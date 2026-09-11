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
 *   and "Die KI soll …" (ggf. nachfragen vs. direkt den Entwurf schreiben).
 *   They are serialized into the system instruction (aiContext.ts), so they
 *   constrain the whole conversation — including revisions and repair rounds.
 * - The conversation does not end with a draft: the composer stays visible, and
 *   a change request goes to `sendRevision` (rule A4) — the AI revises its own
 *   draft instead of the user reworking it by hand.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { NNBSP, allIngredientMappings, integerLadderValues } from '@cookbook/core';
import type { Recipe, RecipeType } from '@cookbook/core';

import { buildAiContextText, buildSpecificationsText } from '../ai/aiContext';
import type { RecipeSpecifications } from '../ai/aiContext';
import { createAiCreateSession } from '../ai/createRecipeDraft';
import type { AiCreateSession } from '../ai/createRecipeDraft';
import { createAiClient } from '../ai/client';
import { getAiApiKey, setAiApiKey } from '../ai/sessionKey';
import type { StoredRecipe } from '../drive/recipeStorage';
import { readRecipe } from '../drive/recipeStorage';
import { loadPersonalRules } from '../drive/personalRules';
import QuantityPicker from './QuantityPicker';

/** One bubble of the chat transcript. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

interface AiCreateSheetProps {
  /** Drive access token (the Drive connection is required). */
  token: string;
  /** All recipes of the collection (for the AI context, read lazily). */
  recipes: StoredRecipe[];
  /** Back without saving. */
  onClose: () => void;
  /** A validated AI draft is ready for review — open it in the editor. */
  onOpenDraft: (recipe: Recipe) => void;
}

/**
 * Loads the session prerequisites: personal rules (Drive) + the collection
 * contents (ingredient_recipes are embedded in full; every readable file
 * contributes its title). Broken files are skipped — like the editor does.
 * Requires a stored session API key (N6).
 */
async function prepareSession(
  token: string,
  stored: readonly StoredRecipe[],
): Promise<AiCreateSession> {
  const apiKey = getAiApiKey();
  if (apiKey === null) {
    throw new Error('Kein API-Schlüssel hinterlegt.');
  }
  const personalRules = await loadPersonalRules(token);
  const contextRecipes: Array<{ recipe: Recipe }> = [];
  for (const entry of stored) {
    try {
      contextRecipes.push({ recipe: await readRecipe(token, entry.fileId) });
    } catch {
      // Broken file — never blocks the AI session.
    }
  }
  const contextText = buildAiContextText({
    personalRules,
    masterData: allIngredientMappings(),
    recipes: contextRecipes,
  });
  const ingredientRecipeTitles = new Set(
    contextRecipes
      .filter(({ recipe }) => recipe.type === 'ingredient_recipe')
      .map(({ recipe }) => recipe.title),
  );
  return createAiCreateSession({
    client: createAiClient({ provider: 'gemini', apiKey }),
    contextText,
    knownIngredientNames: new Set(Object.keys(allIngredientMappings())),
    ingredientRecipeTitles,
  });
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
  recipes,
  onClose,
  onOpenDraft,
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
  /** „Die KI soll …“: ask for clarification by default (current behaviour). */
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
    if (session === null || busy || draft !== null) return;
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

  /** True once the user sent the first prompt — from then on only a single
   *  answer field is shown (the two-field description layout is over). */
  const conversationStarted = messages.length > 0;
  const canSend = !busy && (description.trim() !== '' || source.trim() !== '');

  return (
    <main className="app ai-screen">
      <header className="app-header">
        <div>
          <h1>Rezept mit KI anlegen</h1>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Zurück
        </button>
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
                      onClick={() => onOpenDraft(draft)}
                    >
                      Im Editor öffnen
                    </button>
                  </div>
                </section>
              )}

              <form
                className="ai-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                {conversationStarted ? (
                  // Follow-up answer or change request: fixed three-line height,
                  // scrolls vertically inside the field.
                  <textarea
                    rows={3}
                    value={description}
                    placeholder={
                      draft !== null ? 'Änderung am Entwurf beschreiben …' : 'Antwort eingeben …'
                    }
                    onChange={(event) => setDescription(event.target.value)}
                  />
                ) : (
                  <>
                    {/* First prompt (description): fixed six-line height. */}
                    <textarea
                      rows={6}
                      value={description}
                      placeholder="Rezept beschreiben …"
                      onChange={(event) => setDescription(event.target.value)}
                    />
                    {/* Optional pasted source text: fixed three-line height. */}
                    <textarea
                      rows={3}
                      value={source}
                      placeholder="Quelltext von einer Webseite einfügen (optional) …"
                      onChange={(event) => setSource(event.target.value)}
                    />

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

                      {/* „Die KI soll …“: clarify when needed (current rules
                          behaviour) or always draft directly. */}
                      <div className="field">
                        <span className="field-label">Die KI soll …</span>
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
                            ggf. nachfragen
                          </button>
                          <button
                            type="button"
                            className={replyMode === 'draft' ? 'segmented-active' : ''}
                            onClick={() => setReplyMode('draft')}
                          >
                            direkt den Entwurf schreiben
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
                  <button type="submit" className="primary-button" disabled={!canSend}>
                    {busy ? 'Senden …' : 'Senden'}
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
