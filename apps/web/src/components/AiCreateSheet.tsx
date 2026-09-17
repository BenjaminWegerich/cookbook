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
 * - The API key is pasted here when none is stored yet — session only, never
 *   persisted (N6). A key that arrives in one piece (autofill, paste) is
 *   applied immediately; typing it by hand still needs the button, which also
 *   stays the fallback when a browser fills the field without firing `input`.
 * - No blocking "new ingredient" confirm step: the draft opens in the recipe
 *   editor, where unknown ingredient names / sub-recipes are handled with the
 *   editor's existing flows ("Neue Zutat anlegen", saving an ingredient_recipe).
 * - The first prompt carries recipe specifications below the source field: the
 *   manual editor's Typ and Portionen/Ergiebigkeit controls (defaults: 6
 *   Portionen for a Gericht, Gewicht / 1 kg for a Zutaten-Rezept), the Merkmale
 *   flags "Vorgaben" (vegan — always on for now, schnell und einfach, günstig)
 *   and "KI-Verhalten" (Bei Bedarf nachfragen vs. Direkt entwerfen).
 *   They are serialized into the system instruction (aiContext.ts), so they
 *   constrain the whole conversation — including revisions and repair rounds.
 * - The conversation does not end with a draft: the composer stays visible, and
 *   a change request goes to `sendRevision` (rule A4) — the AI revises its own
 *   draft instead of the user reworking it by hand.
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
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';

import { NNBSP, allIngredientMappings, integerLadderValues } from '@cookbook/core';
import type { Recipe, RecipeType } from '@cookbook/core';

import { buildAiContextText, buildSpecificationsText } from '../ai/aiContext';
import type { RecipeSpecifications } from '../ai/aiContext';
import { createAiCreateSession } from '../ai/createRecipeDraft';
import type { AiCreateSession } from '../ai/createRecipeDraft';
import { createAiClient } from '../ai/client';
import { getAiApiKey, setAiApiKey } from '../ai/sessionKey';
import type { StoredRecipe } from '../drive/recipeStorage';
import { listRecipes, readRecipe } from '../drive/recipeStorage';
import { loadPersonalRules } from '../drive/personalRules';
import { useEscapeTrigger, useLeaveGuard, type LeaveReason } from '../hooks/useLeaveGuard';
import QuantityPicker from './QuantityPicker';
import { EyeIcon } from './icons';

/** One bubble of the chat transcript. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
 * Imperative handle for the exit-trigger integration (owned by App), mirroring
 * the recipe editor: the sheet is asked whether it consumes a browser Back (or
 * a swipe-back, which arrives as one) before the app closes the AI-create
 * screen. Consumed means the "Änderungen verwerfen?" step was armed. Escape is
 * handled by the sheet itself and shares the same guard.
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
  /** The serialized runtime context block for the system instruction. */
  text: string;
  /** Titles of the collection's ingredient-recipes (valid link targets). */
  ingredientRecipeTitles: Set<string>;
}

/**
 * Loads the runtime context: personal rules (Drive) + the collection contents
 * (ingredient_recipes are embedded in full; every readable file contributes its
 * title). Broken files are skipped — like the editor does.
 */
async function loadContext(token: string, stored: readonly StoredRecipe[]): Promise<LoadedContext> {
  const personalRules = await loadPersonalRules(token);
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
    text: buildAiContextText({
      personalRules,
      masterData: allIngredientMappings(),
      recipes: contextRecipes,
    }),
    ingredientRecipeTitles,
  };
}

/**
 * Loads the session prerequisites and creates the session. Requires a stored
 * session API key (N6).
 */
