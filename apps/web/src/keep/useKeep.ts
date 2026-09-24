/**
 * Keep connection state for the app (N5: the core must work without Keep).
 *
 * Owns the whole lifecycle of the optional integration in one hook:
 *
 * - `off` — the build has no gateway URL, so every Keep feature is hidden/off;
 * - `checking` — the configured gateway is being probed (`GET /health`);
 * - `needs-token` — the gateway answers but no session token is stored yet;
 * - `loading` — a `/keep/state` request is running;
 * - `ready` — both notes were read, `state` holds them;
 * - `unreachable` — the probe failed (network, CORS, service down);
 * - `error` — a request failed for another reason (dead credential, 5xx).
 *
 * The token itself lives in ./sessionToken (memory only, N6); this hook never
 * persists it. A rejected token is dropped and the status falls back to
 * `needs-token`, which is what asks the user again — the app never retries a
 * known-dead token in a loop.
 *
 * The hook deliberately does not depend on the Drive session: Keep and Google
 * Drive are separate credentials. App decides *when* to surface the token
 * prompt (after the Google login), not this module.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  KeepClientError,
  checkKeepHealth,
  fetchKeepState,
  isKeepConfigured,
  keepErrorMessage,
  type KeepState,
} from './keepClient';
import { clearKeepGatewayToken, getKeepGatewayToken, setKeepGatewayToken } from './sessionToken';

/** Where the Keep connection currently stands (see the file header). */
export type KeepStatus =
  'off' | 'checking' | 'needs-token' | 'loading' | 'ready' | 'unreachable' | 'error';

export interface UseKeepResult {
  status: KeepStatus;
  /** The notes once loaded, otherwise null. */
  state: KeepState | null;
  /** German failure text for the current status, or null. */
  error: string | null;
  /**
   * Stores the pasted token and reads both notes. Resolves on success; on
   * failure it sets the status/error and rethrows, so the token sheet can
   * show the reason inline.
   */
  connect: (gatewayToken: string) => Promise<void>;
  /** Re-runs the current step (probe or state read) — the retry action. */
  retry: () => void;
}

export function useKeep(): UseKeepResult {
  const [status, setStatus] = useState<KeepStatus>(() => (isKeepConfigured() ? 'checking' : 'off'));
  const [state, setState] = useState<KeepState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry()` to re-run the effect below. */
  const [attempt, setAttempt] = useState(0);

  // Startup / retry: with a stored session token read the notes, without one
  // probe the gateway so the token prompt only appears for a reachable
  // service. `cancelled` drops the result of a superseded attempt (retry while
  // a request is in flight, or unmount), so a stale answer cannot overwrite a
  // newer status. No setState runs synchronously here: the initial status is
  // `checking`, and `retry()` sets the visible status from its click handler.
  useEffect(() => {
    // Without a configured gateway there is nothing to do — the initial state
    // is already 'off', and the URL is a build-time constant.
    if (!isKeepConfigured()) return;
    let cancelled = false;
    const gatewayToken = getKeepGatewayToken();
    if (gatewayToken === null) {
      void checkKeepHealth().then((reachable) => {
        if (cancelled) return;
        setStatus(reachable ? 'needs-token' : 'unreachable');
        setError(reachable ? null : 'Das Keep-Gateway ist nicht erreichbar.');
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchKeepState(gatewayToken).then(
      (loaded) => {
        if (cancelled) return;
        setState(loaded);
        setStatus('ready');
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        const unauthorized = err instanceof KeepClientError && err.code === 'unauthorized';
        if (unauthorized) clearKeepGatewayToken();
        setState(null);
        setStatus(unauthorized ? 'needs-token' : 'error');
        setError(keepErrorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const connect = useCallback(async (gatewayToken: string): Promise<void> => {
    const trimmed = gatewayToken.trim();
    if (trimmed === '') {
      const empty = new KeepClientError('unauthorized', 'Bitte den Keep-Zugangscode einfügen.');
      setStatus('needs-token');
      setError(empty.message);
      throw empty;
    }
    setKeepGatewayToken(trimmed);
    setStatus('loading');
    setError(null);
    try {
      setState(await fetchKeepState(trimmed));
      setStatus('ready');
    } catch (err) {
      // A rejected token is dropped for good (asking again is the only way
      // forward); any other failure keeps it, so "Erneut versuchen" does not
      // force a re-paste.
      const unauthorized = err instanceof KeepClientError && err.code === 'unauthorized';
      if (unauthorized) clearKeepGatewayToken();
      setState(null);
      setStatus(unauthorized ? 'needs-token' : 'error');
      setError(keepErrorMessage(err));
      throw err;
    }
  }, []);

  const retry = useCallback((): void => {
    // The visible feedback belongs to the click, not to the effect (a
    // synchronous setState in an effect would start a second render pass):
    // with a stored token a read is retried, without one the gateway is probed.
    setStatus(getKeepGatewayToken() === null ? 'checking' : 'loading');
    setAttempt((current) => current + 1);
  }, []);

  return { status, state, error, connect, retry };
}
