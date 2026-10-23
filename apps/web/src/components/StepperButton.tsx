/**
 * One round − / + button of a quantity stepper.
 *
 * A tap steps exactly once. Pressing and holding repeats the step at a steady
 * cadence — the same effect as tapping the button quickly — until the value
 * reaches the end of its list or the finger is released. The first repeat comes
 * after a short delay so a normal tap never starts a repeat; after that the
 * interval is constant (no acceleration).
 *
 * A tap and a keyboard activation (Enter / Space) both arrive as a click, so
 * the click performs the single step; the pointerdown only arms the hold. After
 * a hold has repeated at least once, the closing click is swallowed so the
 * release does not add one more step.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useRef } from 'react';

import { PlusIcon, RemoveIcon } from './icons';

/** Press-and-hold cadence: the first repeat after this delay, then this interval. */
const HOLD_FIRST_REPEAT_MS = 450;
const HOLD_REPEAT_INTERVAL_MS = 100;

interface StepperButtonProps {
  /** +1 steps up the list, −1 steps down. */
  direction: 1 | -1;
  /** Disables the button (the end of the list, or no value yet). */
  disabled: boolean;
  /** German accessible name, e.g. "Menge erhöhen". */
  ariaLabel: string;
  /** Performs one step; returns false when the list end already blocks it. */
  onStep: (direction: 1 | -1) => boolean;
}

function StepperButton({ direction, disabled, ariaLabel, onStep }: StepperButtonProps) {
  /** Pending first-repeat timer of an active press-and-hold (one at a time). */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Running repeat interval of an active press-and-hold. */
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * True once the hold has produced at least one repeat. The click that the
   * browser emits when the finger finally lifts must then be ignored — the
   * repeats have already moved the value.
   */
  const repeated = useRef(false);

  /** Stops an active press-and-hold. A quick tap never arms the timers. */
  const stopHold = (): void => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (repeatTimer.current !== null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };

  // A torn-down stepper must never keep stepping.
  useEffect(() => stopHold, []);

  /** Arms the first repeat; a step at the list end simply does not arm it. */
  const beginHold = (): void => {
    repeated.current = false;
    if (holdTimer.current !== null) return; // already holding the other button
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (!onStep(direction)) return; // list end → nothing to repeat
      repeated.current = true;
      repeatTimer.current = setInterval(() => {
        if (!onStep(direction)) stopHold();
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_FIRST_REPEAT_MS);
  };

  return (
    <button
      type="button"
      className="step-button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (event.button === 0) beginHold();
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onClick={() => {
        // A hold's closing click is swallowed; a tap or keyboard activation
        // performs its one step here (the pointerdown only armed the hold).
        if (repeated.current) {
          repeated.current = false;
          return;
        }
        onStep(direction);
      }}
    >
      {direction > 0 ? <PlusIcon className="step-icon" /> : <RemoveIcon className="step-icon" />}
    </button>
  );
}

export default StepperButton;
