/**
 * AI-assisted recipe creation (Phase 3, "Aus Beschreibung (KI)").
 *
 * A full-screen sheet that runs the multi-turn create conversation
 * (docs/ai_recipe_rules.md Task A): the user describes a recipe, the AI may
 * reply with clarifying German questions, and it finally returns a canonical
 * recipe file. The draft is validated with the strict parser inside the
 * session (validate→repair loop); only a valid draft is handed to the editor.
 *
 * Decisions (agreed with the user):
 * - The conversation is shown as a chat transcript.
 * - The API key is pasted here when none is stored yet. By default it lives in
 *   memory only (N6); the key field offers an explicit "Auf diesem Gerät
 *   merken", which writes it to localStorage so a cold start — the Android
 *   share target opens the app fresh — does not ask again. A key that arrives
 *   in one piece (autofill, paste) is applied immediately; typing it by hand
 *   still needs the button, which also stays the fallback when a browser fills
 *   the field without firing `input`.
 * - No blocking "new ingredient" confirm step: the draft opens in the recipe
 *   editor, where unknown ingredient names / sub-recipes are handled with the
 *   editor's existing flows ("Neue Zutat anlegen", saving an ingredient_recipe).
 * - The first prompt has two fields: the description and an optional source
 *   field ("Quelltext") for pasted page text. The source is sent as
 *   "Inspiration" next to the description (composeUserMessage). It exists for
 *   pages the AI cannot read itself — TikTok and Instagram — while nearly every
 *   other recipe link belongs in the description, where the URL context tool
 *   reads it.
 * - The first prompt carries recipe specifications below the prompt and source
 *   fields: the manual editor's Typ and Portionen/Ergiebigkeit controls
 *   (defaults: 6 Portionen for a Gericht, Gewicht / 1 kg for a Zutaten-Rezept),
 *   the Merkmale flags "Vorgaben" (vegan — always on for now, schnell und
 *   einfach, günstig) and "KI-Verhalten" (Bei Bedarf nachfragen vs. Direkt
 *   entwerfen).
 *   They are serialized into the system instruction (aiContext.ts), so they
 *   constrain the whole conversation — including revisions and repair rounds.
 * - The conversation does not end with a draft: the composer stays visible, and
 *   a change request goes to `sendRevision` (rule A4) — the AI revises its own
 *   draft instead of the user reworking it by hand.
 * - The draft-ready card belongs to the transcript, at the turn that created
 *   it — not to a fixed block above the composer. A later change request or
 *   clarifying question then reads *below* the draft it refers to. Only the
 *   current draft card is kept: a newer draft replaces the previous one.
 * - When the user saves a drafted Zutaten-Rezept in the editor, the conversation
 *   continues here: the parent hands the saved recipe back via `handoff`, the
 *   context is re-read (the new sub-recipe is a valid ingredient now) and the
 *   follow-up field is prefilled with the request for the dish that uses it.
 * - Ctrl+Enter sends from inside a text field (plain Enter stays a line break).
 *   The shortcut's caption lives *in the field*, not next to the "Senden"
 *   button: the action row is the last element of a tall composer, so while the
 *   user types it is normally scrolled out of view, whereas the focused field
 *   is on screen by definition. The caption is shown only while a field has
 *   focus and only on pointer/keyboard devices — see .ai-field-hint.
 *
 * The same sheet also runs the AI-edit flow ("Mit KI bearbeiten", Task B of the
 * rules): `mode === 'edit'` drops every create-only extra — the source field
 * and the Typ/Portionen/Merkmale/„KI-Verhalten“ block — so the screen is the
 * explanation plus a *single* prompt field. The original recipe is transferred
 * to the AI in full (buildEditTaskText) and the user only describes the desired
 * changes; the prompt's explanation says exactly that. Everything else (API
 * key, transcript, revision turns, draft hand-over to the editor, exit guard)
 * is shared, and the first edit turn is already a revision of the original.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent, Ref } from 'react';

import { allIngredientMappings, integerLadderValues, serializeRecipe } from '@cookbook/core';
import type { Recipe, RecipeType } from '@cookbook/core';

import {
  buildCollectionText,
  buildEditTaskText,
  buildGuidelinesText,
  buildSpecificationsText,
} from '../ai/aiContext';
import type { RecipeSpecifications } from '../ai/aiContext';
import { createAiCreateSession } from '../ai/createRecipeDraft';
import type { AiCreateSession } from '../ai/createRecipeDraft';
import { createAiClient } from '../ai/client';
import {
  forgetStoredAiApiKey,
  getAiApiKey,
  isAiApiKeyRemembered,
  setAiApiKey,
} from '../ai/sessionKey';
import type { StoredRecipe } from '../drive/recipeStorage';
import { listRecipes, readRecipe } from '../drive/recipeStorage';
import { loadRecipeGuidelines } from '../drive/personalRules';
import { useEscapeTrigger, useLeaveGuard, type LeaveReason } from '../hooks/useLeaveGuard';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import QuantityPicker from './QuantityPicker';
import { EyeIcon } from './icons';

/** One bubble of the chat transcript. */
interface ChatMessage {
  kind: 'message';
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The draft-ready card, kept inside the transcript at the exact point of the
 * conversation that created it. It is a transcript entry rather than a fixed
 * block above the composer, so a later message (a revision request or a
 * clarifying question) appears *below* the draft it refers to instead of above
 * it. Only the current draft is kept: a newer draft replaces the previous card.
 */
interface ChatDraft {
  kind: 'draft';
  recipe: Recipe;
}

/** One entry of the chat transcript: a message bubble or the draft card. */
type ChatEntry = ChatMessage | ChatDraft;

/** A draft the user saved in the editor, handed back to the running chat. */
export interface AiHandoff {
  /** The title as saved (the user may have renamed the draft in the editor). */
  title: string;
  /** The saved recipe's type — only a Zutaten-Rezept continues the chat. */
  type: RecipeType;
}

/** Integer standard numbers 1–30 — the allowed serving counts, identical to
 *  the manual editor's Portionen chips (decision 7). */
const SERVING_OPTIONS = integerLadderValues(1, 30);

/** Default Portionen of a finished dish (agreed with the user). */
const DEFAULT_SERVINGS = 6;

/** Default Ergiebigkeit of a Zutaten-Rezept: 1 kg, measured by weight. */
const DEFAULT_YIELD = 1000;

/** How the AI should behave on the first prompt (agreed with the user): ask a
 *  clarifying question when something is ambiguous, or always draft directly. */
type ReplyMode = 'clarify' | 'draft';

/** Minimum length of an auto-applied key. Real provider keys are far longer (a
 *  Gemini key is ~39 characters), so anything shorter is a typing fragment or a
 *  partial paste and waits for the explicit button. */
const MIN_API_KEY_LENGTH = 20;

/**
 * True when the key field just received a plausibly complete key in one piece
 * — an autofill or a paste — rather than one typed character.
 *
 * Chrome reports both password-manager autofill and `insertReplacementText`
 * completions as a single `input` event, so the bulk check fires the moment the
 * user taps the mobile suggestion. The fill itself stays out of the page's
 * control: Chrome on Android gates password autofill on a user gesture, while
 * the desktop build fills password fields on page load. Auto-apply therefore
 * removes the "Schlüssel verwenden" tap after the fill, not the fill tap.
 */
function shouldAutoApplyKey(previousValue: string, nextValue: string, inputType: string): boolean {
  if (nextValue.trim().length < MIN_API_KEY_LENGTH) return false;
  if (inputType === 'insertReplacementText') return true;
  return nextValue.length - previousValue.length > 1;
}

/** Input `type`s that hold free text — the fields a text cursor can sit in. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * En space (U+2002) — the separator around the middot of the field hint. A
 * plain space (≈ 0.26 em) left the two commands reading as one phrase, so the
 * widest standard space that still counts as word spacing (0.5 em) is used; the
 * escape is kept instead of the literal character so the source stays readable
 * and no irregular-whitespace rule is tripped.
 */
const EN_SPACE = '\u2002';

/**
 * True when a key or focus event happened in a text entry field: a textarea or
 * a text-holding input. This is the single definition of "the cursor is in a
 * text field" for the Ctrl+Enter shortcut (see handleComposerKeyDown); the
 * hint's visibility mirrors it in CSS (`.ai-composer:has(textarea:focus)`),
 * so the two must be kept in step when the composer gains a new field type.
 */
function isTextEntryField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/**
 * The Ctrl+Enter caption of one composer field (see handleComposerKeyDown). It
 * is a sibling of the field's textarea, not a child: a badge painted into the
 * field would otherwise collide with the last text line and the caret. The CSS
 * reserves a strip inside the field for it and reveals it only while that field
 * has focus on a pointer/keyboard device — the same conditions under which the
 * shortcut works, so the caption never promises a dead key.
 */
function FieldHint() {
  return (
    <span className="ai-field-hint">
      Enter: neue Zeile{EN_SPACE}·{EN_SPACE}Strg + Enter: Senden
    </span>
  );
}

/**
 * Grows a composer text area to its content, so the field never scrolls inside
 * itself (docs/DESIGN.md §5.3). The height is re-synced on every value change,
 * the CSS min-height keeps the empty field at its starting size, and the user
 * cannot resize it (resize: none). The floor is dropped for the measurement, so
 * scrollHeight reflects only the text — the same measurement AutoGrowTextarea
 * performs for the editor's fields.
 */
function useGrowingTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const previousMinHeight = element.style.minHeight;
    element.style.minHeight = '0px';
    element.style.height = '0px';
    const borderY =
      parseFloat(getComputedStyle(element).borderTopWidth) +
      parseFloat(getComputedStyle(element).borderBottomWidth);
    element.style.height = `${element.scrollHeight + borderY}px`;
    element.style.minHeight = previousMinHeight;
  }, [value]);
  return ref;
}

