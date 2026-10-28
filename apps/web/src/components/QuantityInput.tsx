/**
 * Quantity input used for every authorable amount (ingredient rows, inline
 * mentions, recipe yield, reorder point).
 *
 * Decided with the user:
 * - +/- steps only through the allowed BQ values from the BQ table
 *   (`nextAllowedBQ` / `previousAllowedBQ`); the buttons never step by an
 *   arbitrary increment. Holding a button repeats that walk, exactly like
 *   tapping it quickly (see StepperButton);
 * - a non-BQ target is only reachable through the keyboard. The field accepts
 *   any positive number; the suggestion chips are shortcuts, not limits;
 * - two suggestion modes. The **adaptive** mode (recipe quantities and yields)
 *   offers the optimizer's arrangements near the current value — "1 Becher
 *   (500 g)", "400 g" — in one measured line, no wrapping and no "andere"
 *   (components/SuggestionChips, core quantitySuggestions.ts). Tapping a chip
 *   stores its displayed, rounded BQ, so the field then reads exactly the
 *   chip's label; the chip is active when the field equals that BQ, and a row
 *   without an active chip is a valid state (the current amount has no
 *   particularly clean arrangement). The **fixed** mode keeps the old decade
 *   shortcuts and is what the reorder-point fields still use; those are
 *   unchanged in this session. A real field is never empty (every call site
 *   initializes a quantity), so the adaptive row has no fallback: without a
 *   value it simply offers nothing;
 * - the value shows its unit in the family unit or in kg / l from 1000
 *   (`formatBQ`): "400 g", "1,5 kg". While the field has keyboard focus it
 *   shows the plain family-unit number, so typing enters a value the same way
 *   the stored target is kept; blur restores the unit form;
 * - the value slot is right-aligned and just wide enough for every quantity up
 *   to 10 kg / 10 l (see QuantityValue); a live preview below the field stays
 *   left-aligned;
 * - zero and infinity are special reorder-point states, not BQ table values:
 *   `allowZero` adds the 0 chip and lets "−" leave the smallest BQ for 0,
 *   `allowInfinite` adds the ∞ chip. Neither applies to a unitless count.
 *
 * A unitless inline count (`{{…}}`) has no BQ table and keeps a plain ±1 step;
 * its display falls back to the AQ fraction typography.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  formatAQValue,
  formatBQ,
  formatDecimal,
  isAQValue,
  mappingsFor,
  nextAllowedBQ,
  previousAllowedBQ,
  suggestQuantities,
  suggestUnitlessQuantities,
  type PrecisionLevel,
} from '@cookbook/core';

import ArrangementLine from './ArrangementLine';
import QuantityValue from './QuantityValue';
import StepperButton from './StepperButton';
import SuggestionChips from './SuggestionChips';

/** The two authorable base-unit families. */
export type QuantityFamily = 'g' | 'ml';

interface QuantityInputProps {
  /** The stored quantity (family unit); undefined = nothing chosen yet. */
  value?: number;
  onChange: (quantity: number) => void;
  /** The ingredient's family unit (g/ml) — null = unitless quantity (`{{…}}`). */
  family: QuantityFamily | null;
  /** Offer 0 as a selectable value (the reorder point's "only for a recipe"). */
  allowZero?: boolean;
  /** Offer infinite stock (the reorder point of a water-like ingredient). */
  allowInfinite?: boolean;
  /** Accessible name of the input (defaults to "Menge"). */
  ariaLabel?: string;
  /**
   * Offer the optimizer's arrangements near the current value in one measured
   * line instead of the fixed decade shortcuts (see the file header). The
   * reorder-point fields leave this off.
   */
  adaptive?: boolean;
  /**
   * The ingredient whose additional units feed the adaptive chips; absent for
   * a recipe yield or a unitless count (metric-only / count-only suggestions).
   */
  ingredient?: string;
  /**
   * The effective precision of this quantity (the row's precision override or
   * the ingredient default). The optimizer picks the arrangement with it, so
   * the chip label matches the preview exactly.
   */
  precision?: PrecisionLevel;
}

/** Suggested family-unit values (all BQs; shortcuts only, not a pool limit). */
const FAMILY_SUGGESTIONS = [1, 10, 100, 1000, 10000];
/** Suggested unitless counts. */
const UNITLESS_SUGGESTIONS = [0.5, 1, 2, 3, 5, 10];
/** Floor of a unitless stepped value; the field itself accepts any positive number. */
const UNITLESS_STEP_FLOOR = 0.000001;

/** Display form in the field at rest: the full quantity with its unit. */
function displayText(value: number | undefined, family: QuantityFamily | null): string {
  if (value === undefined) return '';
  if (value === Infinity) return '∞';
  if (family === null) return isAQValue(value) ? formatAQValue(value) : formatDecimal(value);
  return formatBQ(value, family);
}

/** Display form while the field has focus: the plain stored family-unit number. */
function editText(value: number | undefined, family: QuantityFamily | null): string {
  if (value === undefined) return '';
  if (value === Infinity) return '∞';
  if (family === null) return isAQValue(value) ? formatAQValue(value) : formatDecimal(value);
  return formatDecimal(value);
}

/** Display form of a chip: the full quantity with its unit where applicable. */
function chipText(value: number, family: QuantityFamily | null): string {
  if (family === null) return isAQValue(value) ? formatAQValue(value) : formatDecimal(value);
  return formatBQ(value, family);
}

