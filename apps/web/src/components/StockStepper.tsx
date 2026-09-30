/**
 * StockStepper — the pantry sheet's −/value/+ picker for a row whose stock is
 * stepped in coarse units (components/PantrySelect; which rows those are is
 * core's `stockPool`): **one pack per tap** when the ingredient is bought in
 * exact packs and the need exceeds the chip limit, **one ladder rung per tap**
 * otherwise (no shopping unit, or an approximate one).
 *
 * It is the sibling of the editor's QuantityPicker: the same press-and-hold
 * repeat, but with the bounds of a *stock* rather than of a recipe quantity, and
 * with three additions that answer this sheet's problem — tapping a "+" twenty
 * times for one value:
 *
 * - the pool is precomputed by core (`stockPool`), so a tap jumps to the next
 *   value that changes what is bought, not to the next arbitrary rung;
 * - **the value box is tappable**: it opens an input with the phone's number
 *   keypad ("enter numbers", `inputMode="decimal"`), and a typed number is
 *   always read in the family base unit g / ml (decided with the user) — the box
 *   says which unit while it is open;
 * - **the "≥ <need>" chip** next to it sets the stock to the pool's last value —
 *   the amount from which the row buys nothing — so the chip *names the amount*
 *   that empties the shopping list (decided with the user) instead of describing
 *   it in words. It is the one tap that answers the most common case, carries the
 *   check symbol, and keeps the selected look while the row is covered, so it
 *   doubles as the row's "nothing to buy" marker.
 *
 * The stock is not a stored quantity, so a value that is not a pool member is
 * legal: the row starts on `min(need, reorder point)` (neither a rung nor a
 * whole pack) and a typed number can be anything. A tap then steps to the
 * neighbouring pool values (core's `steppedPool`), so the first tap lands on the
 * pool and no value can be stepped past.
 *
 * The step arithmetic lives in core (`@cookbook/core`, `stockPool`/`steppedPool`),
 * where it is tested; this component only owns the buttons, the typed input, the
 * label and the hold cadence. UI language is German.
 */

import { useEffect, useRef, useState } from 'react';

import { formatBQ, formatDecimal, steppedPool } from '@cookbook/core';
import { CheckCircleIcon, PlusIcon, RemoveIcon } from './icons';

/**
 * Press-and-hold cadence, identical to the editor's QuantityPicker: the first
 * auto-repeat fires after this delay, later repeats follow at this interval, so
 * a hold feels like deliberate repeated tapping.
 */
const HOLD_FIRST_REPEAT_MS = 450;
const HOLD_REPEAT_INTERVAL_MS = 100;

interface StockStepperProps {
  /** The pool's stock values (family base unit), ascending — 0 … the need. */
  values: readonly number[];
  /** The row's current stock, 0 … need (not necessarily a pool value). */
  value: number;
  /** Family base unit of the values (g / ml): the value box and the typed number. */
  baseUnit: 'g' | 'ml';
  /** The stock as its shopping unit's count ("2 Stück"), or null without one. */
  countText: string | null;
  /** Reports the next stock: a step, a typed number, or the covered maximum. */
  onChange: (next: number) => void;
  /** Accessible name of the control, e.g. "Vorrat für Mehl". */
  label: string;
}

/**
 * Parses a typed stock (see the file header). The number is read in the family
 * base unit with German typography: the comma is the decimal separator and a dot
 * may separate thousands ("1.200" is 1200, "1,2" is 1.2). Anything else is
 * ignored, so a typed unit or a stray space does not spoil the input
 * ("1200 g"). NaN for an input without a number — the caller keeps the stock then.
 */
function parseStockInput(text: string): number {
  return Number(
    text
      .replace(/[^\d.,]/g, '')
      .replaceAll('.', '')
      .replace(',', '.'),
  );
}

/** One thousandth — the precision the sheet rounds a stock to. */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The stepper with its two companions (the stock's count in its shopping unit
 * and the chip that names the need), see the file header. The − disables at 0,
 * the + once the stock covers the need — the promise that the amount on the
 * shopping list can never become negative.
 */
