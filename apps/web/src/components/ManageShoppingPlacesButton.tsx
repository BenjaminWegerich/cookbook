/**
 * The home screen's entry into the shopping master data, next to „Zutaten
 * verwalten“.
 *
 * A quiet outlined action with the same geometry and weight as its neighbour:
 * the pair sits below the last recipe and is used only rarely, so neither is a
 * caption action or a FAB destination. The storefront symbol names the kind of
 * place being managed, and the label names the data in full, so the button reads
 * on its own (DESIGN §5.4).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { StorefrontIcon } from './icons';

interface ManageShoppingPlacesButtonProps {
  /** Opens the „Einkaufsorte“ screen. */
  onClick: () => void;
}

function ManageShoppingPlacesButton({ onClick }: ManageShoppingPlacesButtonProps) {
  return (
    <button type="button" className="outlined-button" onClick={onClick}>
      <StorefrontIcon className="button-icon" optical={20} />
      <span>Einkaufsorte verwalten</span>
    </button>
  );
}

export default ManageShoppingPlacesButton;
