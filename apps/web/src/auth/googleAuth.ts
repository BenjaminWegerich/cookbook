/**
 * Google OAuth 2.0 (token flow) via Google Identity Services (GIS).
 *
 * The app needs Google access for two unrelated jobs, and they are kept apart on purpose:
 *
 * - **Drive** (`.../auth/drive.file`) — the recipe collection. The browser calls the Drive
 *   API with it directly.
 * - **Identity** (`openid email`) — proof of *who* the user is, presented to the Keep
 *   gateway. It grants no access to any data, which is what makes it safe to hand to our own
 *   backend — and the reason the gateway never gets the Drive token.
 *
 * Both use the same GIS *token* model. (The ID-token / One Tap flow is deliberately not used:
 * `google.accounts.id` authenticates without granting Drive access, and that API is in flux.)
 * So the silent/gesture/timeout/supersede machinery lives once, in `createTokenSource`, and
 * each scope gets its own instance: two credentials with two independent lifecycles.
 *
 * Docs: https://developers.google.com/identity/oauth2/web/guides/use-token-model
 *
 * Tokens are held in memory only (never persisted to localStorage), so a page reload requires
 * a fresh login. This avoids storing credentials in a place where a future XSS could read
 * them. What *does* survive a reload is the grant Google remembers per user and client ID
 * (Users → third-party access, plus the browser's Google session cookie): the silent request
 * below turns that into a fresh access token without any UI, which is what keeps the login
 * panel out of the way on a cold start.
 */

import { GOOGLE_CLIENT_ID } from '../config';

/** OAuth scope: access to files the app itself creates or opens in Drive. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * OAuth scope for the Keep gateway: the account's address, and nothing else.
 *
 * Deliberately the narrowest pair that still identifies the user — the gateway compares the
 * address against its allowlist and needs to know nothing else about them. It is also why
 * this token, unlike the Drive one, may leave the browser: it opens no file.
 *
 * It gets its own token client (see `identityTokens`) rather than sharing the Drive one, so
 * the request asks for identity scopes alone. That matters beyond tidiness: Google tracks a
 * user's consent per OAuth client, not per request, and reports previously granted scopes
 * along with a new one — so a request that asked for both could hand back a Drive-capable
 * token. The gateway refuses any token carrying more than the identity scopes
 * (`PERMITTED_IDENTITY_SCOPES` in apps/keep-gateway/keep_gateway/identity.py), which turns a
 * mistake here into a refused call instead of a leaked file credential.
 */
const IDENTITY_SCOPE = 'openid email';

/** What every token request accepts; `silent` forbids any UI (see `request`). */
export interface TokenRequestOptions {
  /** True for the page-load attempt: GIS is told `prompt: 'none'`, so nothing is shown. */
  silent?: boolean;
}

/**
 * One credential of one scope: how to obtain it, how to read the current one, how to drop it.
 *
 * Two instances exist (see `driveTokens` / `identityTokens`); nothing outside this module
 * needs the type, but naming it keeps the factory's contract explicit.
 */
interface TokenSource {
  request(options?: TokenRequestOptions): Promise<string>;
  /** The current token without triggering any UI, or null when there is none. */
  peek(): string | null;
  /** Drops the in-memory token — never touches the grant Google remembers. */
  clear(): void;
}

/**
 * How long a token attempt may stay unresolved before it is aborted. A
 * safety net only: normally GIS reports a blocked or closed popup through
 * `error_callback` (and a user gesture supersedes a silent attempt, see
 * `request`), so this timer just bounds the undocumented case in
 * which a silently blocked popup never fires any callback.
 */
const TOKEN_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Shorter bound for the *silent* page-load attempt. It shows no UI, so it can
 * only end in a token, in a reported OAuth error or in nothing at all — the
 * latter must not keep the login panel in its "connecting" state for a minute.
 * A pending silent attempt is superseded by a tap on the login button anyway.
 */
const SILENT_REQUEST_TIMEOUT_MS = 10_000;

/** True when the GIS script (index.html) has loaded and the API is usable. */
export function isGoogleAuthAvailable(): boolean {
  return (
    typeof google !== 'undefined' && typeof google.accounts?.oauth2?.initTokenClient === 'function'
  );
}

/**
 * Reports a *silent* attempt that Google declined.
 *
 * The silent path is invisible on purpose — no UI, no message — so a missing Google session, a
 * blocked third-party context and a multi-account session Google refuses to choose from all
 * look exactly the same: the login panel simply comes back. The GIS error code is the one fact
 * that tells them apart, and this is where it becomes visible.
 *
 * Development builds only: Vite substitutes `false` for the guard in a production bundle, so
 * the published app stays quiet.
 */