function StockStepper({ values, value, baseUnit, countText, onChange, label }: StockStepperProps) {
  /** The pool's last value: the need itself, i.e. "nothing to buy". */
  const covered = values[values.length - 1] ?? 0;

  /** Mirror of the latest value, so a press-and-hold repeat steps from what the
   *  previous repeat produced instead of from a stale render's closure. */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  /** The typed number while the box is open, or null while it is not. */
  const [draft, setDraft] = useState<string | null>(null);

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

  /**
   * Publishes a stock: the mirror first, so the hold cadence and the next step
   * start from it even before the parent's re-render arrives (a committed typed
   * number must never be stepped over), then the parent.
   */
  const applyStock = (next: number): void => {
    valueRef.current = next;
    onChange(next);
  };

  /** One tap in the given direction. Returns false when the pool's bound blocks
   *  it (a hold repeat then stops instead of burning cycles).
   *
   *  An open value box is resolved first, so a nudge of the buttons right after
   *  typing applies the typed number instead of dropping it. */
  const step = (direction: 1 | -1): boolean => {
    const typed = resolveDraft();
    const next = steppedPool(values, typed ?? valueRef.current, direction);
    if (next === null) {
      // The pool's bound blocks the step, but a typed number still applies.
      if (typed !== null) applyStock(typed);
      return false;
    }
    applyStock(next);
    return true;
  };

  /** Press-and-hold: first auto-repeat after HOLD_FIRST_REPEAT_MS, then one
   *  value per HOLD_REPEAT_INTERVAL_MS — the effect of tapping repeatedly. */
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

  /** Opens the value box: it shows the stock as a plain number in the family
   *  base unit (decided with the user — a typed stock is always in g / ml, so
   *  "1,2" is 1.2 g and 1200 g is typed as "1200", while the closed box keeps
   *  the familiar kg / l reading). */
  const beginEdit = (): void => {
    setDraft(formatDecimal(value));
  };

  /**
   * Closes an open value box and answers the stock it stands for: the typed
   * number, clamped to the pool's bounds (0 … the need) and rounded to
   * thousandths, or null when the input holds no number (the stock stays, the
   * box just closes — a typo must not change what is on the list). The draft
   * state is cleared either way.
   */
  const resolveDraft = (): number | null => {
    if (draft === null) return null;
    setDraft(null);
    const parsed = parseStockInput(draft);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(covered, Math.max(0, roundThousandths(parsed)));
  };

  /** A value box left by tapping or tabbing away (see `resolveDraft`). */
  const commitEdit = (): void => {
    const typed = resolveDraft();
    if (typed !== null && typed !== value) applyStock(typed);
  };

  const canDecrease = steppedPool(values, value, -1) !== null;
  const canIncrease = steppedPool(values, value, 1) !== null;

  return (
    <div className="stock-picker">
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
        {draft === null ? (
          // The value is a button, not a label: tapping it opens the keyboard
          // for a typed stock (see the file header).
          <button
            type="button"
            className="stock-stepper-value"
            onClick={beginEdit}
            aria-label={`${label} eintippen`}
          >
            {formatBQ(value, baseUnit)}
          </button>
        ) : (
          <span className="stock-stepper-edit">
            <input
              className="stock-stepper-input"
              // The phone's number keypad, not the full keyboard. The value may
              // carry a decimal comma, hence "decimal" rather than "numeric".
              inputMode="decimal"
              enterKeyHint="done"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit();
                if (event.key === 'Escape') setDraft(null);
              }}
              aria-label={`${label} in ${baseUnit === 'g' ? 'Gramm' : 'Milliliter'}`}
            />
            {/* A typed number is read in the family base unit, so the open box
                names it (the closed box reads as kg / l from 1000 up). */}
            <span className="stock-stepper-unit">{baseUnit}</span>
          </span>
        )}
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
      {/* The stock in its shopping unit ("2 Stück") — only an approximate unit
          needs the translation (core's `stockCountText`). */}
      {countText !== null && <span className="stock-count">{countText}</span>}
      {/* The one tap that answers "everything is at home". It names the amount
          that empties the list (the pool's last value) and carries the check
          symbol plus the olive "nothing to buy" look (".chip-covered" in
          styles/pantry-select.css, shared with the chip picker's last chip);
          while the row is covered it keeps the selected chip look, so it also
          marks that state. The amount alone is the visible label — the sheet's
          intro explains that a chip's amount means "at least this much" — so the
          accessible name and the tooltip spell the meaning out. */}
      <button
        type="button"
        className={value >= covered ? 'chip chip-covered chip-active' : 'chip chip-covered'}
        aria-pressed={value >= covered}
        aria-label={`Genug auf Vorrat: ${formatBQ(covered, baseUnit)}`}
        title="Genug auf Vorrat"
        onClick={() => applyStock(covered)}
      >
        <CheckCircleIcon className="chip-icon" />
        {formatBQ(covered, baseUnit)}
      </button>
    </div>
  );
}

export default StockStepper;