async function prepareSession(
  token: string,
  stored: readonly StoredRecipe[],
): Promise<AiCreateSession> {
  const apiKey = getAiApiKey();
  if (apiKey === null) {
    throw new Error('Kein API-Schlüssel hinterlegt.');
  }
  const context = await loadContext(token, stored);
  return createAiCreateSession({
    client: createAiClient({ provider: 'gemini', apiKey }),
    contextText: context.text,
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
    '## Stand dieser Unterhaltung\n' +
    `Das Zutaten-Rezept „${title}“ wurde soeben gespeichert und ist jetzt in der Sammlung ` +
    'vorhanden (siehe „Vorhandene ingredient_recipes“ oben). Du darfst es ab jetzt als Zutat in ' +
    'einem Gericht verwenden; der Nutzer muss dafür keine neue Anfrage starten.'
  );
}

/** The prefilled follow-up request for the dish that uses the saved sub-recipe. */
function handoffPrompt(title: string): string {
  return `Erstelle jetzt das eigentliche Gericht und verwende „${title}“ als Zutat.`;
}

/**
 * Splits a user input into a leading description and any pasted source text,
 * giving the AI both (source text = "Inspiration", pasted by the user).
 */
function composeUserMessage(description: string, source: string): string {
  const parts = [description.trim()];
  if (source.trim() !== '') {
    parts.push(`Als Inspiration übernehme ich folgenden Quelltext:\n\n${source.trim()}`);
  }
  return parts.join('\n\n');
}

export default function AiCreateSheet({
  token,
  visible,
  recipes,
  handoff,
  onHandoffConsumed,
  onClose,
  onOpenDraft,
  ref,
}: AiCreateSheetProps) {
  /** The prepared session; null while the context loads or no key is set. */
  const [session, setSession] = useState<AiCreateSession | null>(null);
  /** True while the context + session load runs (mount, or after key save). */
  const [preparing, setPreparing] = useState(() => getAiApiKey() !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** German key input shown while no session key is stored (N6). */
  const [showKeyField, setShowKeyField] = useState(() => getAiApiKey() === null);
  const [keyInput, setKeyInput] = useState('');
  /** Chat transcript. */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  /**
   * Recipe specifications below the source field (editor parity): the Typ
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
  /** A validated draft ready to open in the editor. */
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

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
    (activeToken: string): Promise<AiCreateSession> => prepareSession(activeToken, recipes),
    [recipes],
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
  }, [messages, busy]);

  /**
   * Serializes the current Vorgaben into the session's system instruction. The
   * session is created without them, so this effect also performs the initial
   * push; every later control change only rebuilds the system message and takes
   * effect with the next turn (a change alone never triggers a request).
   */
  useEffect(() => {
    if (session === null) return;
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
        session.setContextText(`${context.text}\n\n${handoffNote(handoff.title)}`);
        session.setIngredientRecipeTitles(context.ingredientRecipeTitles);
        // The saved draft's card is history now — the next message is the dish.
        setDraft(null);
        setMessages((current) => [
          ...current,
          {
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
    setAiApiKey(rawKey);
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

  /** Sends the description / answer and advances the conversation. */
  const handleSend = async (): Promise<void> => {
    if (session === null || busy || refreshing) return;
    if (description.trim() === '' && source.trim() === '') return;
    setError(null);
    const userText = composeUserMessage(description, source);
    // A draft already exists: this text is a change request for it (rule A4).
    const revise = draft !== null;
    setMessages((current) => [...current, { role: 'user', content: userText }]);
    setDescription('');
    setSource('');
    setBusy(true);
    try {
      const result = revise ? await session.sendRevision(userText) : await session.send(userText);
      if (result.kind === 'question') {
        setMessages((current) => [...current, { role: 'assistant', content: result.text }]);
      } else if (result.kind === 'draft') {
        // The AI's own prose before the file (rule A2) belongs in the
        // transcript; on a revision it is what explains the change.
        if (result.preamble !== '') {
          setMessages((current) => [...current, { role: 'assistant', content: result.preamble }]);
        }
        setDraft(result.recipe);
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
  const conversationStarted = messages.length > 0;
  /** True while a saved sub-recipe is being re-read into the AI context — a
   *  send during that window would reach the model without the new ingredient
   *  recipe, so the button waits (derived, not state: it mirrors the parent's
   *  handoff signal, which is cleared when the refresh finished). */
  const refreshing = handoff !== null && session !== null;
  const canSend = !busy && !refreshing && (description.trim() !== '' || source.trim() !== '');

  /** True when leaving would discard started work: text typed into the
   *  composer, a started conversation, or an AI draft that was never saved.
   *  The API-key field is deliberately excluded — the key is session-only
   *  (N6), so leaving it loses nothing. */
  const hasWork =
    description.trim() !== '' || source.trim() !== '' || messages.length > 0 || draft !== null;

  /**
   * Fingerprint of the started work (content and shape, not just presence): the
   * shared exit guard binds the armed discard confirmation to it, so any later
   * change — typing, a new message, a new or cleared draft — invalidates the
   * arm during render ("Behalten") instead of surviving it. This keeps the
   * button label honest when the work is gone again (see useLeaveGuard).
   */
  const guard = useLeaveGuard({
    workSignature: `${description}\u0000${source}\u0000${messages.length}\u0000${draft !== null}`,
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

  // Escape is the keyboard equivalent of the browser Back button: it arms the
  // same two-step confirmation instead of leaving the screen. Off while the
  // editor covers this sheet (see AiCreateSheetProps.visible).
  useEscapeTrigger(() => void requestLeave('escape'), visible);

  /**
   * Browser-back consumer (see AiCreateSheetHandle and App): started work arms
   * the "Änderungen verwerfen?" step through the shared guard (the same
   * two-step confirmation as the header button and Escape), so neither the
   * browser / device Back button nor the swipe-back gesture silently drops the
   * conversation.
   */
  useImperativeHandle(ref, () => ({
    notifyBack: (): boolean => requestLeave('browser-back'),
  }));

  return (
    <main className="app ai-screen">
      <header className="app-header">
        {/* Back button on its own line at the top left (editor placement), the
            screen title below it. */}
        <button
          type="button"
          className={guard.armed ? 'text-button danger-text' : 'text-button'}
          onClick={() => void requestLeave('button')}
        >
          {guard.armed ? 'Änderungen verwerfen?' : 'Zurück'}
        </button>
        <h1>Rezept mit KI anlegen</h1>
      </header>

      {showKeyField ? (
        <section className="editor-card ai-key-card" aria-label="API-Schlüssel">
          <h2 className="editor-card-title">Gemini-API-Schlüssel</h2>
          <p>
            Füge deinen Gemini-API-Schlüssel ein. Er wird nur für diese Sitzung im Speicher gehalten
            und niemals dauerhaft gespeichert.
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
                {messages.length === 0 && (
                  <div className="ai-hint">
                    <p>Beschreibe das Gericht frei und beliebig detailliert.</p>
                    <p>
                      Soll eine Webseite als Inspiration dienen, füge nicht den Link ein, sondern
                      beschreibe die Webseite (z.{NNBSP}B. „Thick and Creamy Tomato Soup von Serious
                      Eats“), oder kopiere den Text und füge ihn im zweiten Feld ein.
                    </p>
                  </div>
                )}
                {messages.map((message, index) => (
                  <p key={index} className={`ai-bubble ai-${message.role}`}>
                    {message.content}
                  </p>
                ))}
                {busy && (
                  <p className="ai-bubble ai-assistant" role="status">
                    Die KI denkt nach …
                  </p>
                )}
              </section>

              {draft !== null && (
                <section className="editor-card ai-draft-card">
                  <h2 className="editor-card-title">Entwurf erstellt</h2>
                  <p>
                    Ich habe einen Entwurf für „{draft.title}“ erstellt. Du kannst ihn jetzt im
                    Editor ansehen, ändern und speichern — oder unten beschreiben, was die KI am
                    Entwurf ändern soll.
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
                        onOpenDraft(draft);
                      }}
                    >
                      <EyeIcon className="button-icon" />
                      <span>Entwurf überprüfen</span>
                    </button>
                  </div>
                </section>
              )}

              <form
                className="ai-composer"
                onKeyDown={handleComposerKeyDown}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                {conversationStarted ? (
                  // Follow-up answer or change request: fixed three-line height,
                  // scrolls vertically inside the field.
                  <div className="ai-field">
                    <textarea
                      rows={3}
                      value={description}
                      placeholder={
                        draft !== null ? 'Änderung am Entwurf beschreiben …' : 'Antwort eingeben …'
                      }
                      onChange={(event) => setDescription(event.target.value)}
                    />
                    <FieldHint />
                  </div>
                ) : (
                  <>
                    {/* First prompt (description): fixed six-line height. */}
                    <div className="ai-field">
                      <textarea
                        rows={6}
                        value={description}
                        placeholder="Rezept beschreiben …"
                        onChange={(event) => setDescription(event.target.value)}
                      />
                      <FieldHint />
                    </div>
                    {/* Optional pasted source text: fixed three-line height. */}
                    <div className="ai-field">
                      <textarea
                        rows={3}
                        value={source}
                        placeholder="Quelltext von einer Webseite einfügen (optional) …"
                        onChange={(event) => setSource(event.target.value)}
                      />
                      <FieldHint />
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
                          <span className="field-label">Ergiebigkeit</span>
                          <div
                            className="segmented"
                            role="group"
                            aria-label="Einheit der Ergiebigkeit"
                          >
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
              </form>
            </>
          )}
        </>
      )}
    </main>
  );
}