/**
 * Imperative handle for the exit-trigger integration (owned by App), mirroring
 * the recipe editor: the sheet is asked whether it consumes a browser Back (or
 * a swipe-back, which arrives as one) before the app closes the AI-create
 * screen. Consumed means the discard question was armed. Escape is handled by
 * the sheet itself and shares the same guard.
 */
export interface AiCreateSheetHandle {
  /** True when the back was handled inside the sheet; false when the sheet may
   *  close and return to the recipe list. */
  notifyBack: () => boolean;
}

interface AiCreateSheetProps {
  /** Drive access token (the Drive connection is required). */
  token: string;
  /**
   * Which task the sheet runs: `'create'` (Task A, the default) starts a new
   * recipe from a description, `'edit'` (Task B) revises the recipe passed as
   * `editTarget`. Edit mode hides the create-only extras (the Vorgaben block)
   * and shows a single prompt field.
   */
  mode?: 'create' | 'edit';
  /**
   * The recipe to revise — required in `'edit'` mode, ignored otherwise. Its
   * canonical text is transferred to the AI in full, so the user only describes
   * the desired changes.
   */
  editTarget?: StoredRecipe;
  /**
   * Prefill of the create task's request field. App passes the complete Keep
   * text of an unrecognized meal-plan entry here ("Eintrag ersetzen" → "Rezept
   * mit KI schreiben"), so the conversation starts from that dish. Ignored in
   * `'edit'` mode, where the field is the change request.
   */
  initialPrompt?: string;
  /**
   * Prefill of the create task's source field ("Quelltext"). App passes the
   * caption extracted from a shared TikTok link here, so the user lands on the
   * composer with the page text already in place. Ignored in `'edit'` mode.
   */
  initialSource?: string;
  /**
   * True while this screen is the visible one. The sheet deliberately stays
   * mounted (hidden) while its own draft is edited, so its Escape trigger must
   * be off in that state — otherwise Escape would hit the editor and this sheet
   * at once.
   */
  visible: boolean;
  /** All recipes of the collection (for the AI context, read lazily). */
  recipes: StoredRecipe[];
  /**
   * A draft the user saved in the editor while this sheet was mounted (hidden).
   * Non-null continues the conversation: the context is re-read and the
   * follow-up field is prefilled. The parent clears it via the callback below.
   */
  handoff: AiHandoff | null;
  /** Called once the handoff was applied (the parent resets it to null). */
  onHandoffConsumed: () => void;
  /** Back without saving. */
  onClose: () => void;
  /** A validated AI draft is ready for review — open it in the editor. */
  onOpenDraft: (recipe: Recipe) => void;
  /** Browser-back consumer handle (React 19: ref is a regular prop). */
  ref?: Ref<AiCreateSheetHandle>;
}

