/**
 * The home screen's entry into the ingredient master data.
 *
 * A quiet outlined action, the same geometry and weight as the shopping list's
 * „Einkaufsliste schreiben“ button: it sits below the last recipe and is used
 * only rarely, so it stays out of the captions and the FAB's create menu. The
 * shelf symbol is the app's „Vorrat“ symbol; the label names the managed data
 * in full, so the button reads on its own.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { ShelfIcon } from './icons';

interface ManageIngredientsButtonProps {
  /** Opens the „Zutaten“ screen. */
  onClick: () => void;
}

function ManageIngredientsButton({ onClick }: ManageIngredientsButtonProps) {
  return (
    <button type="button" className="outlined-button" onClick={onClick}>
      <ShelfIcon className="button-icon" optical={20} />
      <span>Zutaten verwalten</span>
    </button>
  );
}

export default ManageIngredientsButton;
