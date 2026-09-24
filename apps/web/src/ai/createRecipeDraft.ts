/**
 * AI-create session logic: the multi-turn conversation that turns a natural
 * language description into a valid canonical recipe draft.
 *
 * Flow (Task A in docs/ai_recipe_rules.md):
 *   user text → the AI either replies with a clarifying question (plain German
 *   prose, forwarded to the user) or with the recipe file for this session
 *   (a `finished_dish` — or, when the request implies a reusable base
 *   preparation, that `ingredient_recipe`). The file starts with `---`; a
 *   short German preamble before it is tolerated and shown to the user, and a
 *   code fence around it is stripped. A returned file is parsed with the
 *   strict canonical parser; on failure the precise German issues are sent
 *   back for a repair round (a few attempts, then an error). Once a file
 *   parses, the draft carries the ingredient names that are unknown to the
 *   master data — the UI informs the user; creating them is deferred to the
 *   recipe editor ("Neue Zutat anlegen").
 *
 * The session owns the message history (the AiClient itself is stateless).
 *
 * Two extensions beyond the first prompt:
 * - **Revisions** (Task A4): once a file has been returned, the caller may keep
 *   the conversation going with {@link AiCreateSession.sendRevision} — the same
 *   history is sent again, so the model revises its own draft.
 * - **Live prompt blocks**: {@link AiCreateSession.setSpecifications} replaces
 *   the user's recipe specifications (Typ, Portionen/Ergiebigkeit, Merkmale,
 *   „KI-Verhalten“) and {@link AiCreateSession.setContextText} the runtime
 *   context (used after a sub-recipe was saved mid-conversation). Both only
 *   rebuild the single system message, which is sent anew with every request —
 *   the AiClient contract stays untouched.
 *
 * The same session also runs the AI-edit flow (Task B, "Mit KI bearbeiten"):
 * `task: 'edit'` swaps the task framing for the {@link buildEditTaskText} block
 * and makes every `send` a revision of the transferred original, so the whole
 * conversation is "change request → complete corrected file" instead of
 * "description → new recipe".
 */

import { parseRecipe } from '@cookbook/core';
import type { Recipe, RecipeParseError, Unit } from '@cookbook/core';

import { AI_RULES_TEXT } from './recipeRules';
import type { AiClient, AiMessage } from './types';

/** Maximum consecutive repair rounds after a failed parse (per user turn). */
const MAX_REPAIR_ROUNDS = 2;

/** The fixed structural heading of the canonical body (storage_format.md §5). */
const ZUBEREITUNG = '## Zubereitung';

/**
 * Prefix of a revision turn (Task A4): the change request refers to the file of
 * the previous assistant reply, which must be returned in full again.
 */
const REVISION_PREFIX =
  'Überarbeite den Entwurf aus deiner letzten Antwort und gib die vollständige, korrigierte ' +
  'Rezeptdatei zurück (kein Diff, keine Auslassungen, kein Kommentar außer optional ein bis ' +
  'zwei Sätzen). Behalte `title` und `type` bei, sofern der Wunsch nichts anderes verlangt. ' +
  'Änderungswunsch:';

/**
 * Prefix of the first user turn of an edit session (Task B): the change request
 * refers to the original file transferred in the system instruction, not to a
 * previous assistant reply — so it cannot reuse {@link REVISION_PREFIX}.
 */
const EDIT_PREFIX =
  'Überarbeite das oben übergebene Rezept und gib die vollständige, korrigierte Rezeptdatei ' +
  'zurück (kein Diff, keine Auslassungen, kein Kommentar außer optional ein bis zwei Sätzen). ' +
  'Behalte `title` und `type` bei, sofern der Wunsch nichts anderes verlangt. Änderungswunsch:';

/** Which task a session runs: create a new recipe (Task A) or revise an
 *  existing one (Task B). */
export type AiRecipeTask = 'create' | 'edit';

/**
 * The task framing of a create session (Task A). The rules document carries
 * both task sections, so the system instruction names the one in force — the
 * edit session names its own in the transferred-recipe block
 * (aiContext.buildEditTaskText).
 */
const CREATE_TASK_TEXT =
  '## Auftrag: neues Rezept aus einer Beschreibung erstellen (Task A)\n\n' +
  'Der Nutzer beschreibt unten ein Gericht; es gibt kein Ausgangsrezept. Erstelle daraus gemäß ' +
  'Task A ein neues Rezept im kanonischen Format. Task B („vorhandenes Rezept überarbeiten“) ' +
  'gilt für diese Unterhaltung nicht.';

/**
 * Strips one optional markdown code fence (```markdown … ```) around a reply:
 * the AI is told to return the raw file, but a fenced reply must still parse.
 */