/** The AI context block (aiContext.ts) plus the collection facts it was built
 *  from — the session needs the sub-recipe titles for its proposal list too. */
interface LoadedContext {
  /** The serialized guidelines block for the system instruction. */
  guidelinesText: string;
  /** The serialized collection block for the system instruction. */
  collectionText: string;
  /** Titles of the collection's ingredient-recipes (valid link targets). */
  ingredientRecipeTitles: Set<string>;
}

/**
 * Loads the runtime context: personal rules (Drive) + the collection contents
 * (ingredient_recipes are embedded in full; every readable file contributes its
 * title). Broken files are skipped — like the editor does.
 */
async function loadContext(token: string, stored: readonly StoredRecipe[]): Promise<LoadedContext> {
  const personalRules = await loadRecipeGuidelines(token);
  const contextRecipes: Array<{ recipe: Recipe }> = [];
  for (const entry of stored) {
    try {
      contextRecipes.push({ recipe: await readRecipe(token, entry.fileId) });
    } catch {
      // Broken file — never blocks the AI session.
    }
  }
  const ingredientRecipeTitles = new Set(
    contextRecipes
      .filter(({ recipe }) => recipe.type === 'ingredient_recipe')
      .map(({ recipe }) => recipe.title),
  );
  return {
    guidelinesText: buildGuidelinesText(personalRules),
    collectionText: buildCollectionText({
      masterData: allIngredientMappings(),
      recipes: contextRecipes,
    }),
    ingredientRecipeTitles,
  };
}

/**
 * Loads the session prerequisites and creates the session. Requires a stored
 * session API key (N6). In edit mode the target recipe is read and transferred
 * to the AI in full (Task B); a broken target file therefore fails preparation
 * instead of silently editing something else.
 */
async function prepareSession(
  token: string,
  stored: readonly StoredRecipe[],
  editTarget?: StoredRecipe,
): Promise<AiCreateSession> {
  const apiKey = getAiApiKey();
  if (apiKey === null) {
    throw new Error('Kein API-Schlüssel hinterlegt.');
  }
  const context = await loadContext(token, stored);
  if (editTarget !== undefined) {
    const originalText = serializeRecipe(await readRecipe(token, editTarget.fileId));
    return createAiCreateSession({
      client: createAiClient({ provider: 'gemini', apiKey }),
      guidelinesText: context.guidelinesText,
      collectionText: context.collectionText,
      editTaskText: buildEditTaskText(originalText),
      task: 'edit',
      knownIngredientNames: new Set(Object.keys(allIngredientMappings())),
      ingredientRecipeTitles: context.ingredientRecipeTitles,
    });
  }
  return createAiCreateSession({
    client: createAiClient({ provider: 'gemini', apiKey }),
    guidelinesText: context.guidelinesText,
    collectionText: context.collectionText,
    knownIngredientNames: new Set(Object.keys(allIngredientMappings())),
    ingredientRecipeTitles: context.ingredientRecipeTitles,
  });
}

/**
 * The context note that tells the model a recipe of this conversation has been
 * saved. Rule A2 sends the user to a *new* AI-create otherwise ("one recipe per
 * conversation"), so the continuation needs an explicit state note.
 */
function handoffNote(title: string): string {
  return (
    '# Stand dieser Unterhaltung\n' +
    `Das Zutaten-Rezept „${title}“ wurde soeben gespeichert und ist jetzt in der Sammlung ` +
    'vorhanden (siehe „Zutaten-Rezepte“ oben). Du darfst es ab jetzt als Zutat in ' +
    'einem Gericht verwenden; der Nutzer muss dafür keine neue Anfrage starten.'
  );
}

