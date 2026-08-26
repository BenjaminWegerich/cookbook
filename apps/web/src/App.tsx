import { useCallback, useEffect, useState } from 'react';

import { getAccessToken, requestAccessToken, revokeAccessToken } from './auth/googleAuth';
import RecipeList from './components/RecipeList';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';
import './styles/recipe-list.css';

/**
 * Root component of the web app — the recipe-list home screen.
 *
 * States: login (not connected), loading, error, empty collection, and the
 * recipe list (single column, small thumbnails). The floating action button
 * opens the recipe editor — currently a placeholder screen that the next
 * roadmap task (recipe editor) replaces. UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [recipes, setRecipes] = useState<StoredRecipe[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Editor state: `editorOpen` switches the screen, `editorTitle` is the
   *  opened recipe or null for a new recipe (placeholder until the editor task). */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState<string | null>(null);

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
  // rule "set-state-in-effect" stays satisfied.
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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
    await revokeAccessToken();
    setToken(null);
    setRecipes(null);
  }, []);

  /** Opens the editor placeholder for a recipe title (null = new recipe). */
  const openEditor = useCallback((title: string | null): void => {
    setEditorTitle(title);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback((): void => {
    setEditorOpen(false);
  }, []);

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
        <section className="editor-placeholder" aria-label="Rezept-Editor">
          <button type="button" className="text-button" onClick={closeEditor}>
            ← Zurück
          </button>
          <h2>{editorTitle ?? 'Neues Rezept'}</h2>
          <p>Der Rezept-Editor folgt im nächsten Schritt.</p>
        </section>
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
