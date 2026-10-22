/**
 * The „Zusatz-Einheiten“ grid of the ingredient master-data forms.
 *
 * One row per known additional unit (Becher, EL, TL, …): the unit's name and the
 * amount of base unit per one unit (the conversion factor). The grid is shared
 * by the create sheet („Neue Zutat anlegen“) and the edit sheet („Zutat
 * bearbeiten“), so both forms show the same units in the same order with the
 * same labels. Per-ingredient priorities are gone: the optimizer scores every
 * compatible unit, and the app allows at most one shopping unit per ingredient.
 *
 * The state lives in the parent as a string record keyed by unit name: an empty
 * factor means the row is skipped. This component only renders the inputs;
 * validation and persistence belong to `ingredientMasterForm.ts` and the parent.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { ADDITIONAL_UNITS } from '@cookbook/core';

interface IngredientMappingsFieldProps {
  /** The ingredient's base unit ("g" or "ml"); factors are expressed in it. */
  bu: string;
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  factors: Record<string, string>;
  /** Reports one factor edit (the parent stores it and marks the form edited). */
  onFactorChange: (au: string, value: string) => void;
}

/**
 * The factor grid (see file header). The header cells are decorative: every
 * input carries a full `aria-label` that names the unit and its meaning, so a
 * screen reader never depends on the visual column header.
 */
function IngredientMappingsField({
  bu,
  factors,
  onFactorChange,
}: IngredientMappingsFieldProps) {
  return (
    <div className="factor-grid">
      <span className="factor-head-cell" aria-hidden="true" />
      <span className="factor-head-cell" aria-hidden="true">
        Menge [{bu}]
      </span>
      {ADDITIONAL_UNITS.flatMap((unit) => [
        <span key={`${unit.name}:name`} className="factor-unit">
          {unit.name}
        </span>,
        <input
          key={`${unit.name}:menge`}
          type="text"
          inputMode="decimal"
          aria-label={`${unit.name}: Menge in ${bu}`}
          value={factors[unit.name] ?? ''}
          onChange={(event) =>
            // The display layer uses the German decimal comma. A dot typed on a
            // numeric keypad (or pasted) is rewritten as the user types, so the
            // field never shows two spellings of the same number; the stored CSV
            // keeps the canonical dot (parseFactor).
            onFactorChange(unit.name, event.target.value.replace('.', ','))
          }
        />,
      ])}
    </div>
  );
}

export default IngredientMappingsField;
