/**
 * Bottom sheet to create a new ingredient in the master data.
 *
 * Opened from the ingredient sheet ("Neue Zutat anlegen") when the typed name
 * is neither in the master data nor an ingredient recipe. It collects the
 * master-data fields (name, base unit g/ml, one factor per known additional
 * unit — Becher / EL / TL) and hands them to the parent, which persists them
 * to the Drive master data (ingredientMasterData.ts). After saving, the
 * ingredient sheet re-appears with the name now valid; the recipe addition is
 * confirmed there separately (decided with the user).
 *
 * Priorities are not collected: the parent assigns 1, 2, … in the order of
 * the known units (Becher, EL, TL) for the filled rows.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import { ADDITIONAL_UNITS, masterIngredientNames } from '@cookbook/core';

/** One filled factor row handed to the parent for persistence. */
export interface NewIngredientEntry {
  au: string;
  factor: number;
}

interface NewIngredientSheetProps {
  /** The typed name from the ingredient sheet (prefilled, editable). */
  initialName: string;
  /** True while the Drive write runs (disables the save button). */
  saving: boolean;
  /** Drive error of the last save attempt (German, from the storage layer). */
  error: string | null;
  /** Called with the master data to create. */
  onSave: (name: string, bu: string, entries: NewIngredientEntry[]) => void;
  onClose: () => void;
}

/** The base unit family options (kg/l exist only in display). */
const BASE_UNITS = ['g', 'ml'] as const;

/**
 * Parses a factor input, tolerating the German decimal comma ("7,5" → 7.5).
 * Returns NaN for empty/invalid input.
 */
function parseFactor(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

/**
 * The bottom sheet with the master-data form (see file header). Renders on
 * top of the ingredient sheet; the backdrop closes it (back to the sheet).
 */
function NewIngredientSheet({
  initialName,
  saving,
  error,
  onSave,
  onClose,
}: NewIngredientSheetProps) {
  const [name, setName] = useState(initialName);
  const [bu, setBu] = useState<'g' | 'ml'>('g');
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  const [factors, setFactors] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmedName = name.trim();

  /** The filled rows in unit order (Becher, EL, TL). */
  const entries: NewIngredientEntry[] = ADDITIONAL_UNITS.map((unit) => ({
    au: unit.name,
    raw: (factors[unit.name] ?? '').trim(),
  }))
    .filter((entry) => entry.raw !== '')
    .map((entry) => ({ au: entry.au, factor: parseFactor(entry.raw) }));

  /** Live summary of what will be saved, e.g. "Basis: g — Becher (400 g)". */
  const summary =
    entries.length === 0
      ? null
      : `Basis: ${bu} — ${entries.map((entry) => `${entry.au} (${entry.factor} ${bu})`).join(', ')}`;

  const handleSave = (): void => {
    if (trimmedName === '') {
      setLocalError('Bitte einen Namen angeben.');
      return;
    }
    if (masterIngredientNames().includes(trimmedName)) {
      setLocalError(`„${trimmedName}“ existiert bereits in der Stammdatenliste.`);
      return;
    }
    if (entries.length === 0) {
      setLocalError('Bitte mindestens eine Umrechnung angeben.');
      return;
    }
    for (const entry of entries) {
      if (!Number.isFinite(entry.factor) || entry.factor <= 0) {
        setLocalError(`Der Faktor für „${entry.au}“ muss eine positive Zahl sein.`);
        return;
      }
    }
    setLocalError(null);
    onSave(trimmedName, bu, entries);
  };

  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={saving ? undefined : onClose}
        role="presentation"
        aria-hidden={saving}
      />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Neue Zutat anlegen">
        <h3 className="sheet-title">Neue Zutat anlegen</h3>
        <p className="sheet-subtitle">
          Legt die Zutat in der Stammdatenliste an (zutaten-stammdaten.csv in deinem
          Cookbook-Ordner). Danach kannst du sie zum Rezept hinzufügen.
        </p>

        <label className="field">
          <span className="field-label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </label>

        <div className="field">
          <span className="field-label">Basis-Einheit</span>
          <div className="segmented" role="radiogroup" aria-label="Basis-Einheit">
            {BASE_UNITS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={bu === option}
                className={bu === option ? 'segmented-active' : undefined}
                onClick={() => setBu(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Umrechnungen — Menge pro Einheit (mindestens eine)</span>
          {ADDITIONAL_UNITS.map((unit) => (
            <label className="factor-row" key={unit.name}>
              <span className="factor-unit">{unit.name}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="z. B. 250"
                value={factors[unit.name] ?? ''}
                onChange={(event) =>
                  setFactors((current) => ({ ...current, [unit.name]: event.target.value }))
                }
              />
              <span className="factor-base">{bu}</span>
            </label>
          ))}
        </div>

        {summary !== null && <p className="aqs-preview">{summary}</p>}

        {(localError ?? error) !== null && (
          <p className="field-error" role="alert">
            {localError ?? error}
          </p>
        )}

        <div className="sheet-actions">
          <button type="button" className="text-button" onClick={onClose} disabled={saving}>
            Abbrechen
          </button>
          <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </>
  );
}

export default NewIngredientSheet;
