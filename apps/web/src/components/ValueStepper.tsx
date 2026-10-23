/**
 * A −/+ stepper over a finite, ordered list of allowed values.
 *
 * Used where the value must be one of a baked set (the meal plan's ingredient
 * recipe yields) rather than a free target. The chip row offers the powers of
 * ten plus the current value as shortcuts; the +/− buttons move exactly one
 * list entry per press. The list itself is the single source of truth, so a
 * value the export cannot show is never offered. Holding a button repeats the
 * walk at the same cadence as tapping it quickly (StepperButton).
 *
 * The value slot is right-aligned and just wide enough for every quantity up
 * to 10 kg / 10 l (QuantityValue); the caller supplies the unit in `format`.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useRef } from 'react';

import QuantityValue from './QuantityValue';
import StepperButton from './StepperButton';

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

  /**
   * Mirror of the latest value so a hold's repeat ticks move from the entry
   * the previous tick produced, even before the parent re-renders and passes
   * the new prop back.
   */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  /** One list entry in `direction`; false when the end of the list blocks it. */
  const step = (direction: 1 | -1): boolean => {
    const current = valueRef.current;
    const currentIndex = values.indexOf(current);
    if (currentIndex < 0) return false;
    const next = values[currentIndex + direction];
    if (next === undefined) return false;
    valueRef.current = next;
    onChange(next);
    return true;
  };

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
        <StepperButton
          direction={-1}
          disabled={index <= 0}
          ariaLabel={`${ariaLabel} verringern`}
          onStep={step}
        />
        <QuantityValue>
          <span className="quantity-value quantity-display">{format(value)}</span>
        </QuantityValue>
        <StepperButton
          direction={1}
          disabled={index < 0 || index >= values.length - 1}
          ariaLabel={`${ariaLabel} erhöhen`}
          onStep={step}
        />
      </div>
    </div>
  );
}

export default ValueStepper;