function reportSilentFailure(label: string, reason: string, detail?: unknown): void {
  if (!import.meta.env.DEV) return;
  const suffix = detail === undefined || detail === '' ? '' : ` (${String(detail)})`;
  console.warn(`[cookbook] silent Google sign-in for ${label} failed: ${reason}${suffix}`);
}

/**
 * Builds one independent token source for a scope.
 *
 * Every piece of mutable state an attempt needs lives in this closure, so the two scopes
 * cannot interfere: a silent Keep sign-in never supersedes a Drive login, and a Drive 401
 * never disturbs the Keep token. The behaviour is exactly what the Drive path had before the
 * Keep sign-in existed (silent attempt at page load, gesture supersedes it, dedupe of
 * double-clicks, bounded by the two timeouts above).
 *
 * @param scope the OAuth scope this source asks for
 * @param label how the source names itself in the development diagnostics above
 */
function createTokenSource(scope: string, label: string): TokenSource {
  /** Current token of this scope (memory only, null when never granted). */
  let token: string | null = null;

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
   *  automatically at page load (silent, no UI allowed). */
  let pendingByGesture = false;

  /**
   * Handles the GIS error callback: non-OAuth failures such as a popup that
   * could not open (typically blocked by the browser) or was closed before a
   * response arrived. Maps the documented GIS error types to German UI
   * messages; unknown types fall back to the original message. Called by GIS —
   * do not call directly.
   */
  function handleTokenError(error: { type?: string; message?: string }): void {
    if (!pendingByGesture) {
      reportSilentFailure(label, error.type ?? 'unknown', error.message);
    }
    const message =
      error.type === 'popup_failed_to_open'
        ? 'Das Google-Anmeldefenster konnte nicht geöffnet werden — vermutlich blockiert dein Browser ' +
          'Pop-ups. Klicke erneut auf „Mit Google verbinden“.'
        : error.type === 'popup_closed'
          ? 'Das Anmeldefenster wurde geschlossen, bevor die Anmeldung abgeschlossen war.'
          : (error.message ?? 'Unbekannter OAuth-Fehler');
    attempt?.reject(new Error(message));
  }

  /**
   * Handles the GIS token-response callback, settling the pending request. An
   * error response is the *normal* outcome of a silent request (no Google
   * session or no grant yet, `interaction_required`), so it is reported as a
   * plain rejection and the caller decides whether it is worth showing — the
   * silent caller in App stays quiet about it. Called by GIS itself — do not
   * call directly.
   */
  function handleTokenResponse(response: google.accounts.oauth2.TokenResponse): void {
    if (response.error || !response.access_token) {
      if (!pendingByGesture) {
        reportSilentFailure(label, response.error ?? 'no access_token', response.error_description);
      }
      const message = response.error_description ?? response.error ?? 'Unbekannter OAuth-Fehler';
      attempt?.reject(new Error(message));
      return;
    }
    // Narrowed by the guard above: definitely present here.
    const grantedToken: string = response.access_token;
    token = grantedToken;
    attempt?.resolve(grantedToken);
  }

  /**
   * Obtains a token for this scope.
   *
   * Shows the Google account chooser / consent popup the first time (or when
   * no valid cached token exists); afterwards GIS returns a cached token
   * without UI. Resolves with the access token.
   *
   * By default the request counts as *user-gesture driven* (login button) and
   * reuses an in-flight request so double-clicks do not open two popups.
   *
   * `{ silent: true }` is the page-load attempt: it sends `prompt: 'none'`, so
   * Google is not allowed to show any screen. It succeeds only when the user is
   * still signed in to Google *and* has already granted the scope; then no popup
   * — and no user gesture — is needed at all, which is exactly what a cold start
   * requires. Otherwise the request fails with an OAuth error (typically
   * `interaction_required`) and no popup was shown; callers treat that as "not
   * connected" rather than as an error (see the Keep hook in ../keep/useKeep).
   *
   * A later real gesture *supersedes* the still-pending silent attempt — it is
   * aborted and a fresh gesture-driven request opens the chooser — instead of
   * being swallowed by the dedupe.
   */
  function request(options?: TokenRequestOptions): Promise<string> {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('VITE_GOOGLE_CLIENT_ID ist nicht gesetzt — siehe apps/web/.env.example.');
    }
    if (!isGoogleAuthAvailable()) {
      throw new Error('Google Identity Services konnte nicht geladen werden.');
    }

    // Narrowed copy: after the guard above this is definitely a string.
    const clientId: string = GOOGLE_CLIENT_ID;

    const byGesture = options?.silent !== true;
    const silent = !byGesture;

    // Reuse the in-flight request for double-clicks and for any silent call
    // while a request is running. Only a genuine gesture may supersede a still
    // pending *silent* attempt — its request shows no UI, so the tap must start
    // a fresh request instead of waiting on it.
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
    const inFlight = new Promise<string>((resolve, reject) => {
      // Abort attempts that never settle (see the timeout constants above).
      const timeout = window.setTimeout(
        () => {
          // A silent attempt that reaches this timer produced no callback at all, which is its
          // own diagnosis: the request was blocked before GIS could answer.
          if (silent) reportSilentFailure(label, 'no answer before the timeout');
          reject(new Error('Die Google-Anmeldung hat zu lange gedauert. Bitte versuche es erneut.'));
        },
        silent ? SILENT_REQUEST_TIMEOUT_MS : TOKEN_REQUEST_TIMEOUT_MS,
      );
      ownAttempt = { resolve, reject, timeout };
      attempt = ownAttempt;
      pendingByGesture = byGesture;

      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          callback: handleTokenResponse,
          error_callback: handleTokenError,
          // Not left at its default, and this is load-bearing. Google's incremental
          // authorization (default `true`) returns a token covering *every* scope the user has
          // granted this OAuth client — so a request for `openid email` alone would also hand
          // back the Drive grant, and the Keep gateway would end up holding a credential over
          // the recipe files. With `false`, each source's token covers exactly the scope it
          // asked for. Verified against the API reference:
          // https://developers.google.com/identity/oauth2/web/reference/js-reference
          include_granted_scopes: false,
        });
      }
      // The prompt is set per request, never on the client: the client is created
      // once and reused for both attempts. "none" keeps the silent attempt free
      // of any screen; "select_account" keeps the tap on the login button showing
      // the account chooser as before.
      tokenClient.requestAccessToken({ prompt: silent ? 'none' : 'select_account' });
    });

    // Clearing the module state on settle is guarded by an identity check: a
    // superseded attempt must not wipe the state of a newer one. (ownAttempt
    // stays null only if the executor threw, in which case nothing was set.)
    pendingRequest = inFlight.finally(() => {
      if (attempt !== null && attempt === ownAttempt) {
        window.clearTimeout(attempt.timeout);
        attempt = null;
        pendingRequest = null;
        pendingByGesture = false;
      }
    });

    return pendingRequest;
  }

  return {
    request,
    peek: (): string | null => token,
    clear: (): void => {
      token = null;
    },
  };
}

