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
 * Tapping a row opens `EditIngredientSheet`. Saving goes through
 * `updateIngredientMasterData` (read the authoritative pair, replace exactly
 * this entry, round-trip check, write both files). The success notice at the
 * app root offers „Rückgängig“, which writes the entry's previous state back.
 *
 * Search matches the canonical name and both display forms, so a user can find
 * „Karotten“ by typing „Karotte“. A search without a match is the expected
 * outcome and shows the bare em dash (DESIGN §6.3); no result never hides the
 * field that names the term.
 *
 * The screen is a *place* (DESIGN §6.1): its header carries „Zurück“ and stays
 * sticky; the edit sheet is a *change* and answers „Abbrechen“. Browser Back
 * and Escape close the topmost layer — first the sheet, then the screen — and
 * the screen refreshes the master data when it opens, so a spreadsheet edit made
 * in Drive in the meantime is what the user sees.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

import {
  allIngredientMappings,
  masterIngredientNames,
  mappingsFor,
  type IngredientEntry,
} from '@cookbook/core';

import EditIngredientSheet from './EditIngredientSheet';
import { CloseIcon, SearchIcon, UndoIcon } from './icons';
import {
  loadIngredientMasterData,
  updateIngredientMasterData,
  type IngredientMasterEntryInput,
} from '../drive/ingredientMasterData';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import type { SnackbarMessage } from '../hooks/useSnackbar';
import '../styles/ingredient-master.css';

/**
 * Imperative handle App uses for the browser Back button: Back must close the
 * open edit sheet first and only the next Back leave the screen.
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

/**
 * True when the sheet's values equal the entry as the registry holds it. A save
 * without a change is a no-op: it closes the sheet without a write and without
 * a notice (DESIGN §5.1), so the undo of an earlier, unrelated save is not
 * buried under a pointless new one.
 */
function isUnchanged(entry: IngredientEntry, update: IngredientMasterEntryInput): boolean {
  if ((entry.singular ?? null) !== update.singular) return false;
  if ((entry.plural ?? null) !== update.plural) return false;
  if (entry.reorderPoint !== update.reorderPoint) return false;
  if (entry.entries.length !== update.entries.length) return false;
  return entry.entries.every((mapping, index) => {
    const next = update.entries[index];
    return (
      next !== undefined &&
      mapping.au === next.au &&
      mapping.factor === next.factor &&
      mapping.priority === next.priority
    );
  });
}

/**
 * The „Zutaten“ screen (see file header). It owns the search, the selected
 * entry and the save/undo cycle; the sheet owns its form values.
 */
function IngredientMaster({ token, onClose, showSnackbar, ref }: IngredientMasterProps) {
  const [query, setQuery] = useState('');
  /** The name of the entry whose sheet is open, or null. */
  const [editingName, setEditingName] = useState<string | null>(null);
  /** True while a save/undo write runs; the sheet keeps its contents then. */
  const [saving, setSaving] = useState(false);
  /**
   * Synchronous mirror of `saving`. A double tap (or a tap racing the shortcut)
   * can arrive before React has re-rendered the disabled button; the ref is what
   * actually keeps the second write from starting, and it also protects the
   * sheet from a Back/Escape that lands in that same window.
   */
  const savingRef = useRef(false);
  /** Drive error of the last failed save (German), shown in the sheet. */
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
  // last loaded data (or the built-in seed), so the list is usable immediately;
  // this only makes an external spreadsheet edit visible. A failure is a quiet
  // warning: saves re-read the authoritative pair themselves and refuse corrupt
  // files, so the visible list can never be written over bad data.
  useEffect(() => {
    mountedRef.current = true;
    void loadIngredientMasterData(token)
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
  // save's form.
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
   * on failure the sheet stays open with the German reason.
   */
  const saveEntry = async (update: IngredientMasterEntryInput): Promise<void> => {
    if (editingName === null || savingRef.current) return;
    const name = editingName;
    // No value changed: the enabled „Speichern“ is a no-op that closes the sheet
    // without a write and without a notice (§5.1). The sheet's values were
    // initialized from this entry, so an unchanged form is a genuine no-op.
    const current = mappingsFor(name);
    if (current !== undefined && isUnchanged(current, update)) {
      setEditingName(null);
      setSaveError(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const { previous } = await updateIngredientMasterData(token, name, update);
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
              await updateIngredientMasterData(token, name, {
                singular: previous.singular ?? null,
                plural: previous.plural ?? null,
                reorderPoint: previous.reorderPoint,
                entries: previous.entries,
              });
              setRevision((current) => current + 1);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              showSnackbar({
                tone: 'error',
                text: `„${name}“ konnte nicht zurückgesetzt werden. ${reason}`,
              });
            }
          },
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
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
    </main>
  );
}

export default IngredientMaster;
