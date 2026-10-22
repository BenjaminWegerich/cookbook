/**
 * The five tolerance chips (decided with the user): very exact (0), exact
 * (0.25), balanced (0.5), practical (0.75), very practical (1).
 *
 * The value is a preference for the quantity optimizer, not a scale factor:
 * it never changes the target amount, only which BQ/AQ representation wins.
 * `undefined` means "inherit" — the recipe / ingredient / global level decides;
 * a small „Standard“ reset appears only when this level overrides it.
 *
 * Shared by the recipe header, the ingredient master-data sheets and the
 * per-quantity row control, so the labels and values cannot drift.
 */

import { TOLERANCE_CHOICES } from '@cookbook/core';

/** German labels of the five choices, in TOLERANCE_CHOICES order. */
const LABELS: readonly string[] = [
  'Sehr genau',
  'Genau',
  'Mittel',
  'Praktisch',
  'Sehr praktisch',
];

interface ToleranceChipsProps {
  /** The effective value of this level; undefined = inherit. */
  value: number | undefined;
  /** Reports a chosen value, or undefined for "inherit". */
  onChange: (value: number | undefined) => void;
  /** Accessible name of the group (e.g. "Toleranz des Rezepts"). */
  ariaLabel: string;
}

/** The five chips plus an optional reset to "inherit" (see file header). */
function ToleranceChips({ value, onChange, ariaLabel }: ToleranceChipsProps) {
  return (
    <div className="tolerance-control">
      <div className="quantity-chips" role="group" aria-label={ariaLabel}>
        {TOLERANCE_CHOICES.map((choice, index) => (
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
      {value !== undefined && (
        <button type="button" className="text-button tolerance-reset" onClick={() => onChange(undefined)}>
          Standard setzen
        </button>
      )}
    </div>
  );
}

export default ToleranceChips;
