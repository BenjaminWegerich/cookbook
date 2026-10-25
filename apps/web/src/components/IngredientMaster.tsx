/**
 * Ingredient master-data screen — the „Zutaten“ place behind the home screen's
 * „Zutaten verwalten“ button.
 *
 * The screen lists every ingredient of the collection's master data
 * (`zutaten.csv` + `zutaten-umrechnungen.csv`, merged into the core registry)
 * as one searchable surface. A row carries only the canonical name: the values
 * that used to sit on a second line — base unit, stock, mapping count — are
 * edited in the sheet behind the row, and repeating them here would turn a
 * quiet reference list into a data table.
 *
 * Tapping a row opens the shared master-data sheet (`MasterDataSheet`) in its
 * ingredient-edit mode. The sheet now also edits the same name's shopping data
 * („Einkauf“ + „Synonyme“), because the ingredient and the shopping item are two
 * views of one name; saving captures both previous states for „Rückgängig“.
 *
 * „Neue Zutat anlegen“ above the list opens the same sheet with the name and base
 * unit editable. When the chosen name already exists as a shopping item, the
 * sheet pre-fills the item's stop and synonyms; a changed one is written to that
 * item instead of creating a second route.
 *
 * Search matches the canonical name and both display forms, so a user can find
 * „Karotten“ by typing „Karotte“. A search without a match is the expected
 * outcome and shows the bare em dash (DESIGN §6.3); no result never hides the
 * field that names the term.
 *
 * The screen is a *place* (DESIGN §6.1): its header carries „Zurück“ and stays
 * sticky; the edit sheet is a *change* and answers „Abbrechen“. Browser Back
 * and Escape close the topmost layer — first a sheet, then the screen — and the
 * screen refreshes both master-data sets when it opens.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import {
  allIngredientMappings,
  allShoppingItems,
  masterIngredientNames,
  mappingsFor,
  shoppingVariantsFor,
  type ShoppingStop,
} from '@cookbook/core';

import EditIngredientSheet from './EditIngredientSheet';
import NewIngredientSheet from './NewIngredientSheet';
import {
  findItemKey,
  isShoppingUnchanged,
  updateIngredientMasterAndShopping,
  writeShoppingChange,
  type IngredientMasterSheetUpdate,
} from './ingredientMasterUpdate';
import { CloseIcon, PlusIcon, SearchIcon } from './icons';
import {
  appendIngredientMasterData,
  loadIngredientMasterData,
  type IngredientMasterEntryInput,
} from '../drive/ingredientMasterData';
import {
  deleteShoppingItem,
  loadShoppingRouteMasterData,
  restoreShoppingItem,
  type ShoppingItemState,
} from '../drive/shoppingRouteMasterData';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import type { SnackbarMessage } from '../hooks/useSnackbar';
import '../styles/ingredient-master.css';

/**
 * Imperative handle App uses for the browser Back button: Back must close the
 * open sheet first and only the next Back leave the screen.
 */
export interface IngredientMasterHandle {
  /** True when the sheet consumed the Back; false when the screen may close. */
  notifyBack: () => boolean;
}

interface IngredientMasterProps {
  /** Drive access token. */
  token: string;
  /** Returns to the recipe list (the screen's „Zurück“). */
  onClose: () => void;
  /** The app-root notice host, so the save can offer its undo. */
  showSnackbar: (message: SnackbarMessage) => void;
  /** App's handle for the browser Back button. */
  ref?: Ref<IngredientMasterHandle>;
}

/** The German reason of a failed create step. */
function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The „Zutaten“ screen (see file header). It owns the search, the selected
 * entry, the create flow and the save/undo cycle; the sheet owns its form values.
 */
