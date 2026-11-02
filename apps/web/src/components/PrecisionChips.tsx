/**
 * The five precision chips: very low, low, medium, high, very high.
 *
 * The value is a preference for the quantity optimizer, not a scale factor:
 * it never changes the target amount, only which BQ/AQ representation wins.
 * Higher precision prefers exact metric amounts, lower precision practical
 * household/package measures.
 *
 * States:
 * - No level chosen (`value === undefined`): no chip is active. The quantity
 *   follows the ingredient's master-data level live, so a later change there
 *   also changes this quantity. Used by the quantity sheet.
 * - A level chosen: that chip is active and the value is pinned — it keeps its
 *   value even when the ingredient default changes later. The dashed
 *   „× Entfernen“ chip drops the pin again (the same clear-chip idiom as the
 *   „Gesamtzeit“ field), so pinning at the current default is possible and
 *   visible without a sixth chip or a separate mode.
 *
 * Independent of those two states, the level that applies without an explicit
 * choice (the `defaultValue`) wears a quiet „Standard“ marker inside its own
 * chip. It stays visible while another level is pinned, so „× Entfernen“ always
 * has a visible target: the user can see which level the quantity returns to.
 *
 * The ingredient master data passes a value that is always defined and no
 * `onClear`: its level is mandatory, so it can neither be absent nor cleared,
 * and it passes no `defaultValue` — nothing sits behind a mandatory value.
 * The create and edit sheets share this component, so labels and values cannot
 * drift.
 */

import { PRECISION_LEVELS, type PrecisionLevel } from '@cookbook/core';

import { CloseIcon } from './icons';
import { precisionLabel } from './precisionLabels';

interface PrecisionChipsProps {
  /** The chosen level; `undefined` renders no active chip (follows the default). */
  value: PrecisionLevel | undefined;
  /**
   * The level that applies while no chip is chosen (the ingredient's
   * master-data level). Its chip carries the `Standard` marker, also while
   * another level is pinned. Omit it where the value is mandatory and no
   * default sits behind it (the master-data sheet).
   */
  defaultValue?: PrecisionLevel;
  /** Reports the chosen level. */
  onChange: (value: PrecisionLevel) => void;
  /**
   * Drops the chosen level back to the default. Renders the „× Entfernen“ chip
   * while `value` is set; mandatory fields omit it.
   */
  onClear?: () => void;
  /** Accessible name of the group (e.g. "Genauigkeit der Zutat"). */
  ariaLabel: string;
}

/** The five chips plus the optional clear chip (see file header). */
function PrecisionChips({
  value,
  defaultValue,
  onChange,
  onClear,
  ariaLabel,
}: PrecisionChipsProps) {
  return (
    <div className="precision-control">
      <div className="quantity-chips" role="group" aria-label={ariaLabel}>
        {PRECISION_LEVELS.map((choice) => (
          <button
            key={choice}
            type="button"
            className={value === choice ? 'chip chip-active' : 'chip'}
            aria-pressed={value === choice}
            // The marker's gap comes from CSS, so the accessible name would
            // otherwise run the words together ("MittelStandard").
            aria-label={choice === defaultValue ? `${precisionLabel(choice)} Standard` : undefined}
            onClick={() => onChange(choice)}
          >
            {precisionLabel(choice)}
            {choice === defaultValue && <span className="chip-standard">Standard</span>}
          </button>
        ))}
        {onClear !== undefined && value !== undefined && (
          <button
            type="button"
            className="chip chip-clear"
            onClick={onClear}
            title="Gewählte Genauigkeit entfernen"
          >
            <CloseIcon className="chip-icon" optical={20} />
            <span>Entfernen</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default PrecisionChips;
