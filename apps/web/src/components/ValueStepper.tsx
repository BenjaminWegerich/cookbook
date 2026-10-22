/**
 * A −/+ stepper over a finite, ordered list of allowed values.
 *
 * Used where the value must be one of a baked set (the meal plan's ingredient
 * recipe yields) rather than a free target. The chip row offers the powers of
 * ten plus the current value as shortcuts; the +/− buttons move exactly one
 * list entry per press. The list itself is the single source of truth, so a
 * value the export cannot show is never offered.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { PlusIcon, RemoveIcon } from './icons';

interface ValueStepperProps {
  /** The current value; must be one of `values`. */
  value: number;
  /** The allowed values, ascending. */
  values: readonly number[];
  /** Reports the newly selected value. */
  onChange: (value: number) => void;
  /** Display form of a value (unit and German formatting are the caller's). */
  format: (value: number) => string;
  /** Accessible name of the group (e.g. "Menge"). */
  ariaLabel: string;
}

/** True for a power of ten (a suggested shortcut). */
function isPowerOfTen(value: number): boolean {
  if (!(value > 0)) return false;
  const exponent = Math.log10(value);
  return Math.abs(exponent - Math.round(exponent)) < 1e-9;
}

function ValueStepper({ value, values, onChange, format, ariaLabel }: ValueStepperProps) {
  const index = values.indexOf(value);
  const suggestions = values.filter((candidate) => isPowerOfTen(candidate));
  if (!suggestions.includes(value)) suggestions.push(value);
  suggestions.sort((a, b) => a - b);

  return (
    <div className="quantity-picker">
      <div className="suggested-chips" role="group" aria-label={`${ariaLabel}: Vorschläge`}>
        {suggestions.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === value ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(candidate)}
          >
            {format(candidate)}
          </button>
        ))}
      </div>
      <div className="quantity-row">
        <button
          type="button"
          className="step-button"
          onClick={() => {
            const next = values[index - 1];
            if (next !== undefined) onChange(next);
          }}
          disabled={index <= 0}
          aria-label={`${ariaLabel} verringern`}
        >
          <RemoveIcon className="step-icon" />
        </button>
        <span className="quantity-value">{format(value)}</span>
        <button
          type="button"
          className="step-button"
          onClick={() => {
            const next = values[index + 1];
            if (next !== undefined) onChange(next);
          }}
          disabled={index < 0 || index >= values.length - 1}
          aria-label={`${ariaLabel} erhöhen`}
        >
          <PlusIcon className="step-icon" />
        </button>
      </div>
    </div>
  );
}

export default ValueStepper;
