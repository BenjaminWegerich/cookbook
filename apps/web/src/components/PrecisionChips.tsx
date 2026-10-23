/**
 * The five precision chips: very low, low, medium, high, very high.
 *
 * The value is a preference for the quantity optimizer, not a scale factor:
 * it never changes the target amount, only which BQ/AQ representation wins.
 * Higher precision prefers exact metric amounts, lower precision practical
 * household/package measures.
 *
 * The ingredient-level value is mandatory, so the control always has a value
 * and offers no „Standard“ reset. It is shared by the create and edit sheets of
 * the ingredient master data, so labels and values cannot drift.
 */

import { PRECISION_LEVELS, type PrecisionLevel } from '@cookbook/core';

/** German labels of the five choices, in PRECISION_LEVELS order. */
const LABELS: readonly string[] = ['Sehr niedrig', 'Niedrig', 'Mittel', 'Hoch', 'Sehr hoch'];

interface PrecisionChipsProps {
  /** The current precision level. */
  value: PrecisionLevel;
  /** Reports the chosen level. */
  onChange: (value: PrecisionLevel) => void;
  /** Accessible name of the group (e.g. "Genauigkeit der Zutat"). */
  ariaLabel: string;
}

/** The five chips (see file header). */
function PrecisionChips({ value, onChange, ariaLabel }: PrecisionChipsProps) {
  return (
    <div className="precision-control">
      <div className="quantity-chips" role="group" aria-label={ariaLabel}>
        {PRECISION_LEVELS.map((choice, index) => (
          <button
            key={choice}
            type="button"
            className={value === choice ? 'chip chip-active' : 'chip'}
            aria-pressed={value === choice}
            onClick={() => onChange(choice)}
          >
            {LABELS[index]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default PrecisionChips;