/** The prefilled follow-up request for the dish that uses the saved sub-recipe. */
function handoffPrompt(title: string): string {
  return `Erstelle jetzt das eigentliche Gericht und verwende „${title}“ als Zutat.`;
}

/**
 * Composes the first user turn out of the two create fields: the user's
 * description and the optional source text (a page's text the AI cannot read
 * itself, e.g. a TikTok caption). The source is labelled "Inspiration" so the
 * model treats it as reference material rather than as an instruction. Either
 * field may be empty; the caller guarantees that at least one is filled.
 */
function composeUserMessage(description: string, source: string): string {
  const parts = [description.trim()];
  if (source.trim() !== '') {
    parts.push(`Als Inspiration übernehme ich folgenden Quelltext:\n\n${source.trim()}`);
  }
  return parts.join('\n\n');
}

/** The current (newest) draft in the transcript, or null. */
function currentDraft(entries: readonly ChatEntry[]): Recipe | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'draft') return entry.recipe;
  }
  return null;
}

/**
 * Appends a draft card to the transcript and drops every previous one: only the
 * current draft may stay tappable, because an older card would open a
 * superseded revision in the editor.
 */
function appendDraft(entries: readonly ChatEntry[], recipe: Recipe): ChatEntry[] {
  return [...entries.filter((entry) => entry.kind === 'message'), { kind: 'draft', recipe }];
}

