/**
 * Bottom sheet to create a new ingredient in the master data.
 *
 * Opened from the ingredient sheet ("Neue Zutat anlegen") when the typed name
 * is neither in the master data nor an ingredient recipe. It collects the
 * master-data fields (name, base unit g/ml, and an optional factor + priority
 * per known additional unit — Becher / EL / TL; all optional: an ingredient
 * without additional units is valid) and hands them to the parent, which
 * persists them to the Drive master data (ingredientMasterData.ts). After
 * saving, the ingredient sheet re-appears with the name now valid; the recipe
 * addition is confirmed there separately (decided with the user).
 *
 * Every mapping carries an explicit priority (1 = most preferred, unique per
 * ingredient, §7 of the AQS spec). As a convenience the mappings of an
 * existing ingredient with the same base-unit family can be copied in as a
 * starting point ("Von bekannter Zutat übernehmen", a text-autocomplete like
 * the ingredient sheet's name selector) and then edited / extended — factors
 * are expressed in the ingredient's own base unit, so only same-family
 * sources are offered.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import {
  ADDITIONAL_UNITS,
  NNBSP,
  formatDecimal,
  masterIngredientNames,
  mappingsFor,
} from '@cookbook/core';

/** One filled mapping row handed to the parent for persistence. */
export interface NewIngredientEntry {
  au: string;
  factor: number;
  /** Positive integer, unique per ingredient; 1 = most preferred. */
  priority: number;
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
 * Parses a priority input. Returns NaN for empty/invalid input; non-integer
 * values ("2,5") stay non-integers so the validation can reject them.
 */
function parsePriority(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

/** One mapping row of the form: the raw factor + priority of one AU. */
interface MappingRow {
  au: string;
  /** The trimmed factor input; "" = row skipped. */
  factorRaw: string;
  /** The trimmed priority input; "" = not yet entered. */
  priorityRaw: string;
}

/**
 * Validates the filled mapping rows. Returns a German error message, or null
 * when the rows are ready to save.
 */
function validateRows(rows: MappingRow[]): string | null {
  const priorityByAu = new Map<number, string>();
  for (const row of rows) {
    if (row.factorRaw === '') {
      // Skipped row; a priority without a factor is a user mistake worth flagging.
      if (row.priorityRaw !== '') {
        return `Bitte für „${row.au}“ auch einen Faktor angeben (Priorität ist bereits gesetzt).`;
      }
      continue;
    }
    const factor = parseFactor(row.factorRaw);
    if (!Number.isFinite(factor) || factor <= 0) {
      return `Der Faktor für „${row.au}“ muss eine positive Zahl sein.`;
    }
    if (row.priorityRaw === '') {
      return `Bitte eine Priorität für „${row.au}“ angeben (1 = bevorzugt).`;
    }
    const priority = parsePriority(row.priorityRaw);
    if (!Number.isInteger(priority) || priority <= 0) {
      return `Die Priorität für „${row.au}“ muss eine positive ganze Zahl sein.`;
    }
    const existing = priorityByAu.get(priority);
    if (existing !== undefined) {
      return `„${existing}“ und „${row.au}“ haben beide die Priorität ${priority} — jede Umrechnung braucht eine eindeutige Priorität.`;
    }
    priorityByAu.set(priority, row.au);
  }
  return null;
}

/**
 * Builds the live summary line of what will be saved, e.g. "Basis: ml — EL (15 ml),
 * TL (5 ml)". Only fully valid rows are shown, so a half-typed row never renders
 * as "NaN"; save-time validation still reports the offending row. Number and
 * unit in the factors are joined with a narrow no-break space (NNBSP) like all
 * quantity displays (docs/CODING_CONVENTIONS.md).
 */
function buildSummary(bu: string, entries: NewIngredientEntry[]): string | null {
  const valid = entries.filter(
    (entry) =>
      Number.isFinite(entry.factor) &&
      entry.factor > 0 &&
      Number.isInteger(entry.priority) &&
      entry.priority > 0,
  );
  if (valid.length === 0) {
    return null;
  }
  return `Basis: ${bu} — ${valid
    .map((entry) => `${entry.au} (${formatDecimal(entry.factor)}${NNBSP}${bu})`)
    .join(', ')}`;
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
  /** Priority inputs keyed by additional-unit name; empty string = not set. */
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  /** The copy-source autocomplete text ("" = nothing typed); applying resets it. */
  const [copyQuery, setCopyQuery] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmedName = name.trim();

  /**
   * Ingredients whose mappings can be copied: master-data ingredients with at
   * least one mapping and the same base-unit family as the current selection
   * (factors are expressed in the ingredient's own base unit, so copying
   * across g/ml would produce meaningless numbers). Re-read every render so a
   * just-created ingredient appears once it is registered.
   */
  const copyCandidates = masterIngredientNames().filter((candidate) => {
    if (candidate.toLowerCase() === trimmedName.toLowerCase()) {
      return false;
    }
    const entry = mappingsFor(candidate);
    return entry !== undefined && entry.bu === bu && entry.entries.length > 0;
  });

  /** The filled rows in AU order (Becher, EL, TL). */
  const mappingRows: MappingRow[] = ADDITIONAL_UNITS.map((unit) => ({
    au: unit.name,
    factorRaw: (factors[unit.name] ?? '').trim(),
    priorityRaw: (priorities[unit.name] ?? '').trim(),
  }));

  /**
   * The rows that carry a mapping, in the order the parent will persist them
   * (ascending priority — matches the registry invariant).
   */
  const entries: NewIngredientEntry[] = mappingRows
    .filter((row) => row.factorRaw !== '')
    .map((row) => ({
      au: row.au,
      factor: parseFactor(row.factorRaw),
      priority: parsePriority(row.priorityRaw),
    }))
    .sort((a, b) => a.priority - b.priority);

  const summary = buildSummary(bu, entries);

  /** Copies the mappings of `source` into the form (AU rows are overwritten). */
  const applyCopy = (source: string): void => {
    const entry = mappingsFor(source);
    if (entry === undefined) {
      return;
    }
    const nextFactors = { ...factors };
    const nextPriorities = { ...priorities };
    for (const mapping of entry.entries) {
      nextFactors[mapping.au] = String(mapping.factor);
      nextPriorities[mapping.au] = String(mapping.priority);
    }
    setFactors(nextFactors);
    setPriorities(nextPriorities);
    setLocalError(null);
  };

  /**
   * Adopts a copy suggestion: fills the AU rows from that ingredient and
   * clears the autocomplete, mirroring the ingredient selector of the
   * ingredient sheet (typed text + suggestion list, tap to apply).
   */
  const adoptCopy = (candidate: string): void => {
    applyCopy(candidate);
    setCopyQuery('');
  };

  /** Suggestion list of the copy autocomplete (same matching as the
   *  ingredient selector: case-insensitive substring, capped at 6). */
  const copyNeedle = copyQuery.trim().toLowerCase();
  const copySuggestions =
    copyNeedle === ''
      ? []
      : copyCandidates
          .filter((candidate) => candidate.toLowerCase().includes(copyNeedle))
          .slice(0, 6);

  const handleSave = (): void => {
    if (trimmedName === '') {
      setLocalError('Bitte einen Namen angeben.');
      return;
    }
    if (masterIngredientNames().includes(trimmedName)) {
      setLocalError(`„${trimmedName}“ existiert bereits in der Stammdatenliste.`);
      return;
    }
    const rowError = validateRows(mappingRows);
    if (rowError !== null) {
      setLocalError(rowError);
      return;
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
          <span className="field-label">Verknüpfungen mit Zusatz-Einheiten</span>

          {copyCandidates.length > 0 && (
            <>
              <p className="field-hint">Von bekannter Zutat übernehmen:</p>
              <input
                type="text"
                value={copyQuery}
                onChange={(event) => setCopyQuery(event.target.value)}
                aria-label="Von bekannter Zutat übernehmen"
              />
              {copySuggestions.length > 0 && (
                <ul className="suggestions">
                  {copySuggestions.map((candidate) => (
                    <li key={candidate}>
                      <button type="button" onClick={() => adoptCopy(candidate)}>
                        {candidate}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <p className="field-hint">Manuell anpassen:</p>
          <div className="factor-head" aria-hidden="true">
            <span />
            <span>Menge [{bu}]</span>
            <span>Priorität</span>
          </div>
          {ADDITIONAL_UNITS.map((unit) => (
            <div className="factor-row" key={unit.name}>
              <span className="factor-unit">{unit.name}</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${unit.name}: Menge in ${bu}`}
                value={factors[unit.name] ?? ''}
                onChange={(event) =>
                  setFactors((current) => ({ ...current, [unit.name]: event.target.value }))
                }
              />
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${unit.name}: Priorität`}
                value={priorities[unit.name] ?? ''}
                onChange={(event) =>
                  setPriorities((current) => ({ ...current, [unit.name]: event.target.value }))
                }
              />
            </div>
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
