/**
 * Bottom sheet to edit one item of the shopping master data — opened by tapping
 * a row of the „Einkaufsorte“ screen.
 *
 * It changes the two things this screen owns (decided with the user):
 * - the item's **stop** — the store as chips and the section as the familiar
 *   search field with that store's sections below it (the same „Einkauf“ field
 *   the new-ingredient sheet uses, so a section can never be paired with the
 *   wrong store, docs/storage_format.md §10);
 * - the item's **synonyms** — the variant texts that resolve to this item
 *   (docs/shopping_item_identity.md §1). Adding a variant validates it live
 *   through core's `validateShoppingVariant`; removing one takes the chip away.
 *
 * The item name is the row's identity and is not a field: it heads the sheet as
 * its subtitle. The route itself is not editable here either — the store and
 * section are picked from the existing route, and the screen only records where
 * an item is bought and what else it is called.
 *
 * „Artikel entfernen“ is a destructive action, but it is reversible: it removes
 * the item row and its synonyms immediately and the app-root notice offers
 * „Rückgängig“ (DESIGN §6.4/§6.5), so it asks no confirmation. „Speichern“ is a
 * no-op on an unchanged form: it closes the sheet without a write and without a
 * notice (DESIGN §5.1).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import {
  allShoppingItems,
  allShoppingSynonyms,
  shoppingSections,
  shoppingStores,
  validateShoppingVariant,
  type ShoppingStop,
  type ShoppingSynonyms,
} from '@cookbook/core';

import { CloseIcon } from './icons';
import { useSaveShortcut } from '../hooks/useSaveShortcut';

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
  /** The item's current stop, as the form starts. */
  stop: ShoppingStop;
  /** The item's current synonyms, as the form starts. */
  variants: readonly string[];
  /**
   * Which write is running, if any: the save button shows „Speichert …“, the
   * delete button „Entfernt …“, and both actions are unavailable meanwhile.
   */
  saving: 'save' | 'delete' | null;
  /** Drive error of the last save/delete attempt (German). */
  error: string | null;
  /** Called with the validated fields; the parent persists them. */
  onSave: (update: ShoppingItemUpdate) => void;
  /** Called by „Artikel entfernen“; the parent deletes and shows the undo. */
  onDelete: () => void;
  /** Called when the user edits any field — the parent forgets a stale error. */
  onEdited: () => void;
  onClose: () => void;
}

/**
 * The draft synonym table the candidate is checked against: the stored table
 * without this item's rows, plus the rows the form currently shows. This is
 * what makes "remove a variant and add it again" a valid edit instead of a
 * duplicate complaint.
 */
function draftSynonyms(name: string, variants: readonly string[]): ShoppingSynonyms {
  const next: Record<string, string> = {};
  for (const [variant, owner] of Object.entries(allShoppingSynonyms())) {
    if (owner !== name) {
      next[variant] = owner;
    }
  }
  for (const variant of variants) {
    next[variant] = name;
  }
  return next;
}

/**
 * The edit sheet (see file header). Rendered on top of the „Einkaufsorte“
 * screen; the backdrop closes it. The parent mounts it with `key={name}`, so
 * opening another item starts from that item's values.
 */
