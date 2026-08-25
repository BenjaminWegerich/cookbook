import { useState } from 'react';

import { getAccessToken, requestAccessToken, revokeAccessToken } from './auth/googleAuth';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';

/**
 * Root component of the web app.
 *
 * Neutral placeholder: it proves the storage layer (OAuth login → token →
 * recipe folder → recipe list) end to end. The actual UI (smartphone +
 * smart display layout, custom typography) is designed in a later roadmap
 * task together with the user. The UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [recipes, setRecipes] = useState<StoredRecipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Logs in and immediately checks the Drive connection. */
  const handleConnect = async (): Promise<void> => {
    setError(null);
    try {
      const newToken = await requestAccessToken();
      setToken(newToken);
      await refreshRecipes(newToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Logs out and clears the session state. */
  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    await revokeAccessToken();
    setToken(null);
    setRecipes(null);
  };

  /** Refreshes the recipe list from the Google Drive recipe folder. */
  const refreshRecipes = async (activeToken: string): Promise<void> => {
    setError(null);
    try {
      setRecipes(await listRecipes(activeToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="app">
      <h1>Cookbook</h1>
      <p>Grundgerüst der Web-App — Design und Funktionen folgen.</p>

      <section className="drive-connect" aria-label="Google Drive">
        {token ? (
          <>
            <p>Mit Google Drive verbunden.</p>
            <button type="button" onClick={() => refreshRecipes(token)}>
              Rezepte aktualisieren
            </button>
            <button type="button" onClick={handleDisconnect}>
              Trennen
            </button>
            {recipes &&
              (recipes.length === 0 ? (
                <p>Noch keine Rezepte im Cookbook-Ordner.</p>
              ) : (
                <ul>
                  {recipes.map((recipe) => (
                    <li key={recipe.fileId}>
                      {recipe.title}
                      {recipe.image !== undefined ? ' 📷' : ''}
                    </li>
                  ))}
                </ul>
              ))}
          </>
        ) : (
          <>
            <p>Noch nicht verbunden.</p>
            <button type="button" onClick={handleConnect}>
              Mit Google verbinden
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}

export default App;
