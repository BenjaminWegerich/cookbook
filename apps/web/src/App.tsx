import { useCallback, useEffect, useRef, useState } from 'react';

import { mealPlanEntriesForTitle, type Recipe } from '@cookbook/core';

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
import RecipeOverview, {
  type RecipeOverviewHandle,
  type RecipeOverviewTarget,
} from './components/RecipeOverview';
import Snackbar from './components/Snackbar';
import { PencilIcon, PlusIcon, SparkleIcon, UndoIcon } from './components/icons';
import { isDriveAuthError, setDriveUnauthorizedHandler } from './drive/driveClient';
import { loadIngredientMasterData } from './drive/ingredientMasterData';
import { listRecipes, type StoredRecipe } from './drive/recipeStorage';
import { useEscapeTrigger } from './hooks/useLeaveGuard';
import { useScrollMemory } from './hooks/useScrollMemory';
import { useSnackbar } from './hooks/useSnackbar';
import type { KeepState } from './keep/keepClient';
import { resolveMealPlan, type MealPlanCard, type MealPlanResolution } from './keep/mealPlanCards';
import { useKeep } from './keep/useKeep';
import './styles/ai-create.css';
import './styles/recipe-list.css';
import './styles/recipe-overview.css';
import './styles/meal-plan-sheet.css';
import './styles/editor.css';
import './styles/snackbar.css';

/**
 * The app layers above the recipe list (the list itself is the root/bottom
 * layer and has no marker of its own). The create menu and the recipe overview
 * sheet are treated like screens here: the browser Back button closes them
 * first, then leaves the list.
 */
type TopScreen = 'editor' | 'ai' | 'menu' | 'overview';

/**
 * Which AI task the sheet runs while it is the visible 'ai' screen: create a new
 * recipe (Task A) or revise an existing one (Task B) — the latter carrying the
 * stored recipe the user opened it for.
 */
type AiScreen = { mode: 'create' } | { mode: 'edit'; recipe: StoredRecipe };

/**
 * Browser-history markers of the two entries a TopScreen is layered between.
 * The recipe list is the entry the app was loaded on (state `null`); every
 * screen above it is one entry carrying SCREEN_MARKER, and the list keeps one
 * guard entry of its own (LIST_MARKER) underneath, so a screen is never the
 * app's shallowest entry (see guardCurrentEntry).
 */
const SCREEN_MARKER = 'above-list';
const LIST_MARKER = 'recipe-list';

/**
 * The stable "no recipe is planned" set: used while Keep is off or its state is
 * not loaded yet, so the "Sammlung" tab never has to test for null and the prop
 * keeps its identity across renders.
 */
const NO_PLANNED_TITLES: ReadonlySet<string> = new Set();

/** True when `state` belongs to one of our screen entries (history.state is a
 *  structured clone, so this must be a value check, never an identity check). */
function isScreenEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { appScreen?: unknown }).appScreen === SCREEN_MARKER
  );
}

/** True for the list's own guard entry (never for a screen entry). */
function isListEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { appScreen?: unknown }).appScreen === LIST_MARKER
  );
}

/**
 * True when the current entry is the app's shallowest own entry — the entry
 * the document happened to be loaded on, whose Back navigates the tab away
 * (to the previous page, or out of the app). Everything the app keeps beneath
 * the list instead carries LIST_MARKER.
 */
function isOwnRootEntry(state: unknown): boolean {
  return state === null || state === undefined;
}

/**
 * Owns one screen entry above the app's own entries: at least one marked entry
 * (the list's guard, see guardCurrentEntry) sits underneath, so the native Back
 * has something the app owns to pop. A screen opened while the app was already
 * sitting on its shallowest entry — possible after a Back on the list or a
 * restored Forward trail — gets the list guard first, so no screen is ever the
 * app's shallowest entry.
 */
function ownScreenEntry(): void {
  if (isOwnRootEntry(window.history.state)) {
    window.history.pushState({ appScreen: LIST_MARKER }, '');
  }
  window.history.pushState({ appScreen: SCREEN_MARKER }, '');
}

