import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  existingPlanLink,
  mealPlanEntriesForTitle,
  mealPlanEntryLabel,
  mealPlanEntryText,
  mealPlanEntryTextWithShortLink,
  parseMealPlanText,
  withPlanSize,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

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
import { newRecipeDraftWithTitle } from './components/recipeDrafts';
import RecipeList, { type RecipeTab } from './components/RecipeList';
import PantrySelect from './components/PantrySelect';
import RecipeOverview, {
  type RecipeOverviewHandle,
  type RecipeOverviewTarget,
} from './components/RecipeOverview';
import ShoppingListSelect from './components/ShoppingListSelect';
import Snackbar from './components/Snackbar';
import { PencilIcon, PlusIcon, SparkleIcon, UndoIcon } from './components/icons';
import { isDriveAuthError, setDriveUnauthorizedHandler } from './drive/driveClient';
import { loadIngredientMasterData } from './drive/ingredientMasterData';
import { listRecipes, recipeExportUrl, type StoredRecipe } from './drive/recipeStorage';
import { useEscapeTrigger } from './hooks/useLeaveGuard';
import { useScrollMemory } from './hooks/useScrollMemory';
import { useSnackbar } from './hooks/useSnackbar';
import { keepErrorMessage, type KeepChecklist, type KeepState } from './keep/keepClient';
import { resolveMealPlan, type MealPlanCard, type MealPlanResolution } from './keep/mealPlanCards';
import { useKeep } from './keep/useKeep';
import './styles/ai-create.css';
import './styles/recipe-list.css';
import './styles/recipe-overview.css';
import './styles/meal-plan-sheet.css';
import './styles/replace-recipe-sheet.css';
import './styles/shopping-list-select.css';
import './styles/pantry-select.css';
import './styles/editor.css';
import './styles/snackbar.css';

/**
 * The app layers above the recipe list (the list itself is the root/bottom
 * layer and has no marker of its own). The create menu and the recipe overview
 * sheet are treated like screens here: the browser Back button closes them
 * first, then leaves the list. 'shopping' is the bundled shopping-list selection
 * (components/ShoppingListSelect) and 'pantry' the stock step that follows it
 * (components/PantrySelect): two full screens of one flow — the flow can carry
 * sheets and the editor above the selection page, so it is not simply a sibling
 * of the list (see shoppingFlowRef).
 */
type TopScreen = 'editor' | 'ai' | 'menu' | 'overview' | 'shopping' | 'pantry';

/**
 * Which AI task the sheet runs while it is the visible 'ai' screen: create a new
 * recipe (Task A) or revise an existing one (Task B) — the latter carrying the
 * stored recipe the user opened it for.
 */