export default function AiCreateSheet({
  token,
  mode = 'create',
  editTarget,
  initialPrompt,
  initialSource,
  visible,
  recipes,
  handoff,
  onHandoffConsumed,
  onClose,
  onOpenDraft,
  ref,
}: AiCreateSheetProps) {
  /** True for the edit task (Task B): no create extras, single prompt field. */
  const isEdit = mode === 'edit';
  /** The prepared session; null while the context loads or no key is set. */
  const [session, setSession] = useState<AiCreateSession | null>(null);
  /** True while the context + session load runs (mount, or after key save). */
  const [preparing, setPreparing] = useState(() => getAiApiKey() !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** German key input shown while no session key is stored (N6). */
  const [showKeyField, setShowKeyField] = useState(() => getAiApiKey() === null);
  const [keyInput, setKeyInput] = useState('');
  /** True when the key is remembered on this device (opt-in in the key field). */
  const [rememberKey, setRememberKey] = useState(false);
  /** True while a key remembered on this device is in use — drives the quiet
   *  "Vergessen" line under the composer. */
  const [keyRemembered, setKeyRemembered] = useState(() => isAiApiKeyRemembered());
  /** Chat transcript, including the draft card at its creation point. */
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [description, setDescription] = useState(initialPrompt ?? '');
  /** Optional source text ("Quelltext") of the first turn: a page the AI
   *  cannot read itself (TikTok/Instagram caption). Prefilled by App when the
   *  sheet was opened from a shared link. */
  const [source, setSource] = useState(isEdit ? '' : (initialSource ?? ''));
  /** The prompt field grows with its content (§5.3). One ref serves the first
   *  field and, once a conversation started, the reply field. */
  const draftFieldRef = useGrowingTextarea(description);
  /** The source field grows the same way; it disappears once the first turn
   *  was sent. */
  const sourceFieldRef = useGrowingTextarea(source);
  /**
   * Recipe specifications below the prompt field (editor parity): the Typ
   * toggle, the type-dependent Portionen / Ergiebigkeit input, and the
   * Merkmale flags. They are serialized into the session's system instruction
   * (see the specification effect below), so they constrain every turn of the
   * conversation instead of being sent as a chat message.
   */
  const [recipeType, setRecipeType] = useState<RecipeType>('finished_dish');
  /** Finished dish: chosen serving count (defaults to 6, agreed with the user). */
  const [servings, setServings] = useState<number>(DEFAULT_SERVINGS);
  /** Zutaten-Rezept: yield quantity and its base unit (g/ml); defaults 1 kg. */
  const [yieldQuantity, setYieldQuantity] = useState<number>(DEFAULT_YIELD);
  const [yieldUnit, setYieldUnit] = useState<'g' | 'ml'>('g');
  /** Merkmale: „schnell und einfach“ and „günstig“ default to off. „vegan“ is
   *  permanently on for now (the app's only user is vegan); the checkbox stays
   *  interactive-looking but cannot be turned off (see the flags row below). */
  const [wantsVegan, setWantsVegan] = useState(true);
  const [wantsFast, setWantsFast] = useState(false);
  const [wantsCheap, setWantsCheap] = useState(false);
  /** „KI-Verhalten“: ask for clarification by default (current behaviour). */
  const [replyMode, setReplyMode] = useState<ReplyMode>('clarify');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  /** The validated draft the conversation is currently working on. It is the
   *  newest draft card in the transcript, so the card's position and the
   *  revision state can never drift apart. */
  const draft = currentDraft(entries);

  /** True while mounted — guards late promise resolutions. StrictMode
   *  double-invokes effects (setup → cleanup → setup), so the flag is
   *  re-asserted in the setup body, not only initialized once. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Loads the session prerequisites (throws on failure). */
  const loadSession = useCallback(
    (activeToken: string): Promise<AiCreateSession> =>
      prepareSession(activeToken, recipes, editTarget),
    [recipes, editTarget],
  );

  /** Applies the prepared session (state updates from promise callbacks). */
  const applySession = useCallback(
    (activeToken: string): void => {
      loadSession(activeToken)
        .then((next) => {
          if (!mountedRef.current) return;
          setSession(next);
          setLoadError(null);
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setLoadError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!mountedRef.current) return;
          setPreparing(false);
        });
    },
    [loadSession],
  );

  // Prepare the session once a key is stored. Re-runs (fresh parent props,
  // StrictMode double-mount) must not replace a session that is already in
  // use — preparation is a one-shot per token; the ref guards that.
  const preparedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (getAiApiKey() === null) return;
    if (preparedTokenRef.current === token) return;
    preparedTokenRef.current = token;
    applySession(token);
  }, [token, applySession]);

  // Keep the newest bubble visible.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [entries, busy]);

  /**
   * Serializes the current Vorgaben into the session's system instruction. The
   * session is created without them, so this effect also performs the initial
   * push; every later control change only rebuilds the system message and takes
   * effect with the next turn (a change alone never triggers a request).
   *
   * Edit mode has no Vorgaben controls: the task's own block (the transferred
   * recipe) already frames the session, so there is nothing to push.
   */
  useEffect(() => {
    if (session === null || isEdit) return;
    session.setSpecifications(
      buildSpecificationsText({
        type: recipeType,
        servings: recipeType === 'finished_dish' ? servings : null,
        yieldQuantity: recipeType === 'ingredient_recipe' ? yieldQuantity : null,
        yieldUnit,
        vegan: wantsVegan,
        fast: wantsFast,
        cheap: wantsCheap,
        replyMode,
      } satisfies RecipeSpecifications),
    );
  }, [
    session,
    isEdit,
    recipeType,
    servings,
    yieldQuantity,
    yieldUnit,
    wantsVegan,
    wantsFast,
    wantsCheap,
    replyMode,
  ]);

  /**
   * Continues the conversation after the user saved a drafted sub-recipe in the
   * editor. The context has to be re-read: the saved file is the AI's proof that
   * the Zutaten-Rezept exists now (rule A2 forbids inventing one) and the exact
   * title must appear in the context list. `listRecipes` is used instead of the
   * `recipes` prop because the parent's refresh is asynchronous.
   *
   * The parent's signal is only cleared once the refresh is done — that keeps
   * {@link refreshing} (derived below) true for the whole re-read.
   */
  useEffect(() => {
    if (handoff === null || session === null) return;
    listRecipes(token)
      .then((stored) => loadContext(token, stored))
      .then((context) => {
        if (!mountedRef.current) return;
        session.setCollectionText(`${context.collectionText}\n\n${handoffNote(handoff.title)}`);
        session.setIngredientRecipeTitles(context.ingredientRecipeTitles);
        // The saved draft's card is history now — the next message is the dish.
        // It leaves the transcript at its old place instead of being pulled
        // below the new note.
        setEntries((current) => [
          ...current.filter((entry) => entry.kind === 'message'),
          {
            kind: 'message',
            role: 'assistant',
            content: `„${handoff.title}“ ist gespeichert und steht dir jetzt als Zutat zur Verfügung.`,
          },
        ]);
        if (handoff.type === 'ingredient_recipe') {
          setDescription(handoffPrompt(handoff.title));
        }
        onHandoffConsumed();
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        onHandoffConsumed();
      });
  }, [handoff, session, token, onHandoffConsumed]);

  /** Stores the pasted / autofilled key for this session and prepares the session. */
  const handleKeyApply = (rawKey: string): void => {
    if (rawKey.trim() === '') return;
    setAiApiKey(rawKey, { remember: rememberKey });
    setKeyRemembered(rememberKey);
    setKeyInput('');
    setShowKeyField(false);
    setLoadError(null);
    setPreparing(true);
    // Same one-shot guard as the mount effect — the key-save triggers the
    // preparation itself, so the effect must not run a second one later.
    if (preparedTokenRef.current !== token) {
      preparedTokenRef.current = token;
      applySession(token);
    }
  };

  /**
   * Removes the key remembered on this device. The running session keeps
   * working (its client already holds the key); only the next start asks again.
   */
  const handleForgetStoredKey = (): void => {
    forgetStoredAiApiKey();
    setKeyRemembered(false);
  };

  /** Sends the description / source text / answer and advances the conversation. */
  const handleSend = async (): Promise<void> => {
    if (session === null || busy || refreshing) return;
    if (description.trim() === '' && source.trim() === '') return;
    setError(null);
    // The source field belongs to the first turn only; once a conversation is
    // running it is empty (the reply field replaces both create fields).
    const userText = composeUserMessage(description, source);
    // A draft already exists: this text is a change request for it (rule A4).
    const revise = draft !== null;
    setEntries((current) => [...current, { kind: 'message', role: 'user', content: userText }]);
    setDescription('');
    setSource('');
    setBusy(true);
    try {
      const result = revise ? await session.sendRevision(userText) : await session.send(userText);
      if (result.kind === 'question') {
        setEntries((current) => [
          ...current,
          { kind: 'message', role: 'assistant', content: result.text },
        ]);
      } else if (result.kind === 'draft') {
        // The AI's own prose before the file (rule A2) belongs in the
        // transcript; on a revision it is what explains the change. The card
        // then follows that prose at the point of this turn.
        setEntries((current) => {
          const next: ChatEntry[] = [...current];
          if (result.preamble !== '') {
            next.push({ kind: 'message', role: 'assistant', content: result.preamble });
          }
          return appendDraft(next, result.recipe);
        });
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ctrl+Enter sends the current prompt while the cursor sits in a text entry
   * field: the composer's textareas keep plain Enter for line breaks, so the
   * shortcut is the keyboard equivalent of the "Senden" button. The keydown
   * bubbles from the focused field up to the form, so a single handler covers
   * every field of the composer. `preventDefault` also suppresses the newline
   * the browser would otherwise insert; the empty/busy/refreshing guards live
   * in {@link handleSend}.
   *
   * The shortcut deliberately does *not* fire outside a text field (see
   * {@link isTextEntryField}): on the "Senden" button plain Enter already
   * activates the focused control, so also grabbing Ctrl+Enter there would
   * submit twice, and on the Typ/Portionen/Merkmale controls the key belongs
   * to the control itself. This is also the condition the visible hint uses
   * (`.ai-composer:has(textarea:focus)`), so hint and behaviour agree.
   */
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== 'Enter' || !event.ctrlKey) return;
    if (!isTextEntryField(event.target)) return;
    event.preventDefault();
    void handleSend();
  };

  /** True once the user sent the first prompt — from then on only a single
   *  answer field is shown (the two-field description layout is over). */
  const conversationStarted = entries.length > 0;
  /** True while a saved sub-recipe is being re-read into the AI context — a
   *  send during that window would reach the model without the new ingredient
   *  recipe, so the button waits (derived, not state: it mirrors the parent's
   *  handoff signal, which is cleared when the refresh finished). */
  const refreshing = handoff !== null && session !== null;
  const canSend = !busy && !refreshing && (description.trim() !== '' || source.trim() !== '');

  /**
   * Placeholder of the shared prompt field. Before the first turn an edit
   * session asks for the change, a create session for the whole dish; later
   * turns answer a question or revise the draft.
   */
  const promptPlaceholder =
    draft !== null
      ? 'Änderung am Entwurf beschreiben …'
      : conversationStarted
        ? 'Antwort eingeben …'
        : isEdit
          ? 'Änderung beschreiben …'
          : 'Rezept beschreiben …';

  /**
   * The prefilled request, if App handed one over (a create started from an
   * unrecognized meal-plan entry). Kept as a value so "has the user touched the
   * composer?" can be answered: a prefill the user never edited is not work to
   * discard.
   */
  const initialPromptValue = initialPrompt ?? '';
  /** The same for the source field: the caption App handed over with a shared
   *  link. An untouched prefill is not work either — re-sharing the link is
   *  cheaper than a discard question. */
  const initialSourceValue = isEdit ? '' : (initialSource ?? '');

  /** True when leaving would discard started work: text typed into the
   *  composer, a started conversation, or an AI draft that was never saved.
   *  A prefilled entry text or shared caption that is still untouched is *not*
   *  work — leaving then discards nothing the user wrote. The API-key field is
   *  deliberately excluded too — the key is session-only (N6), so leaving it
   *  loses nothing. */
  const hasWork =
    (description !== initialPromptValue && description.trim() !== '') ||
    (source !== initialSourceValue && source.trim() !== '') ||
    entries.length > 0 ||
    draft !== null;

  /**
   * Fingerprint of the started work (content and shape, not just presence): the
   * shared exit guard binds the armed discard confirmation to it, so any later
   * change — typing, a new message, a new or cleared draft — invalidates the
   * arm during render instead of surviving it. The armed question (the sheet over
   * the screen) therefore disappears exactly when the work
   * it threatened is gone (see useLeaveGuard).
   */
  const guard = useLeaveGuard({
    workSignature: `${description}\u0000${source}\u0000${entries.length}\u0000${draft !== null}`,
    needsConfirm: hasWork,
  });

  /** Leaves the AI screen for the recipe list. */
  const executeLeave = useCallback((): void => {
    guard.reset();
    onClose();
  }, [guard, onClose]);

  /** The one exit hop every trigger uses (see useLeaveGuard). */
  const requestLeave = useCallback(
    (reason: LeaveReason): boolean => guard.request(reason, executeLeave),
    [guard, executeLeave],
  );

  // Escape is the keyboard equivalent of the browser Back button: it opens the
  // same discard question — and closes it again while it is open — instead of
  // leaving the screen. Off while the editor covers this sheet (see
  // AiCreateSheetProps.visible).
  useEscapeTrigger(() => void requestLeave('escape'), visible);

  /**
   * Browser-back consumer (see AiCreateSheetHandle and App): started work arms
   * the discard question through the shared guard (the same confirmation as the
   * header button and Escape, rendered by LeaveConfirmSheet over the screen), so
   * neither the browser / device Back button nor the swipe-back gesture silently
   * drops the conversation. Back while the question is open closes it —
   * „Abbrechen" — and never discards (§6.2).
   */
  useImperativeHandle(ref, () => ({
    notifyBack: (): boolean => requestLeave('browser-back'),
  }));

  return (
    <main className="app app-narrow ai-screen">
      <header className="app-header app-header-stacked">
        {/* Back button on its own line at the top left (editor placement), the
            screen title below it — the stack itself is .app-header-stacked
            (styles/recipe-list.css), shared with the shopping-list selection.
            The header carries nothing but „Zurück" and the title: the discard
            question is a sheet over the screen (LeaveConfirmSheet, §6.2), never
            a line in here. */}
        <button
          type="button"
          className="text-button back-button"
          onClick={() => void requestLeave('button')}
        >
          Zurück
        </button>
        <h1>{isEdit ? 'Rezept mit KI bearbeiten' : 'Rezept mit KI schreiben'}</h1>
      </header>

      {showKeyField ? (
        <section className="editor-card ai-key-card" aria-label="API-Schlüssel">
          <h2 className="editor-card-title">Gemini-API-Schlüssel</h2>
          <p>
            Füge deinen Gemini-API-Schlüssel ein. Er gilt für diese Sitzung; mit dem Häkchen
            darunter auch nach einem Neustart der App.
          </p>
          <input
            type="password"
            autoComplete="off"
            value={keyInput}
            placeholder="API-Schlüssel einfügen"
            onChange={(event) => {
              const nextValue = event.target.value;
              // InputEvent carries the inputType; autofill and paste arrive as
              // one bulk change (see shouldAutoApplyKey).
              const inputType =
                event.nativeEvent instanceof InputEvent ? event.nativeEvent.inputType : '';
              if (shouldAutoApplyKey(keyInput, nextValue, inputType)) {
                handleKeyApply(nextValue);
                return;
              }
              setKeyInput(nextValue);
            }}
          />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(event) => setRememberKey(event.target.checked)}
            />
            <span>Auf diesem Gerät merken</span>
          </label>
          <p className="field-hint">
            Der Schlüssel wird dann dauerhaft in diesem Browser gespeichert — nur auf einem Gerät,
            das du allein nutzt.
          </p>
          <div className="sheet-actions">
            <button
              type="button"
              className="primary-button"
              disabled={keyInput.trim() === ''}
              onClick={() => handleKeyApply(keyInput)}
            >
              Schlüssel verwenden
            </button>
          </div>
        </section>
      ) : (
        <>
          {loadError !== null && (
            <p className="error-message" role="alert">
              {loadError}
            </p>
          )}
          {preparing && session === null && (
            <p className="loading-message" role="status">
              Kontext wird vorbereitet …
            </p>
          )}
          {session !== null && (
            <>
              <section className="ai-transcript" ref={transcriptRef} aria-label="Unterhaltung">
                {entries.length === 0 && (
                  <div className="ai-hint">
                    {isEdit ? (
                      // Edit task (Task B): the whole point of the screen is
                      // that the user does not retype the recipe — say so before
                      // the single prompt field. Both variants name the one
                      // thing that replaces copied page text: a link.
                      <p>
                        Das Rezept „{editTarget?.title ?? ''}“ wird vollständig an die KI übergeben.
                        Beschreibe die gewünschten Änderungen frei und beliebig detailliert.
                        Rezept-Links kannst du direkt einfügen — die KI liest die Seite selbst.
                      </p>
                    ) : (
                      <p>
                        Beschreibe das Gericht frei und beliebig detailliert. Die meisten
                        Rezept-Links kannst du direkt einfügen — die KI liest die Seite selbst.
                      </p>
                    )}
                  </div>
                )}
                {entries.map((entry, index) =>
                  entry.kind === 'message' ? (
                    <p key={index} className={`ai-bubble ai-${entry.role}`}>
                      {entry.content}
                    </p>
                  ) : (
                    // The draft card is a transcript entry: it stays at the
                    // point of the turn that created it, so later messages read
                    // below the draft they belong to.
                    <section key={index} className="editor-card ai-draft-card">
                      <h2 className="editor-card-title">Entwurf erstellt</h2>
                      <p>
                        {isEdit
                          ? `Ich habe eine überarbeitete Fassung von „${entry.recipe.title}“ erstellt. Du kannst sie jetzt im Editor prüfen und speichern — dabei wird das vorhandene Rezept ersetzt — oder unten beschreiben, was die KI weiter ändern soll.`
                          : `Ich habe einen Entwurf für „${entry.recipe.title}“ erstellt. Du kannst ihn jetzt im Editor ansehen, ändern und speichern — oder unten beschreiben, was die KI am Entwurf ändern soll.`}
                      </p>
                      <div className="sheet-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => {
                            // Opening the draft is a deliberate "keep working"
                            // action — drop any armed discard confirmation so the
                            // header button reads "Zurück" again on return.
                            guard.reset();
                            onOpenDraft(entry.recipe);
                          }}
                        >
                          <EyeIcon className="button-icon" optical={20} />
                          <span>Entwurf überprüfen</span>
                        </button>
                      </div>
                    </section>
                  ),
                )}
                {busy && (
                  <p className="ai-bubble ai-assistant" role="status">
                    Die KI denkt nach …
                  </p>
                )}
              </section>

              <form
                className="ai-composer"
                onKeyDown={handleComposerKeyDown}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                {conversationStarted || isEdit ? (
                  // Follow-up answer or change request (and the single prompt
                  // field of the edit screen): one field that grows with its
                  // content (§5.3), never a fixed height that scrolls.
                  <div className="ai-field">
                    <textarea
                      ref={draftFieldRef}
                      value={description}
                      placeholder={promptPlaceholder}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                    <FieldHint />
                  </div>
                ) : (
                  <>
                    {/* First prompt (description): the same floor, grown to fit. */}
                    <div className="ai-field">
                      <textarea
                        ref={draftFieldRef}
                        value={description}
                        placeholder={promptPlaceholder}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                      <FieldHint />
                    </div>

                    {/* Optional source text ("Quelltext"): page text the AI
                        cannot fetch itself. TikTok and Instagram block the URL
                        context tool, so their captions belong here; nearly
                        every other recipe link belongs in the field above. */}
                    <div className="field ai-field ai-source-field">
                      <span className="field-label">
                        Quelltext<span className="optional-mark">(optional)</span>
                      </span>
                      <textarea
                        ref={sourceFieldRef}
                        value={source}
                        placeholder="Beschreibungstext einfügen …"
                        onChange={(event) => setSource(event.target.value)}
                      />
                      <p className="field-hint">
                        TikTok- und Instagram-Links kann die KI nicht öffnen. Kopiere dort den
                        Beschreibungstext und füge ihn hier ein.
                      </p>
                    </div>

                    {/* Rezept-Vorgaben — the manual editor's Typ and
                        Portionen/Ergiebigkeit controls plus the Merkmale
                        flags. Serialized into the AI prompt (see the
                        specification effect above). */}
                    <div className="ai-options">
                      <div className="field">
                        <span className="field-label">Typ</span>
                        <div className="segmented" role="group" aria-label="Rezept-Typ">
                          <button
                            type="button"
                            className={recipeType === 'finished_dish' ? 'segmented-active' : ''}
                            onClick={() => setRecipeType('finished_dish')}
                          >
                            Gericht
                          </button>
                          <button
                            type="button"
                            className={recipeType === 'ingredient_recipe' ? 'segmented-active' : ''}
                            onClick={() => setRecipeType('ingredient_recipe')}
                          >
                            Zutaten-Rezept
                          </button>
                        </div>
                      </div>

                      {recipeType === 'finished_dish' ? (
                        <div className="field">
                          <span className="field-label">Portionen</span>
                          <div className="quantity-chips" role="group" aria-label="Portionen">
                            {SERVING_OPTIONS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={option === servings ? 'chip chip-active' : 'chip'}
                                onClick={() => setServings(option)}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="field ai-yield">
                          <span className="field-label">Menge</span>
                          <div className="segmented" role="group" aria-label="Einheit der Menge">
                            <button
                              type="button"
                              className={yieldUnit !== 'ml' ? 'segmented-active' : ''}
                              onClick={() => setYieldUnit('g')}
                            >
                              Gewicht
                            </button>
                            <button
                              type="button"
                              className={yieldUnit === 'ml' ? 'segmented-active' : ''}
                              onClick={() => setYieldUnit('ml')}
                            >
                              Volumen
                            </button>
                          </div>
                          <QuantityPicker
                            value={yieldQuantity}
                            onChange={setYieldQuantity}
                            family={yieldUnit === 'ml' ? 'ml' : 'g'}
                          />
                        </div>
                      )}

                      {/* Merkmale, grouped under their own caption. „vegan“ is
                          permanently on for now (the app's only user is
                          vegan): it stays an ordinary, enabled-looking
                          checkbox, but its handler can never turn it off.
                          The other two are plain toggles, off by default. */}
                      <div className="field">
                        <span className="field-label">Vorgaben</span>
                        <div className="ai-flags">
                          <label className="checkbox-field">
                            <input
                              type="checkbox"
                              checked={wantsVegan}
                              onChange={() => setWantsVegan(true)}
                            />
                            <span>vegan</span>
                          </label>
                          <label className="checkbox-field">
                            <input
                              type="checkbox"
                              checked={wantsFast}
                              onChange={(event) => setWantsFast(event.target.checked)}
                            />
                            <span>schnell und einfach</span>
                          </label>
                          <label className="checkbox-field">
                            <input
                              type="checkbox"
                              checked={wantsCheap}
                              onChange={(event) => setWantsCheap(event.target.checked)}
                            />
                            <span>günstig</span>
                          </label>
                        </div>
                      </div>

                      {/* „KI-Verhalten“: clarify when needed (current rules
                          behaviour) or always draft directly. */}
                      <div className="field">
                        <span className="field-label">KI-Verhalten</span>
                        <div
                          className="segmented ai-mode"
                          role="group"
                          aria-label="Verhalten der KI"
                        >
                          <button
                            type="button"
                            className={replyMode === 'clarify' ? 'segmented-active' : ''}
                            onClick={() => setReplyMode('clarify')}
                          >
                            Bei Bedarf nachfragen
                          </button>
                          <button
                            type="button"
                            className={replyMode === 'draft' ? 'segmented-active' : ''}
                            onClick={() => setReplyMode('draft')}
                          >
                            Direkt entwerfen
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {error !== null && (
                  <p className="error-message" role="alert">
                    {error}
                  </p>
                )}
                <div className="sheet-actions">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!canSend}
                    aria-busy={busy || refreshing}
                  >
                    {busy ? 'Senden …' : refreshing ? 'Kontext wird aktualisiert …' : 'Senden'}
                  </button>
                </div>

                {/* The remembered-key state stays visible and revocable: the
                    key field is gone by the time this line shows, so without it
                    a stored key could only be removed by clearing site data. */}
                {keyRemembered && (
                  <p className="ai-key-note">
                    Der Gemini-Schlüssel ist auf diesem Gerät gespeichert.
                    <button type="button" className="text-button" onClick={handleForgetStoredKey}>
                      Vergessen
                    </button>
                  </p>
                )}
              </form>
            </>
          )}
        </>
      )}
      {guard.armed && (
        <LeaveConfirmSheet
          question="Änderungen am Entwurf verwerfen?"
          confirmLabel="Verwerfen"
          onCancel={guard.reset}
          onConfirm={() => guard.confirm(executeLeave)}
        />
      )}
    </main>
  );
}
