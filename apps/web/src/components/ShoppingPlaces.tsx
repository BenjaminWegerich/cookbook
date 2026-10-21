/**
 * Shopping master-data screen — the „Einkaufsorte“ place behind the home
 * screen's „Einkaufsorte verwalten“ button, next to „Zutaten verwalten“.
 *
 * The screen lists every **article row** of `einkaufs-artikel.csv`
 * (docs/storage_format.md §10). The name set is a superset of the ingredient
 * list, so non-ingredients („Klopapier“, „Seife“, „Blumen“) appear here beside
 * recipe ingredients. Only existing rows are listed and edited (decided with
 * the user): an ingredient without an item row is simply never bought, and
 * creating rows stays with the flows that already own it (the new-ingredient
 * sheet and the shopping-list sort).
 *
 * A row carries the article name only — the same one-line row as „Zutaten
 * verwalten“ (decided with the user). The stop is edited in the sheet behind
 * it, not repeated in the list. Tapping a row opens `EditShoppingItemSheet`,
 * which owns the two things this screen edits — the stop and the item's
 * synonyms. The route itself (stores and sections) is not edited here; the
 * sheet picks from it.
 *
 * Search matches the article name and its synonyms, so typing „Möhren“ finds
 * „Karotten“. A search without a match is the expected outcome and shows the
 * bare em dash (DESIGN §6.3).
 *
 * The screen is a *place* (DESIGN §6.1): its header carries „Zurück“ and stays
 * sticky; the edit sheet is a *change* and answers „Abbrechen“. Browser Back
 * and Escape close the topmost layer — first the sheet, then the screen — and
 * the screen refreshes the set from Drive when it opens, so a spreadsheet edit
 * made in the meantime is what the user sees.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import {
  allShoppingItems,
  shoppingItemNames,
  shoppingVariantsFor,
  type ShoppingStop,
} from '@cookbook/core';

import EditShoppingItemSheet, { type ShoppingItemUpdate } from './EditShoppingItemSheet';
import { CloseIcon, SearchIcon, UndoIcon } from './icons';
import {
  deleteShoppingItem,
  loadShoppingRouteMasterData,
  restoreShoppingItem,
  saveShoppingItem,
} from '../drive/shoppingRouteMasterData';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import type { SnackbarMessage } from '../hooks/useSnackbar';
import '../styles/shopping-places.css';

/**
 * Imperative handle App uses for the browser Back button: Back must close the
 * open edit sheet first and only the next Back leave the screen.
 */
export interface ShoppingPlacesHandle {
  /** True when the sheet consumed the Back; false when the screen may close. */
  notifyBack: () => boolean;
}

interface ShoppingPlacesProps {
  /** Drive access token. */
  token: string;
  /** Returns to the recipe list (the screen's „Zurück“). */
  onClose: () => void;
  /** The app-root notice host, so a save/delete can offer its undo. */
  showSnackbar: (message: SnackbarMessage) => void;
  /** App's handle for the browser Back button. */
  ref?: Ref<ShoppingPlacesHandle>;
}

/** True when both stops name the same store and section. */
function sameStop(left: ShoppingStop, right: ShoppingStop): boolean {
  return left.store === right.store && left.section === right.section;
}

/**
 * True when the form's values equal the item as the registry holds it. A save
 * without a change is a no-op: it closes the sheet without a write and without
 * a notice (DESIGN §5.1). The synonym order carries no meaning, so set equality
 * is what counts; otherwise removing and re-adding the same variant would write
 * the identical file.
 */
function isUnchanged(
  stop: ShoppingStop,
  variants: readonly string[],
  update: ShoppingItemUpdate,
): boolean {
  if (!sameStop(stop, update.stop)) return false;
  if (variants.length !== update.variants.length) return false;
  return variants.every((variant) => update.variants.includes(variant));
}

/**
 * The „Einkaufsorte“ screen (see file header). It owns the search, the selected
 * item and the save/delete/undo cycle; the sheet owns its form values.
 */
