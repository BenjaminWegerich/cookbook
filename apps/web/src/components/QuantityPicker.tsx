/**
 * QuantityPicker — the editor's quantity input (decided with the user after
 * the brainstorm: option A).
 *
 * Three complementary elements:
 * - a horizontally scrollable **suggested** chip row (one tap for common
 *   values; the app may later highlight further suggestions, e.g. a whole
 *   Becher — the row is explicitly a "suggestions" surface);
 * - a **− / + stepper** that moves exactly one ladder rung per tap — it
 *   reaches every rung of the pool (1 … 10000 in the family unit), always
 *   ladder-valid by construction;
 *
 * Values are stored in the family unit (g/ml); labels switch to kg/l at 1000
 * (core formatBQ). UI language is German.
 */

import { formatBQ, scale } from '@cookbook/core';

import { QUANTITY_MAX, QUANTITY_MIN, suggestedChips, type QuantityFamily } from './quantityChips';

interface QuantityPickerProps {
  /** The stored quantity (family unit); undefined = nothing chosen yet. */
  value?: number;
  onChange: (quantity: number) => void;
  /** The ingredient's family unit (g or ml), derived from the master data. */
  family: QuantityFamily;
}

/**
 * The quantity input (see file header). Used for ingredient quantities in the
 * sheet and for the Ergiebigkeit in the editor's Kopfdaten.
 */
function QuantityPicker({ value, onChange, family }: QuantityPickerProps) {
  const suggestions = suggestedChips(family);

  /** One ladder rung up/down, clamped to the pool bounds [1, 10000]. */
  const step = (delta: 1 | -1): void => {
    if (value === undefined) return;
    const next = scale(value, delta);
    onChange(Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, next)));
  };

  const minReached = value !== undefined && value <= QUANTITY_MIN;
  const maxReached = value !== undefined && value >= QUANTITY_MAX;

  return (
    <div className="quantity-picker">
      <div className="suggested-chips" role="group" aria-label="Vorgeschlagene Mengen">
        {suggestions.map((chip) => (
          <button
            key={chip.quantity}
            type="button"
            className={chip.quantity === value ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(chip.quantity)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="quantity-row">
        <button
          type="button"
          className="step-button"
          onClick={() => step(-1)}
          disabled={minReached || value === undefined}
          aria-label="Menge um eine Stufe verringern"
        >
          −
        </button>
        <span className="quantity-value">
          {value === undefined ? '—' : formatBQ(value, family)}
        </span>
        <button
          type="button"
          className="step-button"
          onClick={() => step(1)}
          disabled={maxReached || value === undefined}
          aria-label="Menge um eine Stufe erhöhen"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default QuantityPicker;
