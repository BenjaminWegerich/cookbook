/**
 * Keep connection state for the app (N5: the core must work without Keep).
 *
 * Owns the whole lifecycle of the optional integration in one hook:
 *
 * - `off` — the build has no gateway URL, so every Keep feature is hidden/off;
 * - `checking` — the configured gateway is being probed (`GET /health`);
 * - `needs-signin` — the gateway answers, but Google has not yet given us a sign-in to prove
 *   who we are; one tap on "Keep verbinden" starts that (a gesture is the one thing a silent
 *   attempt cannot provide);
 * - `loading` — a `/keep/state` request is running;
 * - `ready` — both notes were read, `state` holds them;
 * - `unreachable` — the probe failed (network, CORS, service down);
 * - `error` — a request failed for another reason (5xx, bad answer, a Google popup the user
 *   closed).
 *
 * The sign-in itself lives in ../auth/googleAuth: the identity token (scope `openid email`,
 * memory only, N6) is requested there and never stored. A 401 from the gateway is answered by
 * dropping the cached token and asking Google again — silently, because an expired token
 * (Google access tokens live about an hour) is the ordinary reason — and only if that also
 * fails does the status fall back to `needs-signin`.
 *
 * The hook deliberately does not depend on the Drive *credential*: Keep and Google Drive are
 * separate credentials on separate scopes. App decides *when* to offer the connection, not this
 * module — and that "when" now matters, because Google's popup window serves only **one
 * gesture-less sign-in per page load**: measured on a cold start, the first silent flow returned
 * its token and the second one was closed with `popup_closed`, whichever credential went second.
 * The app therefore spends that one silent flow on Drive (it gates the whole app) and tells this
 * hook when the Drive login is done, via `UseKeepOptions.enabled`.
 */

import { useCallback, useEffect, useState } from 'react';

import { clearIdentityToken, getIdentityToken, requestIdentityToken } from '../auth/googleAuth';
import {
  KeepClientError,
  checkKeepHealth,
  fetchKeepState,
  isKeepConfigured,
  keepErrorMessage,
  setMealPlanChecked,
  shortenUrl,
  writeMealPlan,
  writeShoppingList,
  type KeepState,
} from './keepClient';

/** Where the Keep connection currently stands (see the file header). */
export type KeepStatus =
  'off' | 'checking' | 'needs-signin' | 'loading' | 'ready' | 'unreachable' | 'error';

export interface UseKeepResult {
  status: KeepStatus;
  /** The notes once loaded, otherwise null. */
  state: KeepState | null;
  /** German failure text for the current status, or null. */
  error: string | null;
  /**
   * Signs in with Google (a user gesture, so Google may show its chooser) and reads both
   * notes. Resolves on success; on failure it sets the status/error and rethrows, so a caller
   * that wants to react to the failure can.
   */
  connect: () => Promise<void>;
  /**
   * Puts a dish on the meal plan — the recipe overview's write action. `entry` is the
   * complete line to add, `replace` the exact texts of the entries the caller recognized as
   * the same recipe (it has the recipe's type and family unit, this hook does not).
   *
   * Adopts the state the gateway reports back, so the planned badge appears without a second
   * read. On failure it updates the status like `connect` does and rethrows, so the calling
   * sheet can show the reason.
   */
  planMeal: (entry: string, replace: readonly string[]) => Promise<void>;
  /**
   * Asks the gateway for a short link to one export URL. Resolves the short URL, or null when
   * shortening is off, unreachable or refused.
   *
   * Deliberately never changes the connection status: a missing shortener is not a Keep
   * failure, and the caller answers null by writing the long export URL — the app's behaviour
   * before the shortener existed. The link is created on demand, when a dish is planned; it is
   * never pre-generated for sizes nobody chose.
   */
  shortenExportUrl: (target: string) => Promise<string | null>;
  /**
   * Undoes a `planMeal` write (the success pop-up's "Rückgängig"): removes the entry that
   * was added and puts the `restore` lines the write replaced back on the plan. The caller
   * captured both when it performed the write — this hook has no memory of it.
   *
   * Adopts the state the gateway reports back and maps a failure exactly like `planMeal`.
   */
  undoMealPlan: (entry: string, restore: readonly string[]) => Promise<void>;
  /**
   * Takes dishes off the meal plan without deleting them: the named lines are ticked off in
   * Keep ("Vom Plan entfernen"), so they stay visible in Keep as cooked while the app's plan
   * no longer shows them. `entries` are the exact texts of the lines the caller recognized as
   * the recipe (it has the recipe's type and family unit, this hook does not).
   *
   * Adopts the state the gateway reports back, so the card's "Eingeplant" badge disappears
   * without a second read, and maps a failure exactly like `planMeal`.
   */
  checkMealPlan: (entries: readonly string[]) => Promise<void>;
  /**
   * Undoes a `checkMealPlan` (the success pop-up's "Rückgängig"): ticks the named lines back
   * on, so the dish is planned again. The caller captured the texts when it ticked them off —
   * this hook has no memory of it.
   *
   * Adopts the state the gateway reports back and maps a failure exactly like `planMeal`.
   */
  uncheckMealPlan: (entries: readonly string[]) => Promise<void>;
  /**
   * Writes the shopping list: `add` are the ingredient lines the pantry sheet built (already
   * rounded to whole shopping units), `remove` the exact texts an undo takes back off. Both
   * directions use one call — the write sends the lines with an empty `remove`, its undo sends
   * an empty `add` — because the two differ only in which texts they place and delete.
   *
   * Adopts the shopping list the gateway reports back (the meal plan is untouched by this
   * action, so only that half of the state is replaced); a failure is mapped onto the status
   * exactly like `planMeal` and rethrown, so the sheet can show the reason and stay open.
   */
  writeShopping: (add: readonly string[], remove: readonly string[]) => Promise<void>;
  /** Re-runs the current step (probe, silent sign-in and read) — the retry action. */
  retry: () => void;
}