/** The Drive credential (recipe files). Read by the Drive client. */
const driveTokens = createTokenSource(DRIVE_SCOPE, 'Drive');

/** The identity credential (who the user is). Read by the Keep client. */
const identityTokens = createTokenSource(IDENTITY_SCOPE, 'Keep (identity)');

/** Current Drive access token without triggering any UI, or null when logged out. */
export function getAccessToken(): string | null {
  return driveTokens.peek();
}

/** Obtains a Drive access token — the login button and the silent cold start. */
export function requestAccessToken(options?: TokenRequestOptions): Promise<string> {
  return driveTokens.request(options);
}

/**
 * Current identity access token without triggering any UI, or null when none was obtained
 * yet. The Keep hook reads it only to decide whether a silent attempt is worth making.
 */
export function getIdentityToken(): string | null {
  return identityTokens.peek();
}

/**
 * Obtains the identity token that proves *who* the user is to the Keep gateway.
 *
 * Same semantics as `requestAccessToken`, on its own scope and its own attempt: a Keep
 * sign-in never disturbs the Drive credential, and vice versa.
 */
export function requestIdentityToken(options?: TokenRequestOptions): Promise<string> {
  return identityTokens.request(options);
}

/**
 * Drops the cached identity token, so the next request asks Google again — which is what the
 * Keep hook does after a 401, letting an expired token recover without user interaction.
 *
 * The grant Google remembers is deliberately left alone: revoking it can affect the Drive
 * consent too, and Keep's recovery has nothing to do with Drive.
 */
export function clearIdentityToken(): void {
  identityTokens.clear();
}

/**
 * Revokes the current Drive token and clears the session state.
 * Resolves once Google confirms the revocation.
 */
export function revokeAccessToken(): Promise<void> {
  const token = getAccessToken();
  driveTokens.clear();
  if (!token || !isGoogleAuthAvailable()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    google.accounts.oauth2.revoke(token, () => resolve());
  });
}