type AiScreen = { mode: 'create'; prompt?: string } | { mode: 'edit'; recipe: StoredRecipe };

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
  const editorOriginRef = useRef<'ai-create' | 'ai-edit' | 'list' | 'overview' | null>(null);
  /** The AI draft that opened the editor (null for a list/manual edit). */
  const pendingDraftRef = useRef<Recipe | null>(null);
  /**
   * True while the editor or the AI screen was started from an unrecognized
   * meal-plan entry's "Eintrag ersetzen" menu. Such a flow must return to that
   * entry's overview when it ends — the two create entries are the only flows
   * whose destination is a sheet rather than the list, the embedded AI
   * conversation or the bundled shopping flow. App clears the flag when it
   * returns to the overview (or when another flow starts).
   */
  const overviewReturnRef = useRef(false);
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
   * The bundled shopping-list selection is open (the full screen behind
   * "Einkaufsliste schreiben", components/ShoppingListSelect). Unlike the other
   * screens it is *not* unmounted by the layers above it: the selection is what
   * the user built up, so an overview sheet opened from a row, or the editor
   * opened from that sheet, keeps this page mounted (hidden) and returns to it
   * (see shoppingFlowRef and the render below).
   */
  const [shoppingOpen, setShoppingOpen] = useState(false);
  /**
   * True while the user is inside the bundled shopping-list flow: from opening
   * the selection page until a layer returns to the home screen. Screen → screen
   * navigation reuses one history entry (see setNav), so the flow is not
   * readable from `navRef` alone: it is what tells a closing layer where to go
   * and keeps the selection page mounted underneath every layer of the flow.
   * A ref, because the popstate listener is registered once and would close over
   * a stale state value.
   */
  const shoppingFlowRef = useRef(false);
  /**
   * The pantry step ("Vorräte auswählen", components/PantrySelect) is open: the
   * second page of the bundled shopping flow. It is *not* kept mounted while
   * another layer sits above it — none can be opened from it — so unlike the
   * selection page it is simply mounted and unmounted.
   */
  const [pantryOpen, setPantryOpen] = useState(false);
  /**
   * The dishes the pantry step was opened for: the checked cards the selection
   * page handed over. A snapshot on purpose — that page is what the user
   * confirmed, and the sheet must not change under their fingers when Keep moves
   * (an undo elsewhere re-resolves the plan).
   */
  const [pantryCards, setPantryCards] = useState<MealPlanCard[]>([]);
  /**
   * The meal plan the shopping list was last written for, or null. The Keep
   * state object *is* the marker: every meal-plan write (and every fresh read)
   * replaces `keep.state.mealplan` with a new object, while the shopping write
   * leaves it untouched — so "the list still belongs to this plan" is an
   * identity check, and any later plan change re-enables the button by itself
   * (decided with the user).
   *
   * Session-only on purpose: Keep cannot tell which shopping list belongs to
   * which plan, so after a reload the app does not pretend to know (it says
   * nothing rather than claiming the list was written).
   */
  const [shoppingWrittenFor, setShoppingWrittenFor] = useState<KeepChecklist | null>(null);
  /**
   * The tab of the recipe list the user picked, or null while they have not
   * touched the tabs. App owns it (not the list) because the header's counter
   * follows the view. Null keeps the default open: "Essensplan" once Keep is
   * connected and "Sammlung" otherwise — a stored null keeps the app from
   * jumping to an empty meal plan before the token is entered, and lets the view
   * follow the connection the moment it becomes ready.
   */
  const [listTab, setListTab] = useState<RecipeTab | null>(null);
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
   *
   * `enabled` is the Drive login: the page load has exactly one gesture-less
   * OAuth popup to spend, and it goes to Drive, which gates the whole app (see
   * the header of useKeep.ts). Only once that login is done may the hook ask
   * Google for its own identity token.
   */
  const keep = useKeep({ enabled: token !== null });
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
   * the sheets that overlay such a page (overview, create menu) keep that page's
   * key, so opening them never scrolls the page behind them. The selection page
   * keeps its key while an overview or the editor is above it, so the flow
   * returns to the rows exactly where they were left.
   */
  const visiblePageKey = editorOpen
    ? editorLevelKey(editorSubRecipes.length)
    : aiOpen
      ? aiScreen?.mode === 'edit'
        ? 'ai-edit'
        : 'ai'
      : pantryOpen
        ? 'pantry'
        : shoppingOpen
          ? 'shopping'
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
      // Leaving the flow for the home screen ends it: `shoppingFlowRef` is the
      // memory of where the layers above the selection page belong, and it must
      // not survive the return to the list.
      if (next === null) {
        shoppingFlowRef.current = false;
      }
      setEditorOpen(next === 'editor');
      // The AI screen (create or edit) stays mounted (hidden) while its own
      // draft is opened in the editor: transcript, AI context and Vorgaben
      // survive the trip, so saving a Zutaten-Rezept there can continue the same
      // chat and a revision can still be refined afterwards.
      setAiOpen(next === 'ai' || (next === 'editor' && prev === 'ai'));
      setCreateMenuOpen(next === 'menu');
      setOverviewOpen(next === 'overview');
      // The pantry step is the only layer above the selection page that is
      // mounted fresh each time; leaving it (Back, the write) unmounts it, so
      // the chosen stocks are gone and the next visit starts from the
      // pre-filled Vorräte again.
      setPantryOpen(next === 'pantry');
      // The selection page stays mounted (hidden) while any layer of its flow is
      // above it — the overview opened from a row, the editor opened from that
      // sheet — so the checked dishes survive the detour. The flow flag is set
      // by openShoppingSelect before the first setNav('shopping') call.
      setShoppingOpen(next === 'shopping' || (shoppingFlowRef.current && next !== null));
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
      if (top === 'ai' && overviewReturnRef.current) {
        // The AI-create screen was started from an unrecognized entry's menu:
        // Back returns to that entry's overview, which the flow was opened from.
        // The pop consumed the flow's single history entry, so the guard puts one
        // back under the restored sheet.
        overviewReturnRef.current = false;
        navRef.current = 'overview';
        setAiOpen(false);
        setOverviewOpen(true);
        guardCurrentEntry();
        return;
      }
      // Back out of a layer of the bundled shopping-list flow returns to the
      // selection page, which stayed mounted underneath it (see
      // shoppingFlowRef): the editor or the AI screen opened from the sheet, or
      // the sheet itself. The pop consumed the flow's single history entry, so
      // the guard has to put one back. Back on the selection page itself falls
      // through to the generic close below, which ends the flow.
      if (top === 'ai' && shoppingFlowRef.current) {
        navRef.current = 'shopping';
        setAiOpen(false);
        guardCurrentEntry();
        return;
      }
      if (top === 'overview' && overviewHandleRef.current?.notifyBack() === true) {
        // The overview's meal-plan overlay consumed the Back and closed; the
        // sheet stays open, so re-establish the entry the pop consumed.
        guardCurrentEntry();
        return;
      }
      if (top === 'pantry') {
        // Back out of the pantry step returns to the selection page, which
        // stayed mounted underneath it: the flow shares one history entry, so
        // the pop this consumed has to be replaced by the guard.
        navRef.current = 'shopping';
        setPantryOpen(false);
        guardCurrentEntry();
        return;
      }
      if (top === 'overview' && shoppingFlowRef.current) {
        // The sheet sits over the selection page: Back closes only the sheet.
        navRef.current = 'shopping';
        setOverviewOpen(false);
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
      if (top === 'editor' && overviewReturnRef.current) {
        // The editor was started from an unrecognized entry's create menu: Back
        // returns to that entry's overview, the sheet the flow was opened from.
        editorOriginRef.current = null;
        pendingDraftRef.current = null;
        editorSubRecipesRef.current = [];
        editorTargetRef.current = null;
        overviewReturnRef.current = false;
        navRef.current = 'overview';
        setEditorOpen(false);
        setEditorSubRecipes([]);
        setOverviewOpen(true);
        guardCurrentEntry();
        return;
      }
      // The editor opened from the selection page's overview (or a new recipe
      // started from an unrecognized entry there): Back returns to the selection
      // page with its checked dishes instead of leaving the flow.
      if (top === 'editor' && shoppingFlowRef.current) {
        editorOriginRef.current = null;
        pendingDraftRef.current = null;
        editorSubRecipesRef.current = [];
        editorTargetRef.current = null;
        navRef.current = 'shopping';
        setEditorOpen(false);
        setEditorSubRecipes([]);
        guardCurrentEntry();
        return;
      }
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorSubRecipesRef.current = [];
      editorTargetRef.current = null;
      navRef.current = null;
      // The way out of the flow: the selection page is dropped (its checked
      // dishes are not worth keeping across a return to the home screen).
      shoppingFlowRef.current = false;
      setEditorOpen(false);
      setEditorSubRecipes([]);
      setAiOpen(false);
      setCreateMenuOpen(false);
      setOverviewOpen(false);
      setShoppingOpen(false);
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
   * True while the current meal plan is the one the shopping list was written
   * for: an identity check against `shoppingWrittenFor`, which any meal-plan
   * change (a write, an undo, a fresh read) invalidates on its own — see the
   * state's own comment.
   */
  const shoppingWritten =
    shoppingWrittenFor !== null && shoppingWrittenFor === keep.state?.mealplan;

  /**
   * The meal-plan resolution for the *current* Keep state, or null while none
   * exists (Keep off or loading, resolution still running, or it failed).
   */
  const mealPlanResolution =
    mealPlan !== null && mealPlan.source === keep.state ? mealPlan.resolution : null;

  /**
   * The target the overview sheet really renders. An unrecognized entry can
   * become recognized while it is the open target: a recipe is created for it
   * (the "Eintrag ersetzen" menu's two create entries), or a known title's file
   * appears, and the live meal-plan resolution then holds a recipe card for the
   * entry's exact text. The sheet must switch to the known recipe's style — its
   * "Geplant" value, its badge and its travel action — so the stored target stays
   * the opened snapshot and only an `unknown` target is upgraded here.
   */
  const activeOverviewTarget: RecipeOverviewTarget | null = useMemo(() => {
    if (overviewTarget === null || overviewTarget.kind !== 'unknown') return overviewTarget;
    const card = mealPlanResolution?.cards.find((entry) => entry.text === overviewTarget.text);
    if (card === undefined || card.recipe === null) return overviewTarget;
    return {
      kind: 'recipe',
      recipe: card.recipe,
      source: 'mealplan',
      onMealPlan: true,
      planned: card.planned,
    };
  }, [overviewTarget, mealPlanResolution]);

  /**
   * The open overview's *live* plan state, derived from the current resolution,
   * or null when there is none (Keep off, the resolution is between two Keep
   * states, or the target is an unrecognized entry — nothing of this applies to
   * it). The sheet prefers this over the snapshot baked into the target because
   * the plan can move while the sheet is open: the previous notice's
   * "Rückgängig" can re-plan or remove the dish, and the meal plan may only
   * resolve after the sheet was opened. Its badge, its "Geplant" value and its
   * travel action must follow that. Between a write and the re-resolved plan the
   * sheet falls back to the snapshot, which is why the target still carries one.
   */
  const overviewLivePlan =
    activeOverviewTarget?.kind === 'recipe' && mealPlanResolution !== null
      ? {
          onMealPlan: mealPlanResolution.plannedRecipeTitles.has(activeOverviewTarget.recipe.title),
          planned: mealPlanResolution.plannedAmounts.get(activeOverviewTarget.recipe.title) ?? null,
        }
      : null;

  /**
   * True while the bundled selection page is the visible layer (no editor, AI
   * screen or overview sheet above it). It is *not* the condition for mounting
   * it: the page stays mounted while a layer of its flow sits above it, so the
   * checked dishes survive the detour and the flow returns to them.
   */
  const shoppingVisible = shoppingOpen && !pantryOpen && !editorOpen && !aiOpen && !overviewOpen;

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
          : { kind: 'unknown', text: card.text, displayText: card.displayText },
      );
      setNav('overview');
    },
    [setNav],
  );

  /**
   * Opens the bundled shopping-list selection ("Einkaufsliste schreiben"). The
   * flow flag is set first: `setNav` reads it to keep the page mounted under
   * every layer that follows it (see shoppingFlowRef).
   */
  const openShoppingSelect = useCallback((): void => {
    shoppingFlowRef.current = true;
    setNav('shopping');
  }, [setNav]);

  /**
   * Opens the pantry step for the dishes the selection page handed over
   * ("Vorräte auswählen"). The page is a new instance every time it is opened
   * (it unmounts when the flow leaves it), so its remembered scroll is dropped
   * and it starts at the top — the same rule the editor levels follow.
   */
  const openPantry = useCallback(
    (cards: readonly MealPlanCard[]): void => {
      scrollMemory.forget('pantry');
      setPantryCards([...cards]);
      setNav('pantry');
    },
    [setNav, scrollMemory],
  );

  /** Closes the overview sheet (backdrop, close button, browser Back). */
  const closeOverview = useCallback((): void => {
    // Over the selection page the sheet closes onto it — and its flow stays
    // active, so the checked dishes are still there. Over the list it leaves for
    // the list.
    setNav(shoppingFlowRef.current ? 'shopping' : null);
  }, [setNav]);

  /** The Keep write actions (stable), pulled out so the callbacks below can depend on them. */
  const planMeal = keep.planMeal;
  const undoMealPlan = keep.undoMealPlan;
  const checkMealPlan = keep.checkMealPlan;
  const uncheckMealPlan = keep.uncheckMealPlan;
  const writeShopping = keep.writeShopping;
  const shortenExportUrl = keep.shortenExportUrl;

  /**
   * Builds the Keep line for one chosen size: the recipe's export link, shortened when the
   * gateway can do it, otherwise the long URL exactly as before.
   *
   * Why the shortener is called here and not ahead of time: one short link exists per
   * (recipe, size), because the promised size is baked into the link's target — a redirect
   * does not reliably forward an appended parameter, and Apps Script never sees a fragment.
   * Pre-generating them for every possible yield would create dozens of links per recipe that
   * are never tapped, and would go stale as soon as the recipe's written yield (and with it
   * the range of sizes the export bakes) changes. So a link is created at the moment a dish is
   * planned, and reused whenever the plan already carries one for the same size.
   *
   * Reuse comes from the plan itself (`existingPlanLink`), which is free and needs no second
   * store: the lines that are about to be replaced are exactly the entries for this recipe.
   * A recipe without an export file keeps the linkless parenthetical shape.
   */
  const resolveMealPlanEntry = useCallback(
    async (
      recipe: StoredRecipe,
      planned: PlannedAmount,
      texts: readonly string[],
    ): Promise<string> => {
      const exportUrl =
        recipe.exportFileId !== undefined ? recipeExportUrl(recipe.exportFileId) : undefined;
      if (exportUrl === undefined) {
        return mealPlanEntryText(recipe.title, planned);
      }
      const reused = existingPlanLink(texts, recipe.title, planned);
      const shortUrl = reused ?? (await shortenExportUrl(withPlanSize(exportUrl, planned)));
      return shortUrl === null
        ? mealPlanEntryText(recipe.title, planned, exportUrl)
        : mealPlanEntryTextWithShortLink(recipe.title, planned, shortUrl);
    },
    [shortenExportUrl],
  );

  /**
   * Performs the meal-plan write for the open overview's recipe. The overlay
   * hands over the chosen size; the entry text is built here
   * (`resolveMealPlanEntry` — export link, shortened when possible), and the
   * entries to replace are every line of the raw Keep plan that names the same
   * recipe — checked or not, and whatever size it states (core's
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
    async (planned: PlannedAmount): Promise<void> => {
      const targetRecipe =
        activeOverviewTarget?.kind === 'recipe' ? activeOverviewTarget.recipe : null;
      if (targetRecipe === null) return;
      // The raw Keep items, not the resolved cards: the cards hide checked
      // entries, and a ticked-off line is still a duplicate in Keep.
      const texts = (keep.state?.mealplan.items ?? []).map((item) => item.text);
      const replace = mealPlanEntriesForTitle(texts, targetRecipe.title);
      const entryText = await resolveMealPlanEntry(targetRecipe, planned, texts);
      await planMeal(entryText, replace);
      closeOverview();
      // The written line is "<Titel>: <URL>" and would read poorly in the
      // notice; the parser gives back the human form ("Kürbissuppe (6
      // Portionen)") for it. The exact line stays the undo's business.
      const written = parseMealPlanText(entryText);
      const label = mealPlanEntryLabel(written.title, written.planned);
      showSnackbar({
        text: `${label} zum Essensplan hinzugefügt. Die Einkaufsliste bleibt unverändert.`,
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
                text: `„${label}“ konnte nicht rückgängig gemacht werden. ${reason}`,
              });
            }
          },
        },
      });
    },
    [
      activeOverviewTarget,
      keep.state,
      planMeal,
      undoMealPlan,
      closeOverview,
      showSnackbar,
      resolveMealPlanEntry,
    ],
  );

  /**
   * Performs the "Umplanen" write for the open overview's recipe: replaces the
   * recipe's current entries with one at the newly chosen size. The overlay hands
   * over the chosen size; the entry text is built here (`resolveMealPlanEntry`,
   * like planning — an existing short link at that size is reused), and the
   * entries to replace are every line of the raw Keep plan that names the same
   * recipe (core's `mealPlanEntriesForTitle`) — the same rule the first-time plan
   * uses, so the dish ends up on the plan exactly once and its link opens the new
   * size.
   *
   * Unlike "Vom Plan entfernen", this does *not* keep the overview open: the
   * whole flow closes back to the list like planning does (decided with the
   * user), so only "Abbrechen" returns to the overview. The card there already
   * carries the new size through the re-resolved plan. A failure is thrown on to
   * the overlay, which stays open and shows the reason next to the button.
   *
   * "Rückgängig" is the same full restore as planning's undo: it removes the
   * line this write added and puts back the exact lines it replaced
   * (`undoMealPlan`). Both texts are captured here, because only this callback
   * knows what the write actually changed.
   */
  const changeMealPlanAmount = useCallback(
    async (planned: PlannedAmount): Promise<void> => {
      const targetRecipe =
        activeOverviewTarget?.kind === 'recipe' ? activeOverviewTarget.recipe : null;
      if (targetRecipe === null) return;
      // The raw Keep items, not the resolved cards: the cards hide checked
      // entries, and a ticked-off line is still a duplicate in Keep.
      const texts = (keep.state?.mealplan.items ?? []).map((item) => item.text);
      const replace = mealPlanEntriesForTitle(texts, targetRecipe.title);
      const entryText = await resolveMealPlanEntry(targetRecipe, planned, texts);
      await planMeal(entryText, replace);
      closeOverview();
      showSnackbar({
        text: `Menge für ${targetRecipe.title} auf dem Essensplan geändert. Die Einkaufsliste bleibt unverändert.`,
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
                text: `Die Änderung für „${targetRecipe.title}“ konnte nicht rückgängig gemacht werden. ${reason}`,
              });
            }
          },
        },
      });
    },
    [
      activeOverviewTarget,
      keep.state,
      planMeal,
      undoMealPlan,
      closeOverview,
      showSnackbar,
      resolveMealPlanEntry,
    ],
  );

  /**
   * Replaces the open unrecognized meal-plan entry with a chosen recipe of the
   * collection — the "Eintrag ersetzen" → "Bestehendes Rezept auswählen" flow.
   *
   * The overlay hands over the picked recipe and the size chosen in its own
   * control; the Keep line is built here like every meal-plan write
   * (`resolveMealPlanEntry`: the recipe's export link, shortened when the
   * gateway can, or the long URL as before), and the entry it replaces is the
   * one unrecognized line the overview was opened on — a 1:1 replacement
   * (decided with the user): the chosen recipe's own entries elsewhere on the
   * plan are deliberately left alone, so the notice and its undo are exact.
   *
   * On success the whole flow closes back to the list, where that line no longer
   * renders as an unrecognized card but as the recipe's own card, and one
   * snackbar confirms it with the way back (docs/ui_patterns.md). The notice
   * names the entry that left the plan and the dish that took its place, and
   * repeats that the shopping list is untouched.
   *
   * "Rückgängig" is the exact inverse: it removes the written line and puts the
   * unrecognized entry back (`undoMealPlan`). Both texts are captured here,
   * because only this callback knows what the write changed.
   */
  const replaceMealPlanEntry = useCallback(
    async (recipe: StoredRecipe, planned: PlannedAmount): Promise<void> => {
      if (activeOverviewTarget === null || activeOverviewTarget.kind !== 'unknown') return;
      // The exact Keep line to overwrite, and its human form for the notice.
      const replacedText = activeOverviewTarget.text;
      const replacedLabel = activeOverviewTarget.displayText;
      // The raw Keep items, so an existing short link at the chosen size is
      // reused (`resolveMealPlanEntry`) exactly like the other writes.
      const texts = (keep.state?.mealplan.items ?? []).map((item) => item.text);
      const entryText = await resolveMealPlanEntry(recipe, planned, texts);
      await planMeal(entryText, [replacedText]);
      closeOverview();
      // The label the meal plan now shows for the new dish ("Kürbissuppe
      // (6 Portionen)"); the exact written line stays the undo's business.
      const label = mealPlanEntryLabel(recipe.title, planned);
      showSnackbar({
        text: `„${replacedLabel}“ durch ${label} ersetzt. Die Einkaufsliste bleibt unverändert.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" />,
          run: async (): Promise<void> => {
            try {
              await undoMealPlan(entryText, [replacedText]);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              showSnackbar({
                tone: 'error',
                text: `„${replacedLabel}“ konnte nicht wiederhergestellt werden. ${reason}`,
              });
            }
          },
        },
      });
    },
    [
      activeOverviewTarget,
      keep.state,
      planMeal,
      undoMealPlan,
      closeOverview,
      showSnackbar,
      resolveMealPlanEntry,
    ],
  );

  /**
   * Takes the open overview's meal-plan entry off the plan: a recognized recipe
   * ("Mehr" → "Vom Plan entfernen") or an unrecognized entry (its own danger
   * button), which has no recipe behind it. Removing deliberately *checks* the
   * Keep lines instead of deleting them, so the user can still see in Keep what
   * was cooked; `checkMealPlan` is therefore the write and `uncheckMealPlan` its
   * undo.
   *
   * What is checked differs by card type, and both cases hand the gateway the
   * exact Keep texts:
   * - a recognized recipe owns every line naming it in the raw plan (core's
   *   `mealPlanEntriesForTitle`), the same recognition rule the write uses, so
   *   duplicates all move together;
   * - an unrecognized entry *is* its one line — the target's complete text,
   *   which the recognized path would parse apart.
   *
   * The whole flow closes back to the list (decided with the user), exactly like
   * the two write overlays, so only "Abbrechen" or the close button returns to
   * the sheet.
   *
   * The Keep connection state can fail, and the button that triggered this has
   * no place to show a reason, so a failure is reported as its own error notice
   * instead of being thrown. The success notice names the entry the way the
   * sheet does — a recipe by title, an unrecognized entry by its text without
   * the export link — because it is the dish that left the plan, not one of its
   * Keep lines.
   */
  const removeFromMealPlan = useCallback((): void => {
    void (async (): Promise<void> => {
      if (activeOverviewTarget === null) return;
      let entries: string[];
      let name: string;
      if (activeOverviewTarget.kind === 'recipe') {
        // The raw Keep items, not the resolved cards: the cards hide checked
        // entries, and a ticked-off line is still a duplicate in Keep.
        const texts = (keep.state?.mealplan.items ?? []).map((item) => item.text);
        entries = mealPlanEntriesForTitle(texts, activeOverviewTarget.recipe.title);
        name = activeOverviewTarget.recipe.title;
      } else {
        // The unrecognized entry's complete text is the exact Keep line; its
        // display text (the line without the export URL) is what the sheet shows
        // as the title and what the notice names.
        entries = [activeOverviewTarget.text];
        name = activeOverviewTarget.displayText;
      }
      try {
        await checkMealPlan(entries);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        showSnackbar({
          tone: 'error',
          text: `„${name}“ konnte nicht vom Essensplan entfernt werden. ${reason}`,
        });
        return;
      }
      closeOverview();
      showSnackbar({
        text: `${name} vom Essensplan entfernt. Die Einkaufsliste bleibt unverändert.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" />,
          run: async (): Promise<void> => {
            try {
              // Ticking the lines back on is the exact inverse of the removal, so
              // the dish reappears on the plan with the size it had.
              await uncheckMealPlan(entries);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              showSnackbar({
                tone: 'error',
                text: `„${name}“ konnte nicht wieder eingeplant werden. ${reason}`,
              });
            }
          },
        },
      });
    })();
  }, [
    activeOverviewTarget,
    keep.state,
    checkMealPlan,
    uncheckMealPlan,
    closeOverview,
    showSnackbar,
  ]);

  /**
   * Performs the pantry step's write: the sheets' "Einkaufsliste schreiben"
   * hands over the lines of its upper part (one per ingredient that is not
   * covered, in the familiar display arrangement) and the number of dishes they
   * were computed from.
   *
   * On success the whole flow closes back to the home screen and one snackbar
   * reports it with the way back (docs/ui_patterns.md): "Rückgängig" removes
   * exactly the lines this write added (`writeShopping([], lines)`) and clears
   * the "written" marker again, so the button offers the flow once more. The
   * meal plan is never touched by either direction — the second sentence of the
   * meal-plan notices exists for the opposite doubt, so it is not repeated
   * here.
   *
   * The meal plan's identity is captured *before* the write and kept as the
   * "written for" marker: the shopping endpoint answers the shopping list only,
   * so that object stays the current one and the button reads "Einkaufsliste
   * geschrieben" — until any meal-plan change replaces it (see
   * `shoppingWrittenFor`).
   *
   * A failure is thrown on to the sheet, which stays open and shows the reason
   * next to its button, so the chosen Vorräte are not lost. `keepErrorMessage`
   * turns the gateway's operator-facing codes into the app's German reading —
   * including the `not_implemented` (501) the route answers with until the
   * shopping write exists in the gateway.
   */
  const writeShoppingList = useCallback(
    async (lines: readonly string[], recipes: number): Promise<void> => {
      const writtenFor = keep.state?.mealplan ?? null;
      try {
        await writeShopping(lines, []);
      } catch (err) {
        throw new Error(keepErrorMessage(err));
      }
      setShoppingWrittenFor(writtenFor);
      setPantryCards([]);
      setNav(null);
      const ingredients = lines.length;
      showSnackbar({
        text: `${ingredients} ${ingredients === 1 ? 'Zutat' : 'Zutaten'} für ${recipes} ${
          recipes === 1 ? 'Rezept' : 'Rezepte'
        } zur Einkaufsliste hinzugefügt.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" />,
          run: async (): Promise<void> => {
            try {
              await writeShopping([], lines);
              // The list is back to what it was, so the plan has not been
              // written for any more: the button offers the flow again.
              setShoppingWrittenFor(null);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              showSnackbar({
                tone: 'error',
                text: `Die Einkaufsliste konnte nicht zurückgesetzt werden. ${reason}`,
              });
            }
          },
        },
      });
    },
    [keep.state, writeShopping, setNav, showSnackbar],
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
      // A create flow started from an unrecognized entry ends here: the list is
      // the destination of this one, so the overview return must not linger.
      overviewReturnRef.current = false;
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
    // The list/FAB entry point, not the overview's create menu: the AI screen
    // returns to the list, so no overview return may linger.
    overviewReturnRef.current = false;
    setAiScreen({ mode: 'create' });
    setNav('ai');
  }, [setNav]);

  /** Opens the AI-edit screen for a stored recipe (Task B). */
  const openAiEdit = useCallback(
    (recipe: StoredRecipe): void => {
      // Task B is never started from the unrecognized entry's create menu.
      overviewReturnRef.current = false;
      setAiScreen({ mode: 'edit', recipe });
      setNav('ai');
    },
    [setNav],
  );

  /**
   * "Rezept manuell anlegen" of an unrecognized meal-plan entry: opens the editor
   * on a new recipe whose title is the entry's *complete* Keep text (the exact
   * line, not the shortened display form), and remembers that leaving the editor
   * comes back to this overview. Saving a recipe whose title then matches the
   * entry makes the overview render the recognized style by itself (see
   * activeOverviewTarget).
   */
  const createRecipeFromEntry = useCallback((): void => {
    if (overviewTarget === null || overviewTarget.kind !== 'unknown') return;
    overviewReturnRef.current = true;
    editorOriginRef.current = 'overview';
    pendingDraftRef.current = null;
    startEditorChain();
    showInEditor(null, newRecipeDraftWithTitle(overviewTarget.text));
    setNav('editor');
  }, [overviewTarget, setNav, showInEditor, startEditorChain]);

  /**
   * "Rezept mit KI anlegen" of an unrecognized meal-plan entry: opens the
   * AI-create screen with the entry's *complete* Keep text as the first request
   * (the exact line, not the shortened display form), and remembers that closing
   * the screen comes back to this overview.
   */
  const createRecipeWithAiFromEntry = useCallback((): void => {
    if (overviewTarget === null || overviewTarget.kind !== 'unknown') return;
    overviewReturnRef.current = true;
    setAiScreen({ mode: 'create', prompt: overviewTarget.text });
    setNav('ai');
  }, [overviewTarget, setNav]);

  /**
   * Leaves the editor one step: first back to the parent level of an open
   * sub-recipe chain (the level stays mounted, so nothing is lost), and only
   * from the base level out of the editor (to the selection page of the bundled
   * shopping-list flow, to the list, or back to the AI conversation of an AI
   * draft). Every exit trigger — header button, Escape, browser Back — ends
   * here, so they all follow the same order.
   */
  const closeEditor = useCallback((): void => {
    const open = editorSubRecipesRef.current;
    if (open.length > 0) {
      replaceSubRecipes(open.slice(0, -1));
      return;
    }
    const fromAi = editorOriginRef.current === 'ai-create' || editorOriginRef.current === 'ai-edit';
    const toOverview = overviewReturnRef.current;
    editorOriginRef.current = null;
    pendingDraftRef.current = null;
    editorTargetRef.current = null;
    // Leaving an AI draft without saving returns to its conversation (the sheet
    // is still mounted) and keeps the overview return armed for when that
    // conversation is closed; an editor started from an unrecognized entry's
    // create menu returns to that entry's overview; an editor opened inside the
    // bundled shopping-list flow returns to the selection page (its checked
    // dishes are still mounted); every other editor closes to the list.
    if (fromAi) {
      setNav('ai');
      return;
    }
    if (toOverview) {
      overviewReturnRef.current = false;
      setNav('overview');
      return;
    }
    setNav(shoppingFlowRef.current ? 'shopping' : null);
  }, [setNav, replaceSubRecipes]);

  /**
   * Closes the AI screen (create or edit) without a save. A create started from
   * an unrecognized entry's menu returns to that entry's overview; otherwise the
   * bundled shopping flow keeps the selection page as the destination and
   * everything else returns to the list.
   */
  const closeAi = useCallback((): void => {
    if (overviewReturnRef.current) {
      overviewReturnRef.current = false;
      setNav('overview');
      return;
    }
    setNav(shoppingFlowRef.current ? 'shopping' : null);
  }, [setNav]);

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
      const toOverview = overviewReturnRef.current;
      editorOriginRef.current = null;
      pendingDraftRef.current = null;
      editorTargetRef.current = null;
      // A saved Zutaten-Rezept continues the *create* conversation: the dish
      // using it is usually the next request, and the chat must list the new
      // title (the overview return stays armed until that conversation closes).
      // A saved dish and every AI *edit* are the end of the flow — back to the
      // entry's overview when the flow was started from there, to the selection
      // page when the editor was opened inside the bundled shopping-list flow,
      // to the list otherwise (the list was refreshed above).
      if (origin === 'ai-create' && saved !== null && saved.type === 'ingredient_recipe') {
        setAiHandoff({ title: saved.title, type: saved.type });
        setNav('ai');
        return;
      }
      if (toOverview) {
        overviewReturnRef.current = false;
        setNav('overview');
        return;
      }
      setNav(shoppingFlowRef.current ? 'shopping' : null);
    },
    [token, refreshRecipes, setNav, replaceSubRecipes],
  );

  /** The chat applied the handoff (context re-read, request prefilled). */
  const handleHandoffConsumed = useCallback((): void => {
    setAiHandoff(null);
  }, []);

  /**
   * The active tab of the recipe list. The list renders it, the header's
   * counter below reads it. Null means the user has not picked one yet, so the
   * default (decided with the user) is "Essensplan" once Keep is connected and
   * "Sammlung" otherwise.
   */
  const activeListTab: RecipeTab = listTab ?? (keep.status === 'ready' ? 'mealplan' : 'collection');

  /**
   * Titles recognized on the meal plan, or the stable empty set while Keep is
   * off or its plan has not resolved. Named here because the header counter and
   * the list both read it.
   */
  const plannedRecipeTitles = mealPlanResolution?.plannedRecipeTitles ?? NO_PLANNED_TITLES;

  /**
   * The header's status line(s), German, following the active tab:
   *
   * - "Sammlung": `x Rezepte,` and, below it, `davon y eingeplant` — y is how
   *   many of the collection's recipes the meal plan uses (the "Eingeplant"
   *   badge; a dish planned twice still counts once, as one of the x).
   * - "Essensplan": `x Einträge auf dem Essensplan,` and, below it, `davon y
   *   unbekannt` — y is how many of Keep's entries are not recognized as a
   *   recipe (the "Unbekannt" badge; every entry counts, even a repeated one).
   *
   * The first line ends in a comma in both views: it carries the stack on to
   * the "davon …" share below it.
   *
   * The list of lines is empty while the active view has nothing to count yet:
   * on the collection that is the loading/empty case the body already states in
   * place of the list, on the meal plan a resolution that is not there (Keep
   * off, connecting, still loading or failed). The header then stays silent
   * rather than claiming a zero it cannot know, and never repeats the body's
   * text on the same screen.
   */
  const subtitleLines: string[] = (() => {
    if (token === null) return ['Nicht verbunden'];
    if (recipes === null || recipes.length === 0) return [];
    if (activeListTab === 'mealplan') {
      if (mealPlanResolution === null) return [];
      const entries = mealPlanResolution.cards.length;
      const unknown = mealPlanResolution.cards.filter((card) => card.recipe === null).length;
      return [
        `${entries} ${entries === 1 ? 'Eintrag' : 'Einträge'} auf dem Essensplan,`,
        `davon ${unknown} unbekannt`,
      ];
    }
    const planned = recipes.filter((recipe) => plannedRecipeTitles.has(recipe.title)).length;
    return [
      `${recipes.length} ${recipes.length === 1 ? 'Rezept' : 'Rezepte'},`,
      `davon ${planned} eingeplant`,
    ];
  })();

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
            initialPrompt={aiScreen.mode === 'create' ? aiScreen.prompt : undefined}
            token={token ?? ''}
            visible={!editorOpen}
            recipes={recipes ?? []}
            handoff={aiHandoff}
            onHandoffConsumed={handleHandoffConsumed}
            // Closing the AI screen returns to the unrecognized entry's overview
            // when the create flow was started there, to the selection page while
            // the bundled shopping-list flow is active (that page is still
            // mounted), and to the list otherwise.
            onClose={closeAi}
            onOpenDraft={(draft) =>
              aiScreen.mode === 'edit'
                ? openEditorWithRevision(aiScreen.recipe, draft)
                : openEditorWithDraft(draft)
            }
          />
        </div>
      )}

      {/* The bundled shopping-list selection ("Einkaufsliste schreiben"). It is
          a full screen of its own, but it stays mounted (hidden) while a layer
          of its flow sits above it — the overview sheet opened from a row, the
          editor or the AI screen opened from that sheet — so the checked dishes
          survive the detour and closing that layer returns here (see
          shoppingFlowRef). The wrapper carries `hidden` (a plain div, like the
          AI sheet and the editor levels), because the page's own `.app` display
          would beat [hidden]. */}
      {shoppingOpen && (
        <div hidden={!shoppingVisible}>
          <ShoppingListSelect
            cards={mealPlanResolution?.cards ?? null}
            onOpenCard={openMealPlanOverview}
            onChoosePantry={openPantry}
            onClose={() => setNav(null)}
          />
        </div>
      )}

      {/* The pantry step ("Vorräte auswählen") — the second page of the bundled
          shopping flow, over the selection page it follows. Nothing opens above
          it, so it needs no hidden wrapper: it is simply mounted while it is the
          flow's visible page. */}
      {pantryOpen && (
        <PantrySelect
          cards={pantryCards}
          token={token ?? ''}
          onBack={() => setNav('shopping')}
          onWrite={writeShoppingList}
        />
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
      ) : aiOpen ? null : shoppingOpen || pantryOpen ? null : (
        <main className="app">
          <header className="app-header">
            <h1>Cookbook</h1>
            <p className="app-subtitle" role="status">
              {subtitleLines.map((line, index) => (
                // Each line is its own block, so the counter reads as a two-line
                // stack in the header's top right corner (see .app-subtitle-line).
                <span key={index} className="app-subtitle-line">
                  {line}
                </span>
              ))}
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
              tab={activeListTab}
              onTabChange={setListTab}
              token={token}
              onOpenRecipe={openCollectionOverview}
              onOpenPlanCard={openMealPlanOverview}
              mealPlanCards={mealPlanResolution?.cards ?? null}
              plannedRecipeTitles={plannedRecipeTitles}
              keepStatus={keep.status}
              keepError={keep.error}
              onConnectKeep={() => void keep.connect()}
              onRetryKeep={keep.retry}
              onWriteShoppingList={openShoppingSelect}
              shoppingWritten={shoppingWritten}
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
          "Mehr → Manuell bearbeiten" replaces the sheet with the editor. The
          target is the live one (activeOverviewTarget): an unrecognized entry
          whose recipe has just been created for it switches to the recognized
          style while the sheet is open. */}
      {!editorOpen &&
        !aiOpen &&
        overviewOpen &&
        activeOverviewTarget !== null &&
        token !== null && (
          <RecipeOverview
            ref={overviewHandleRef}
            token={token}
            recipes={recipes ?? []}
            target={activeOverviewTarget}
            onClose={closeOverview}
            onEdit={openEditor}
            onAiEdit={openAiEdit}
            onCreateFromEntry={createRecipeFromEntry}
            onCreateWithAiFromEntry={createRecipeWithAiFromEntry}
            onAddToMealPlan={addToMealPlan}
            onChangeAmount={changeMealPlanAmount}
            onReplaceEntry={replaceMealPlanEntry}
            onRemoveFromMealPlan={removeFromMealPlan}
            livePlan={overviewLivePlan}
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
