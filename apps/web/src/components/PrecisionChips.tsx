/**
 * The five precision chips: very low, low, medium, high, very high.
 *
 * The value is a preference for the quantity optimizer, not a scale factor:
 * it never changes the target amount, only which BQ/AQ representation wins.
 * Higher precision prefers exact metric amounts, lower precision practical
 * household/package measures.
 *
 * The control always carries a value in both places it is used: the ingredient
 * master data (mandatory) and the quantity sheet (the effective value). It never
 * offers a separate „Standard“ chip or reset — the default is one of the five
 * levels, so in the quantity sheet selecting that level *is* the reset. The
 * create and edit sheets of the ingredient master data share it, so labels and
 * values cannot drift.
 */

import { PRECISION_LEVELS, type PrecisionLevel } from '@cookbook/core';

import { precisionLabel } from './precisionLabels';

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
        {PRECISION_LEVELS.map((choice) => (
          <button
            key={choice}
            type="button"
            className={value === choice ? 'chip chip-active' : 'chip'}
            aria-pressed={value === choice}
            onClick={() => onChange(choice)}
          >
            {precisionLabel(choice)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default PrecisionChips;
