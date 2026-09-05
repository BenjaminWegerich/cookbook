import { useCallback, useEffect, useState } from 'react';

import { resetIngredientMappings } from '@cookbook/core';

import { clearAiApiKey } from './ai/sessionKey';
import { getAccessToken, requestAccessToken, revokeAccessToken } from './auth/googleAuth';
import RecipeEditor from './components/RecipeEditor';
import RecipeList from './components/RecipeList';
import { loadIngredientMasterData } from './drive/ingredientMasterData';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';
import './styles/recipe-list.css';
import './styles/editor.css';

/**
 * Root component of the web app — the recipe-list home screen plus the recipe
 * editor (Phase 2).
 *
 * States: login (not connected), loading, error, empty collection, and the
 * recipe list (single column, small thumbnails). The floating action button
 * and a tap on a recipe row open the recipe editor. UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [recipes, setRecipes] = useState<StoredRecipe[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal warning when the Drive master data could not be loaded; the
   *  built-in seed keeps the app functional (see ingredientMasterData.ts). */
  const [masterDataWarning, setMasterDataWarning] = useState<string | null>(null);
  /** Editor state: `editorOpen` switches the screen, `editorTarget` is the
   *  opened recipe or null for a new recipe. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<StoredRecipe | null>(null);

  /** Refreshes the recipe list from the Google Drive recipe folder. */
  const refreshRecipes = useCallback(async (activeToken: string): Promise<void> => {
    try {
      setRecipes(await listRecipes(activeToken));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Refreshes the list with a loading indicator (user-triggered refreshes). */
  const refreshWithLoading = useCallback(
    async (activeToken: string): Promise<void> => {
      setLoading(true);
      try {
        await refreshRecipes(activeToken);
      } finally {
        setLoading(false);
      }
    },
    [refreshRecipes],
  );

  // Reload the list automatically on startup when a session is still active.
  // State is only updated in promise callbacks (never synchronously), so the
  // rule "set-state-in-effect" stays satisfied. The master data is loaded in
  // parallel: a corrupt file only warns (built-in seed stays active), it must
  // never block the recipe list.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void listRecipes(token)
      .then((result) => {
        if (cancelled) return;
        setRecipes(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    void loadIngredientMasterData(token)
      .then(() => {
        if (!cancelled) setMasterDataWarning(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMasterDataWarning(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * Logs in; the mount effect below refreshes the recipe list as soon as the
   * token is set (recipes === null shows the loading message meanwhile).
   */
  const handleConnect = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setToken(await requestAccessToken());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Logs out and clears the session state. */
  const handleDisconnect = useCallback(async (): Promise<void> => {
    setError(null);
    setMasterDataWarning(null);
    await revokeAccessToken();
    // Drop the loaded master data and the pasted AI key so the next account
    // (and session) starts clean — neither is ever persisted (N6).
    resetIngredientMappings();
    clearAiApiKey();
    setToken(null);
    setRecipes(null);
  }, []);

  /** Opens the editor for a recipe (null = new recipe). */
  const openEditor = useCallback((recipe: StoredRecipe | null): void => {
    setEditorTarget(recipe);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback((): void => {
    setEditorOpen(false);
  }, []);

  /** After a save/delete: refresh the list and return to it. */
  const handleEditorSaved = useCallback((): void => {
    if (token !== null) void refreshRecipes(token);
    setEditorOpen(false);
  }, [token, refreshRecipes]);

  /** Status line under the header, German. */
  const subtitle = !token
    ? 'Nicht verbunden'
    : loading || recipes === null
      ? 'Rezepte werden geladen …'
      : recipes.length === 0
        ? 'Noch keine Rezepte'
        : `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'}`;

  return (
    <main className="app">
      {editorOpen ? (
        <RecipeEditor
          token={token ?? ''}
          target={editorTarget}
          recipes={recipes ?? []}
          onClose={closeEditor}
          onSaved={handleEditorSaved}
          onOpenRecipe={openEditor}
        />
      ) : (
        <>
          <header className="app-header">
            <div>
              <h1>Cookbook</h1>
              <p className="app-subtitle" role="status">
                {subtitle}
              </p>
            </div>
            {token && (
              <div className="header-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void refreshWithLoading(token)}
                >
                  Aktualisieren
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void handleDisconnect()}
                >
                  Trennen
                </button>
              </div>
            )}
          </header>

          {token && masterDataWarning !== null && (
            <p className="master-data-warning" role="alert">
              Zutaten-Stammdaten konnten nicht geladen werden — es wird die eingebaute Liste
              verwendet. ({masterDataWarning})
            </p>
          )}

          {!token ? (
            <section className="login-panel" aria-label="Anmeldung">
              <h2>Dein digitales Kochbuch</h2>
              <p>Verbinde dein Google-Konto, um deine Rezepte in Google Drive zu verwalten.</p>
              <p className="login-note">
                Deine Rezepte liegen als Markdown-Dateien in einem „Cookbook“-Ordner in deinem
                Google Drive.
              </p>
              <button type="button" onClick={() => void handleConnect()}>
                Mit Google verbinden
              </button>
            </section>
          ) : error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : loading || recipes === null ? (
            <p className="loading-message" role="status">
              Rezepte werden geladen …
            </p>
          ) : recipes.length === 0 ? (
            <section className="empty-state">
              <p>Noch keine Rezepte im Cookbook-Ordner.</p>
              <p>Tippe auf das + unten rechts, um dein erstes Rezept anzulegen.</p>
            </section>
          ) : (
            <RecipeList recipes={recipes} token={token} onOpenRecipe={openEditor} />
          )}

          {token && (
            <button
              type="button"
              className="fab"
              aria-label="Neues Rezept"
              onClick={() => openEditor(null)}
            >
              <svg className="fab-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
              </svg>
            </button>
          )}
        </>
      )}
    </main>
  );
}

export default App;