/**
 * Makes sure the *current* entry is a marked one, i.e. that the next native
 * Back has an app entry to pop instead of reaching the document below the app.
 * Called whenever a layer must survive the Back that just popped it (the
 * discard confirmation stays armed, the parent sub-recipe level is revealed):
 * the pop already happened, so the entry has to be put back.
 *
 * Why this guard exists: when a swipe-back pops the app's last entry, Chrome
 * for Android does not hand the gesture to the document — it navigates the tab
 * away, the app reloads at the login screen and the in-memory Drive/OAuth
 * session (googleAuth.ts) is gone. Together with the list guard entry pushed at
 * startup, the app's shallowest entry is therefore never the visible one: a
 * swipe always steps exactly one layer back, whatever made the trail shallow
 * (a Forward trail, a reload while a screen was open, a stale entry collapsed
 * on open).
 */
function guardCurrentEntry(): void {
  if (!isScreenEntry(window.history.state) && !isListEntry(window.history.state)) {
    ownScreenEntry();
  }
}

/**
 * Scroll-memory key of one editor level (see useScrollMemory): level 0 is the
 * base editor, levels 1..n are the sub-recipe levels in the order of
 * `editorSubRecipes`. Levels are a stack, so the index alone identifies a page
 * instance within one open chain; a popped level is forgotten, which is what
 * makes a later jump to the same recipe open at the top again.
 */
