/**
 * StockStepper — the compact −/value/+ stepper of the pantry sheet's "Vorrat"
 * column (components/PantrySelect).
 *
 * It is the table-sized sibling of the editor's QuantityPicker: the same
 * "one ladder rung per tap" rule and the same press-and-hold repeat, but
 * without the suggested-chips row (a table cell has no room for it) and with the
 * bounds of a *stock* rather than of a recipe quantity:
 *
 * - the value never goes below 0 (`allowZero` in the picker) and — because the
 *   stock is at most what the dishes need — never above the need, so the
 *   "Einkaufen" amount beside it can never become negative;
 * - a value that is not on the ladder (the sheet starts on
 *   `min(need, reorder point)`, and a need summed over several dishes is not
 *   necessarily a rung) is not rejected: core's `steppedStock` answers the
 *   neighbouring rungs of an arbitrary value, so the first tap lands on the
 *   ladder.
 *
 * The step arithmetic lives in core (`@cookbook/core`, `steppedStock`), where it
 * is tested; this component only owns the buttons, the label and the hold
 * cadence. UI language is German.
 */

import { useEffect, useRef } from 'react';

import { QUANTITY_MIN } from './quantityChips';
import { formatBQ, steppedStock } from '@cookbook/core';
import { PlusIcon, RemoveIcon } from './icons';

/**
 * Press-and-hold cadence, identical to the editor's QuantityPicker: the first
 * auto-repeat fires after this delay, later repeats follow at this interval, so
 * a hold feels like deliberate repeated tapping.
 */
const HOLD_FIRST_REPEAT_MS = 450;
const HOLD_REPEAT_INTERVAL_MS = 100;

interface StockStepperProps {
  /** The row's current stock (the Vorrat), 0 … `needed`. */
  value: number;
  /** The row's need: the upper bound, and what "nothing to buy" means. */
  needed: number;
  /** Family base unit of both values (g / ml), for the label. */
  baseUnit: 'g' | 'ml';
  /** Reports the next value of one tap (never called with a blocked direction). */
  onChange: (next: number) => void;
  /** Accessible name of the control, e.g. "Vorrat für Mehl". */
  label: string;
}

/**
 * The stepper (see the file header). Both buttons disable themselves at their
 * bound — the − at 0, the + once the stock covers the need — which is the
 * promise that "Einkaufen" can never become negative.
 */
function StockStepper({ value, needed, baseUnit, onChange, label }: StockStepperProps) {
  /** Mirror of the latest value, so a press-and-hold repeat steps from what the
   *  previous repeat produced instead of from a stale render's closure. */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  /** Pending timers of an active press-and-hold (one at a time). */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stops an active press-and-hold. A quick tap never arms the timers — the
   *  release click then performs the single step. */
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

  // Clear on unmount so a torn-down stepper can never keep stepping.
  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      if (repeatTimer.current !== null) clearInterval(repeatTimer.current);
    };
  }, []);

  /** One tap in the given direction. Returns false when the bound blocks it
   *  (a hold repeat then stops instead of burning cycles). */
  const step = (direction: 1 | -1): boolean => {
    const next = steppedStock(valueRef.current, needed, direction, QUANTITY_MIN);
    if (next === null) return false;
    valueRef.current = next; // optimistic: the repeat cadence is render-independent
    onChange(next);
    return true;
  };

  /** Press-and-hold: first auto-repeat after HOLD_FIRST_REPEAT_MS, then one
   *  rung per HOLD_REPEAT_INTERVAL_MS — the effect of tapping repeatedly. */
  const beginHold = (direction: 1 | -1): void => {
    if (holdTimer.current !== null) return; // already holding (the other button)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (!step(direction)) return; // clamped at a bound → nothing to repeat
      repeatTimer.current = setInterval(() => {
        if (!step(direction) && repeatTimer.current !== null) {
          clearInterval(repeatTimer.current);
          repeatTimer.current = null;
        }
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_FIRST_REPEAT_MS);
  };

  const canDecrease = steppedStock(value, needed, -1, QUANTITY_MIN) !== null;
  const canIncrease = steppedStock(value, needed, 1, QUANTITY_MIN) !== null;

  return (
    <div className="stock-stepper" role="group" aria-label={label}>
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
        disabled={!canDecrease}
        aria-label="Vorrat um eine Stufe verringern"
      >
        <RemoveIcon className="step-icon" />
      </button>
      <span className="stock-stepper-value">{formatBQ(value, baseUnit)}</span>
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
        disabled={!canIncrease}
        aria-label="Vorrat um eine Stufe erhöhen"
      >
        <PlusIcon className="step-icon" />
      </button>
    </div>
  );
}

export default StockStepper;
