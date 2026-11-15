/**
 * The inline „Lagerort“ picker of the two pantry steps — the same shape as the
 * „Markt“ chips of „Einkaufsliste sortieren“: a caption, the storage-place chips
 * below it, and one quiet exception action beside them.
 *
 * It is shown only while the ingredient has **no** storage place (decided with
 * the user: the pantry enters missing places, it does not edit existing ones).
 * Picking a chip writes the place immediately (see
 * ../hooks/useStoragePlaceAssignment); „Ignorieren“ writes nothing and only lets
 * this visit collapse the row without a place.
 *
 * The picker does not own the row's collapse: the page decides whether the stock
 * is confirmed too (see PantrySelect / SubRecipeSelect).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { STORAGE_PLACES } from '@cookbook/core';

interface StoragePlacePickerProps {
  /** The ingredient the place belongs to (the caption's accessible context). */
  ingredient: string;
  /** True while this ingredient's place is ignored for the visit. */
  ignored: boolean;
  /** True while the assignment write runs (chips and the skip action are off). */
  saving: boolean;
  /** German reason of the last failed write, or null. */
  error: string | null;
  /** Picks a place; the parent starts the write through the shared hook. */
  onAssign: (place: string) => void;
  /** Toggles the visit-only skip. */
  onToggleIgnore: () => void;
}

/**
 * The picker (see the file header). The page mounts it only for an ingredient
 * without a place, so there is no stored value to show as an active chip.
 */
function StoragePlacePicker({
  ingredient,
  ignored,
  saving,
  error,
  onAssign,
  onToggleIgnore,
}: StoragePlacePickerProps) {
  return (
    <div
      className="field pantry-place-picker"
      aria-busy={saving}
      // A tap anywhere in the picker belongs to the picker, never to the row's
      // fold handler (the caption itself is not a control).
      onClick={(event) => event.stopPropagation()}
    >
      <span className="field-label">Lagerort</span>
      <div className="pantry-place-row">
        <div className="store-chips" role="group" aria-label={`Lagerort für ${ingredient}`}>
          {STORAGE_PLACES.map((place) => (
            <button
              key={place}
              type="button"
              className="chip"
              disabled={saving}
              onClick={() => onAssign(place)}
            >
              {place}
            </button>
          ))}
        </div>
        {/* The exception action is a quiet text button, never a chip: a place is
            a value, skipping is the row's other answer (the same distinction the
            shopping sort page draws between its store chips and parking). */}
        <button
          type="button"
          className="text-button pantry-ignore"
          aria-pressed={ignored}
          disabled={saving}
          onClick={onToggleIgnore}
        >
          {ignored ? 'Ignoriert' : 'Ignorieren'}
        </button>
      </div>
      {saving && (
        <p className="field-hint" role="status">
          Wird gespeichert …
        </p>
      )}
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default StoragePlacePicker;