function EditShoppingItemSheet({
  name,
  stop,
  variants,
  saving,
  error,
  onSave,
  onDelete,
  onEdited,
  onClose,
}: EditShoppingItemSheetProps) {
  const [store, setStore] = useState(stop.store);
  const [sectionQuery, setSectionQuery] = useState(stop.section);
  const [drafts, setDrafts] = useState<readonly string[]>(variants);
  /** The text of the „Synonym“ field, still waiting to be added. */
  const [variantQuery, setVariantQuery] = useState('');
  /** The first failed save attempt: only then does the stop field explain. */
  const [attempted, setAttempted] = useState(false);
  /** The synonym field's own message (validation or duplicate). */
  const [variantError, setVariantError] = useState<string | null>(null);

  const stores = shoppingStores();
  const sections = store === '' ? [] : shoppingSections(store);
  const section = sectionQuery.trim();

  /**
   * The stop the picker currently names, or null while it is incomplete. The
   * section must be one of this store's sections — the pair is the key, so free
   * text is not a valid stop.
   */
  const chosenStop: ShoppingStop | null =
    store !== '' && sections.includes(section) ? { store, section } : null;

  /**
   * The message the „Einkauf“ field reports once a save was attempted. It names
   * the exact missing step, so the user does not have to guess which half of the
   * pair is incomplete.
   */
  const stopError =
    attempted && chosenStop === null
      ? stores.length === 0
        ? 'Kein Einkaufsweg hinterlegt — der Einkaufsort kann nicht geändert werden.'
        : store === ''
          ? 'Bitte einen Markt wählen.'
          : section === ''
            ? 'Bitte einen Bereich wählen.'
            : `„${section}“ ist kein Bereich von ${store}.`
      : null;

  /** Reports a form edit to the parent, which drops a stale Drive error. */
  const markEdited = (): void => onEdited();

  /** Picks a store. A section belongs to exactly one store, so it is cleared. */
  const chooseStore = (next: string): void => {
    setStore(next);
    setSectionQuery('');
    markEdited();
  };

  /** Adopts a section option into the search field (same tap-to-apply). */
  const adoptSection = (next: string): void => {
    setSectionQuery(next);
    markEdited();
  };

  /**
   * Adds the typed synonym to the form. The candidate is checked against the
   * draft table, so a removed-and-retyped variant is allowed and a duplicate or
   * shadowed article name is refused with the exact reason under the field.
   */
  const addVariant = (): void => {
    if (saving !== null) return;
    const check = validateShoppingVariant(
      variantQuery,
      name,
      allShoppingItems(),
      draftSynonyms(name, drafts),
    );
    if (!check.ok) {
      setVariantError(check.message);
      return;
    }
    setDrafts([...drafts, check.variant]);
    setVariantQuery('');
    setVariantError(null);
    markEdited();
  };

  /** Removes one synonym chip from the form (the save writes the new set). */
  const removeVariant = (variant: string): void => {
    setDrafts(drafts.filter((candidate) => candidate !== variant));
    setVariantError(null);
    markEdited();
  };

  /**
   * Validates and saves. A missing stop shows its field message and keeps the
   * sheet open; a busy write is ignored (the buttons are disabled anyway).
   */
  const handleSave = (): void => {
    if (saving !== null) return;
    if (chosenStop === null) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    onSave({ stop: chosenStop, variants: drafts });
  };

  // Ctrl+S is the keyboard equivalent of the „Speichern“ button. The sheet is
  // only ever mounted while it is the topmost layer, so the shortcut is enabled.
  useSaveShortcut(handleSave);

  /** The options under the section field: all of the store's sections while
   *  nothing is typed, the matching ones while a part is typed, none once the
   *  text names one exactly (the pick moved into the field). */
  const sectionSuggestions = sections.includes(section)
    ? []
    : sections.filter((candidate) => candidate.toLowerCase().includes(section.toLowerCase()));

  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={saving !== null ? undefined : onClose}
        role="presentation"
        aria-hidden={saving !== null}
      />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Artikel bearbeiten">
        <div className="sheet-head">
          <h3 className="sheet-title">Artikel bearbeiten</h3>
          <p className="sheet-subtitle">{name}</p>
        </div>

        {/* A Drive failure belongs to no field: it is the save itself that
            failed, so it is reported once above the form (DESIGN §5.3). */}
        {error !== null && (
          <p className="master-banner" role="alert">
            {error}
          </p>
        )}

        {/* Where the item is bought (docs/storage_format.md §10): level 1 is the
            store („Markt“ in the UI, one tap on a chip), level 2 the section
            („Bereich“) as a search field with that store's sections below it. */}
        <div className="field">
          <span className="field-label">Einkauf</span>

          {stores.length === 0 ? (
            <p className="field-hint">
              Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — der Einkaufsort kann nicht geändert
              werden.
            </p>
          ) : (
            <>
              <div className="store-chips" role="group" aria-label="Markt">
                {stores.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={store === candidate ? 'chip chip-active' : 'chip'}
                    aria-pressed={store === candidate}
                    onClick={() => chooseStore(candidate)}
                    disabled={saving !== null}
                  >
                    {candidate}
                  </button>
                ))}
              </div>

              {/* The section field follows the store: without a store there is no
                  option to offer, and a section belongs to exactly one store. */}
              {store !== '' && (
                <>
                  <p className="field-hint">Bereich</p>
                  <input
                    type="text"
                    value={sectionQuery}
                    onChange={(event) => {
                      setSectionQuery(event.target.value);
                      markEdited();
                    }}
                    aria-label={`Bereich in ${store}`}
                    aria-describedby={stopError === null ? undefined : 'shopping-stop-error'}
                    placeholder="Suchen oder wählen"
                    disabled={saving !== null}
                  />
                  {sectionSuggestions.length > 0 && (
                    <ul className="suggestions">
                      {sectionSuggestions.map((candidate) => (
                        <li key={candidate}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => adoptSection(candidate)}
                            disabled={saving !== null}
                          >
                            {candidate}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Nothing matches the typed text: the established bare em dash
                      placeholder, so the field never looks broken. Suppressed
                      while the field names a section exactly. */}
                  {section !== '' &&
                    !sections.includes(section) &&
                    sectionSuggestions.length === 0 && (
                      <p className="field-hint" role="status">
                        —
                      </p>
                    )}
                </>
              )}
            </>
          )}

          {stopError !== null && (
            <p className="field-error" id="shopping-stop-error" role="alert">
              {stopError}
            </p>
          )}
        </div>

        {/* What else the item is called (docs/shopping_item_identity.md §1):
            one chip per variant, and a field that adds the next one. A variant
            is meaning, not a stop — it never gets a route of its own. */}
        <div className="field">
          <span className="field-label">Synonyme</span>
          <p className="field-hint">Weitere Schreibweisen, die auf diesen Artikel verweisen.</p>

          {drafts.length === 0 ? (
            <p className="field-hint">Noch keine Synonyme.</p>
          ) : (
            <ul className="suggestions">
              {drafts.map((variant) => (
                <li key={variant}>
                  <button
                    type="button"
                    className="chip chip-clear"
                    onClick={() => removeVariant(variant)}
                    aria-label={`Synonym „${variant}“ entfernen`}
                    disabled={saving !== null}
                  >
                    <span>{variant}</span>
                    <CloseIcon className="chip-icon" optical={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="synonym-add">
            <input
              type="text"
              value={variantQuery}
              onChange={(event) => {
                setVariantQuery(event.target.value);
                setVariantError(null);
                markEdited();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addVariant();
              }}
              placeholder="Synonym"
              aria-label="Neues Synonym"
              aria-describedby={variantError === null ? undefined : 'shopping-variant-error'}
              disabled={saving !== null}
            />
            <button
              type="button"
              className="add-button"
              onClick={addVariant}
              disabled={saving !== null}
            >
              Hinzufügen
            </button>
          </div>

          {variantError !== null && (
            <p className="field-error" id="shopping-variant-error" role="alert">
              {variantError}
            </p>
          )}
        </div>

        <div className="sheet-actions">
          <button
            type="button"
            className="danger-button"
            onClick={onDelete}
            disabled={saving !== null}
            aria-busy={saving === 'delete'}
          >
            {saving === 'delete' ? 'Entfernt …' : 'Artikel entfernen'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onClose}
            disabled={saving !== null}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={saving !== null}
            aria-busy={saving === 'save'}
          >
            {saving === 'save' ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </>
  );
}

export default EditShoppingItemSheet;
