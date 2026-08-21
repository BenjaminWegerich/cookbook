/**
 * Ambient type declarations for the Google Identity Services (GIS) OAuth 2.0
 * token model (`google.accounts.oauth2`).
 *
 * The published `@types/gsi` only covers `google.accounts.id` (ID-token /
 * One Tap flow). These declarations mirror the official GIS JavaScript
 * reference for the token flow the app uses:
 * https://developers.google.com/identity/oauth2/web/reference/js-reference
 *
 * `RevocationResponse` is already declared globally by `@types/gsi` and is
 * reused here.
 */
declare namespace google.accounts.oauth2 {
  /** Configuration for the OAuth 2.0 token client. */
  interface TokenClientConfig {
    /** The web app's OAuth client ID (…apps.googleusercontent.com). */
    client_id: string;
    /** Space-separated OAuth scopes, e.g. the Google Drive scope. */
    scope: string;
    /** Called with the token response (or error) when the flow completes. */
    callback: (response: TokenResponse) => void;
    /** Called when the flow fails before a token response exists. */
    error_callback?: (error: { type: string; message: string }) => void;
    /** Forces the consent screen on every request when set to "consent". */
    prompt?: string;
    enable_serial_consent?: boolean;
    /** Email address or unique ID of the Google Account to preselect. */
    hint?: string;
    /** Adds previously granted scopes to new requests. */
    include_granted_scopes?: boolean;
  }

  /** Payload passed to the token client's callback. */
  interface TokenResponse {
    /** The OAuth 2.0 access token, present on success. */
    access_token?: string;
    token_type?: string;
    /** Lifetime of the access token in seconds. */
    expires_in?: number;
    /** The granted scopes, space-separated. */
    scope?: string;
    authuser?: string;
    prompt?: string;
    /** OAuth error code, present on failure. */
    error?: string;
    error_description?: string;
  }

  /** Per-request overrides for an existing token client. */
  interface OverridableTokenClientConfig {
    prompt?: string;
    hint?: string;
    include_granted_scopes?: boolean;
  }

  /** The token client returned by `initTokenClient`. */
  interface TokenClient {
    /**
     * Starts the account-chooser / consent popup (or returns a cached token
     * without UI when one is still valid and granted).
     */
    requestAccessToken(overrideConfig?: OverridableTokenClientConfig): void;
  }

  /** Creates a token client for the OAuth 2.0 token flow. */
  function initTokenClient(config: TokenClientConfig): TokenClient;

  /** Revokes the given access token; the callback fires on completion. */
  function revoke(hint: string, callback?: (done: RevocationResponse) => void): void;

  /** Checks whether a token response includes at least one of the scopes. */
  function hasGrantedAnyScope(tokenResponse: TokenResponse, ...scopes: string[]): boolean;
}