function stripCodeFence(text: string): string {
  const match = /^\s*```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return match !== null ? match[1]! : text;
}

/** An ingredient name used by a draft that is not in the master data yet. */
export interface NewIngredientProposal {
  /** The ingredient name exactly as written in the draft rows. */
  name: string;
  /** The base unit observed in the rows (master data needs a fixed one). */
  unit: Unit;
}

/** The result of one `send`/`reply` step of the session. */
export type AiCreateStepResult =
  | { kind: 'question'; text: string }
  | {
      kind: 'draft';
      recipe: Recipe;
      /** The AI's prose before the file (rule A2's short explanation), '' when
       *  it replied with the bare file. Shown to the user as a chat bubble. */
      preamble: string;
      /** Ingredient names of the draft not yet in the master data (info). */
      newIngredients: NewIngredientProposal[];
    }
  | { kind: 'error'; message: string };

/**
 * One AI-create session: keeps the message history and the repair-loop state.
 * Create via {@link createAiCreateSession}; then call {@link send} with the
 * user's text (description or an answer to a clarifying question) until it
 * resolves to `draft` or `error`.
 */
export interface AiCreateSession {
  /** Sends the user's next text and advances the conversation. */
  send(userText: string): Promise<AiCreateStepResult>;

  /**
   * Sends a change request for the draft of the previous assistant reply
   * (Task A4). Only meaningful once a draft exists — the caller decides that.
   */
  sendRevision(userText: string): Promise<AiCreateStepResult>;

  /**
   * Replaces the „Vorgaben“ block of the system instruction (see
   * aiContext.buildSpecificationsText). Takes effect with the next request.
   */
  setSpecifications(text: string): void;

  /** Replaces the runtime context block (e.g. after a recipe was saved). */
  setContextText(text: string): void;

  /** Replaces the valid sub-recipe titles (a saved draft is one of them now). */
  setIngredientRecipeTitles(titles: ReadonlySet<string>): void;
}

/** Options for {@link createAiCreateSession}. */
export interface AiCreateSessionOptions {
  /** The provider client to call (key already bound). */
  client: AiClient;
  /** The serialized runtime context block (see aiContext.ts). */
  contextText: string;
  /** The serialized Vorgaben block (see aiContext.buildSpecificationsText). */
  specificationsText?: string;
  /**
   * The serialized edit-task block (see aiContext.buildEditTaskText) — the
   * original recipe the session revises. Required when `task` is `'edit'`,
   * ignored otherwise.
   */
  editTaskText?: string;
  /** Which task the session runs (default `'create'`, Task A). */
  task?: AiRecipeTask;
  /** Names present in the loaded ingredient master data. */
  knownIngredientNames: ReadonlySet<string>;
  /** Titles of the collection's ingredient-recipes (valid link targets). */
  ingredientRecipeTitles: ReadonlySet<string>;
}

/** A recipe file extracted from a reply, plus the prose that preceded it. */
interface ExtractedFile {
  /** The canonical file text (from the first `---` line). */
  file: string;
  /** The prose before the file, trimmed ('' when the reply is the bare file). */
  preamble: string;
}

/**
 * Creates the session. The system instruction = static AI rules + the runtime
 * context (personal rules, master data, collection) + the user's Vorgaben.
 */
export function createAiCreateSession(options: AiCreateSessionOptions): AiCreateSession {
  /** Which task this session runs (Task A create vs. Task B edit). */
  const task: AiRecipeTask = options.task ?? 'create';
  /** The runtime context block (aiContext.ts); replaced after a save. */
  let contextText = options.contextText;
  /** The user's Vorgaben block; replaced whenever the settings change. */
  let specificationsText = options.specificationsText ?? '';
  /** Valid sub-recipe titles for the new-ingredient proposal list. */
  let ingredientRecipeTitles = options.ingredientRecipeTitles;
  const messages: AiMessage[] = [{ role: 'system', content: '' }];
  let repairRounds = 0;

  /**
   * Rebuilds the head of the history (the only system message): static rules,
   * the task framing in force, runtime context and the current Vorgaben. The
   * provider receives the system instruction with every request, so replacing
   * it here is enough.
   */
  function rebuildSystemInstruction(): void {
    const taskText = task === 'edit' ? (options.editTaskText ?? '') : CREATE_TASK_TEXT;
    const parts = [AI_RULES_TEXT, taskText, contextText, specificationsText].filter(
      (part) => part.trim() !== '',
    );
    messages[0] = { role: 'system', content: parts.join('\n\n') };
  }
  rebuildSystemInstruction();

  /**
   * Extracts ingredient names of the parsed draft that are not in the master
   * data and not existing ingredient-recipe titles — the propose→confirm list.
   * Grouped by exact trimmed name; the proposal unit is the row's unit (a name
   * used with both g and ml would need two master entries and is left out —
   * the editor flags such drafts; see ai_recipe_rules.md §4).
   */
  function proposeNewIngredients(recipe: Recipe): NewIngredientProposal[] {
    // null marks a name used with mixed units — no fixed base unit, skip.
    const byName = new Map<string, Unit | null>();
    for (const step of recipe.steps) {
      for (const ingredient of step.ingredients) {
        const name = ingredient.name.trim();
        if (options.knownIngredientNames.has(name) || ingredientRecipeTitles.has(name)) {
          continue;
        }
        const existing = byName.get(name);
        if (existing === undefined) {
          byName.set(name, ingredient.unit);
        } else if (existing !== ingredient.unit) {
          byName.set(name, null);
        }
      }
    }
    const proposals: NewIngredientProposal[] = [];
    for (const [name, unit] of byName) {
      if (unit === 'g' || unit === 'ml') proposals.push({ name, unit });
    }
    return proposals.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Extracts the recipe file from a reply that starts with a preamble ("Hier
   * ist das Rezept: …"). Returns the canonical block — the text from the first
   * `---` line whose remainder contains a `## Zubereitung` — plus that
   * preamble, or null when the reply has no file (a genuine clarifying question
   * never contains the step heading). A leftover code-fence close (```) after
   * the file is dropped.
   */
  function extractRecipeFile(reply: string): ExtractedFile | null {
    const lines = reply.split(/\r?\n/);
    let start = -1;
    for (let index = 0; index < lines.length; index++) {
      if (lines[index]!.trim() === '---') {
        start = index;
        break;
      }
    }
    if (start === -1) return null;
    const candidateLines = lines.slice(start);
    while (
      candidateLines.length > 0 &&
      /^```/.test(candidateLines[candidateLines.length - 1]!.trim())
    ) {
      candidateLines.pop();
    }
    const candidate = candidateLines.join('\n').trim();
    if (!candidate.includes(ZUBEREITUNG)) return null;
    return { file: candidate, preamble: lines.slice(0, start).join('\n').trim() };
  }

  /** Asks the AI for a corrected file carrying the German parse issues. */
  async function requestRepair(): Promise<AiCreateStepResult> {
    if (repairRounds >= MAX_REPAIR_ROUNDS) {
      return {
        kind: 'error',
        message:
          'Der Entwurf konnte nach mehreren Versuchen nicht in das gültige Rezeptformat gebracht werden. ' +
          'Bitte formuliere die Beschreibung neu oder erstelle das Rezept manuell.',
      };
    }
    repairRounds += 1;
    return runTurn();
  }

  /** Runs one AI call; the caller has already appended its user message. */
  async function runTurn(): Promise<AiCreateStepResult> {
    let reply: string;
    try {
      reply = await options.client.complete(messages);
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    const raw = reply.trim();
    // Tolerate a markdown code fence around the file (models often wrap).
    const stripped = stripCodeFence(raw).trim();
    if (stripped === '') {
      return { kind: 'error', message: 'Der KI-Assistent hat eine leere Antwort geliefert.' };
    }
    // A finished recipe file starts with the front-matter delimiter (Task A3).
    // A reply that leads with prose but still contains a `---`…`## Zubereitung`
    // block ("Hier ist das Rezept: …") is a draft too — extract that block.
    // Anything else is a clarifying question in plain German prose.
    const fileText = stripped.startsWith('---')
      ? { file: stripped, preamble: '' }
      : extractRecipeFile(stripped);
    if (fileText === null) {
      messages.push({ role: 'assistant', content: reply });
      return { kind: 'question', text: reply };
    }

    let recipe: Recipe;
    try {
      recipe = parseRecipe(fileText.file);
    } catch (err) {
      // RecipeParseError carries the precise German issues (ValidationIssue[]).
      const issues =
        typeof err === 'object' && err !== null && 'issues' in err
          ? (err as RecipeParseError).issues
          : [];
      messages.push({ role: 'assistant', content: reply });
      const detail =
        issues.length > 0
          ? issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')
          : err instanceof Error
            ? err.message
            : String(err);
      messages.push({
        role: 'user',
        content:
          `Das Rezept ist noch nicht im gültigen kanonischen Format. Behebe bitte genau diese ` +
          `Probleme und gib ausschließlich die korrigierte Rezeptdatei zurück (kein Kommentar):\n${detail}`,
      });
      return requestRepair();
    }

    // Parsed cleanly — hand over to the caller with the unknown-ingredient
    // list (informational; creation is deferred to the editor).
    messages.push({ role: 'assistant', content: reply });
    return {
      kind: 'draft',
      recipe,
      preamble: fileText.preamble,
      newIngredients: proposeNewIngredients(recipe),
    };
  }

  return {
    async send(userText: string): Promise<AiCreateStepResult> {
      // The repair budget belongs to one user turn — a long conversation with
      // several drafts must not accumulate it across turns.
      repairRounds = 0;
      // In an edit session the first turn already revises the transferred
      // original, so it carries the same "complete corrected file" framing as a
      // later revision (a clarifying answer keeps it, which is harmless).
      const content = task === 'edit' ? `${EDIT_PREFIX}\n${userText}` : userText;
      messages.push({ role: 'user', content });
      return runTurn();
    },

    async sendRevision(userText: string): Promise<AiCreateStepResult> {
      repairRounds = 0;
      messages.push({ role: 'user', content: `${REVISION_PREFIX}\n${userText}` });
      return runTurn();
    },

    setSpecifications(text: string): void {
      specificationsText = text;
      rebuildSystemInstruction();
    },

    setContextText(text: string): void {
      contextText = text;
      rebuildSystemInstruction();
    },

    setIngredientRecipeTitles(titles: ReadonlySet<string>): void {
      ingredientRecipeTitles = titles;
    },
  };
}
