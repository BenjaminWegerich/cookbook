/**
 * Shared exit guard for screens with unsaved work (RecipeEditor, AiCreateSheet).
 *
 * Why this exists (decided with the user): the app has several ways to leave a
 * screen — the header's „Zurück" button, Escape, the browser / device Back
 * button, and the swipe-back gesture (which arrives as a browser Back). Before
 * this hook each trigger carried its own copy of the dirty check and its own
 * armed-confirmation state, which allowed the discard question to stay armed
 * while the user did something else in between (e.g. closed an ingredient
 * sheet) — the next trigger then discarded the changes without asking. The guard
 * owns that state once, for every trigger.
 *
 * Two rules are encoded here:
 * 1. An armed confirmation belongs to the exact work state it was armed for
 *    (`workSignature`). The moment that signature changes — typing, a new
 *    message, a cleared draft — the arm is gone and the armed question
 *    (LeaveConfirmBar) disappears again. This is deliberately *not* an effect:
 *    the arm must be honest in the same render that shows the changed work.
 * 2. A modal's own fields are transient. Dismissing a modal (backdrop tap,
 *    Escape, its cancel button) means "keep working", so the screen below must
 *    clear its armed confirmation via `reset()` when it opens or closes a
 *    modal instead of letting the arm outlive the state it referred to.
 *
 * The armed question itself is rendered by `LeaveConfirmBar`, inside the
 * screen's sticky header. Keeping it out of the „Zurück" button is what makes it
 * visible on every trigger: the button only ever guaranteed that the *button*
 * was on screen, while the question it had turned into could be scrolled away.
 *
 * The hook also guards the one exit that is *not* a navigation inside the app:
 * a reload (F5), closing the tab or window, or a real navigation away. Those
 * unload the document — no history entry and no popstate are involved — so the
 * app's own guard cannot reach them. The browser's own `beforeunload` dialog is
 * the only tool for them; it is also the only confirmation the app does not
 * style, because the browser owns its wording.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which trigger asked to leave. All of them must run through
 * `LeaveGuard.request`; the distinction documents the call site, so a future
 * per-trigger rule has one place to read it from.
 */
export type LeaveReason = 'button' | 'backdrop' | 'escape' | 'browser-back';

export interface LeaveGuard {
  /** True while the two-step exit confirmation is armed for the current work. */
  armed: boolean;
  /**
   * Asks to leave the screen. The first call arms the confirmation and returns
   * true (the caller stays; LeaveConfirmBar now offers „Abbrechen" / „Verwerfen");
   * the confirmed second call runs `onLeave` and returns false. Without unsaved
   * work it runs `onLeave` immediately.
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

  /**
   * True once the user confirmed leaving through the app's own question. The
   * `beforeunload` listener below reads it, because that confirmation and the
   * browser's dialog would otherwise answer the same decision twice: our
   * "Verwerfen" would be followed by the browser asking again.
   */
  const leavingRef = useRef(false);

  const request = useCallback(
    (reason: LeaveReason, onLeave: () => void): boolean => {
      // `reason` documents the call site; every trigger shares this two-step
      // behaviour (the armed question is answered by LeaveConfirmBar).
      void reason;
      if (!needsConfirm || armed) {
        setArmedSignature(null);
        // Leaving for real (no work to lose, or the question just confirmed):
        // disarm the reload dialog below, even if this unmount's effect cleanup
        // has not run yet when the browser fires it.
        leavingRef.current = true;
        onLeave();
        return false;
      }
      setArmedSignature(workSignature);
      return true;
    },
    [armed, needsConfirm, workSignature],
  );

  // Reload / close / navigation away while work would be lost. Registered only
  // while that is true, as recommended (a standing listener would also keep the
  // page out of Firefox's bfcache), and removed again with the work or the
  // screen, so the browser's dialog never outlives the unsaved state it warns
  // about. The dialog itself is generic browser text; only its wording is out of
  // the app's hands, not its timing.
  useEffect(() => {
    if (!needsConfirm) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // The app's own answer already happened — let the unload pass.
      if (leavingRef.current) return;
      // Chrome and Firefox show the dialog for preventDefault; `returnValue` is
      // the legacy spelling kept for older Safari, which asks without it.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [needsConfirm]);

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
