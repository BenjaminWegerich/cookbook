/**
 * Bottom sheet to edit one ingredient's master data.
 *
 * Opened by tapping a row of the „Zutaten“ screen. It changes the fields that
 * are safe to change on an existing entry:
 * - the optional Singular/Plural display forms (the pair is atomic);
 * - the reorder point („Vorrat“), with the same picker and the same live
 *   preview as the create sheet;
 * - the additional-unit mappings (a factor per unit; no per-ingredient priority);
 * - the optional ingredient-level tolerance (five chips).
 *
 * The canonical name and the base unit are deliberately not fields. Recipes,
 * inline mentions and the mappings file key on the name; the base unit decides
 * how every stored quantity is read. Changing either is a collection-wide
 * operation with its own transaction, not an edit of one row. The sheet names
 * the name as its subtitle and shows the base unit with it, so the user always
 * knows which identity is being edited.
 *
 * The shopping stop („Einkauf“) is not part of this sheet: it belongs to the
 * shopping master data, which gets its own management surface. A save therefore
 * writes only the two ingredient CSV files.
 *
 * Validation follows the shared create/edit rules in `ingredientMasterForm.ts`.
 * Errors stay at their field; a Drive failure is shown as a banner above the
 * fields and the sheet stays open. `Ctrl+S` saves.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useRef, useState } from 'react';

import { resolveReorderPoint, type IngredientEntry } from '@cookbook/core';

import IngredientMappingsField from './IngredientMappingsField';
import QuantityInput from './QuantityInput';
import ToleranceChips from './ToleranceChips';
import {
  buildMappingRows,
  displayFormsFromValues,
  mappingEntriesFromRows,
  mappingFormFromEntry,
  validateDisplayForms,
  validateMappingRows,
} from './ingredientMasterForm';
import type { IngredientMasterEntryInput } from '../drive/ingredientMasterData';
import { useSaveShortcut } from '../hooks/useSaveShortcut';

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
  onSave: (update: IngredientMasterEntryInput) => void;
  /** Called when the user edits any field — the parent forgets a stale Drive error. */
  onEdited: () => void;
  onClose: () => void;
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
}: EditIngredientSheetProps) {
  /**
   * The base unit is narrowed here because the parser guarantees g/ml; the
   * picker and the grid use the same value the reorder point is stored in.
   */
  const bu: 'g' | 'ml' = entry.bu === 'ml' ? 'ml' : 'g';

  const [singular, setSingular] = useState(entry.singular ?? '');
  const [plural, setPlural] = useState(entry.plural ?? '');
  const [reorderPoint, setReorderPoint] = useState(entry.reorderPoint);
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  const [factors, setFactors] = useState<Record<string, string>>(
    () => mappingFormFromEntry(entry).factors,
  );
  /** Ingredient-level tolerance; undefined = inherit the recipe / global value. */
  const [tolerance, setTolerance] = useState<number | undefined>(entry.tolerance);
  /**
   * True after the first failed save attempt. Before it, the form is pristine
   * (the entry is valid by construction), so no error is shown; after it, the
   * messages update live while the user fixes their cause.
   */
  const [attempted, setAttempted] = useState(false);

  /** The first invalid display-form input, for the focus move on a failed save. */
  const singularInputRef = useRef<HTMLInputElement>(null);
  const pluralInputRef = useRef<HTMLInputElement>(null);
  /** The mapping group, focused when its rows hold the first problem. */
  const mappingFieldRef = useRef<HTMLDivElement>(null);

  const rows = buildMappingRows(factors);
  const displayError = validateDisplayForms(singular, plural);
  const mappingError = validateMappingRows(rows);
  const showDisplayError = attempted && displayError !== null;
  const showMappingError = attempted && mappingError !== null;
  /**
   * The banner for a form with several problems (DESIGN §5.3): the field
   * messages name each one, the banner says that more than one field needs
   * attention. One field alone stays at its field, without a banner.
   */
  const showSummary = showDisplayError && showMappingError;

  /**
   * The rows that would actually be saved (a finite positive factor). The
   * preview resolves against exactly these, so a half-typed row neither shows
   * up in the preview nor changes the value.
   */
  const entries = mappingEntriesFromRows(rows).filter(
    (entry_) => Number.isFinite(entry_.factor) && entry_.factor > 0,
  );

  /**
   * The draft entry the preview resolves against: the unsaved display forms and
   * the valid mapping rows of this form, so a corrected pair or a new factor is
   * visible immediately (resolveReorderPoint reads the mappings from its
   * argument rather than from the registry).
   */
  const draftEntry = {
    bu,
    singular: singular.trim() === '' ? undefined : singular.trim(),
    plural: plural.trim() === '' ? undefined : plural.trim(),
    entries,
    ...(tolerance !== undefined ? { tolerance } : {}),
  };

  /** The reorder point as it will read and be stored (exact units snap it). */
  const reorder = resolveReorderPoint(name, draftEntry, reorderPoint, bu);

  /** Reports a form edit to the parent, which drops a stale Drive error. */
  const markEdited = (): void => onEdited();

  /**
   * Validates and saves. A failure shows the field errors and moves focus to the
   * first problem; the form's values stay untouched, so the user can correct
   * one thing without losing the rest.
   */
  const handleSave = (): void => {
    // A write is already running: the button is disabled then, and the shortcut
    // must honour the same state (a second in-flight write would race the first).
    if (saving) return;
    if (displayError !== null || mappingError !== null) {
      setAttempted(true);
      if (displayError !== null) {
        // The pair is half-filled: focus the empty side, which is the one the
        // user still has to fill (or clear the other side to drop both).
        if (singular.trim() === '') {
          singularInputRef.current?.focus();
        } else {
          pluralInputRef.current?.focus();
        }
      } else {
        mappingFieldRef.current?.focus();
      }
      return;
    }
    setAttempted(false);
    const forms = displayFormsFromValues(singular, plural);
    onSave({
      singular: forms.singular,
      plural: forms.plural,
      reorderPoint: reorder.storedValue,
      entries,
      tolerance,
    });
  };

  // Ctrl+S is the keyboard equivalent of the „Speichern“ button. The sheet is
  // only ever mounted while it is the topmost layer, so the shortcut is enabled.
  useSaveShortcut(handleSave);

  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={saving ? undefined : onClose}
        role="presentation"
        aria-hidden={saving}
      />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Zutat bearbeiten">
        {/* The name is the entry's identity, so it heads the sheet instead of
            sitting in a fake read-only field. The base unit travels with it,
            because the factors and the stock value are expressed in it. */}
        <div className="sheet-head">
          <h3 className="sheet-title">Zutat bearbeiten</h3>
          <p className="sheet-subtitle">
            {name} · {bu}
          </p>
        </div>

        {/* A Drive failure belongs to no field: it is the save itself that
            failed, so it is reported once above the form (DESIGN §5.3). */}
        {error !== null && (
          <p className="master-banner" role="alert">
            {error}
          </p>
        )}

        {showSummary && (
          <p className="master-banner" role="alert">
            Bitte die markierten Felder prüfen.
          </p>
        )}

        <fieldset className="field display-form-field">
          <legend className="field-label">
            Anzeigeform <span className="optional-mark">(optional)</span>
          </legend>
          <label className="field">
            <span className="field-label">Singular</span>
            <input
              ref={singularInputRef}
              type="text"
              value={singular}
              aria-invalid={showDisplayError || undefined}
              aria-describedby={showDisplayError ? 'display-form-error' : undefined}
              onChange={(event) => {
                setSingular(event.target.value);
                markEdited();
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">Plural</span>
            <input
              ref={pluralInputRef}
              type="text"
              value={plural}
              aria-invalid={showDisplayError || undefined}
              aria-describedby={showDisplayError ? 'display-form-error' : undefined}
              onChange={(event) => {
                setPlural(event.target.value);
                markEdited();
              }}
            />
          </label>
          <p className="field-hint">
            Beide ausfüllen oder beide leer lassen — leer gilt der Name für jede Anzahl.
          </p>
          {showDisplayError && (
            <p className="field-error" id="display-form-error" role="alert">
              {displayError}
            </p>
          )}
        </fieldset>

        {/* The mapping group: the caption names the field, the grid renders one
            row per known unit. A failed save focuses the group, because the
            exact invalid input is one of several rows (the message names it). */}
        <div
          className="field"
          role="group"
          aria-labelledby="mapping-field-label"
          aria-describedby={showMappingError ? 'mapping-error' : undefined}
          tabIndex={-1}
          ref={mappingFieldRef}
        >
          <span className="field-label" id="mapping-field-label">
            Zusatz-Einheiten <span className="optional-mark">(optional)</span>
          </span>
          <p className="field-hint">Menge in {bu}.</p>
          <IngredientMappingsField
            bu={bu}
            factors={factors}
            onFactorChange={(au, value) => {
              setFactors((current) => ({ ...current, [au]: value }));
              markEdited();
            }}
          />
          {showMappingError && (
            <p className="field-error" id="mapping-error" role="alert">
              {mappingError}
            </p>
          )}
        </div>

        {/* Ingredient-level tolerance: a display preference, not a scale. */}
        <div className="field">
          <span className="field-label">Toleranz</span>
          <p className="field-hint">
            Standard erbt die Rezept- bzw. globale Einstellung.
          </p>
          <ToleranceChips
            value={tolerance}
            onChange={(next) => {
              setTolerance(next);
              markEdited();
            }}
            ariaLabel="Toleranz der Zutat"
          />
        </div>

        {/* The reorder point: what is on the shelf after a shopping trip. Same
            picker as the create sheet, with 0 and ∞; the preview below resolves
            against this form's unsaved display forms and mappings. */}
        <div className="field">
          <span className="field-label">Vorrat</span>
          <QuantityInput
            value={reorderPoint}
            onChange={(next) => {
              setReorderPoint(next);
              markEdited();
            }}
            family={bu}
            allowZero
            allowInfinite
          />
        </div>

        <div className="field">
          <p className="field-hint">Vorschau</p>
          <p className="aqs-preview" aria-live="polite">
            {reorder.preview}
          </p>
        </div>

        <div className="sheet-actions">
          <button type="button" className="text-button" onClick={onClose} disabled={saving}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={saving}
            aria-busy={saving}
          >
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </>
  );
}

export default EditIngredientSheet;
