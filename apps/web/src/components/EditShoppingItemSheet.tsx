/**
 * Bottom sheet to edit one item of the shopping master data — opened by tapping
 * a row of the „Einkaufsartikel“ screen.
 *
 * The form is the shared `MasterDataSheet` in its item mode: only the name, the
 * shopping stop and the synonyms are shown, exactly like the „Einkaufsartikel
 * verwalten“ sheet. The route itself is not editable here — the store and
 * section are picked from the existing route, and the screen records where an
 * item is bought and what else it is called.
 *
 * The item's delete action is reversible: it removes the row and its synonyms
 * immediately and the app-root notice offers „Rückgängig“ (DESIGN §6.4/§6.5), so
 * it asks no confirmation. „Speichern“ is a no-op on an unchanged form: it
 * closes the sheet without a write and without a notice (DESIGN §5.1).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { type ShoppingStop } from '@cookbook/core';

import MasterDataSheet from './MasterDataSheet';

/** The fields one save hands to the parent: the complete desired item state. */
export interface ShoppingItemUpdate {
  /** The chosen stop (store + section). */
  readonly stop: ShoppingStop;
  /** The item's complete synonym list, in display order. */
  readonly variants: readonly string[];
}

interface EditShoppingItemSheetProps {
  /** The canonical item name (the row's key; not editable). */
  name: string;

  /**
   * Which write is running, if any: the save button shows „Speichert …“, the
   * delete button „Löscht …“, and both actions are unavailable meanwhile.
   */
  saving: 'save' | 'delete' | null;
  /** Drive error of the last save/delete attempt (German). */
  error: string | null;
  /** Called with the validated fields; the parent persists them. */
  onSave: (update: ShoppingItemUpdate) => void;
  /** Called by „Einkaufsartikel löschen“; the parent deletes and shows the undo. */
  onDelete: () => void;
  /** Called when the user edits any field — the parent forgets a stale error. */
  onEdited: () => void;
  onClose: () => void;
}

/**
 * The edit sheet (see file header). Rendered on top of the „Einkaufsartikel“
 * screen; the backdrop closes it. The parent mounts it with `key={name}`, so
 * opening another item starts from that item's values.
 */
function EditShoppingItemSheet({
  name,
  saving,
  error,
  onSave,
  onDelete,
  onEdited,
  onClose,
}: EditShoppingItemSheetProps) {
  return (
    <MasterDataSheet
      kind="item"
      creating={false}
      initialName={name}
      busy={saving}
      error={error}
      onSave={(result) => {
        if (result.kind !== 'item') return;
        onSave({ stop: result.stop, variants: result.variants });
      }}
      onDelete={onDelete}
      onEdited={onEdited}
      onClose={onClose}
    />
  );
}

export default EditShoppingItemSheet;