function ShoppingPlaces({ token, onClose, showSnackbar, ref }: ShoppingPlacesProps) {
  const [query, setQuery] = useState('');
  /** The name of the item whose sheet is open, or null. */
  const [editingName, setEditingName] = useState<string | null>(null);
  /** Which write is running; the sheet keeps its contents and labels it. */
  const [saving, setSaving] = useState<'save' | 'delete' | null>(null);
  /**
   * Synchronous mirror of `saving`. A double tap (or a tap racing the shortcut)
   * can arrive before React has re-rendered the disabled button; the ref is what
   * actually keeps the second write from starting, and it also protects the
   * sheet from a Back/Escape that lands in that same window.
   */
  const savingRef = useRef(false);
  /** Drive error of the last failed write (German), shown in the sheet. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Non-fatal failure of the refresh on open; the cached data stays visible. */
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  /**
   * Bumped after a successful write or undo. The registry is module-level
   * state, not React state, so this is what tells the screen to read it again.
   */
  const [, setRevision] = useState(0);
  /**
   * Guards the refresh effect against a response landing after the screen was
   * left: setting state on an unmounted screen is pointless, and the warning
   * would belong to a screen the user no longer sees.
   */
  const mountedRef = useRef(true);

  // Refresh from Drive when the screen opens. The registry already carries the
  // last loaded set (or the built-in seed), so the list is usable immediately;
  // this only makes an external spreadsheet edit visible. A failure is a quiet
  // warning: every write re-reads the authoritative set itself and refuses a
  // corrupt file, so the visible list can never be written over bad data.
  useEffect(() => {
    mountedRef.current = true;
    void loadShoppingRouteMasterData(token)
      .then(() => {
        if (!mountedRef.current) return;
        setLoadWarning(null);
        setRevision((current) => current + 1);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setLoadWarning(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mountedRef.current = false;
    };
  }, [token]);

  // Browser Back: close the sheet first, leave the screen on the next Back. A
  // running write keeps the sheet open, so a Back cannot discard an in-flight
  // write's form.
  useImperativeHandle(
    ref,
    () => ({
      notifyBack: (): boolean => {
        if (editingName === null) return false;
        if (savingRef.current) return true;
        setEditingName(null);
        setSaveError(null);
        return true;
      },
    }),
    [editingName],
  );

  // Escape mirrors Back: the topmost layer closes, the screen only when no
  // sheet is open.
  useEscapeTrigger(() => {
    if (editingName !== null) {
      if (!savingRef.current) {
        setEditingName(null);
        setSaveError(null);
      }
      return;
    }
    onClose();
  });

  const items = allShoppingItems();
  const needle = query.trim().toLowerCase();
  const names = shoppingItemNames().filter((name) => {
    if (needle === '') return true;
    if (name.toLowerCase().includes(needle)) return true;
    return shoppingVariantsFor(name).some((variant) => variant.toLowerCase().includes(needle));
  });

  /** The item behind the open sheet, or undefined if the registry changed. */
  const editingStop = editingName === null ? undefined : items[editingName];

  /** Opens one item's sheet with a clean error state. */
  const openEntry = (name: string): void => {
    setSaveError(null);
    setEditingName(name);
  };

  /** Reports a failed undo as its own error notice (the success one closes). */
  const reportUndoFailure = (name: string, err: unknown): void => {
    const reason = err instanceof Error ? err.message : String(err);
    showSnackbar({
      tone: 'error',
      text: `„${name}“ konnte nicht wiederhergestellt werden. ${reason}`,
    });
  };

  /**
   * Persists the sheet's validated stop and synonym list and reports the
   * outcome. On success the sheet closes and the app-root notice offers the
   * previous state back; on failure the sheet stays open with the German reason.
   */
  const saveEntry = async (update: ShoppingItemUpdate): Promise<void> => {
    if (editingName === null || savingRef.current) return;
    const name = editingName;
    const stop = items[name];
    const variants = shoppingVariantsFor(name);
    // No value changed: the enabled „Speichern“ is a no-op that closes the sheet
    // without a write and without a notice (§5.1).
    if (stop !== undefined && isUnchanged(stop, variants, update)) {
      setEditingName(null);
      setSaveError(null);
      return;
    }
    savingRef.current = true;
    setSaving('save');
    setSaveError(null);
    try {
      const { previous } = await saveShoppingItem(token, name, update.stop, update.variants);
      setEditingName(null);
      setRevision((current) => current + 1);
      showSnackbar({
        text: `„${name}“ gespeichert.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" optical={20} />,
          run: async (): Promise<void> => {
            try {
              await restoreShoppingItem(token, name, previous);
              setRevision((current) => current + 1);
            } catch (err) {
              reportUndoFailure(name, err);
            }
          },
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  /**
   * Removes the item row and its synonyms. The removal is reversible, so it
   * happens on the tap and the notice offers the restore (DESIGN §6.4/§6.5).
   */
  const deleteEntry = async (): Promise<void> => {
    if (editingName === null || savingRef.current) return;
    const name = editingName;
    savingRef.current = true;
    setSaving('delete');
    setSaveError(null);
    try {
      const { previous } = await deleteShoppingItem(token, name);
      setEditingName(null);
      setRevision((current) => current + 1);
      showSnackbar({
        text: `„${name}“ entfernt.`,
        action: {
          label: 'Rückgängig',
          busyLabel: 'Wird rückgängig gemacht …',
          icon: <UndoIcon className="button-icon" optical={20} />,
          run: async (): Promise<void> => {
            try {
              await restoreShoppingItem(token, name, previous);
              setRevision((current) => current + 1);
            } catch (err) {
              reportUndoFailure(name, err);
            }
          },
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  return (
    <main className="app app-narrow shopping-places">
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={onClose}>
          Zurück
        </button>
        <div className="app-header-title">
          <h1>Einkaufsorte</h1>
        </div>
      </header>

      {/* Same search field as the home screen, without its sticky behaviour:
          the header above already stays, and two sticky bars would eat the
          viewport on a phone. */}
      <div className="recipe-search shopping-places-search">
        <div className="recipe-search-field" role="search">
          <SearchIcon className="recipe-search-icon" />
          <input
            type="search"
            className="recipe-search-input"
            placeholder="Artikel oder Synonym suchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Artikel oder Synonym suchen"
          />
          {query !== '' && (
            <button
              type="button"
              className="recipe-search-clear"
              aria-label="Suche löschen"
              onClick={() => setQuery('')}
            >
              <CloseIcon className="recipe-search-clear-icon" />
            </button>
          )}
        </div>
      </div>

      {loadWarning !== null && (
        <p className="master-banner" role="alert">
          {`Einkaufsdaten konnten nicht geladen werden — die zuletzt geladenen Daten bleiben sichtbar. (${loadWarning})`}
        </p>
      )}

      {names.length === 0 ? (
        <p className="ingredient-master-empty" role="status">
          {needle === '' ? 'Keine Artikel in den Einkaufsdaten.' : '—'}
        </p>
      ) : (
        <ul className="ingredient-list">
          {names.map((name) => (
            <li key={name}>
              {/* Exactly the „Zutaten“ row: the canonical name is the row's only
                  text. The stop is edited behind it, so repeating it here would
                  turn the reference list into a data table (DESIGN §5.12). */}
              <button type="button" className="ingredient-row" onClick={() => openEntry(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingName !== null && editingStop !== undefined && (
        <EditShoppingItemSheet
          key={editingName}
          name={editingName}
          stop={editingStop}
          variants={shoppingVariantsFor(editingName)}
          saving={saving}
          error={saveError}
          onSave={(update) => void saveEntry(update)}
          onDelete={() => void deleteEntry()}
          onEdited={() => setSaveError(null)}
          onClose={() => {
            if (savingRef.current) return;
            setEditingName(null);
            setSaveError(null);
          }}
        />
      )}
    </main>
  );
}

export default ShoppingPlaces;
