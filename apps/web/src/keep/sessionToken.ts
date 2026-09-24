/**
 * Session-only storage for the Keep gateway token (N6).
 *
 * Mirrors the AI API key handling (../ai/sessionKey): the token is pasted by
 * the user per session and held in memory only — never localStorage, never
 * the repository, never the published bundle (a static site cannot keep a
 * secret). A page reload therefore removes it and the app asks again.
 *
 * The token is deliberately not part of a client instance's state: callers
 * read it here at call time and pass it into the gateway calls (../keep/
 * keepClient), so no long-lived object carries the secret around.
 */

/** Gateway token of the current session, or null when none was entered. */
let gatewayToken: string | null = null;

/** Returns the session gateway token, or null when none was entered. */
export function getKeepGatewayToken(): string | null {
  return gatewayToken;
}

/** Stores the pasted token for this session (trimmed); never persists it. */
export function setKeepGatewayToken(token: string): void {
  const trimmed = token.trim();
  gatewayToken = trimmed === '' ? null : trimmed;
}

/** Clears the session token — used when the gateway rejects it. */
export function clearKeepGatewayToken(): void {
  gatewayToken = null;
}
