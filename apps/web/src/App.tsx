import { useCallback, useEffect, useRef, useState } from 'react';

import type { Recipe } from '@cookbook/core';

import {
  getAccessToken,
  isGoogleAuthAvailable,
  requestAccessToken,
  revokeAccessToken,
} from './auth/googleAuth';
import AiCreateSheet, {
  type AiCreateSheetHandle,
  type AiHandoff,
} from './components/AiCreateSheet';
import RecipeEditor, { type RecipeEditorHandle } from './components/RecipeEditor';
import RecipeList from './components/RecipeList';
import RecipeOverview from './components/RecipeOverview';
import { PencilIcon, PlusIcon, SparkleIcon } from './components/icons';
import { isDriveAuthError, setDriveUnauthorizedHandler } from './drive/driveClient';
import { loadIngredientMasterData } from './drive/ingredientMasterData';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';
import { useEscapeTrigger } from './hooks/useLeaveGuard';
import './styles/ai-create.css';
import './styles/recipe-list.css';
import './styles/recipe-overview.css';
import './styles/editor.css';

/**
 * The app layers above the recipe list (the list itself is the root/bottom
 * layer and has no marker of its own). The create menu and the recipe overview
 * sheet are treated like screens here: the browser Back button closes them
 * first, then leaves the list.
 */
type TopScreen = 'editor' | 'ai' | 'menu' | 'overview';

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

/** Auto-login on page load waits at most this long for the async-loaded GIS
 *  script before it gives up silently (the login button keeps working). */
const GIS_LOAD_TIMEOUT_MS = 10_000;

/** Polling cadence of the GIS availability check. */
const GIS_POLL_INTERVAL_MS = 200;

