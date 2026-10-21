/**
 * Storage for the user's AI API key.
 *
 * Two levels, chosen by the user at the key field:
 *
 * - **Session** (default, N6): held in memory only. A page reload forgets it.
 * - **This device** (opt-in): written to localStorage, so a cold start no longer
 *   asks for the key. The Android share target opens the app fresh every time,
 *   which is why the second level exists: without it every share would land on
 *   the key field again.
 *
 * Security: the key is a *billing* credential, not a data credential. Stored in
 * localStorage it is readable by any script on this origin (an XSS or a
 * compromised dependency), by someone using the unlocked device, and by an
 * Android backup. The app loads no third-party scripts, the choice is explicit
 * and off by default, and the key should be restricted to the Gemini API with a
 * quota in Google AI Studio. {@link forgetAiApiKey} removes it again.
 *
 * The key is deliberately not part of an {@link AiClient} instance's public
 * state: callers read it here at call time and pass it into
 * {@link createAiClient} / the provider adapter. Note that the created client
 * keeps the key in its closure for as long as that client object lives — so
 * clients should be created per use (as the Phase 3 flows do) rather than kept
 * in long-lived state.
 */

/** localStorage key of the remembered key. */
const STORAGE_KEY = 'cookbook.aiApiKey';

/** API key of the current session, or null when none was entered (yet). */
let apiKey: string | null = null;

/** Reads the key remembered on this device, or null. Storage can be blocked
 *  (private mode, hardened browser), which is never an error here. */
function readStoredKey(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null || stored.trim() === '' ? null : stored;
  } catch {
    return null;
  }
}

/** Removes the remembered key; blocked storage is not an error. */
function removeStoredKey(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

/** Options of {@link setAiApiKey}. */
export interface AiApiKeyOptions {
  /** Write the key to this device's storage (explicit user choice). */
  remember?: boolean;
}

/** Returns the API key in use: the session key, else the one remembered on this
 *  device, else null. A remembered key becomes the session key on first read. */
export function getAiApiKey(): string | null {
  if (apiKey === null) {
    apiKey = readStoredKey();
  }
  return apiKey;
}

/** True when an API key is available (session or remembered). */
export function hasAiApiKey(): boolean {
  return getAiApiKey() !== null;
}

/** True when a key is remembered on this device (opt-in, see the key field). */
export function isAiApiKeyRemembered(): boolean {
  return readStoredKey() !== null;
}

/**
 * Stores the pasted key for this session and, when asked, on this device.
 * Passing `remember: false` also removes a previously remembered key, so the
 * checkbox is the single switch for both directions.
 */
export function setAiApiKey(key: string, options: AiApiKeyOptions = {}): void {
  const trimmed = key.trim();
  apiKey = trimmed === '' ? null : trimmed;
  if (trimmed !== '' && options.remember === true) {
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Storage blocked: the key still works for this session.
    }
  } else {
    removeStoredKey();
  }
}

/** Forgets the key entirely: session and device. Used by {@link forgetAiApiKey}
 *  and on logout. */
export function clearAiApiKey(): void {
  apiKey = null;
  removeStoredKey();
}

/**
 * Removes only the copy remembered on this device. The running session keeps
 * its key (the created clients hold it in their closure), so this never breaks
 * a conversation — it only makes the next start ask again.
 */
export function forgetStoredAiApiKey(): void {
  removeStoredKey();
}

/** Alias with the user-facing intent of {@link clearAiApiKey}. */
export function forgetAiApiKey(): void {
  clearAiApiKey();
}
