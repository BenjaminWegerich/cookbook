/**
 * Session-only storage for the user's AI API key (N6).
 *
 * The key is pasted by the user per session and held in memory only — it is
 * never written to localStorage or any other persistent store, so a page
 * reload (and the explicit {@link clearAiApiKey} on logout) removes it.
 * Mirrors the Google access token handling in ./auth/googleAuth.
 *
 * The key is deliberately not part of an {@link AiClient} instance's public
 * state: callers read it here at call time and pass it into
 * {@link createAiClient} / the provider adapter. Note that the created client
 * keeps the key in its closure for as long as that client object lives — so
 * clients should be created per use (as the Phase 3 flows do) rather than kept
 * in long-lived state.
 */

/** API key of the current session, or null when not entered yet. */
let apiKey: string | null = null;

/** Returns the session API key, or null when none was entered. */
export function getAiApiKey(): string | null {
  return apiKey;
}

/** True when a session API key is present. */
export function hasAiApiKey(): boolean {
  return apiKey !== null;
}

/** Stores the pasted key for this session (trimmed); never persists it. */
export function setAiApiKey(key: string): void {
  apiKey = key.trim() === '' ? null : key.trim();
}

/** Clears the session key — called on logout and never persisted anyway. */
export function clearAiApiKey(): void {
  apiKey = null;
}
