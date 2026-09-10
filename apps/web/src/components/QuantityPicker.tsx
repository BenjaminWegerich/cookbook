/**
 * QuantityPicker — the editor's quantity input (decided with the user after
 * the brainstorm: option A).
 *
 * Three complementary elements:
 * - a horizontally scrollable **suggested** chip row (one tap for common
 *   values; the app may later highlight further suggestions, e.g. a whole
 *   Becher — the row is explicitly a "suggestions" surface);
 * - a **− / + stepper** that moves exactly one standard-number step per tap —
 *   for a g/ml quantity one BQ rung (pool 1 … 10000 in the family unit), for a
 *   unitless count one AQ step (the fraction ladder, 0.1 … 1000). Both are
 *   always standard-number-valid by construction. Pressing and holding a
 *   stepper button repeats the step at a steady pace, as if it were tapped
 *   repeatedly;
 *
 * Values are stored in the family unit (g/ml); labels switch to kg/l at 1000
 * (core formatBQ). A unitless count is labelled with the AQ fraction
 * typography (core formatAQValue). UI language is German.
 */

import { useEffect, useRef } from 'react';

import { AQ_MAX, AQ_MIN, isAQValue, nearestAQValue, scale, scaleAQ } from '@cookbook/core';

import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  quantityLabel,
  suggestedChips,
  type QuantityFamily,
} from './quantityChips';

/** Press-and-hold cadence for the stepper buttons: the first auto-repeat fires
 *  after this delay, later repeats follow at this interval. The values mimic a
 *  deliberate repeated tapping (start slower, then a steady pace). */
const HOLD_FIRST_REPEAT_MS = 450;
const HOLD_REPEAT_INTERVAL_MS = 100;

interface QuantityPickerProps {
  /** The stored quantity (family unit); undefined = nothing chosen yet. */
  value?: number;
  onChange: (quantity: number) => void;
  /** The ingredient's family unit (g/ml) — null = unitless quantity (`{{100}}`). */
  family: QuantityFamily | null;
}

/**
 * The quantity input (see file header). Used for ingredient quantities in the
 * sheet and for the Ergiebigkeit in the editor's Kopfdaten.
 */
function QuantityPicker({ value, onChange, family }: QuantityPickerProps) {
  const suggestions = suggestedChips(family);

  /** Mirror of the latest `value` prop. Updated optimistically on every step
   *  so the press-and-hold repeat keeps climbing the ladder even before the
   *  parent re-renders (each interval tick must start from the value the
   *  previous tick produced, not from a stale closure). */
  const valueRef = useRef<number | undefined>(value);

  // Keep the mirror in sync after every commit (step() also updates it
  // optimistically between commits so a hold never reads a stale value).
  useEffect(() => {
    valueRef.current = value;
  });

  /** Pending timers of an active press-and-hold (one at a time). */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stops an active press-and-hold. A quick tap never arms the timers — the
   *  release click below then performs the single step. */
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

  // Clear on unmount so a torn-down picker can never keep stepping.
  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      if (repeatTimer.current !== null) clearInterval(repeatTimer.current);
    };
  }, []);

  /** One ladder step up/down from the current value, clamped to the mode's
   *  bounds. A g/ml quantity walks the BQ ladder (pool 1 … 10000); a unitless
   *  count walks the AQ ladder (0.1 … 1000, the standard numbers with
   *  fractions). A current value that does not belong to the mode's ladder (a
   *  transient state while the unit mode changes) is first snapped to the
   *  nearest standard number. Returns false when the bound already blocks a
   *  further step (a hold repeat then stops instead of burning cycles). */
  const step = (delta: 1 | -1): boolean => {
    const current = valueRef.current;
    if (current === undefined) return false;
    let next: number;
    if (family === null) {
      const base = isAQValue(current) ? current : nearestAQValue(current);
      next = scaleAQ(base, delta);
      if (next === current) return false;
    } else {
      next = Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, scale(current, delta)));
      if (next === current) return false;
    }
    valueRef.current = next; // optimistic: repeat cadence is render-independent
    onChange(next);
    return true;
  };

  /** Press-and-hold: first auto-repeat after HOLD_FIRST_REPEAT_MS, then one
   *  rung per HOLD_REPEAT_INTERVAL_MS — the effect of tapping repeatedly. */
  const beginHold = (delta: 1 | -1): void => {
    if (holdTimer.current !== null) return; // already holding (the other button)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (!step(delta)) return; // clamped at a bound → nothing to repeat
      repeatTimer.current = setInterval(() => {
        if (!step(delta) && repeatTimer.current !== null) {
          clearInterval(repeatTimer.current);
          repeatTimer.current = null;
        }
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_FIRST_REPEAT_MS);
  };

  const boundMin = family === null ? AQ_MIN : QUANTITY_MIN;
  const boundMax = family === null ? AQ_MAX : QUANTITY_MAX;
  const minReached = value !== undefined && value <= boundMin;
  const maxReached = value !== undefined && value >= boundMax;

  return (
    <div className="quantity-picker">
      <div className="suggested-chips" role="group" aria-label="Vorgeschlagene Mengen">
        {suggestions.map((chip) => (
          <button
            key={chip.quantity}
            type="button"
            className={chip.quantity === value ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(chip.quantity)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="quantity-row">
        <button
          type="button"
          className="step-button"
          onClick={() => step(-1)}
          onPointerDown={(event) => {
            if (event.button === 0) beginHold(-1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          disabled={minReached || value === undefined}
          aria-label="Menge um eine Stufe verringern"
        >
          <span className="step-glyph">−</span>
        </button>
        <span className="quantity-value">
          {value === undefined ? '—' : quantityLabel(value, family)}
        </span>
        <button
          type="button"
          className="step-button"
          onClick={() => step(1)}
          onPointerDown={(event) => {
            if (event.button === 0) beginHold(1);
          }}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          disabled={maxReached || value === undefined}
          aria-label="Menge um eine Stufe erhöhen"
        >
          <span className="step-glyph">+</span>
        </button>
      </div>
    </div>
  );
}

export default QuantityPicker;