function editorLevelKey(level: number): string {
  return `editor:${level}`;
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
  /** True while a token request is running (the silent one on page load or
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
   * Which screen opened the editor: an AI conversation ('ai-create' or
   * 'ai-edit') continues underneath instead of the app returning to the list,
   * and a saved Zutaten-Rezept of an AI-create continues that conversation
   * (see the handoff below).
   */
  const editorOriginRef = useRef<'ai-create' | 'ai-edit' | 'list' | null>(null);
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
  /**
   * The recipe overview sheet (opened by tapping a card of either list tab).
   * The target is one of the three card types RecipeOverview renders: a known
   * recipe with its meal-plan context, or an unrecognized meal-plan entry.
   */
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewTarget, setOverviewTarget] = useState<RecipeOverviewTarget | null>(null);
  /**
   * Imperative handle of the mounted overview sheet. It owns the meal-plan
   * overlay layered inside it, so the popstate handler must let the sheet
   * consume the Back before it closes the sheet itself (same contract as the
   * editor and the AI sheet).
   */
  const overviewHandleRef = useRef<RecipeOverviewHandle | null>(null);
  /**
   * The AI screen (Task A create or Task B edit) is open. It stays mounted
   * (hidden) while its own draft is edited in the editor, so the conversation
   * survives the trip.
   */
  const [aiOpen, setAiOpen] = useState(false);
  /** The task the open AI screen runs (create vs. edit of a stored recipe). */
  const [aiScreen, setAiScreen] = useState<AiScreen | null>(null);
  /**
   * The resolved meal plan (the cards of the "Essensplan" tab plus the recipe
   * titles that carry the "Eingeplant" badge in "Sammlung"), together with the
   * Keep state it was computed for. Pairing the two makes a stale resolution
   * recognizable during render — a fresh Keep state has a fresh identity — so
   * nothing has to clear it from an effect. It lives in App, not in the list,
   * because it needs the recipe list and the Drive token (see
   * ./keep/mealPlanCards).
   */
  const [mealPlan, setMealPlan] = useState<{
    source: KeepState;
    resolution: MealPlanResolution;
  } | null>(null);
  /**
   * Keep connection state — the optional add-on (N5). The app stays fully
   * usable while it is off, unreachable or unauthenticated; the two list tabs
   * simply show their connection state instead of meal-plan cards.
   */
  const keep = useKeep();
  /**
   * `keep.retry` is referentially stable, but the hook's result object is not
   * (it is rebuilt each render). Naming the function here lets the automatic
   * connect effect below depend on it alone instead of on the whole object.
   */
  const retryKeep = keep.retry;
  /**
   * The app's transient notices (docs/ui_patterns.md). They live at the root so
   * every screen can report a finished action the same way; the timer, the queue
   * and the undo plumbing live in the hook. `showSnackbar` is stable, so the
   * callbacks below can depend on it directly.
   */
  const snackbar = useSnackbar();
  const showSnackbar = snackbar.show;

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
   * The full-screen page that owns the window scroll right now, for the scroll
   * memory below. Only pages that replace the whole viewport get their own key:
   * the sheets that overlay the list (overview, create menu) keep the list key,
   * so opening them never scrolls the list behind them.
   */
  const visiblePageKey = editorOpen
    ? editorLevelKey(editorSubRecipes.length)
    : aiOpen
      ? aiScreen?.mode === 'edit'
        ? 'ai-edit'
        : 'ai'
      : 'list';
  /** Remembers/restores the window scroll per page (see useScrollMemory). */
  const scrollMemory = useScrollMemory(visiblePageKey);

  // Give the recipe list an own guard entry (LIST_MARKER) directly above the
  // entry the app was loaded on. The list is the bottom layer and stays the
  // visible one across the guard, so nothing changes on screen; the point is
  // that from here on a screen entry always has a marked entry underneath.
  // Without it, a swipe-back that pops the app's last entry leaves the app
  // (Chrome for Android closes the tab or navigates back) and the reload lands
  // on the login screen — the in-memory Drive session is gone (see
  // guardCurrentEntry). The entry check keeps this to one entry per page load:
  // a re-run (a dev remount) must not stack another guard, and the entry that
  // gives up is the app's own root, so a Back onto that root still leaves the
  // app as before.
  useEffect(() => {
    if (!isListEntry(window.history.state)) {
      window.history.pushState({ appScreen: LIST_MARKER }, '');
    }
  }, []);

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
   * Dropped levels are page instances that no longer exist, so their remembered
   * scroll is forgotten: jumping to the same recipe again opens it at the top.
   */
  const replaceSubRecipes = useCallback(
    (next: StoredRecipe[]): void => {
      // The level that is on top right now is still visible: capture its offset
      // before this commit hides it (see useScrollMemory).
      scrollMemory.remember();
      const previous = editorSubRecipesRef.current;
      for (let level = next.length + 1; level <= previous.length; level += 1) {
        scrollMemory.forget(editorLevelKey(level));
      }
      editorSubRecipesRef.current = next;
      setEditorSubRecipes(next);
    },
    [scrollMemory],
  );

  /**
   * Starts a fresh editor chain (from the list, the overview or the AI
   * conversation). The base level is a new page instance, so its remembered
   * scroll is dropped and it opens at the top; `replaceSubRecipes([])` also
   * drops the levels of a previous chain. Both editor entry points share this.
   */
  const startEditorChain = useCallback((): void => {
    scrollMemory.forget(editorLevelKey(0));
    replaceSubRecipes([]);
  }, [replaceSubRecipes, scrollMemory]);

  /**
   * Switches the visible layer and keeps the browser history in sync so the
   * Back button steps back exactly one screen:
   * - list → screen: push one history entry (the list stays underneath);
   * - screen → screen (e.g. AI-create → editor): replace the entry;
   * - screen → list: pop via history.back() — the popstate listener then
   *   finds the layer already closed and does nothing.
   */
  const setNav = useCallback(
    (next: TopScreen | null): void => {
      const prev = navRef.current;
      navRef.current = next;
      if (next === prev) {
        return;
      }
      // The screen that is visible right now is still in the DOM: capture its
      // scroll offset before this commit replaces it (see useScrollMemory).
      scrollMemory.remember();
      setEditorOpen(next === 'editor');
      // The AI screen (create or edit) stays mounted (hidden) while its own
      // draft is opened in the editor: transcript, AI context and Vorgaben
      // survive the trip, so saving a Zutaten-Rezept there can continue the same
      // chat and a revision can still be refined afterwards.
      setAiOpen(next === 'ai' || (next === 'editor' && prev === 'ai'));
      setCreateMenuOpen(next === 'menu');
      setOverviewOpen(next === 'overview');
      if (prev === null) {
        if (next === null) {
          return;
        }
        // Collapse a stale screen entry (e.g. left behind by a browser Forward)
        // instead of stacking a duplicate on top of it: the current entry is
        // reused, so the list guard entry below it stays where it is.
        if (isScreenEntry(window.history.state)) {
          window.history.replaceState({ appScreen: SCREEN_MARKER }, '');
        } else {
          ownScreenEntry();
        }
      } else if (next === null) {
        window.history.back();
      } else {
        window.history.replaceState({ appScreen: SCREEN_MARKER }, '');
      }
    },
    [scrollMemory],
  );

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

  // Browser Back / Forward: step back exactly one layer instead of leaving the
  // app. The history holds the list's own guard entry (LIST_MARKER) plus at most
  // one screen entry above it, so a pop onto the guard closes the current
  // screen. A screen with internal layers can consume the pop itself: both the
  // editor and the AI-create sheet route it through their shared exit guard
  // (useLeaveGuard) — topmost overlay first, then the "Änderungen verwerfen?"
  // step. The device's swipe-back gesture arrives as the same popstate, so it
  // gets the identical guard.
  //
  // The guard entry is what makes the gesture safe on Android: a swipe-back that
  // pops the app's last entry does not reach this listener at all — Chrome for
  // Android then navigates the tab away, the app reloads at the login screen and
  // the memory-only session is lost ("the gesture closed the whole app"). With
  // the guard underneath, a swipe always lands on an entry the app owns, and a
  // pop the app consumes is undone by guardCurrentEntry.
  useEffect(() => {
    const onPopState = (): void => {
      // A Back / Forward may change the visible page below: capture the offset
      // of the page that is on screen right now while it still is (see
      // useScrollMemory). A pop that an inner layer consumes only re-stores the
      // same offset and changes no key.
      scrollMemory.remember();
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
      // Safety net for a guard entry that was lost anyway (e.g. a restored
      // Forward trail): the pop reached the entry the app was loaded on while a
      // screen is open. Rebuild the list's own entry here and reserve a screen
      // entry above it, so the next swipe is consumed inside the app instead of
      // leaving it. The visible layer already occupies one entry of the tab's
      // history, hence the replace before the push.
      if (isOwnRootEntry(window.history.state)) {
        window.history.replaceState({ appScreen: LIST_MARKER }, '');
        ownScreenEntry();
      }
      if (top === 'editor') {
        // The open-level count before the editor sees the pop: `notifyBack` may
        // step back to the parent level of a sub-recipe chain, which consumes
        // the pop although it reports false (the parent stays mounted).
        const levelCount = editorSubRecipesRef.current.length;
        if (topEditorHandle()?.notifyBack() === true) {
          // Stay on the editor (an overlay closed or the discard confirmation
          // was armed): make sure the Back the guard consumed left an entry.
          guardCurrentEntry();
          return;
        }
        if (editorSubRecipesRef.current.length < levelCount) {
          // Back stepped from a sub-recipe to its parent level: the editor
          // stays open, so cancel the pop exactly like a consumed overlay.
          guardCurrentEntry();
          return;
        }
      }
      if (top === 'ai' && aiCreateHandleRef.current?.notifyBack() === true) {
        // Stay on the AI screen (the discard confirmation was armed): make sure
        // the Back the guard consumed left an entry.
        guardCurrentEntry();
        return;
      }
      if (top === 'overview' && overviewHandleRef.current?.notifyBack() === true) {
        // The overview's meal-plan overlay consumed the Back and closed; the
        // sheet stays open, so re-establish the entry the pop consumed.
        guardCurrentEntry();
        return;
      }
      // Back out of an AI draft (created or revised) returns to the
      // still-running conversation (mounted underneath) instead of leaving for
      // the list.
      if (
        top === 'editor' &&
        (editorOriginRef.current === 'ai-create' || editorOriginRef.current === 'ai-edit')
      ) {
        editorOriginRef.current = null;
        pendingDraftRef.current = null;
        editorSubRecipesRef.current = [];
        editorTargetRef.current = null;
        navRef.current = 'ai';
        setEditorOpen(false);
        setEditorSubRecipes([]);
        setAiOpen(true);
        guardCurrentEntry();
        return;
      }
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorSubRecipesRef.current = [];
      editorTargetRef.current = null;
      navRef.current = null;
      setEditorOpen(false);
      setEditorSubRecipes([]);
      setAiOpen(false);
      setCreateMenuOpen(false);
      setOverviewOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // `scrollMemory` is referentially stable (memoized by the hook), so the
    // listener is registered once.
  }, [scrollMemory]);

  // Escape closes the FAB create menu. It is the keyboard equivalent of the
  // menu's backdrop tap and of the browser Back button (which App's popstate
  // handler covers when the menu is a screen entry). No discard confirmation is
  // needed: the menu holds no state of its own.
  useEscapeTrigger(() => setNav(null), createMenuOpen);

  /**
   * Logs in — triggered by the login button (user gesture) or by the
   * auto-login effect below (`{ silent: true }`, no UI). The mount effect
   * refreshes the recipe list as soon as the token is set (recipes === null
   * shows the loading message meanwhile).
   *
   * A silent attempt that does not get a token is *not* an error the user
   * should see: no screen was ever shown (googleAuth.ts sends `prompt: 'none'`
   * for it), so the login panel simply stays and the button is the retry.
   */
  const handleConnect = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    // An explicit login opens a new auth generation: allow one automatic
    // recovery again in case the new token is rejected as well.
    if (options?.silent !== true) authRecoveryRef.current = false;
    setError(null);
    setConnecting(true);
    let aborted = false;
    try {
      setToken(await requestAccessToken(options));
    } catch (err) {
      // A superseded silent attempt (user clicked during page-load login)
      // is aborted without a user-visible error — the fresh gesture attempt
      // takes over. Keep the `connecting` flag: it belongs to that attempt.
      aborted = err instanceof Error && err.name === 'AbortError';
      if (!aborted && options?.silent !== true) {
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
   * instead of returning the cached one. The fresh request is a silent one (no
   * UI, no gesture) and the revoked grant can no longer satisfy it, so it ends
   * without an error message and the login panel appears, where a single click
   * on "Mit Google verbinden" completes the login.
   */
  const recoverFromAuthError = useCallback(async (): Promise<void> => {
    if (authRecoveryRef.current) return; // already recovering / already ran
    authRecoveryRef.current = true;
    await revokeAccessToken();
    setToken(null);
    setRecipes(null);
    setError(null);
    setMasterDataWarning(null);
    await handleConnect({ silent: true });
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
   * Cold-start login: the access token is memory-only (googleAuth.ts), so every
   * page load starts logged out. To skip the intro screen, ask for a token
   * silently once the GIS script is ready — `{ silent: true }` sends
   * `prompt: 'none'`, so Google shows nothing and only answers from the
   * browser's Google session plus the grant it already remembers. That works
   * without a user gesture, which is what a page load cannot provide; when it
   * fails, the login panel stays and one tap on "Mit Google verbinden" opens
   * the account chooser. The GIS script loads `async`, so poll until it is
   * usable.
   */
  useEffect(() => {
    if (token) {
      return;
    }
    const deadline = Date.now() + GIS_LOAD_TIMEOUT_MS;
    const interval = window.setInterval(() => {
      if (isGoogleAuthAvailable()) {
        window.clearInterval(interval);
        void handleConnect({ silent: true });
      } else if (Date.now() >= deadline) {
        // GIS still unavailable — give up silently; the button keeps working.
        window.clearInterval(interval);
      }
    }, GIS_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [token, handleConnect]);

  // Resolve the meal plan into cards as soon as both halves are there: the
  // recipe list (for the title match) and the Keep state. Only entries that
  // state a size need a recipe file read (see ./keep/mealPlanCards), and the
  // Drive content cache makes repeated entries of one recipe free. A failed
  // resolution leaves the tab in its loading state instead of showing a card
  // set built from half the data.
  useEffect(() => {
    const keepState = keep.state;
    if (keepState === null || recipes === null || token === null) return;
    let cancelled = false;
    void resolveMealPlan(recipes, keepState.mealplan.items, token)
      .then((resolution) => {
        if (!cancelled) setMealPlan({ source: keepState, resolution });
      })
      .catch((err: unknown) => {
        if (!cancelled) setMealPlan(null);
        console.warn(
          `Essensplan konnte nicht aufgelöst werden: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [keep.state, recipes, token]);

  /**
   * The meal-plan resolution for the *current* Keep state, or null while none
   * exists (Keep off or loading, resolution still running, or it failed).
   */
  const mealPlanResolution =
    mealPlan !== null && mealPlan.source === keep.state ? mealPlan.resolution : null;

  /**
   * True while the recipe list is the visible layer (no editor, AI screen,
   * sheet or menu above it) — the precondition for the automatic attempt below.
   */
  const listVisible = !editorOpen && !aiOpen && !createMenuOpen && !overviewOpen;

  /** Fires the automatic Keep attempt at most once per page session. */
  const keepAttemptedRef = useRef(false);

  /**
   * The automatic Keep connection (decided with the user: once the Google login is done, the
   * app connects Keep without being asked). There is nothing to type any more — the sign-in
   * replaced the pasted code — so this is one *silent* attempt: if Google has the grant
   * already, the meal plan simply appears; if it needs a gesture, the "Essensplan" tab keeps
   * offering the connection and the app stays fully usable without Keep (N5).
   *
   * It fires once per page session and only from the visible list, so it never lands on top
   * of another layer. Waiting for `token` is what makes it work: on a cold start the Keep
   * hook's own attempt can run before the GIS script has loaded, and this is the retry that
   * happens once GIS is usable.
   */
  useEffect(() => {
    if (keepAttemptedRef.current) return;
    if (token === null || keep.status !== 'needs-signin') return;
    if (!listVisible) return;
    keepAttemptedRef.current = true;
    retryKeep();
  }, [token, keep.status, listVisible, retryKeep]);

  /**
   * Opens the overview for a card of the "Sammlung" tab. The resolution already
   * knows whether the recipe is planned and which size the plan states, so the
   * sheet can show the "Eingeplant" badge (only here — on "Essensplan" the tab
   * itself says it) and the "Geplant" value. With Keep off there is no
   * resolution: the recipe then behaves exactly like an unplanned one.
   */
  const openCollectionOverview = useCallback(
    (recipe: StoredRecipe): void => {
      const resolution = mealPlanResolution;
      setOverviewTarget({
        kind: 'recipe',
        recipe,
        source: 'collection',
        onMealPlan: resolution?.plannedRecipeTitles.has(recipe.title) ?? false,
        planned: resolution?.plannedAmounts.get(recipe.title) ?? null,
      });
      setNav('overview');
    },
    [mealPlanResolution, setNav],
  );

  /**
   * Opens the overview for a card of the "Essensplan" tab. A recognized card
   * carries the entry's stated size and is planned by definition ("Umplanen");
   * an unrecognized one opens the destination for replacing or dropping the
   * entry, because there is no recipe behind it.
   */
  const openMealPlanOverview = useCallback(
    (card: MealPlanCard): void => {
      setOverviewTarget(
        card.recipe !== null
          ? {
              kind: 'recipe',
              recipe: card.recipe,
              source: 'mealplan',
              onMealPlan: true,
              planned: card.planned,
            }
          : { kind: 'unknown', text: card.text },
      );
      setNav('overview');
    },
    [setNav],
  );

  /** Closes the overview sheet (backdrop, close button, browser Back). */
  const closeOverview = useCallback((): void => {
    setNav(null);
  }, [setNav]);

  /** The Keep write actions (stable), pulled out so the callback below can depend on them. */
  const planMeal = keep.planMeal;
  const undoMealPlan = keep.undoMealPlan;

  /**
   * Performs the meal-plan write for the open overview's recipe. The overlay
   * hands over the complete entry text (title + chosen size); the entries to
   * replace are every line of the raw Keep plan that names the same recipe —
   * checked or not, and whatever size it states (core's
   * `mealPlanEntriesForTitle`) — so the dish ends up on the plan exactly once.
   * The app owns that rule; the gateway only executes it.
   *
   * On success the whole flow closes back to the list, where the recipe card now
   * carries the "Eingeplant" badge, and one snackbar confirms it with the way back
   * (docs/ui_patterns.md). The active tab is deliberately untouched, so the app
   * stays on "Sammlung" instead of jumping to the new "Essensplan" entry.
   *
   * "Rückgängig" is a full undo: it removes the line this write added and puts
   * back the exact lines it replaced (`undoMealPlan`). Both texts are captured
   * here, because only this callback knows what the write actually changed. A
   * failed undo is reported as its own error notice — the success notice has
   * already closed by then.
   */
  const addToMealPlan = useCallback(
    async (entryText: string): Promise<void> => {
      const targetRecipe = overviewTarget?.kind === 'recipe' ? overviewTarget.recipe : null;
      if (targetRecipe === null) return;
      // The raw Keep items, not the resolved cards: the cards hide checked
      // entries, and a ticked-off line is still a duplicate in Keep.
      const texts = (keep.state?.mealplan.items ?? []).map((item) => item.text);
      const replace = mealPlanEntriesForTitle(texts, targetRecipe.title);
      await planMeal(entryText, replace);
      closeOverview();
      showSnackbar({
        text: `${entryText} zum Essensplan hinzugefügt. Die Einkaufsliste bleibt unverändert.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" />,
          run: async (): Promise<void> => {
            try {
              await undoMealPlan(entryText, replace);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              showSnackbar({
                tone: 'error',
                text: `„${entryText}“ konnte nicht rückgängig gemacht werden. ${reason}`,
              });
            }
          },
        },
      });
    },
    [overviewTarget, keep.state, planMeal, undoMealPlan, closeOverview, showSnackbar],
  );

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
      startEditorChain();
      showInEditor(recipe, null);
      setNav('editor');
    },
    [setNav, showInEditor, startEditorChain],
  );

  /** Opens the editor prefilled with an AI-created draft (new recipe). */
  const openEditorWithDraft = useCallback(
    (recipe: Recipe): void => {
      // Remembered so saving the draft can hand it back to the conversation.
      editorOriginRef.current = 'ai-create';
      pendingDraftRef.current = recipe;
      startEditorChain();
      showInEditor(null, recipe);
      setNav('editor');
    },
    [setNav, showInEditor, startEditorChain],
  );

  /**
   * Opens the editor on an existing recipe, prefilled with the AI's revised
   * version (Task B). The editor keeps the stored file as its baseline, so the
   * dirty check and the save rollback point at what is actually stored and
   * saving replaces the recipe.
   */
  const openEditorWithRevision = useCallback(
    (original: StoredRecipe, revision: Recipe): void => {
      editorOriginRef.current = 'ai-edit';
      pendingDraftRef.current = revision;
      startEditorChain();
      showInEditor(original, revision);
      setNav('editor');
    },
    [setNav, showInEditor, startEditorChain],
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

  /** Opens the AI-create conversation screen (Task A). */
  const openAiCreate = useCallback((): void => {
    setAiScreen({ mode: 'create' });
    setNav('ai');
  }, [setNav]);

  /** Opens the AI-edit screen for a stored recipe (Task B). */
  const openAiEdit = useCallback(
    (recipe: StoredRecipe): void => {
      setAiScreen({ mode: 'edit', recipe });
      setNav('ai');
    },
    [setNav],
  );

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
    const fromAi = editorOriginRef.current === 'ai-create' || editorOriginRef.current === 'ai-edit';
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
      const origin = editorOriginRef.current;
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorTargetRef.current = null;
      // A saved Zutaten-Rezept continues the *create* conversation: the dish
      // using it is usually the next request, and the chat must list the new
      // title. A saved dish and every AI *edit* are the end of the flow — back
      // to the list like any other save (the list was refreshed above).
      if (origin === 'ai-create' && saved !== null && saved.type === 'ingredient_recipe') {
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

  /** Status line in the header, German. It carries nothing but the count: while
   *  the list is loading and while the collection is empty, the body already
   *  says so in place of the list — the screen must not carry the same text
   *  twice. */
  const subtitle = !token
    ? 'Nicht verbunden'
    : recipes === null || recipes.length === 0
      ? ''
      : `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'}`;

  return (
    <>
      {/* The AI screen (create or edit) stays mounted while its own draft is
          edited (hidden): transcript, AI context and the transferred recipe
          survive the trip, so a saved Zutaten-Rezept can continue the same
          conversation and a revision can be refined further. The key remounts
          the sheet for a different task/target, so no conversation leaks from
          one recipe into another. */}
      {aiOpen && aiScreen !== null && (
        <div hidden={editorOpen}>
          <AiCreateSheet
            key={aiScreen.mode === 'edit' ? `edit:${aiScreen.recipe.fileId}` : 'create'}
            ref={aiCreateHandleRef}
            mode={aiScreen.mode}
            editTarget={aiScreen.mode === 'edit' ? aiScreen.recipe : undefined}
            token={token ?? ''}
            visible={!editorOpen}
            recipes={recipes ?? []}
            handoff={aiHandoff}
            onHandoffConsumed={handleHandoffConsumed}
            onClose={() => setNav(null)}
            onOpenDraft={(draft) =>
              aiScreen.mode === 'edit'
                ? openEditorWithRevision(aiScreen.recipe, draft)
                : openEditorWithDraft(draft)
            }
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
      ) : aiOpen ? null : (
        <main className="app">
          <header className="app-header">
            <h1>Cookbook</h1>
            <p className="app-subtitle" role="status">
              {subtitle}
            </p>
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
                  Anmeldung bei Google läuft …
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
            <RecipeList
              recipes={recipes}
              token={token}
              onOpenRecipe={openCollectionOverview}
              onOpenPlanCard={openMealPlanOverview}
              mealPlanCards={mealPlanResolution?.cards ?? null}
              plannedRecipeTitles={mealPlanResolution?.plannedRecipeTitles ?? NO_PLANNED_TITLES}
              keepStatus={keep.status}
              keepError={keep.error}
              onConnectKeep={() => void keep.connect()}
              onRetryKeep={keep.retry}
            />
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
          visible base. It renders one of the three card types from the target
          (known recipe, planned or not, or an unrecognized meal-plan entry);
          "Mehr → Manuell bearbeiten" replaces the sheet with the editor. */}
      {!editorOpen && !aiOpen && overviewOpen && overviewTarget !== null && token !== null && (
        <RecipeOverview
          ref={overviewHandleRef}
          token={token}
          target={overviewTarget}
          onClose={closeOverview}
          onEdit={openEditor}
          onAiEdit={openAiEdit}
          onAddToMealPlan={addToMealPlan}
        />
      )}

      {/* The transient notice (docs/ui_patterns.md). It renders at the root and
          above every layer, because the action it reports has just closed those
          layers; it is non-modal and never takes focus. */}
      <Snackbar host={snackbar} />
    </>
  );
}

export default App;
