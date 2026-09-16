/**
 * Shared exit guard for screens with unsaved work (RecipeEditor, AiCreateSheet).
 *
 * Why this exists (decided with the user): the app has five ways to leave a
 * screen — the header's „Zurück" button, a backdrop tap, Escape, the browser /
 * device Back button, and the swipe-back gesture (which arrives as a browser
 * Back). Before this hook each trigger carried its own copy of the dirty check
 * and its own armed-confirmation state, which allowed the "Änderungen
 * verwerfen?" step to stay armed while the user did something else in between
 * (e.g. closed an ingredient sheet) — the next trigger then discarded the
 * changes without asking. The guard owns that state once, for every trigger.
 *
 * Two rules are encoded here:
 * 1. An armed confirmation belongs to the exact work state it was armed for
 *    (`workSignature`). The moment that signature changes — typing, a new
 *    message, a cleared draft — the arm is gone and the button reads „Zurück"
 *    again. This is deliberately *not* an effect: the label must be honest in
 *    the same render that shows the changed work.
 * 2. A modal's own fields are transient. Dismissing a modal (backdrop tap,
 *    Escape, its cancel button) means "keep working", so the screen below must
 *    clear its armed confirmation via `reset()` when it opens or closes a
 *    modal instead of letting the arm outlive the state it referred to.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which trigger asked to leave. All of them must run through
 * `LeaveGuard.request`; the distinction is documentation of the call site (and
 * a hook for future per-trigger rules, e.g. a body lock that only applies to
 * the browser Back path).
 */
export type LeaveReason = 'button' | 'backdrop' | 'escape' | 'browser-back';

export interface LeaveGuard {
  /** True while the two-step exit confirmation is armed for the current work. */
  armed: boolean;
  /**
   * Asks to leave the screen. First call arms the confirmation and returns true
   * (the caller stays and only swaps the label); the confirmed second call runs
   * `onLeave` and returns false. Without unsaved work it runs `onLeave`
   * immediately.
   */
  request: (reason: LeaveReason, onLeave: () => void) => boolean;
  /** Disarms the confirmation (a modal was opened or dismissed). */
  reset: () => void;
}

export interface LeaveGuardOptions {
  /**
   * Fingerprint of the work the user would lose. Any change invalidates an
   * armed confirmation (rule 1 above).
   */
  workSignature: string;
  /** True when leaving right now would discard unsaved work. */
  needsConfirm: boolean;
}

/**
 * Creates the exit guard of one screen. The screen itself keeps the trigger
 * wiring (button, backdrop, Escape, browser Back) so the layers inside it stay
 * in charge of their order.
 */
export function useLeaveGuard({ workSignature, needsConfirm }: LeaveGuardOptions): LeaveGuard {
  /** The work signature the confirmation was armed for; null when disarmed. */
  const [armedSignature, setArmedSignature] = useState<string | null>(null);

  // Rule 1: an arm outlives its work state never — compare during render, so a
  // single tap on a *changed* state cannot discard the new content.
  const armed = armedSignature !== null && armedSignature === workSignature;

  const reset = useCallback((): void => {
    setArmedSignature(null);
  }, []);

  const request = useCallback(
    (reason: LeaveReason, onLeave: () => void): boolean => {
      // `reason` is part of the contract of every exit trigger; today all of
      // them share the same two-step behaviour (see LeaveReason).
      void reason;
      if (!needsConfirm || armed) {
        setArmedSignature(null);
        onLeave();
        return false;
      }
      setArmedSignature(workSignature);
      return true;
    },
    [armed, needsConfirm, workSignature],
  );

  return { armed, request, reset };
}

/**
 * Binds a screen-level Escape trigger. Escape is the keyboard equivalent of the
 * browser Back button: it closes the topmost visible layer and never leaves the
 * app. The listener is registered on `window` only while the screen is the
 * visible one (`enabled`), so a hidden-but-mounted screen (the AI sheet under
 * the editor) never reacts as well.
 *
 * The callback is read through a ref, so an inline arrow at the call site does
 * not re-register the listener on every render while the latest state is still
 * seen when the key is pressed. The small "latest" effect below (instead of
 * `ref.current = onEscape` during render, or a listener per parent render) keeps
 * the key handler stable without mutating a ref while rendering.
 */
export function useEscapeTrigger(onEscape: () => void, enabled = true): void {
  const handlerRef = useRef(onEscape);

  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