/**
 * Root component of the web app — the recipe-list home screen plus the recipe
 * editor (Phase 2).
 *
 * States: login (not connected), loading, error, empty collection, and the
 * recipe list (adaptive card grid with square photos). The floating action
 * button opens the create menu (manual / AI); a tap on a recipe card opens the
 * recipe overview sheet, whose "Mehr → Manuell bearbeiten" entry opens the editor.
 * UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  /** True while the Google sign-in popup is being requested (auto-login or
   *  the login button); shows a status line on the login panel meanwhile. */
  const [connecting, setConnecting] = useState(false);
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
  /**
   * Sub-recipes opened from the editor with the "Rezept" badge, innermost last.
   * Every level stays mounted (hidden) underneath the one above it, so the
   * parent's unsaved draft survives the jump and is simply there again when the
   * user comes back — a jump never discards or asks to discard.
   */
  const [editorSubRecipes, setEditorSubRecipes] = useState<StoredRecipe[]>([]);
  /**
   * Which screen opened the editor: 'ai' means it was started from a draft of
   * the AI-create conversation, which then continues underneath (see the
   * handoff below) instead of the app returning to the list.
   */
  const editorOriginRef = useRef<'ai' | 'list' | null>(null);
  /** The AI draft that opened the editor (null for a list/manual edit). */
  const pendingDraftRef = useRef<Recipe | null>(null);
  /**
   * A Zutaten-Rezept the user saved while the AI conversation is still running:
   * the chat takes it as the handoff signal (re-read the context, prefill the
   * request for the dish that uses it) and clears it again.
   */
  const [aiHandoff, setAiHandoff] = useState<AiHandoff | null>(null);
  /** The FAB create menu: two extended FABs (manually create vs. AI create). */
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  /** The recipe overview sheet (opened by tapping a recipe card). */
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewTarget, setOverviewTarget] = useState<StoredRecipe | null>(null);
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
  /**
   * Imperative handles of the mounted editor levels, indexed by level: 0 is the
   * base editor (list or AI draft), 1..n are the sub-recipes. A slot is null
   * while its level is unmounted; `topEditorHandle` returns the current one.
   */
  const editorHandleRefs = useRef<(RecipeEditorHandle | null)[]>([]);
  /** Imperative handle of the mounted AI-create sheet (browser-back consumer). */
  const aiCreateHandleRef = useRef<AiCreateSheetHandle | null>(null);
  /**
   * Ref mirror of `editorSubRecipes` and `editorTarget` for the synchronous
   * event handlers (history popstate, sub-recipe jump): their closures would
   * otherwise see the state of the render they were created in.
   */
  const editorSubRecipesRef = useRef<StoredRecipe[]>([]);
  const editorTargetRef = useRef<StoredRecipe | null>(null);
  /**
   * True while a 401 recovery is running (and after it ran for the current
   * token). Guards two hazards: the startup list load and the master-data load
   * fail together, so without it several re-logins would start at once; and if
   * the fresh token is rejected too, it stops an endless revoke/log-in loop.
   * An explicit click on "Mit Google verbinden" resets it (see handleConnect).
   */
  const authRecoveryRef = useRef(false);

  /**
   * The imperative handle of the editor level currently on top (the deepest
   * mounted sub-recipe, or the base editor). Called from the popstate listener,
   * so it reads the ref array directly — the highest non-null slot is the
   * visible level.
   */
  const topEditorHandle = (): RecipeEditorHandle | null => {
    const handles = editorHandleRefs.current;
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      const handle = handles[index];
      if (handle !== null && handle !== undefined) return handle;
    }
    return null;
  };

  /**
   * Replaces the open sub-recipe levels and keeps the ref mirror in sync, so the
   * synchronous handlers (popstate, jump) see the current stack immediately.
   */
  const replaceSubRecipes = useCallback((next: StoredRecipe[]): void => {
    editorSubRecipesRef.current = next;
    setEditorSubRecipes(next);
  }, []);

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
    // The AI-create conversation stays mounted (hidden) while its own draft is
    // opened in the editor: transcript, AI context and Vorgaben survive the
    // trip, so saving a Zutaten-Rezept there can continue the same chat.
    setAiCreateOpen(next === 'ai' || (next === 'editor' && prev === 'ai'));
    setCreateMenuOpen(next === 'menu');
    setOverviewOpen(next === 'overview');
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
      // A 401 is handled by the re-auth hook (below); showing the raw Drive
      // error would only flash before the login panel reappears.
      if (isDriveAuthError(err)) return;
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
        if (isDriveAuthError(err)) return; // re-auth hook handles it
        setError(err instanceof Error ? err.message : String(err));
      });
    void loadIngredientMasterData(token)
      .then(() => {
        if (!cancelled) setMasterDataWarning(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isDriveAuthError(err)) return; // re-auth hook handles it
        setMasterDataWarning(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Browser Back / Forward: step back one screen at a time instead of leaving
  // the app. The history holds the list (initial entry) plus at most one
  // screen entry, so a pop onto the list entry must close the current screen.
  // A screen with internal layers can consume the pop itself: both the editor
  // and the AI-create sheet route it through their shared exit guard
  // (useLeaveGuard) — topmost overlay first, then the "Änderungen verwerfen?"
  // step. The device's swipe-back gesture arrives as the same popstate, so it
  // gets the identical guard. When consumed, the screen entry is re-pushed to
  // cancel the pop.
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
      if (top === 'editor') {
        // The open-level count before the editor sees the pop: `notifyBack` may
        // step back to the parent level of a sub-recipe chain, which consumes
        // the pop although it reports false (the parent stays mounted).
        const levelCount = editorSubRecipesRef.current.length;
        if (topEditorHandle()?.notifyBack() === true) {
          // Stay on the editor (an overlay closed or the discard confirmation
          // was armed): undo the pop by re-pushing the screen entry.
          window.history.pushState({ appScreen: SCREEN_MARKER }, '');
          return;
        }
        if (editorSubRecipesRef.current.length < levelCount) {
          // Back stepped from a sub-recipe to its parent level: the editor
          // stays open, so cancel the pop exactly like a consumed overlay.
          window.history.pushState({ appScreen: SCREEN_MARKER }, '');
          return;
        }
      }
      if (top === 'ai' && aiCreateHandleRef.current?.notifyBack() === true) {
        // Stay on the AI-create screen (the discard confirmation was armed):
        // undo the pop by re-pushing the screen entry.
        window.history.pushState({ appScreen: SCREEN_MARKER }, '');
        return;
      }
      // Back out of an AI-created draft returns to the still-running
      // conversation (mounted underneath) instead of leaving for the list.
      if (top === 'editor' && editorOriginRef.current === 'ai') {
        editorOriginRef.current = null;
        pendingDraftRef.current = null;
        editorSubRecipesRef.current = [];
        editorTargetRef.current = null;
        navRef.current = 'ai';
        setEditorOpen(false);
        setEditorSubRecipes([]);
        setAiCreateOpen(true);
        window.history.pushState({ appScreen: SCREEN_MARKER }, '');
        return;
      }
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorSubRecipesRef.current = [];
      editorTargetRef.current = null;
      navRef.current = null;
      setEditorOpen(false);
      setEditorSubRecipes([]);
      setAiCreateOpen(false);
      setCreateMenuOpen(false);
      setOverviewOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Escape closes the FAB create menu. It is the keyboard equivalent of the
  // menu's backdrop tap and of the browser Back button (which App's popstate
  // handler covers when the menu is a screen entry). No discard confirmation is
  // needed: the menu holds no state of its own.
  useEscapeTrigger(() => setNav(null), createMenuOpen);

  /**
   * Logs in — triggered by the login button (user gesture) or by the
   * auto-login effect below (`{ automatic: true }`, best-effort, may be
   * popup-blocked). The mount effect refreshes the recipe list as soon as
   * the token is set (recipes === null shows the loading message meanwhile).
   */
  const handleConnect = useCallback(async (options?: { automatic?: boolean }): Promise<void> => {
    // An explicit login opens a new auth generation: allow one automatic
    // recovery again in case the new token is rejected as well.
    if (options?.automatic !== true) authRecoveryRef.current = false;
    setError(null);
    setConnecting(true);
    let aborted = false;
    try {
      setToken(await requestAccessToken(options));
    } catch (err) {
      // A superseded automatic attempt (user clicked during page-load login)
      // is aborted without a user-visible error — the fresh gesture attempt
      // takes over. Keep the `connecting` flag: it belongs to that attempt.
      aborted = err instanceof Error && err.name === 'AbortError';
      if (!aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!aborted) setConnecting(false);
    }
  }, []);

  /**
   * Reaction to a Drive 401 (registered on the Drive client just below): the
   * cached access token is stale — Google rejects it while Google Identity
   * Services keeps handing the same dead token back. Drop it for good and start
   * one fresh login. Revoking at Google is the step that matters: it invalidates
   * the cached token and forces the next token request to ask for consent again
   * instead of returning the cached one. The fresh request carries no user
   * gesture, so the browser may block its popup — then the login panel stays and
   * a single click on "Mit Google verbinden" completes the login.
   */
  const recoverFromAuthError = useCallback(async (): Promise<void> => {
    if (authRecoveryRef.current) return; // already recovering / already ran
    authRecoveryRef.current = true;
    await revokeAccessToken();
    setToken(null);
    setRecipes(null);
    setError(null);
    setMasterDataWarning(null);
    await handleConnect({ automatic: true });
  }, [handleConnect]);

  // Register the Drive client's 401 hook for the lifetime of the app. Every
  // Drive call funnels through that client, so this covers the startup loads,
  // list refreshes and the editor alike.
  useEffect(() => {
    setDriveUnauthorizedHandler(() => {
      void recoverFromAuthError();
    });
    return () => setDriveUnauthorizedHandler(null);
  }, [recoverFromAuthError]);

  /**
   * Best-effort auto-login: the access token is memory-only (googleAuth.ts),
   * so every page load starts logged out. To skip the intro screen, request
   * the token flow without a click once the GIS script is ready. Browsers
   * only allow the account-chooser popup after a user gesture, so this
   * attempt may be blocked — GIS then reports an error (or the request times
   * out) and the login panel stays, where a single click retries with a
   * gesture. The GIS script loads `async`, so poll until it is usable.
   */
  useEffect(() => {
    if (token) {
      return;
    }
    const deadline = Date.now() + GIS_LOAD_TIMEOUT_MS;
    const interval = window.setInterval(() => {
      if (isGoogleAuthAvailable()) {
        window.clearInterval(interval);
        void handleConnect({ automatic: true });
      } else if (Date.now() >= deadline) {
        // GIS still unavailable — give up silently; the button keeps working.
        window.clearInterval(interval);
      }
    }, GIS_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [token, handleConnect]);

  /** Opens the overview sheet for a tapped recipe card. */
  const openOverview = useCallback(
    (recipe: StoredRecipe): void => {
      setOverviewTarget(recipe);
      setNav('overview');
    },
    [setNav],
  );

  /** Closes the overview sheet (backdrop, close button, browser Back). */
  const closeOverview = useCallback((): void => {
    setNav(null);
  }, [setNav]);

  /**
   * Shows the base recipe in the editor (`draft` prefills a brand-new recipe)
   * and keeps the target ref mirror in sync, so the synchronous event handlers
   * (sub-recipe jump, history popstate) see the recipe that is on screen.
   */
  const showInEditor = useCallback((recipe: StoredRecipe | null, draft: Recipe | null): void => {
    editorTargetRef.current = recipe;
    setEditorTarget(recipe);
    setEditorDraft(draft);
  }, []);

  /** Opens the editor for a recipe (null = new recipe). */
  const openEditor = useCallback(
    (recipe: StoredRecipe | null): void => {
      editorOriginRef.current = 'list';
      pendingDraftRef.current = null;
      replaceSubRecipes([]);
      showInEditor(recipe, null);
      setNav('editor');
    },
    [setNav, showInEditor, replaceSubRecipes],
  );

  /** Opens the editor prefilled with an AI-created draft (new recipe). */
  const openEditorWithDraft = useCallback(
    (recipe: Recipe): void => {
      // Remembered so saving the draft can hand it back to the conversation.
      editorOriginRef.current = 'ai';
      pendingDraftRef.current = recipe;
      replaceSubRecipes([]);
      showInEditor(null, recipe);
      setNav('editor');
    },
    [setNav, showInEditor, replaceSubRecipes],
  );

  /**
   * Opens a linked sub-recipe from the editor (the "Rezept" badge). The level
   * above is pushed onto the open stack and stays mounted (hidden) underneath,
   * so its unsaved draft survives the jump — a jump never discards or asks to
   * discard. The whole chain shares the editor's single history entry: Back is
   * consumed to drop one level (the popstate handler re-pushes the entry).
   */
  const openSubRecipe = useCallback(
    (recipe: StoredRecipe): void => {
      // Defensive: a jump without the editor on top behaves like a normal open.
      if (navRef.current !== 'editor') {
        openEditor(recipe);
        return;
      }
      const open = editorSubRecipesRef.current;
      const top = open.length > 0 ? open[open.length - 1]! : editorTargetRef.current;
      // Skip a no-op jump (same file) so Back never steps onto the same recipe.
      if (top !== null && top.fileId === recipe.fileId) return;
      replaceSubRecipes([...open, recipe]);
    },
    [openEditor, replaceSubRecipes],
  );

  /** Opens the AI-create conversation screen. */
  const openAiCreate = useCallback((): void => {
    setNav('ai');
  }, [setNav]);

  /**
   * Leaves the editor one step: first back to the parent level of an open
   * sub-recipe chain (the level stays mounted, so nothing is lost), and only
   * from the base level out of the editor (to the list, or back to the AI
   * conversation of an AI draft). Every exit trigger — header button, Escape,
   * browser Back — ends here, so they all follow the same order.
   */
  const closeEditor = useCallback((): void => {
    const open = editorSubRecipesRef.current;
    if (open.length > 0) {
      replaceSubRecipes(open.slice(0, -1));
      return;
    }
    const fromAi = editorOriginRef.current === 'ai';
    editorOriginRef.current = null;
    pendingDraftRef.current = null;
    editorTargetRef.current = null;
    // Leaving an AI draft without saving returns to its conversation (the
    // sheet is still mounted); every other editor closes to the list.
    setNav(fromAi ? 'ai' : null);
  }, [setNav, replaceSubRecipes]);

  /** After a save/delete: refresh the list and leave the editor. */
  const handleEditorSaved = useCallback(
    (saved: Recipe | null): void => {
      if (token !== null) void refreshRecipes(token);
      // A saved sub-recipe returns to its parent level, whose unsaved draft is
      // still mounted underneath — not all the way to the list.
      const open = editorSubRecipesRef.current;
      if (open.length > 0) {
        replaceSubRecipes(open.slice(0, -1));
        return;
      }
      const fromAi = editorOriginRef.current === 'ai';
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorTargetRef.current = null;
      // A saved Zutaten-Rezept continues the conversation: the dish using it is
      // usually the next request, and the chat must list the new title. A saved
      // dish is the end of the flow — back to the list like any other save.
      if (fromAi && saved !== null && saved.type === 'ingredient_recipe') {
        setAiHandoff({ title: saved.title, type: saved.type });
        setNav('ai');
      } else {
        setNav(null);
      }
    },
    [token, refreshRecipes, setNav, replaceSubRecipes],
  );

  /** The chat applied the handoff (context re-read, request prefilled). */
  const handleHandoffConsumed = useCallback((): void => {
    setAiHandoff(null);
  }, []);

  /** Status line under the header, German. */
  const subtitle = !token
    ? 'Nicht verbunden'
    : recipes === null
      ? 'Rezepte werden geladen …'
      : recipes.length === 0
        ? 'Noch keine Rezepte'
        : `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'}`;

  return (
    <>
      {/* The AI-create conversation stays mounted while its own draft is edited
          (hidden): transcript, AI context and Vorgaben survive the trip, so a
          saved Zutaten-Rezept can continue the same conversation. */}
      {aiCreateOpen && (
        <div hidden={editorOpen}>
          <AiCreateSheet
            ref={aiCreateHandleRef}
            token={token ?? ''}
            visible={!editorOpen}
            recipes={recipes ?? []}
            handoff={aiHandoff}
            onHandoffConsumed={handleHandoffConsumed}
            onClose={() => setNav(null)}
            onOpenDraft={openEditorWithDraft}
          />
        </div>
      )}

      {editorOpen ? (
        <>
          {/* The base level (recipe from the list, or the AI draft). It stays
              mounted while a sub-recipe is open above it (hidden), so its
              unsaved draft is still there when the user comes back. The
              wrapper carries `hidden` (a plain div, like the AI sheet below),
              because the editor's own `.app` display would beat [hidden]. */}
          <div hidden={editorSubRecipes.length !== 0}>
            <RecipeEditor
              key={`base:${editorTarget?.fileId ?? 'new-recipe'}`}
              ref={(handle) => {
                editorHandleRefs.current[0] = handle;
              }}
              visible={editorSubRecipes.length === 0}
              token={token ?? ''}
              target={editorTarget}
              initialDraft={editorDraft ?? undefined}
              recipes={recipes ?? []}
              onClose={closeEditor}
              onSaved={handleEditorSaved}
              onOpenRecipe={openSubRecipe}
            />
          </div>
          {/* One mounted level per jumped sub-recipe: only the deepest is
              visible, the levels below stay mounted (hidden) with their work. */}
          {editorSubRecipes.map((recipe, index) => (
            <div
              key={`sub:${index}:${recipe.fileId}`}
              hidden={index !== editorSubRecipes.length - 1}
            >
              <RecipeEditor
                ref={(handle) => {
                  editorHandleRefs.current[index + 1] = handle;
                }}
                visible={index === editorSubRecipes.length - 1}
                token={token ?? ''}
                target={recipe}
                recipes={recipes ?? []}
                onClose={closeEditor}
                onSaved={handleEditorSaved}
                onOpenRecipe={openSubRecipe}
              />
            </div>
          ))}
        </>
      ) : aiCreateOpen ? null : (
        <main className="app">
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
              {connecting && (
                <p className="login-status" role="status">
                  Google-Anmeldefenster wird geöffnet …
                </p>
              )}
              {!connecting && error !== null && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
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
            <RecipeList recipes={recipes} token={token} onOpenRecipe={openOverview} />
          )}

          {token && (
            <button
              type="button"
              className={createMenuOpen ? 'fab fab-active' : 'fab'}
              aria-label={createMenuOpen ? 'Menü schließen' : 'Neues Rezept'}
              aria-expanded={createMenuOpen}
              onClick={() => setNav(createMenuOpen ? null : 'menu')}
            >
              <PlusIcon className="fab-icon" />
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
                  <PencilIcon className="fab-extended-icon" />
                  <span>Rezept manuell anlegen</span>
                </button>
                <button type="button" className="fab-extended" onClick={openAiCreate}>
                  <SparkleIcon className="fab-extended-icon" />
                  <span>Rezept mit KI anlegen</span>
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* The overview is a sheet over the list (not a screen of its own), so it
          renders as a sibling of the list branch and only while the list is the
          visible base. "Mehr → Manuell bearbeiten" replaces the sheet with the editor. */}
      {!editorOpen &&
        !aiCreateOpen &&
        overviewOpen &&
        overviewTarget !== null &&
        token !== null && (
          <RecipeOverview
            token={token}
            recipe={overviewTarget}
            onClose={closeOverview}
            onEdit={openEditor}
          />
        )}
    </>
  );
}

export default App;