/**
 * Shown when the gateway refused a sign-in that Google *did* issue - a wrong Google account in
 * the browser session, or a client id that no longer matches the bundle. A silent retry cannot
 * fix either, so the tab offers the account chooser again and says why.
 */
const REFUSED_HINT =
  'Der Keep-Zugang wurde abgelehnt. Bitte melde dich mit deinem Cookbook-Google-Konto an.';

/**
 * Runs one gateway call with a *silent* sign-in.
 *
 * A 401 is the expected end of a token's life (about an hour), so it recovers silently: drop
 * the cached token, ask Google for a fresh one and try once more. Only if the second attempt
 * is refused too does the failure reach the caller — that is the case a tap has to fix.
 *
 * Everything else (the gateway being down, a bad answer, a 5xx) is passed straight through.
 */
async function withIdentityToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  let token = getIdentityToken();
  if (token === null) {
    // No silent token means Google wants a gesture — thrown, and the caller treats it as
    // "needs sign-in" rather than as an error.
    token = await requestIdentityToken({ silent: true });
  }
  try {
    return await call(token);
  } catch (error) {
    if (!(error instanceof KeepClientError) || error.code !== 'unauthorized') throw error;
    clearIdentityToken();
    return await call(await requestIdentityToken({ silent: true }));
  }
}

/** Reads both notes using a silent sign-in (see `withIdentityToken`). */
async function readStateSilently(): Promise<KeepState> {
  return withIdentityToken((token) => fetchKeepState(token));
}

/**
 * True when the failure is the gateway turning down a sign-in that Google already accepted.
 *
 * This is the one gateway answer a user can act on, and the one a retry cannot fix: the address
 * is not on the allowlist, or the token was minted for a different OAuth client. Everything
 * else the gateway reports (down, 5xx, bad answer) is an error to show as-is.
 */
function isRefusedSignIn(error: unknown): boolean {
  return error instanceof KeepClientError && error.code === 'unauthorized';
}

/** What App tells the hook about the app's own login (see the file header). */
export interface UseKeepOptions {
  /**
   * True once the Drive login is done — a token exists, so Drive's own sign-in is no longer
   * using the page's one gesture-less OAuth popup (see the file header). While it is false the
   * hook probes the gateway but does not ask Google for an identity token: that request would
   * be the second silent flow of the page load and Google would close it again.
   */
  enabled: boolean;
}

