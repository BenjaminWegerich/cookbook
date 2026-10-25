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
 * The rows are displayed in alphabetical order (German collation), not in the
 * CSV table order of ADDITIONAL_UNITS. Display order and data order are kept
 * apart on purpose: the form state and the persisted mappings stay in the
 * declared table order (buildMappingRows), while only this grid sorts, because
 * the inputs are bound to their unit by name and never by position. Sorting the
 * persisted rows instead would rewrite every existing ingredient's mapping
 * order on an unchanged save.
 *
 * The state lives in the parent as a string record keyed by unit name: an empty
 * factor means the row is skipped. This component only renders the inputs;
 * validation and persistence belong to `ingredientMasterForm.ts` and the parent.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { ADDITIONAL_UNITS } from '@cookbook/core';

/**
 * The known units in alphabetical order. `localeCompare` with the German
 * locale gives dictionary order as a German reader expects it, including the
 * umlauts equal to their base letters (Päckchen before Packung) and the
 * parenthesised variants grouped with their base unit. Computed once at module
 * load: the unit table is static, so there is no reason to sort per render.
 */
const UNITS_ALPHABETICALLY = [...ADDITIONAL_UNITS].sort((left, right) =>
  left.name.localeCompare(right.name, 'de'),
);

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
function IngredientMappingsField({ bu, factors, onFactorChange }: IngredientMappingsFieldProps) {
  return (
    <div className="factor-grid">
      {/* The two captions name the grid's columns and deliberately use the
          same quiet .factor-head-cell style: „Zusatz-Einheit“ over the unit
          names, „Menge“ over the factors. The base unit itself sits in every
          factor field, so the header stays short and the unit is visible where
          the number is typed. The captions stay aria-hidden because every
          input's aria-label already names its unit and the meaning of the
          number, so a screen reader loses nothing. */}
      <span className="factor-head-cell" aria-hidden="true">
        Zusatz-Einheit
      </span>
      <span className="factor-head-cell" aria-hidden="true">
        Menge
      </span>
      {UNITS_ALPHABETICALLY.flatMap((unit) => [
        <span key={`${unit.name}:name`} className="factor-unit">
          {unit.name}
        </span>,
        <span key={`${unit.name}:menge`} className="factor-input">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${unit.name}: Menge in ${bu}`}
            value={factors[unit.name] ?? ''}
            onChange={(event) =>
              // The display layer uses the German decimal comma. A dot typed on
              // a numeric keypad (or pasted) is rewritten as the user types, so
              // the field never shows two spellings of the same number; the
              // stored CSV keeps the canonical dot (parseFactor).
              onFactorChange(unit.name, event.target.value.replace('.', ','))
            }
          />
          <span className="factor-input-unit" aria-hidden="true">
            {bu}
          </span>
        </span>,
      ])}
    </div>
  );
}

export default IngredientMappingsField;
