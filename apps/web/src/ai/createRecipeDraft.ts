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
 */

import { parseRecipe } from '@cookbook/core';
import type { Recipe, RecipeParseError, Unit } from '@cookbook/core';

import { AI_RULES_TEXT } from './recipeRules';
import type { AiClient, AiMessage } from './types';

/** Maximum consecutive repair rounds after a failed parse. */
const MAX_REPAIR_ROUNDS = 2;

/** The fixed structural heading of the canonical body (storage_format.md §5). */
const ZUBEREITUNG = '## Zubereitung';

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
}

/** Options for {@link createAiCreateSession}. */
export interface AiCreateSessionOptions {
  /** The provider client to call (key already bound). */
  client: AiClient;
  /** The serialized runtime context block (see aiContext.ts). */
  contextText: string;
  /** Names present in the loaded ingredient master data. */
  knownIngredientNames: ReadonlySet<string>;
  /** Titles of the collection's ingredient-recipes (valid link targets). */
  ingredientRecipeTitles: ReadonlySet<string>;
}

/**
 * Creates the session. The system instruction = static AI rules + the runtime
 * context (personal rules, master data, collection).
 */
export function createAiCreateSession(options: AiCreateSessionOptions): AiCreateSession {
  const messages: AiMessage[] = [
    {
      role: 'system',
      content: `${AI_RULES_TEXT}\n\n${options.contextText}`,
    },
  ];
  let repairRounds = 0;

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
        if (options.knownIngredientNames.has(name) || options.ingredientRecipeTitles.has(name)) {
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
   * `---` line whose remainder contains a `## Zubereitung` — or null when the
   * reply has none (a genuine clarifying question never contains the step
   * heading). A leftover code-fence close (```) after the file is dropped.
   */
  function extractRecipeFile(reply: string): string | null {
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
    while (candidateLines.length > 0 && /^```/.test(candidateLines[candidateLines.length - 1]!.trim())) {
      candidateLines.pop();
    }
    const candidate = candidateLines.join('\n').trim();
    return candidate.includes(ZUBEREITUNG) ? candidate : null;
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
      ? stripped
      : extractRecipeFile(stripped);
    if (fileText === null) {
      messages.push({ role: 'assistant', content: reply });
      return { kind: 'question', text: reply };
    }

    let recipe: Recipe;
    try {
      recipe = parseRecipe(fileText);
    } catch (err) {
      // RecipeParseError carries the precise German issues (ValidationIssue[]).
      const issues =
        typeof err === 'object' && err !== null && 'issues' in err
          ? ((err as RecipeParseError).issues)
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
      newIngredients: proposeNewIngredients(recipe),
    };
  }

  return {
    async send(userText: string): Promise<AiCreateStepResult> {
      messages.push({ role: 'user', content: userText });
      return runTurn();
    },
  };
}
