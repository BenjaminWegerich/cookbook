/**
 * Bottom sheet to create a new ingredient in the master data.
 *
 * The form is the shared `MasterDataSheet`, with the name and base unit editable
 * (the edit sheet shows both disabled). Everything else — display forms, the
 * additional-unit mappings, the precision, the reorder point and the shopping
 * data („Einkauf“ + „Synonyme“) — is the same form the edit flow uses.
 *
 * The create flow's name usually arrives from the recipe editor's ingredient
 * sheet. When that name already exists as a shopping item, the shared sheet
 * pre-fills the item's stop and synonyms; a change in those fields is handed to
 * the parent, which updates the existing item instead of creating a second one.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { type PrecisionLevel, type ShoppingStop } from '@cookbook/core';

import MasterDataSheet from './MasterDataSheet';

/** One filled mapping row handed to the parent for persistence. */
export interface NewIngredientEntry {
  au: string;
  factor: number;
}

interface NewIngredientSheetProps {
  /** The typed name from the ingredient sheet (prefilled, editable). */
  initialName: string;
  /** True while the Drive write runs (disables the save button). */
  saving: boolean;
  /** Drive error of the last save attempt (German, from the storage layer). */
  error: string | null;
  /** Called with the master data to create; `reorderPoint` is the value as
   *  entered (stored without optimization) and `stop` is the chosen shopping
   *  stop, or null while the route holds no stops at all. */
  onSave: (
    name: string,
    bu: string,
    reorderPoint: number,
    entries: NewIngredientEntry[],
    precision: PrecisionLevel,
    stop: ShoppingStop | null,
    variants: readonly string[],
  ) => void;
  /** Called when the user edits any form field — the parent forgets the
   *  stale Drive error of the last attempt (its cause may be gone now). */
  onEdited: () => void;
  onClose: () => void;
}

/**
 * The create sheet (see file header). Renders on top of the ingredient sheet;
 * the backdrop closes it (back to the sheet).
 */
function NewIngredientSheet({
  initialName,
  saving,
  error,
  onSave,
  onEdited,
  onClose,
}: NewIngredientSheetProps) {
  return (
    <MasterDataSheet
      kind="ingredient"
      creating
      initialName={initialName}
      busy={saving ? 'save' : null}
      error={error}
      onSave={(result) => {
        if (result.kind !== 'ingredient') return;
        onSave(
          result.name,
          result.bu,
          result.reorderPoint,
          result.entries.map((entry) => ({ au: entry.au, factor: entry.factor })),
          result.precision,
          result.stop,
          result.variants,
        );
      }}
      onEdited={onEdited}
      onClose={onClose}
    />
  );
}

export default NewIngredientSheet;
