/**
 * The snackbar host — queue, countdown and action state for the app's transient
 * notices (rendered by components/Snackbar.tsx, specified in docs/ui_patterns.md).
 *
 * One hook owns everything a notice needs, so no screen re-implements the
 * timing or the undo plumbing:
 *
 * - **One at a time, in order.** `show` appends; the message at the head of the
 *   queue is the visible one. A second `show` while one is up therefore waits
 *   its turn instead of overwriting the first (which could still be holding an
 *   undo).
 * - **Auto-dismiss after `SNACKBAR_DURATION_MS`.** A new message, a pause or a
 *   running action restarts the countdown; the message that is gone clears it.
 * - **Pause on interaction.** The component reports pointer/focus over the card
 *   as a pause, so a user reaching for the action does not have it vanish under
 *   the finger. The pause is keyed to the message id, so the next queued message
 *   starts unpaused even if the previous one was dismissed while hovered.
 * - **The action is a promise.** `runAction` marks the host busy (the component
 *   shows the busy label and blocks the countdown) and clears the notice when it
 *   settles. A failure is *not* swallowed into silence: the action's own `run`
 *   is the place that reports it — by enqueuing an error notice, which then
 *   becomes the head of the queue once this one closes.
 *
 * The hook is deliberately free of layout and copy: `message.text` is a ready
 * German sentence and the tones are the two the UI knows (docs/ui_patterns.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** How long a notice stays on screen before it hides itself (docs/ui_patterns.md). */
export const SNACKBAR_DURATION_MS = 6000;

/** The two notice meanings the app has: a finished action and a failed one. */
export type SnackbarTone = 'success' | 'error';

/** The optional action of a notice (the "Rückgängig" button). */
export interface SnackbarAction {
  /** The visible button label, German prose ("Rückgängig"). */
  label: string;
  /** Label while the action runs; falls back to `label` (shared busy convention). */
  busyLabel?: string;
  /** The action's leading symbol, taken from components/icons.tsx. */
  icon?: ReactNode;
  /**
   * Runs the action. May be async; the host stays busy until it settles. A
   * rejection is reported by this function itself (usually by enqueuing an error
   * notice) — the host only closes the notice.
   */
  run: () => void | Promise<void>;
}

/** One notice as a caller describes it. */
export interface SnackbarMessage {
  /** Defaults to `success`. */
  tone?: SnackbarTone;
  /** The complete German sentence to display. */
  text: string;
  /** An optional action ("Rückgängig"). */
  action?: SnackbarAction;
}

/** A queued notice with its stable identity (React key and pause bookkeeping). */
export interface ActiveSnackbar extends SnackbarMessage {
  id: number;
}

export interface UseSnackbarResult {
  /** The notice on screen, or null while the queue is empty. */
  message: ActiveSnackbar | null;
  /** True while the visible notice's action is running. */
  busy: boolean;
  /** Queues a notice; it shows at once when nothing is on screen. */
  show: (message: SnackbarMessage) => void;
  /** Runs the visible notice's action and closes it when the action settles. */
  runAction: () => void;
  /** Closes the visible notice; the next queued one takes its place. */
  dismiss: () => void;
  /** Pauses/resumes the countdown of one notice (pointer, hover, focus). */
  setPaused: (id: number, paused: boolean) => void;
}

export function useSnackbar(): UseSnackbarResult {
  const [queue, setQueue] = useState<ActiveSnackbar[]>([]);
  /** The id whose notice is paused, or null; a fresh id is never paused. */
  const [pausedId, setPausedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** Source of the stable ids; a ref, because it drives no rendering. */
  const nextIdRef = useRef(1);
  /**
   * Synchronous mirror of `busy`. A second click can arrive before React has
   * re-rendered the disabled button, and a ref is what actually stops it from
   * running the same action (e.g. the undo) twice.
   */
  const busyRef = useRef(false);

  const message = queue[0] ?? null;
  const paused = message !== null && pausedId === message.id;

  const show = useCallback((next: SnackbarMessage): void => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setQueue((current) => [...current, { ...next, id }]);
  }, []);

  const dismiss = useCallback((): void => {
    busyRef.current = false;
    setQueue((current) => current.slice(1));
    setBusy(false);
  }, []);

  const setPaused = useCallback((id: number, next: boolean): void => {
    // A leave report from a notice that already made way must not clear the
    // pause of the one now on screen, hence the id check instead of a plain set.
    setPausedId((current) => (next ? id : current === id ? null : current));
  }, []);

  // The countdown belongs to the notice on screen: a different head, a pause or
  // a running action tears the old timer down and (unless suppressed) starts a
  // fresh full one. State is only written from the timeout, never synchronously.
  useEffect(() => {
    if (message === null || paused || busy) return;
    const timer = window.setTimeout(() => {
      setQueue((current) => current.slice(1));
    }, SNACKBAR_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, paused, busy]);

  const runAction = useCallback((): void => {
    const action = queue[0]?.action;
    if (action === undefined || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // `Promise.resolve().then` also absorbs a synchronous throw in `run`, so a
    // broken action can never leave the host stuck in the busy state.
    void Promise.resolve()
      .then(() => action.run())
      .catch(() => {
        // Deliberately silent: `run` owns its failure reporting (it can show an
        // error notice), and this notice has served its purpose either way.
      })
      .finally(() => {
        dismiss();
      });
  }, [queue, dismiss]);

  return { message, busy, show, runAction, dismiss, setPaused };
}
