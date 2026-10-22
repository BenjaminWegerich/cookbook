/**
 * Free quantity input (decided with the user: recipes store the unrounded
 * target, so the old ladder-only stepper is gone).
 *
 * The field accepts any positive number; the suggestion chips are shortcuts,
 * not limits. The +/− buttons step by a magnitude-aware increment (1 below
 * 100, 10 below 1000, 50 above) so a value can still be reached quickly
 * without forcing it onto a table. The value is always stored in the family
 * unit (g/ml); the label switches to kg/l at 1000 (core formatBQ), while the
 * input itself stays in the family unit.
 *
 * Two optional modes serve the ingredient master data's reorder point:
 * `allowZero` adds a "0" chip, `allowInfinite` adds "∞". Neither applies to a
 * unitless count.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useRef, useState } from 'react';

import { formatAQValue, formatBQ, formatDecimal, isAQValue } from '@cookbook/core';

import { PlusIcon, RemoveIcon } from './icons';

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
}

/** Suggested family-unit values (shortcuts only, not a pool limit). */
const FAMILY_SUGGESTIONS = [1, 10, 100, 1000, 10000];
/** Suggested unitless counts. */
const UNITLESS_SUGGESTIONS = [0.5, 1, 2, 3, 5, 10];

/** Display form of a value in the input: family unit, or a plain count. */
function inputText(value: number, family: QuantityFamily | null): string {
  if (value === Infinity) return '∞';
  if (family === null) return isAQValue(value) ? formatAQValue(value) : formatDecimal(value);
  return formatDecimal(value);
}

/** Display form of a chip: the full quantity with its unit where applicable. */
function chipText(value: number, family: QuantityFamily | null): string {
  if (family === null) return isAQValue(value) ? formatAQValue(value) : formatDecimal(value);
  return formatBQ(value, family);
}

/** Magnitude-aware step for the +/− buttons. */
function stepFor(value: number, family: QuantityFamily | null): number {
  if (family === null || !Number.isFinite(value)) return 1;
  if (value < 100) return 1;
  if (value < 1000) return 10;
  return 50;
}

/** A free quantity input with suggestion chips and adaptive +/− buttons. */
function QuantityInput({
  value,
  onChange,
  family,
  allowZero,
  allowInfinite,
  ariaLabel = 'Menge',
}: QuantityInputProps) {
  const [text, setText] = useState(value === undefined ? '' : inputText(value, family));
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the field in sync when the parent changes the value (a chip, a step,
  // a prefill), but do not fight the user's own typing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(value === undefined ? '' : inputText(value, family));
    }
  }, [value, family]);

  const suggestions =
    family === null ? UNITLESS_SUGGESTIONS : FAMILY_SUGGESTIONS;
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

  /** One adaptive step; 0/∞ are left through a chip or by typing. */
  const step = (direction: 1 | -1): void => {
    if (value === undefined || value === Infinity) return;
    const increment = stepFor(value, family);
    const next = Math.max(allowZero === true ? 0 : 0.000001, value + direction * increment);
    if (next === 0 && allowZero !== true) return;
    onChange(Math.round(next * 1000) / 1000);
  };

  return (
    <div className="quantity-picker">
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

      <div className="quantity-row">
        <button
          type="button"
          className="step-button"
          onClick={() => step(-1)}
          disabled={value === undefined || value === Infinity || (allowZero !== true && (value ?? 0) <= 0.000001)}
          aria-label="Menge verringern"
        >
          <RemoveIcon className="step-icon" />
        </button>
        <input
          ref={inputRef}
          className="quantity-value quantity-input"
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value);
          }}
          onBlur={() => setText(value === undefined ? '' : inputText(value, family))}
        />
        <button
          type="button"
          className="step-button"
          onClick={() => step(1)}
          disabled={value === undefined || value === Infinity}
          aria-label="Menge erhöhen"
        >
          <PlusIcon className="step-icon" />
        </button>
      </div>
    </div>
  );
}

export default QuantityInput;
