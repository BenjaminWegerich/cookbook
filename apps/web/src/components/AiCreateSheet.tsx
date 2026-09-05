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
 *   persisted (N6).
 * - No blocking "new ingredient" confirm step: the draft opens in the recipe
 *   editor, where unknown ingredient names / sub-recipes are handled with the
 *   editor's existing flows ("Neue Zutat anlegen", saving an ingredient_recipe).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { allIngredientMappings } from '@cookbook/core';
import type { Recipe } from '@cookbook/core';

import { buildAiContextText } from '../ai/aiContext';
import { createAiCreateSession } from '../ai/createRecipeDraft';
import type { AiCreateSession, NewIngredientProposal } from '../ai/createRecipeDraft';
import { createAiClient } from '../ai/client';
import { getAiApiKey, setAiApiKey } from '../ai/sessionKey';
import type { StoredRecipe } from '../drive/recipeStorage';
import { readRecipe } from '../drive/recipeStorage';
import { loadPersonalRules } from '../drive/personalRules';

/** One bubble of the chat transcript. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
async function prepareSession(token: string, stored: readonly StoredRecipe[]): Promise<AiCreateSession> {
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
  const [busy, setBusy] = useState(false);
  /** A validated draft ready to open in the editor. */
  const [draft, setDraft] = useState<Recipe | null>(null);
  /** Ingredient names of the draft not yet in the master data (info only). */
  const [unknownIngredients, setUnknownIngredients] = useState<NewIngredientProposal[]>([]);
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
  const applySession = useCallback((activeToken: string): void => {
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
  }, [loadSession]);

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

  /** Stores the pasted key for this session and prepares the session. */
  const handleKeySave = (): void => {
    if (keyInput.trim() === '') return;
    setAiApiKey(keyInput);
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
    setMessages((current) => [...current, { role: 'user', content: userText }]);
    setDescription('');
    setSource('');
    setBusy(true);
    try {
      const result = await session.send(userText);
      if (result.kind === 'question') {
        setMessages((current) => [...current, { role: 'assistant', content: result.text }]);
      } else if (result.kind === 'draft') {
        setDraft(result.recipe);
        setUnknownIngredients(result.newIngredients);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSend =
    !busy && draft === null && (description.trim() !== '' || source.trim() !== '');

  return (
    <main className="app ai-screen">
      <header className="app-header">
        <div>
          <h1>Rezept aus Beschreibung</h1>
          <p className="app-subtitle" role="status">
            KI-Assistent (Gemini)
          </p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Zurück
        </button>
      </header>

      {showKeyField ? (
        <section className="editor-card ai-key-card" aria-label="API-Schlüssel">
          <h2 className="editor-card-title">Gemini-API-Schlüssel</h2>
          <p>
            Füge deinen Gemini-API-Schlüssel ein. Er wird nur für diese Sitzung im Speicher
            gehalten und niemals gespeichert.
          </p>
          <input
            type="password"
            autoComplete="off"
            value={keyInput}
            placeholder="API-Schlüssel einfügen"
            onChange={(event) => setKeyInput(event.target.value)}
          />
          <div className="sheet-actions">
            <button
              type="button"
              className="primary-button"
              disabled={keyInput.trim() === ''}
              onClick={handleKeySave}
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
              <section
                className="ai-transcript"
                ref={transcriptRef}
                aria-label="Unterhaltung"
              >
                {messages.length === 0 && (
                  <p className="ai-hint">
                    Beschreibe das Rezept frei — z. B. „vegane Lasagne mit Zucchini und meiner
                    Béchamelsauce für 4 Personen“. Du kannst auch den Text einer Webseite als
                    Inspiration einfügen. Die KI fragt bei Unklarheiten nach.
                  </p>
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

              {draft !== null ? (
                <section className="editor-card ai-draft-card">
                  <h2 className="editor-card-title">Entwurf erstellt</h2>
                  <p>
                    „{draft.title}“ wurde im gültigen Rezeptformat erstellt. Du kannst ihn jetzt
                    im Editor ansehen, ändern und speichern.
                  </p>
                  {unknownIngredients.length > 0 && (
                    <p className="ai-draft-note">
                      Diese Zutaten sind noch nicht in deinen Stammdaten:{' '}
                      {unknownIngredients
                        .map((entry) => `„${entry.name}“ (${entry.unit})`)
                        .join(', ')}
                      . Du legst sie im Editor bei Bedarf an („Neue Zutat anlegen“).
                    </p>
                  )}
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
              ) : (
                <form
                  className="ai-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSend();
                  }}
                >
                  <textarea
                    rows={3}
                    value={description}
                    placeholder="Rezept beschreiben …"
                    onChange={(event) => setDescription(event.target.value)}
                  />
                  <textarea
                    rows={2}
                    value={source}
                    placeholder="Quelltext von einer Webseite einfügen (optional) …"
                    onChange={(event) => setSource(event.target.value)}
                  />
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
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
