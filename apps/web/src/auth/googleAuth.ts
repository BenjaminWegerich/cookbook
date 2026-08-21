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

/** Promise of the in-flight token request, so repeated calls share one popup. */
let pendingRequest: Promise<string> | null = null;

/** Settlers of the in-flight request, used by the GIS callbacks. */
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((error: Error) => void) | null = null;

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
 */
export function requestAccessToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID ist nicht gesetzt — siehe apps/web/.env.example.');
  }
  if (!isGoogleAuthAvailable()) {
    throw new Error('Google Identity Services konnte nicht geladen werden.');
  }

  // Narrowed copy: after the guard above this is definitely a string.
  const clientId: string = GOOGLE_CLIENT_ID;

  // Reuse an in-flight request so double-clicks do not open two popups.
  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = new Promise<string>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;

    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: handleTokenResponse,
        error_callback: (error) => {
          pendingReject?.(new Error(error.message));
        },
      });
    }
    tokenClient.requestAccessToken();
  }).finally(() => {
    pendingRequest = null;
    pendingResolve = null;
    pendingReject = null;
  });

  return pendingRequest;
}

/**
 * Handles the GIS token-response callback, settling the pending request.
 * Called by GIS itself — do not call directly.
 */
function handleTokenResponse(response: google.accounts.oauth2.TokenResponse): void {
  if (response.error || !response.access_token) {
    const message = response.error_description ?? response.error ?? 'Unbekannter OAuth-Fehler';
    pendingReject?.(new Error(message));
    return;
  }
  // Narrowed by the guard above: definitely present here.
  const grantedToken: string = response.access_token;
  accessToken = grantedToken;
  pendingResolve?.(grantedToken);
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
