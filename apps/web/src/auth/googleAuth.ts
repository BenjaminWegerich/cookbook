/**
 * Google OAuth 2.0 (token flow) via Google Identity Services (GIS).
 *
 * The app uses the *token* model (`google.accounts.oauth2`) because it needs
 * an access token for the Google Drive API — the ID-token / One Tap flow
 * (`google.accounts.id`) only authenticates the user without Drive access.
 *
 * Docs: https://developers.google.com/identity/oauth2/web/guides/use-token-model
 *
 * The access token is held in memory only (never persisted to localStorage),
 * so a page reload requires a fresh login. This avoids storing credentials
 * in a place where a future XSS could read them.
 */

import { GOOGLE_CLIENT_ID } from '../config';

/** OAuth scope: access to files the app itself creates or opens in Drive. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Access token of the current session (memory only, null when logged out). */
let accessToken: string | null = null;

/** Lazily created token client; survives across login attempts. */
let tokenClient: google.accounts.oauth2.TokenClient | null = null;

/**
 * The *current* token attempt: the setters the GIS callbacks (and the
 * timeout) address, plus the abort timer. Replaced when a new attempt
 * supersedes the previous one, so late GIS callbacks always reach the latest
 * attempt — never a stale one that was already abandoned.
 */
type TokenAttempt = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  /** Abort timer of this attempt; cleared when it settles or is superseded. */
  timeout: number;
};
let attempt: TokenAttempt | null = null;

/** Promise of the in-flight request, so repeated calls share one popup. */
let pendingRequest: Promise<string> | null = null;

/** Whether the in-flight request was started by a user gesture (button) or
 *  automatically at page load (which browsers may popup-block). */
let pendingByGesture = false;

/**
 * How long a token attempt may stay unresolved before it is aborted. A
 * safety net only: normally GIS reports a blocked or closed popup through
 * `error_callback` (and a user gesture supersedes an automatic attempt, see
 * `requestAccessToken`), so this timer just bounds the undocumented case in
 * which a silently blocked popup never fires any callback.
 */
const TOKEN_REQUEST_TIMEOUT_MS = 60_000;

/** True when the GIS script (index.html) has loaded and the API is usable. */
export function isGoogleAuthAvailable(): boolean {
  return (
    typeof google !== 'undefined' && typeof google.accounts?.oauth2?.initTokenClient === 'function'
  );
}

/** Current access token without triggering any UI, or null when logged out. */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Obtains an access token for Google Drive.
 *
 * Shows the Google account chooser / consent popup the first time (or when
 * no valid cached token exists); afterwards GIS returns a cached token
 * without UI. Resolves with the access token.
 *
 * By default the request counts as *user-gesture driven* (login button) and
 * reuses an in-flight request so double-clicks do not open two popups. Pass
 * `{ automatic: true }` for the best-effort page-load attempt: browsers only
 * allow the popup after a gesture, so such an attempt may be blocked. A later
 * real gesture then *supersedes* the still-pending automatic attempt — it is
 * aborted and a fresh gesture-driven request reopens the popup — instead of
 * being swallowed by the dedupe.
 */
export function requestAccessToken(options?: { automatic?: boolean }): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID ist nicht gesetzt — siehe apps/web/.env.example.');
  }
  if (!isGoogleAuthAvailable()) {
    throw new Error('Google Identity Services konnte nicht geladen werden.');
  }

  // Narrowed copy: after the guard above this is definitely a string.
  const clientId: string = GOOGLE_CLIENT_ID;

  const byGesture = options?.automatic !== true;

  // Reuse the in-flight request for double-clicks and for any automatic call
  // while a request is running. Only a genuine gesture may supersede a still
  // pending *automatic* attempt — its popup is likely blocked, so the gesture
  // must start a fresh request instead of waiting on a dead one.
  if (pendingRequest !== null) {
    if (pendingByGesture || !byGesture) {
      return pendingRequest;
    }
    const superseded = attempt;
    if (superseded !== null) {
      window.clearTimeout(superseded.timeout);
      superseded.reject(new DOMException('Aborted', 'AbortError'));
    }
    // Detach the superseded attempt so its .finally cannot clear the state of
    // the fresh request created below.
    attempt = null;
    pendingRequest = null;
  }

  let ownAttempt: TokenAttempt | null = null;
  const request = new Promise<string>((resolve, reject) => {
    // Abort attempts that never settle (see TOKEN_REQUEST_TIMEOUT_MS).
    const timeout = window.setTimeout(() => {
      reject(new Error('Die Google-Anmeldung hat zu lange gedauert. Bitte versuche es erneut.'));
    }, TOKEN_REQUEST_TIMEOUT_MS);
    ownAttempt = { resolve, reject, timeout };
    attempt = ownAttempt;
    pendingByGesture = byGesture;

    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: handleTokenResponse,
        error_callback: handleTokenError,
      });
    }
    tokenClient.requestAccessToken();
  });

  // Clearing the module state on settle is guarded by an identity check: a
  // superseded attempt must not wipe the state of a newer one. (ownAttempt
  // stays null only if the executor threw, in which case nothing was set.)
  pendingRequest = request.finally(() => {
    if (attempt !== null && attempt === ownAttempt) {
      window.clearTimeout(attempt.timeout);
      attempt = null;
      pendingRequest = null;
      pendingByGesture = false;
    }
  });

  return pendingRequest;
}

/**
 * Handles the GIS error callback: non-OAuth failures such as a popup that
 * could not open (typically blocked by the browser, e.g. for the automatic
 * login attempt on page load) or was closed before a response arrived. Maps
 * the documented GIS error types to German UI messages; unknown types fall
 * back to the original message. Called by GIS — do not call directly.
 */
function handleTokenError(error: { type: string; message: string }): void {
  const message =
    error.type === 'popup_failed_to_open'
      ? 'Das Google-Anmeldefenster konnte nicht geöffnet werden — vermutlich blockiert dein Browser ' +
        'Pop-ups. Klicke erneut auf „Mit Google verbinden“.'
      : error.type === 'popup_closed'
        ? 'Das Anmeldefenster wurde geschlossen, bevor die Anmeldung abgeschlossen war.'
        : error.message;
  attempt?.reject(new Error(message));
}

/**
 * Handles the GIS token-response callback, settling the pending request.
 * Called by GIS itself — do not call directly.
 */
function handleTokenResponse(response: google.accounts.oauth2.TokenResponse): void {
  if (response.error || !response.access_token) {
    const message = response.error_description ?? response.error ?? 'Unbekannter OAuth-Fehler';
    attempt?.reject(new Error(message));
    return;
  }
  // Narrowed by the guard above: definitely present here.
  const grantedToken: string = response.access_token;
  accessToken = grantedToken;
  attempt?.resolve(grantedToken);
}

/**
 * Revokes the current token and clears the session state.
 * Resolves once Google confirms the revocation.
 */
export function revokeAccessToken(): Promise<void> {
  const token = accessToken;
  accessToken = null;
  if (!token || !isGoogleAuthAvailable()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    google.accounts.oauth2.revoke(token, () => resolve());
  });
}