export function useKeep({ enabled }: UseKeepOptions): UseKeepResult {
  const [status, setStatus] = useState<KeepStatus>(() => (isKeepConfigured() ? 'checking' : 'off'));
  const [state, setState] = useState<KeepState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry()` to re-run the effect below. */
  const [attempt, setAttempt] = useState(0);

  // Startup / retry: probe the gateway, then try a silent sign-in and a read. `cancelled`
  // drops the result of a superseded attempt (retry while a request is in flight, or
  // unmount), so a stale answer cannot overwrite a newer status. No setState runs
  // synchronously here: the initial status is `checking`, and `retry()` sets the visible
  // status from its click handler.
  useEffect(() => {
    // Without a configured gateway there is nothing to do — the initial state is already
    // 'off', and the URL is a build-time constant.
    if (!isKeepConfigured()) return;
    let cancelled = false;
    void (async () => {
      const reachable = await checkKeepHealth();
      if (cancelled) return;
      if (!reachable) {
        // A dead gateway is not a sign-in problem: say so, and offer the retry.
        setState(null);
        setStatus('unreachable');
        setError('Das Keep-Gateway ist nicht erreichbar.');
        return;
      }
      if (!enabled) {
        // The Drive login has not happened yet, so Drive's silent sign-in owns the page's one
        // gesture-less popup (see the file header). Report the ordinary first-run state without
        // spending a second flow on a request Google would close again; the effect re-runs with
        // `enabled` true as soon as the Drive token exists.
        setState(null);
        setStatus('needs-signin');
        setError(null);
        return;
      }
      try {
        const loaded = await readStateSilently();
        if (cancelled) return;
        setState(loaded);
        setStatus('ready');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setState(null);
        if (isRefusedSignIn(err)) {
          // Google signed the user in and the gateway refused that sign-in. The *chooser* is
          // the way out (pick the allowed account), so the tab stays on the connect offer -
          // with the reason showing above the button instead of a silent dead end.
          setStatus('needs-signin');
          setError(REFUSED_HINT);
        } else if (err instanceof KeepClientError) {
          setStatus('error');
          setError(keepErrorMessage(err));
        } else {
          // The silent sign-in found no Google session or grant yet: the ordinary first-run
          // state. The tab's own text explains it, so no error line is needed.
          setStatus('needs-signin');
          setError(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, enabled]);

  const connect = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setError(null);
    try {
      // The gesture path: the user tapped, so Google is allowed to show its account chooser
      // or the consent screen. Nothing is asked for here that the silent path could not ask
      // for — the gesture is only what makes the UI possible.
      const token = await requestIdentityToken();
      setState(await fetchKeepState(token));
      setStatus('ready');
    } catch (err) {
      setState(null);
      if (isRefusedSignIn(err)) {
        // Same reasoning as in the effect: the sign-in itself worked, so offer the chooser
        // again rather than a "retry" that would run the silent path and fail identically.
        setStatus('needs-signin');
        setError(REFUSED_HINT);
      } else {
        // A problem worth reading: a closed popup, a blocked popup, a gateway failure.
        setStatus('error');
        setError(keepErrorMessage(err));
      }
      throw err;
    }
  }, []);

  const retry = useCallback((): void => {
    // The visible feedback belongs to the click, not to the effect (a synchronous setState in
    // an effect would start a second render pass). Every retry starts at the probe and then
    // tries the silent sign-in again — a token that was missing before may exist now.
    setStatus('checking');
    setAttempt((current) => current + 1);
  }, []);

  /**
   * Maps a failed `planMeal` / `undoMealPlan` onto the connection status, so both writes
   * report the same failure the same way and the caller only has to show the thrown reason.
   * Stable, so the write callbacks do not change identity with every render.
   */
  const reportWriteFailure = useCallback((err: unknown): void => {
    if (isRefusedSignIn(err)) {
      setStatus('needs-signin');
      setError(REFUSED_HINT);
    } else if (err instanceof KeepClientError) {
      // A problem worth reading: the gateway is down, or it reported a failure.
      setStatus('error');
      setError(keepErrorMessage(err));
    } else {
      // No silent Google session or grant: the ordinary "sign in again" state, exactly
      // like the startup read. The caller shows the thrown reason.
      setStatus('needs-signin');
      setError(null);
    }
  }, []);

  /**
   * Runs one meal-plan write and adopts the list the gateway answers. The two writes (the
   * plan action and its undo) differ only in which lines they add and remove, so they share
   * this body; a failure is mapped onto the status by `reportWriteFailure` and rethrown.
   */
  const runMealPlanWrite = useCallback(
    async (add: readonly string[], remove: readonly string[]): Promise<void> => {
      try {
        const updated = await withIdentityToken((token) => writeMealPlan(token, add, remove));
        // The endpoint answers the changed list; the shopping list is untouched.
        setState((current) => (current === null ? current : { ...current, mealplan: updated }));
        setStatus('ready');
        setError(null);
      } catch (err) {
        reportWriteFailure(err);
        throw err;
      }
    },
    [reportWriteFailure],
  );

  const planMeal = useCallback(
    async (entry: string, replace: readonly string[]): Promise<void> => {
      // No loaded state means Keep was never read, so the caller could not compute which
      // entries the write replaces. Refuse instead of adding a possible duplicate.
      if (state === null) {
        throw new Error('Google Keep ist nicht verbunden — verbinde dich im Tab „Essensplan“.');
      }
      await runMealPlanWrite([entry], replace);
    },
    [state, runMealPlanWrite],
  );

  /**
   * Shortens one export URL through the gateway, or answers null.
   *
   * Every failure is swallowed on purpose (see the interface doc): the write must succeed
   * without a shortener, and a status/error change here would show a Keep failure for what is
   * only a missing refinement. The link itself is optional; the line is not.
   */
  const shortenExportUrl = useCallback(async (target: string): Promise<string | null> => {
    try {
      return await withIdentityToken((token) => shortenUrl(token, target));
    } catch {
      return null;
    }
  }, []);

  const undoMealPlan = useCallback(
    async (entry: string, restore: readonly string[]): Promise<void> => {
      // Same guard as `planMeal`: without the loaded list there is nothing to restore onto.
      if (state === null) {
        throw new Error('Google Keep ist nicht verbunden — verbinde dich im Tab „Essensplan“.');
      }
      await runMealPlanWrite(restore, [entry]);
    },
    [state, runMealPlanWrite],
  );

  /**
   * Runs one check write and adopts the list the gateway answers. Both directions (tick off,
   * tick back on) share this body; a failure is mapped onto the status by
   * `reportWriteFailure` and rethrown.
   */
  const runMealPlanCheck = useCallback(
    async (check: readonly string[], uncheck: readonly string[]): Promise<void> => {
      try {
        const updated = await withIdentityToken((token) =>
          setMealPlanChecked(token, check, uncheck),
        );
        // The endpoint answers the changed list; the shopping list is untouched.
        setState((current) => (current === null ? current : { ...current, mealplan: updated }));
        setStatus('ready');
        setError(null);
      } catch (err) {
        reportWriteFailure(err);
        throw err;
      }
    },
    [reportWriteFailure],
  );

  const checkMealPlan = useCallback(
    async (entries: readonly string[]): Promise<void> => {
      // No loaded state means Keep was never read, so the caller could not compute which
      // entries belong to the recipe. Refuse instead of ticking nothing.
      if (state === null) {
        throw new Error('Google Keep ist nicht verbunden — verbinde dich im Tab „Essensplan“.');
      }
      await runMealPlanCheck(entries, []);
    },
    [state, runMealPlanCheck],
  );

  const uncheckMealPlan = useCallback(
    async (entries: readonly string[]): Promise<void> => {
      // Same guard as `checkMealPlan`: without the loaded list there is nothing to tick back on.
      if (state === null) {
        throw new Error('Google Keep ist nicht verbunden — verbinde dich im Tab „Essensplan“.');
      }
      await runMealPlanCheck([], entries);
    },
    [state, runMealPlanCheck],
  );

  /**
   * Runs one shopping-list write and adopts the list the gateway answers. The write and its
   * undo share this body (they differ only in which texts they add and remove); a failure is
   * mapped onto the status by `reportWriteFailure` and rethrown.
   */
  const runShoppingWrite = useCallback(
    async (add: readonly string[], remove: readonly string[]): Promise<void> => {
      try {
        const updated = await withIdentityToken((token) => writeShoppingList(token, add, remove));
        // The endpoint answers the changed list; the meal plan is untouched, so the
        // "Eingeplant" badges and the resolved cards stay exactly as they are.
        setState((current) => (current === null ? current : { ...current, shopping: updated }));
        setStatus('ready');
        setError(null);
      } catch (err) {
        // A 501 (`not_implemented`) is not a connection problem: the gateway
        // answers, the read works, only this one action does not exist there yet.
        // The sheet reports it next to its button; the "Essensplan" tab must not
        // fall into its error state for it.
        if (!(err instanceof KeepClientError && err.code === 'not_implemented')) {
          reportWriteFailure(err);
        }
        throw err;
      }
    },
    [reportWriteFailure],
  );

  const writeShopping = useCallback(
    async (add: readonly string[], remove: readonly string[]): Promise<void> => {
      // No loaded state means Keep was never read — the write would add lines to a list the app
      // does not know, so refuse instead (same guard as the meal-plan writes).
      if (state === null) {
        throw new Error('Google Keep ist nicht verbunden — verbinde dich im Tab „Essensplan“.');
      }
      await runShoppingWrite(add, remove);
    },
    [state, runShoppingWrite],
  );

  return {
    status,
    state,
    error,
    connect,
    planMeal,
    shortenExportUrl,
    undoMealPlan,
    checkMealPlan,
    uncheckMealPlan,
    writeShopping,
    retry,
  };
}