function IngredientMaster({ token, onClose, showSnackbar, ref }: IngredientMasterProps) {
  const [query, setQuery] = useState('');
  /** The name of the entry whose sheet is open, or null. */
  const [editingName, setEditingName] = useState<string | null>(null);
  /** True while the „Neue Zutat anlegen“ sheet is open. */
  const [creating, setCreating] = useState(false);
  /** True while a save/undo/create write runs; the sheets keep their contents. */
  const [saving, setSaving] = useState(false);
  /**
   * Synchronous mirror of `saving`. A double tap (or a tap racing the shortcut)
   * can arrive before React has re-rendered the disabled button; the ref is what
   * actually keeps the second write from starting, and it also protects the
   * sheets from a Back/Escape that lands in that same window.
   */
  const savingRef = useRef(false);
  /** Drive error of the last failed save (German), shown in the edit sheet. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Drive error of the last failed create (German), shown in the create sheet. */
  const [createError, setCreateError] = useState<string | null>(null);
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

  // Refresh both master-data sets from Drive when the screen opens. The screen
  // now edits the shopping data behind the same names, so a stale item table
  // would be as wrong as a stale ingredient table. A failure is a quiet warning:
  // saves re-read the authoritative files themselves and refuse corrupt data.
  useEffect(() => {
    mountedRef.current = true;
    void Promise.all([loadIngredientMasterData(token), loadShoppingRouteMasterData(token)])
      .then(() => {
        if (!mountedRef.current) return;
        setLoadWarning(null);
        setRevision((current) => current + 1);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setLoadWarning(reasonOf(err));
      });
    return () => {
      mountedRef.current = false;
    };
  }, [token]);

  // Browser Back: close the sheet first, leave the screen on the next Back. A
  // running write keeps the sheet open, so a Back cannot discard an in-flight
  // save's form.
  useImperativeHandle(
    ref,
    () => ({
      notifyBack: (): boolean => {
        if (creating) {
          if (savingRef.current) return true;
          setCreating(false);
          setCreateError(null);
          return true;
        }
        if (editingName === null) return false;
        if (savingRef.current) return true;
        setEditingName(null);
        setSaveError(null);
        return true;
      },
    }),
    [creating, editingName],
  );

  // Escape mirrors Back: the topmost layer closes, the screen only when no
  // sheet is open.
  useEscapeTrigger(() => {
    if (creating) {
      if (!savingRef.current) {
        setCreating(false);
        setCreateError(null);
      }
      return;
    }
    if (editingName !== null) {
      if (!savingRef.current) {
        setEditingName(null);
        setSaveError(null);
      }
      return;
    }
    onClose();
  });

  const needle = query.trim().toLowerCase();
  const mappings = allIngredientMappings();
  const names = masterIngredientNames().filter((name) => {
    if (needle === '') return true;
    if (name.toLowerCase().includes(needle)) return true;
    const entry = mappings[name];
    return (
      (entry?.singular?.toLowerCase().includes(needle) ?? false) ||
      (entry?.plural?.toLowerCase().includes(needle) ?? false)
    );
  });

  /** The entry behind the open sheet, or undefined if the registry changed. */
  const editingEntry = editingName === null ? undefined : mappingsFor(editingName);

  /** Opens one entry's sheet with a clean error state. */
  const openEntry = (name: string): void => {
    setSaveError(null);
    setEditingName(name);
  };

  /**
   * Persists the sheet's validated values and reports the outcome. On success
   * the sheet closes and the app-root notice offers the previous state back;
   * on failure the sheet stays open with the German reason. The write path is
   * shared with the recipe editor's „Stammdaten bearbeiten“ action, so both
   * surfaces persist the ingredient and its shopping item identically.
   */
  const saveEntry = async (input: IngredientMasterSheetUpdate): Promise<void> => {
    if (editingName === null || savingRef.current) return;
    const name = editingName;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await updateIngredientMasterAndShopping(
        {
          token,
          showSnackbar,
          onChanged: () => setRevision((current) => current + 1),
        },
        name,
        input,
      );
      setEditingName(null);
    } catch (err) {
      setSaveError(reasonOf(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Creates a new ingredient and, when the form names a shopping item, writes
   * the route/synonyms to that item. The shopping write runs first: a row
   * without an ingredient is valid master data and a retry overwrites it, while
   * an ingredient without its row is the state the create form's „Einkauf“
   * field exists to prevent. If the ingredient write then fails, the shopping
   * change is rolled back.
   */
  const createEntry = async (
    name: string,
    bu: string,
    reorderPoint: number,
    entries: ReadonlyArray<{ au: string; factor: number }>,
    precision: IngredientMasterEntryInput['precision'],
    stop: ShoppingStop | null,
    variants: readonly string[],
  ): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setCreateError(null);
    const itemKey = findItemKey(name);
    let previousItem: ShoppingItemState | null = null;
    let createdItem = false;
    try {
      if (stop !== null) {
        const item = itemKey === undefined ? undefined : allShoppingItems()[itemKey];
        const itemVariants = itemKey === undefined ? [] : shoppingVariantsFor(itemKey);
        if (item === undefined || !isShoppingUnchanged(item, itemVariants, stop, variants)) {
          const result = await writeShoppingChange(token, name, itemKey, stop, variants);
          previousItem = result.previous;
          createdItem = result.created;
        }
      } else if (variants.length > 0) {
        throw new Error('Ohne Einkaufsort lassen sich keine Synonyme speichern.');
      }

      await appendIngredientMasterData(token, name, bu, reorderPoint, entries, precision);
      setCreating(false);
      setRevision((current) => current + 1);
      showSnackbar({ text: `„${name}“ angelegt.` });
    } catch (err) {
      // Roll the shopping part back when it was written by this attempt and the
      // ingredient write failed afterwards.
      try {
        if (createdItem) {
          await deleteShoppingItem(token, name);
        } else if (itemKey !== undefined && previousItem !== null) {
          await restoreShoppingItem(token, itemKey, previousItem);
        }
      } catch {
        // The create error below is the actionable one.
      }
      setCreateError(reasonOf(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <main className="app app-narrow ingredient-master">
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={onClose}>
          Zurück
        </button>
        <div className="app-header-title">
          <h1>Zutaten</h1>
        </div>
      </header>

      {/* Same search field as the home screen, without its sticky behaviour:
          the header above already stays, and two sticky bars would eat the
          viewport on a phone. */}
      <div className="recipe-search ingredient-master-search">
        <div className="recipe-search-field" role="search">
          <SearchIcon className="recipe-search-icon" />
          <input
            type="search"
            className="recipe-search-input"
            placeholder="Zutat suchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Zutat suchen"
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

      <div className="master-create">
        <button
          type="button"
          className="outlined-button"
          onClick={() => {
            setCreateError(null);
            setCreating(true);
          }}
        >
          <PlusIcon className="button-icon" optical={20} />
          <span>Neue Zutat anlegen</span>
        </button>
      </div>

      {loadWarning !== null && (
        <p className="master-banner" role="alert">
          {`Stammdaten konnten nicht geladen werden — die zuletzt geladenen Daten bleiben sichtbar. (${loadWarning})`}
        </p>
      )}

      {names.length === 0 ? (
        <p className="ingredient-master-empty" role="status">
          {needle === '' ? 'Keine Zutaten in den Stammdaten.' : '—'}
        </p>
      ) : (
        <ul className="ingredient-list">
          {names.map((name) => (
            <li key={name}>
              <button type="button" className="ingredient-row" onClick={() => openEntry(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingName !== null && editingEntry !== undefined && (
        <EditIngredientSheet
          key={editingName}
          name={editingName}
          entry={editingEntry}
          saving={saving}
          error={saveError}
          onSave={(update) => void saveEntry(update)}
          onEdited={() => setSaveError(null)}
          onClose={() => {
            if (savingRef.current) return;
            setEditingName(null);
            setSaveError(null);
          }}
        />
      )}

      {creating && (
        <NewIngredientSheet
          key="new-ingredient"
          initialName=""
          saving={saving}
          error={createError}
          onSave={(name, bu, reorderPoint, entries, precision, stop, variants) =>
            void createEntry(name, bu, reorderPoint, entries, precision, stop, variants)
          }
          onEdited={() => setCreateError(null)}
          onClose={() => {
            if (savingRef.current) return;
            setCreating(false);
            setCreateError(null);
          }}
        />
      )}
    </main>
  );
}

export default IngredientMaster;
