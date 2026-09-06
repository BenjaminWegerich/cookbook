import { useCallback, useEffect, useRef, useState } from 'react';

import type { Recipe } from '@cookbook/core';

import { getAccessToken, requestAccessToken } from './auth/googleAuth';
import AiCreateSheet from './components/AiCreateSheet';
import RecipeEditor, { type RecipeEditorHandle } from './components/RecipeEditor';
import RecipeList from './components/RecipeList';
import { loadIngredientMasterData } from './drive/ingredientMasterData';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';
import './styles/ai-create.css';
import './styles/recipe-list.css';
import './styles/editor.css';

/**
 * The app screens above the recipe list (the list itself is the root/bottom
 * layer and has no marker of its own). The create menu is treated like a
 * screen here: the browser Back button closes it first, then leaves the list.
 */
type TopScreen = 'editor' | 'ai' | 'menu';

/**
 * Browser-history entry marker for a TopScreen. The recipe list is the app's
 * initial entry (state `null`); each screen above it is a single history
 * entry carrying this marker.
 */
const SCREEN_MARKER = 'above-list';

/** True when `state` belongs to one of our screen entries (history.state is a
 *  structured clone, so this must be a value check, never an identity check). */
function isScreenEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { appScreen?: unknown }).appScreen === SCREEN_MARKER
  );
}

