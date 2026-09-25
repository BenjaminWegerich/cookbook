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
 *
 * Two optional modes widen the g/ml pool for the ingredient master data's
 * reorder point (the `allowZero` / `allowInfinite` props):
 * - `allowZero` adds a "0" chip and lets the stepper step below the smallest
 *   rung to 0 — the reorder point's "only ever bought for a recipe". 0 is not a
 *   ladder value, so it is special-cased instead of joining the BQ pool;
 * - `allowInfinite` adds an "∞" chip that selects Infinity (infinite stock,
 *   e.g. water); the stepper walks the ladder through it — + at the top rung
 *   enters ∞, − leaves it for the top rung.
 * Neither mode applies to a unitless count (a reorder point always has a
 * family unit).
 */

import { useEffect, useRef } from 'react';

import { AQ_MAX, AQ_MIN, isAQValue, nearestAQValue, scale, scaleAQ } from '@cookbook/core';

import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  quantityLabel,
  suggestedChips,
  type QuantityChip,
  type QuantityFamily,
} from './quantityChips';
import { PlusIcon, RemoveIcon } from './icons';

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
  /**
   * Lowest selectable family-unit value (default `QUANTITY_MIN`). The meal-plan
   * sheet narrows the pool to the yields the recipe's export bakes, so it never
   * offers a size whose cooking view does not exist.
   */
  min?: number;
  /** Highest selectable family-unit value (default `QUANTITY_MAX`). */
  max?: number;
  /**
   * Offer 0 as a selectable value (the reorder point's "only ever bought for a
   * recipe"): a "0" chip plus one stepper step below the smallest rung. Ignored
   * for a unitless count.
   */
  allowZero?: boolean;
  /**
   * Offer infinite stock (the reorder point of a water-like ingredient): an
   * "∞" chip, and a stepper that walks through it — + at the top rung enters
   * ∞, − from ∞ returns to the top rung. Ignored for a unitless count.
   */
  allowInfinite?: boolean;
}

/**
 * The quantity input (see file header). Used for ingredient quantities in the
 * sheet, for the Ergiebigkeit in the editor's Kopfdaten, for the planned size in
 * the meal-plan sheet (which passes `min`/`max` to bound the pool), and for the
 * reorder point in the create-ingredient sheet (which passes `allowZero` and
 * `allowInfinite`).
 */
function QuantityPicker({
  value,
  onChange,
  family,
  min,
  max,
  allowZero,
  allowInfinite,
}: QuantityPickerProps) {
  const suggestions = suggestedChips(family);

  /** The smallest selectable *rung* of this mode (1 for a g/ml quantity). */
  const positiveMin = Math.max(QUANTITY_MIN, min === undefined ? QUANTITY_MIN : min);
  /** The selectable pool of this mode: the editor's full bounds, narrowed by
   *  the caller's `min`/`max` (family unit only — a unitless count keeps the AQ
   *  ladder, whose bounds are not a caller's business). `allowZero` lowers the
   *  floor to 0, which is not a ladder rung and is handled separately. */
  const boundMin = family === null ? AQ_MIN : allowZero ? 0 : positiveMin;
  const boundMax =
    family === null ? AQ_MAX : Math.min(QUANTITY_MAX, max === undefined ? QUANTITY_MAX : max);
  /** The suggested chips that are inside the pool. */
  const visibleSuggestions = suggestions.filter(
    (chip) => chip.quantity >= positiveMin && chip.quantity <= boundMax,
  );
  /** The 0 chip (`allowZero`): 0 is not a ladder value, so it is not part of
   *  `suggestedChips` and is prepended in the chip row instead. */
  const zeroChip: QuantityChip | null =
    allowZero && family !== null ? { quantity: 0, label: quantityLabel(0, family) } : null;
  /** Whether the stepper walks through Infinity (an "∞" chip mode on a family
   *  unit): + at the top rung enters it, − leaves it for the top rung. */
  const infiniteReachable = allowInfinite === true && family !== null;

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
   *  nearest standard number. With `allowZero` the floor is 0 instead of the
   *  smallest rung; with `allowInfinite` the ladder ends in Infinity — + at the
   *  top rung enters it and − leaves it for the top rung. Returns false when the
   *  bound already blocks a further step (a hold repeat then stops instead of
   *  burning cycles). */
  const step = (delta: 1 | -1): boolean => {
    const current = valueRef.current;
    if (current === undefined) return false;
    // Infinity is the top of the ladder when the mode offers it: − steps back
    // to the top rung, + is blocked (nothing lies above infinite stock).
    if (current === Infinity) {
      if (delta > 0 || !infiniteReachable) return false;
      valueRef.current = boundMax;
      onChange(boundMax);
      return true;
    }
    if (!Number.isFinite(current)) return false;
    let next: number;
    if (family === null) {
      const base = isAQValue(current) ? current : nearestAQValue(current);
      next = scaleAQ(base, delta);
    } else if (allowZero && current === 0) {
      // 0 is the floor; the first step up lands on the smallest rung.
      if (delta < 0) return false;
      next = positiveMin;
    } else if (infiniteReachable && delta > 0 && current >= boundMax) {
      // + at the top rung enters infinite stock.
      valueRef.current = Infinity;
      onChange(Infinity);
      return true;
    } else {
      const stepped = scale(current, delta);
      // Stepping below the smallest rung lands on 0 when the mode offers it;
      // otherwise the value is clamped to the pool.
      next =
        allowZero && delta < 0 && stepped < positiveMin
          ? 0
          : Math.min(boundMax, Math.max(positiveMin, stepped));
    }
    if (next === current) return false;
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

  // The stepper bounds: at ∞ the + button is blocked and − returns to the top
  // rung; at the top rung + enters ∞ when the mode offers it; the − direction
  // otherwise stops at the allowZero floor (0).
  const atInfinity = value === Infinity;
  const minReached = value !== undefined && value <= boundMin;
  const maxReached =
    value !== undefined && (atInfinity || (value >= boundMax && !infiniteReachable));

  return (
    <div className="quantity-picker">
      <div className="suggested-chips" role="group" aria-label="Vorgeschlagene Mengen">
        {zeroChip !== null && (
          <button
            type="button"
            className={zeroChip.quantity === value ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(zeroChip.quantity)}
          >
            {zeroChip.label}
          </button>
        )}
        {visibleSuggestions.map((chip) => (
          <button
            key={chip.quantity}
            type="button"
            className={chip.quantity === value ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(chip.quantity)}
          >
            {chip.label}
          </button>
        ))}
        {allowInfinite === true && family !== null && (
          <button
            type="button"
            className={value === Infinity ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(Infinity)}
            aria-label="Unbegrenzt vorrätig"
          >
            ∞
          </button>
        )}
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
          <RemoveIcon className="step-icon" />
        </button>
        <span className="quantity-value">
          {value === undefined ? '—' : value === Infinity ? '∞' : quantityLabel(value, family)}
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
          <PlusIcon className="step-icon" />
        </button>
      </div>
    </div>
  );
}

export default QuantityPicker;
