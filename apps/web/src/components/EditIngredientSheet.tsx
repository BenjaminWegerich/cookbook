/**
 * Bottom sheet to edit one ingredient's master data.
 *
 * The form itself is the shared `MasterDataSheet`: this wrapper only maps the
 * shared result onto the parent's ingredient update. An edit changes the optional
 * Singular/Plural pair, the reorder point („Vorrat“), the additional-unit
 * mappings, the precision, **and** the shopping data („Einkauf“ + „Synonyme“)
 * that belongs to the same name. The canonical name and the base unit are shown
 * as disabled fields: recipes, inline mentions and the mappings file key on the
 * name, and the base unit decides how every stored quantity is read.
 *
 * The shopping fields are part of this sheet because the ingredient and the
 * shopping item are two views of one name. A save that changes them writes the
 * item row too; the parent captures both previous states for „Rückgängig“.
 * For the row of an ingredient recipe (`subRecipe`) those fields are hidden:
 * a sub-recipe is cooked, never bought.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { type IngredientEntry } from '@cookbook/core';

import MasterDataSheet from './MasterDataSheet';
import type { IngredientMasterSheetUpdate } from './ingredientMasterUpdate';

interface EditIngredientSheetProps {
  /** The canonical name of the entry (its key; not editable). */
  name: string;
  /** The current registry entry this form starts from. */
  entry: IngredientEntry;
  /** True while the Drive write runs (disables both actions). */
  saving: boolean;
  /** Drive error of the last save attempt (German, from the storage layer). */
  error: string | null;
  /** Called with the validated fields; the parent persists them. */
  onSave: (update: IngredientMasterSheetUpdate) => void;
  /** Called when the user edits any field — the parent forgets a stale error. */
  onEdited: () => void;
  onClose: () => void;
  /** True for the ingredient row of an ingredient recipe: no shopping fields. */
  subRecipe?: boolean;
}

/**
 * The edit sheet (see file header). Rendered on top of the „Zutaten“ screen;
 * the backdrop closes it. The parent mounts it with `key={name}`, so opening
 * another ingredient starts from that entry's values.
 */
function EditIngredientSheet({
  name,
  entry,
  saving,
  error,
  onSave,
  onEdited,
  onClose,
  subRecipe = false,
}: EditIngredientSheetProps) {
  return (
    <MasterDataSheet
      kind="ingredient"
      creating={false}
      initialName={name}
      entry={entry}
      busy={saving ? 'save' : null}
      error={error}
      subRecipe={subRecipe}
      onSave={(result) => {
        if (result.kind !== 'ingredient') return;
        onSave({
          update: {
            singular: result.singular,
            plural: result.plural,
            reorderPoint: result.reorderPoint,
            entries: result.entries,
            precision: result.precision,
          },
          stop: result.stop,
          variants: result.variants,
        });
      }}
      onEdited={onEdited}
      onClose={onClose}
    />
  );
}

export default EditIngredientSheet;
