/**
 * Renews the Drive access token shortly before Google's reported expiry.
 *
 * Why this exists: Google access tokens live about an hour. Without this, a
 * long editing session ends in a Drive 401 on the next save — recoverable now
 * (the editor stays mounted and offers a re-login), but still an interruption.
 * The token source records `expires_in` (./googleAuth), and this hook schedules
 * one silent renewal a few minutes before that deadline while the user is in a
 * screen that can hold unsaved work (the editor or the AI screen).
 *
 * The renewal is best-effort and invisible except for the brief popup window
 * that GIS uses for every token request (documented in ./googleAuth). A failed
 * attempt is not an error: the token may still work until its deadline, and the
 * ordinary 401 path then shows the in-place login. It is also not retried in a
 * loop — a missing Google session would otherwise flash a popup every minute.
 *
 * The hook only runs while the tab is visible. A background tab must not open
 * an OAuth window (see `whenDocumentVisible` in ./googleAuth); when the tab
 * comes back, the deadline is re-evaluated and the renewal happens then.
 */

import { useEffect } from 'react';

import { getAccessToken, getAccessTokenExpiry, requestAccessToken } from './googleAuth';

/**
 * How long before the reported expiry the renewal starts. Five minutes leaves
 * room for a slow popup and for the save the user is about to make, without
 * renewing so early that the token is still comfortably valid.
 */
const REFRESH_LEAD_MS = 5 * 60 * 1000;

/**
 * Schedules the renewal for the current Drive token.
 *
 * @param token the current in-memory token, or null when logged out
 * @param enabled true while a screen with unsaved work is open (the editor or
 *   the AI screen); the list does not need a proactive renewal
 * @param onRefreshed called with a new token; the caller stores it like a login
 *   (without the login status/reset semantics)
 */
export function useDriveTokenRefresh(
  token: string | null,
  enabled: boolean,
  onRefreshed: (token: string) => void,
): void {
  useEffect(() => {
    if (!enabled || token === null) return;
    const expiresAt = getAccessTokenExpiry();
    // No reported lifetime (unusual) — nothing to schedule. The 401 path still
    // covers an expired token.
    if (expiresAt === null) return;

    let cancelled = false;
    let timer: number | null = null;
    /** True once this effect has made its one renewal attempt. */
    let attempted = false;

    const refresh = async (): Promise<void> => {
      if (cancelled || attempted) return;
      // The background-tab rule: defer to the visibility listener below instead
      // of opening an OAuth window the user did not ask for.
      if (document.visibilityState !== 'visible') return;
      attempted = true;
      try {
        const fresh = await requestAccessToken({ silent: true });
        // A token source may hand back the same value; re-storing it would not
        // re-render and would only restart this effect for nothing.
        //
        // The result is applied even if this effect was torn down while the
        // popup was open (the user closed the editor, say): otherwise the fresh
        // credential would sit unused in the token source while React still
        // holds the old one, and the next 401 would revoke the fresh token.
        // `getAccessToken()` is the arbiter: a newer login or renewal replaces
        // the module token, and then this older result is dropped.
        if (fresh !== token && getAccessToken() === fresh) onRefreshed(fresh);
      } catch {
        // Best effort: the next Drive call's 401 opens the editor's in-place
        // login. No message here — a silent renewal must stay silent.
      }
    };

    const schedule = (): void => {
      const delay = Math.max(0, expiresAt - Date.now() - REFRESH_LEAD_MS);
      timer = window.setTimeout(() => {
        timer = null;
        void refresh();
      }, delay);
    };

    const onVisibilityChange = (): void => {
      if (cancelled || attempted || document.visibilityState !== 'visible') return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      // Back in the foreground: renew at once when the deadline is inside the
      // lead window, otherwise resume the schedule from the new "now".
      if (expiresAt - Date.now() <= REFRESH_LEAD_MS) {
        void refresh();
      } else {
        schedule();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, enabled, onRefreshed]);
}
