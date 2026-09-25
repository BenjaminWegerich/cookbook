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
 * How long an *open* token popup may stay unresolved before its attempt is
 * aborted. A safety net only: normally GIS reports a blocked or closed popup
 * through `error_callback` (and a user gesture supersedes a silent attempt, see
 * `request`), so this timer just bounds the undocumented case in which a
 * silently blocked popup never fires any callback. The timer starts with the
 * popup, not with the request — a queued attempt must not run down its patience
 * while it waits for the shared popup window (see `takePopupTurn`).
 */
const TOKEN_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Shorter bound for the *silent* page-load attempt. It shows no UI, so it can
 * only end in a token, in a reported OAuth error or in nothing at all — the
 * latter must not keep the login panel in its "connecting" state for a minute.
 * A pending silent attempt is superseded by a tap on the login button anyway.
 */
const SILENT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * GIS serves every token request through **one** popup window per page and reuses it, so two
 * flows do not coexist: starting a second one while the first is still open navigates that same
 * window away, and a second one started in the same tick as the first one's token arrives is
 * closed again immediately. Measured with the development diagnostics on a cold start, where the
 * app asked for both credentials at once: the popup that went second always died with
 * `popup_closed`, on either credential. The user-visible failure was the reported "the popup
 * opens and closes instantly, then I have to tap 'Mit Google verbinden'" — the Drive sign-in,
 * which gates the whole app, was the one that lost the race.
 *
 * Two rules follow, and both are implemented here and in the callers: only one flow at a time
 * (`popupTurn`), with a minimum distance between two of them (`POPUP_FLOW_SPACING_MS`), and the
 * page's first silent flow is spent on the credential the app cannot work without — App passes
 * the Drive login state to the Keep hook for that (see `UseKeepOptions.enabled`).
 *
 * `popupTurn` is the flow that currently owns the window. A silent request waits for it and
 * re-checks after every wake-up, so a gesture that took the window in the meantime is respected
 * instead of being overwritten. A gesture never waits: a tap takes the window immediately (it
 * supersedes a pending silent attempt, see `request`), and that claim is also what tells the
 * queued silent requests to give way.
 */
let popupTurn: Promise<void> | null = null;

/** When the next *silent* flow may open its popup (see `POPUP_FLOW_SPACING_MS`). */
let popupFreeAt = 0;

/**
 * Minimum gap between two popup flows.
 *
 * A popup opened in the same tick as the previous flow's token was closed again with
 * `popup_closed` (see the lock above); opening it after the previous popup had time to disappear
 * worked. That gap used to come from the Keep hook's gateway probe, which is incidental timing
 * rather than a guarantee, so it is made explicit here. The value is a safety margin, not a tuned
 * measurement: the first flow of a page load never waits, and a tap never waits.
 */
const POPUP_FLOW_SPACING_MS = 1000;

/** One flow's claim on the popup window. */
interface PopupTurn {
  /** True while this claim still owns the window (a gesture may have taken it over). */
  owned: () => boolean;
  /** Hands the window on to the next waiting flow. */
  release: () => void;
}

/** Takes the popup window for a flow that has to start now. */
function claimPopupTurn(): PopupTurn {
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  popupTurn = turn;
  return {
    owned: () => popupTurn === turn,
    release: () => {
      // A later claim (a gesture that took over) may own the window by now.
      if (popupTurn === turn) popupTurn = null;
      popupFreeAt = Date.now() + POPUP_FLOW_SPACING_MS;
      releaseTurn();
    },
  };
}

/** Waits out the spacing between two flows. */
function waitForPopupSpacing(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Waits until no flow owns the popup window, then takes it — and holds it back for the spacing
 * above, so a silent flow never opens its popup right behind another one.
 */
async function takePopupTurn(): Promise<() => void> {
  for (;;) {
    while (popupTurn !== null) {
      await popupTurn;
    }
    const turn = claimPopupTurn();
    const remaining = popupFreeAt - Date.now();
    if (remaining <= 0) {
      return turn.release;
    }
    await waitForPopupSpacing(remaining);
    // A gesture may have taken the window while it was held back; queue again instead of
    // opening a second popup on top of the account chooser.
    if (turn.owned()) {
      return turn.release;
    }
    turn.release();
  }
}

/**
 * Resolves as soon as the tab is in the foreground, immediately when it already is.
 *
 * A silent attempt must not open a popup window from a background tab: the user is looking at
 * another tab or window and only sees an unexplained OAuth window flashing up (reported for a
 * Cookbook tab that sits in the background while the user works elsewhere). Deferring the
 * attempt until the tab is visible costs nothing — the sign-in has no deadline of its own.
 */
function whenDocumentVisible(): Promise<void> {
  if (document.visibilityState === 'visible') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
}

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
    /** Hands the shared popup window on when this attempt settles (see `takePopupTurn`). */
    let releaseTurn: (() => void) | null = null;

    const inFlight = new Promise<string>((resolve, reject) => {
      const own: TokenAttempt = { resolve, reject, timeout: 0 };
      ownAttempt = own;
      attempt = own;
      pendingByGesture = byGesture;

      /**
       * Opens the popup and starts the abort timer. Deliberately as late as possible: a silent
       * attempt first waits for its turn at the shared popup window and for the tab to be in the
       * foreground, so it neither raises a window on a hidden tab nor burns its timeout while
       * queued behind another sign-in.
       */
      const open = (): void => {
        // A queued silent attempt may have been superseded while it waited.
        if (attempt !== own) return;
        own.timeout = window.setTimeout(
          () => {
            // A silent attempt that reaches this timer produced no callback at all, which is its
            // own diagnosis: the request was blocked before GIS could answer.
            if (silent) reportSilentFailure(label, 'no answer before the timeout');
            reject(
              new Error('Die Google-Anmeldung hat zu lange gedauert. Bitte versuche es erneut.'),
            );
          },
          silent ? SILENT_REQUEST_TIMEOUT_MS : TOKEN_REQUEST_TIMEOUT_MS,
        );
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
        // once and reused for both attempts. "none" forbids Google's own screens
        // (account chooser, consent) but not the popup window itself — GIS runs every
        // token request through one, so a silent sign-in still shows a brief window.
        // That flash is inherent to the token flow and cannot be hidden from here;
        // "select_account" keeps the tap on the login button showing the account
        // chooser as before.
        tokenClient.requestAccessToken({ prompt: silent ? 'none' : 'select_account' });
      };

      if (byGesture) {
        // A tap must never look dead: it takes the popup window straight away.
        releaseTurn = claimPopupTurn().release;
        open();
        return;
      }
      void (async () => {
        const release = await takePopupTurn();
        // The attempt may have been superseded while it was queued; hand the window straight
        // back instead of holding it for a dead flow that will never open a popup.
        if (attempt !== own) {
          release();
          return;
        }
        releaseTurn = release;
        await whenDocumentVisible();
        open();
      })().catch(reject);
    });

    // Clearing the module state on settle is guarded by an identity check: a
    // superseded attempt must not wipe the state of a newer one. (ownAttempt
    // stays null only if the executor threw, in which case nothing was set.)
    pendingRequest = inFlight.finally(() => {
      // Hand the popup window on first, so a queued silent attempt can start.
      releaseTurn?.();
      releaseTurn = null;
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