/**
 * Root component of the web app — the recipe-list home screen plus the recipe
 * editor (Phase 2).
 *
 * States: login (not connected), loading, error, empty collection, and the
 * recipe list (adaptive card grid with square photos). The floating action
 * button opens the create menu (manual / AI) and a tap on a recipe card
 * opens the recipe editor. UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [recipes, setRecipes] = useState<StoredRecipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal warning when the Drive master data could not be loaded; the
   *  built-in seed keeps the app functional (see ingredientMasterData.ts). */
  const [masterDataWarning, setMasterDataWarning] = useState<string | null>(null);
  /** Editor state: `editorOpen` switches the screen, `editorTarget` is the
   *  opened recipe or null for a new recipe. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<StoredRecipe | null>(null);
  /** An already-valid draft (AI create) that opens the editor prefilled. */
  const [editorDraft, setEditorDraft] = useState<Recipe | null>(null);
  /** The FAB create menu: two extended FABs (manually create vs. AI create). */
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  /** The AI-create conversation screen. */
  const [aiCreateOpen, setAiCreateOpen] = useState(false);

  /**
   * The current TopScreen above the recipe list, or null for the list itself.
   * Mirrored into the browser history (one entry per screen) and kept in a
   * ref so the popstate listener always sees the *current* layer even though
   * it is registered only once. All screen switches go through `setNav` so
   * React state and the history never drift apart.
   */
  const navRef = useRef<TopScreen | null>(null);
  /** Imperative handle of the mounted RecipeEditor (browser-back consumer). */
  const editorHandleRef = useRef<RecipeEditorHandle | null>(null);

  /**
   * Switches the visible layer and keeps the browser history in sync so the
   * Back button steps back exactly one screen:
   * - list → screen: push one history entry (the list stays underneath);
   * - screen → screen (e.g. AI-create → editor): replace the entry;
   * - screen → list: pop via history.back() — the popstate listener then
   *   finds the layer already closed and does nothing.
   */
  const setNav = useCallback((next: TopScreen | null): void => {
    const prev = navRef.current;
    navRef.current = next;
    if (next === prev) {
      return;
    }
    setEditorOpen(next === 'editor');
    setAiCreateOpen(next === 'ai');
    setCreateMenuOpen(next === 'menu');
    if (prev === null) {
      if (next === null) {
        return;
      }
      // Collapse a stale screen entry (e.g. left behind by a browser Forward)
      // instead of stacking a duplicate on top of it.
      if (isScreenEntry(window.history.state)) {
        window.history.replaceState({ appScreen: SCREEN_MARKER }, '');
      } else {
        window.history.pushState({ appScreen: SCREEN_MARKER }, '');
      }
    } else if (next === null) {
      window.history.back();
    } else {
      window.history.replaceState({ appScreen: SCREEN_MARKER }, '');
    }
  }, []);

  /** Refreshes the recipe list from the Google Drive recipe folder. */
  const refreshRecipes = useCallback(async (activeToken: string): Promise<void> => {
    try {
      setRecipes(await listRecipes(activeToken));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  // Browser Back / Forward: step back one screen at a time instead of leaving
  // the app. The history holds the list (initial entry) plus at most one
  // screen entry, so a pop onto the list entry must close the current screen.
  // The editor can consume the pop itself (its topmost overlay closes first;
  // unsaved changes arm the "Wirklich verwerfen?" step like the header button
  // does) — when it does, the screen entry is re-pushed to cancel the pop.
  useEffect(() => {
    const onPopState = (): void => {
      const top = navRef.current;
      if (top === null) {
        // A screen entry must not outlive its (now closed) screen — this can
        // happen when a browser Forward restores a stale entry after the app
        // already returned to the list. Reset it to a plain list entry so the
        // Back/Forward trail stays clean.
        if (isScreenEntry(window.history.state)) {
          window.history.replaceState(null, '');
        }
        return;
      }
      if (top === 'editor' && editorHandleRef.current?.notifyBack() === true) {
        // Stay on the editor (an overlay closed or the discard confirmation
        // was armed): undo the pop by re-pushing the screen entry.
        window.history.pushState({ appScreen: SCREEN_MARKER }, '');
        return;
      }
      navRef.current = null;
      setEditorOpen(false);
      setAiCreateOpen(false);
      setCreateMenuOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

  /** Opens the editor for a recipe (null = new recipe). */
  const openEditor = useCallback(
    (recipe: StoredRecipe | null): void => {
      setEditorTarget(recipe);
      setEditorDraft(null);
      setNav('editor');
    },
    [setNav],
  );

  /** Opens the editor prefilled with an AI-created draft (new recipe). */
  const openEditorWithDraft = useCallback(
    (recipe: Recipe): void => {
      setEditorTarget(null);
      setEditorDraft(recipe);
      setNav('editor');
    },
    [setNav],
  );

  /** Opens the AI-create conversation screen. */
  const openAiCreate = useCallback((): void => {
    setNav('ai');
  }, [setNav]);

  const closeEditor = useCallback((): void => {
    setNav(null);
  }, [setNav]);

  /** After a save/delete: refresh the list and return to it. */
  const handleEditorSaved = useCallback((): void => {
    if (token !== null) void refreshRecipes(token);
    setNav(null);
  }, [token, refreshRecipes, setNav]);

  /** Status line under the header, German. */
  const subtitle = !token
    ? 'Nicht verbunden'
    : recipes === null
      ? 'Rezepte werden geladen …'
      : recipes.length === 0
        ? 'Noch keine Rezepte'
        : `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'}`;

  return (
    <main className="app">
      {editorOpen ? (
        <RecipeEditor
          ref={editorHandleRef}
          token={token ?? ''}
          target={editorTarget}
          initialDraft={editorDraft ?? undefined}
          recipes={recipes ?? []}
          onClose={closeEditor}
          onSaved={handleEditorSaved}
          onOpenRecipe={openEditor}
        />
      ) : aiCreateOpen ? (
        <AiCreateSheet
          token={token ?? ''}
          recipes={recipes ?? []}
          onClose={() => setNav(null)}
          onOpenDraft={openEditorWithDraft}
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
          ) : recipes === null ? (
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
              className={createMenuOpen ? 'fab fab-active' : 'fab'}
              aria-label={createMenuOpen ? 'Menü schließen' : 'Neues Rezept'}
              aria-expanded={createMenuOpen}
              onClick={() => setNav(createMenuOpen ? null : 'menu')}
            >
              <svg className="fab-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
              </svg>
            </button>
          )}

          {createMenuOpen && token && (
            <>
              <button
                type="button"
                className="fab-backdrop"
                aria-label="Menü schließen"
                onClick={() => setNav(null)}
              />
              <div className="fab-menu" role="group" aria-label="Neues Rezept anlegen">
                <button type="button" className="fab-extended" onClick={() => openEditor(null)}>
                  <svg className="fab-extended-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>Rezept manuell anlegen</span>
                </button>
                <button type="button" className="fab-extended" onClick={openAiCreate}>
                  <svg className="fab-extended-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>Rezept mit KI anlegen</span>
                </button>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;