/** A quantity field with suggestion chips and a BQ-only −/+ stepper. */
function QuantityInput({
  value,
  onChange,
  family,
  allowZero,
  allowInfinite,
  ariaLabel = 'Menge',
  adaptive = false,
  ingredient,
  precision,
}: QuantityInputProps) {
  /** True while the text field owns keyboard focus (then it shows the raw number). */
  const [editing, setEditing] = useState(false);
  /**
   * The user's own text while editing; null = not editing, so the display is
   * derived from `value` and `family` on every render. Deriving it (instead of
   * mirroring it into state) keeps external changes — a chip, a step, a
   * prefill — in sync without an effect fighting the user's typing.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Mirror of the latest committed value. It lets a hold's repeat ticks step
   * from the value the previous tick produced, even before the parent has
   * re-rendered and passed the new prop back.
   */
  const valueRef = useRef<number | undefined>(value);

  // The mirror follows every commit. A hold writes it optimistically as well.
  useEffect(() => {
    valueRef.current = value;
  });

  // Select the whole value when keyboard editing starts, so the first
  // keystroke replaces the old amount instead of appending to it.
  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const text = editing && draft !== null ? draft : displayText(value, family);

  /**
   * The adaptive chips in ranking order (see the file header). They are derived
   * from the current value, so the row follows the field: a step or a keystroke
   * recenters it. The core normalizes each chip to its tap state, and tapping
   * stores the chip's displayed BQ — so the row and the preview can never
   * disagree. The optimizer runs with the field's effective precision.
   *
   * No fallback: a real field always carries a number (every call site
   * initializes one), and without a value there is no anchor to adapt to.
   */
  const adaptiveChips = useMemo(() => {
    if (adaptive !== true || value === undefined || !(value > 0) || !Number.isFinite(value)) {
      return [];
    }
    const context = precision === undefined ? {} : { quantity: precision };
    const list =
      family === null
        ? suggestUnitlessQuantities(value, context)
        : suggestQuantities(value, mappingsFor(ingredient ?? ''), family, context);
    return list.map((suggestion) => ({
      value: suggestion.value,
      label: <ArrangementLine display={suggestion.display} />,
    }));
  }, [adaptive, value, family, ingredient, precision]);

  const suggestions = family === null ? UNITLESS_SUGGESTIONS : FAMILY_SUGGESTIONS;
  const zeroChip = allowZero === true && family !== null ? 0 : null;
  const infinite = allowInfinite === true && family !== null;

  /** Parses the field; invalid/empty input is ignored (and reset on blur). */
  const commit = (raw: string): void => {
    const compact = raw.trim().replace(',', '.');
    if (compact === '' || compact === '∞') return;
    const parsed = Number(compact);
    if (!Number.isFinite(parsed)) return;
    if (parsed < 0) return;
    if (parsed === 0 && allowZero !== true) return;
    onChange(parsed);
  };

  /**
   * One step. A family quantity walks the BQ table (0 and ∞ are special
   * reorder-point states); a unitless count keeps its plain ±1. Returns false
   * when the list end blocks the step, which also stops a press-and-hold.
   */
  const step = (direction: 1 | -1): boolean => {
    const current = valueRef.current;
    if (current === undefined || !Number.isFinite(current)) return false;

    let next: number | undefined;
    if (family === null) {
      if (direction < 0 && current <= UNITLESS_STEP_FLOOR) return false;
      next = Math.max(UNITLESS_STEP_FLOOR, current + direction);
      next = Math.round(next * 1000) / 1000;
    } else if (direction < 0) {
      next = previousAllowedBQ(current);
      // 0 is the reorder point's "only ever bought for a recipe" state, not a
      // BQ table value; it is still reachable with one step down from the
      // smallest BQ (and from a typed value below it).
      if (next === undefined && allowZero === true && current > 0) {
        next = 0;
      }
    } else {
      next = nextAllowedBQ(current);
    }

    if (next === undefined || next === current) return false;
    valueRef.current = next; // optimistic: repeats are render-independent
    onChange(next);
    return true;
  };

  return (
    <div className="quantity-picker">
      {adaptive === true ? (
        <SuggestionChips
          chips={adaptiveChips}
          value={value}
          ariaLabel="Vorgeschlagene Mengen"
          onChange={onChange}
        />
      ) : (
        <div className="suggested-chips" role="group" aria-label="Vorgeschlagene Mengen">
          {zeroChip !== null && (
            <button
              type="button"
              className={value === 0 ? 'chip chip-active' : 'chip'}
              onClick={() => onChange(0)}
            >
              0
            </button>
          )}
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={value === suggestion ? 'chip chip-active' : 'chip'}
              onClick={() => onChange(suggestion)}
            >
              {chipText(suggestion, family)}
            </button>
          ))}
          {infinite && (
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
      )}

      <div className="quantity-row">
        <StepperButton
          direction={-1}
          disabled={
            value === undefined ||
            !Number.isFinite(value) ||
            (family === null
              ? value <= UNITLESS_STEP_FLOOR
              : previousAllowedBQ(value) === undefined && !(allowZero === true && value > 0))
          }
          ariaLabel="Menge verringern"
          onStep={step}
        />
        <QuantityValue>
          <input
            ref={inputRef}
            className="quantity-value quantity-input"
            type="text"
            inputMode="decimal"
            aria-label={ariaLabel}
            value={text}
            onFocus={() => {
              setEditing(true);
              setDraft(editText(value, family));
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              commit(event.target.value);
            }}
            onBlur={() => {
              setEditing(false);
              setDraft(null);
            }}
          />
        </QuantityValue>
        <StepperButton
          direction={1}
          disabled={value === undefined || !Number.isFinite(value)}
          ariaLabel="Menge erhöhen"
          onStep={step}
        />
      </div>
    </div>
  );
}

export default QuantityInput;
