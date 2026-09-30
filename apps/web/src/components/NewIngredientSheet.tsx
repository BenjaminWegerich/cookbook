/**
 * Bottom sheet to create a new ingredient in the master data.
 *
 * Opened from the ingredient sheet ("Neue Zutat anlegen") when the typed name
 * is neither in the master data nor an ingredient recipe. It collects the
 * master-data fields (name, base unit g/ml, the reorder point, the shopping
 * stop, and an optional factor + priority per known additional unit — Becher /
 * EL / TL; the mappings are all optional: an ingredient without additional
 * units is valid) and hands them to the parent, which persists them to the
 * Drive master data (ingredientMasterData.ts +
 * shoppingRouteMasterData.ts). After saving, the ingredient sheet re-appears
 * with the name now valid; the recipe addition is confirmed there separately
 * (decided with the user).
 *
 * The „Einkauf“ field (docs/storage_format.md §10) asks where the ingredient is
 * bought: level 1 (the store, „Markt“ in the UI) is picked with one tap on a
 * chip, level 2 (the section, „Bereich“ in the UI) from a search field with the
 * chosen store's sections listed below it (decided with the user). Both values
 * are mandatory — a section belongs to exactly one store, and a stop that the
 * route does not contain would fail the next master-data load — unless the route
 * holds no stops at all: then there is nothing to choose, the sheet says so and
 * the ingredient is created without a shopping stop (decided with the user).
 *
 * The reorder point is picked with the same QuantityPicker as a recipe quantity
 * (suggested chips + stepper) and previewed as the ingredient line it will
 * produce. The preview resolves against the *unsaved* mapping rows of this form,
 * so adding a Becher mapping updates the line immediately; an exact unit snaps
 * the stored value to its amount (core resolveReorderPoint,
 * docs/storage_format.md §9). Its default is 0 ("only ever bought for a
 * recipe"); "∞" selects infinite stock.
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
  masterIngredientNames,
  mappingsFor,
  resolveReorderPoint,
  shoppingSections,
  shoppingStores,
  type ShoppingStop,
} from '@cookbook/core';

import QuantityPicker from './QuantityPicker';

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
  /** Called with the master data to create; `reorderPoint` is the resolved
   *  value (already snapped to an exact unit's amount) and `stop` is the chosen
   *  shopping stop, or null while the route holds no stops at all. */
  onSave: (
    name: string,
    bu: string,
    reorderPoint: number,
    entries: NewIngredientEntry[],
    stop: ShoppingStop | null,
  ) => void;
  /** Called when the user edits any form field — the parent forgets the
   *  stale Drive error of the last attempt (its cause may be gone now). */
  onEdited: () => void;
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
 * The exact German message a save attempt would report for the current form:
 * empty/duplicate name first, then the first invalid mapping row. It is the
 * single source of truth for both the save attempt and the live error text.
 */
function currentSaveErrorMessage(name: string, rows: MappingRow[]): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Bitte einen Namen angeben.';
  }
  if (masterIngredientNames().includes(trimmed)) {
    return `„${trimmed}“ existiert bereits in der Stammdatenliste.`;
  }
  return validateRows(rows);
}

/**
 * Validates the „Einkauf“ field against the route the app currently holds.
 * Returns a German error message, or null when the form can be saved.
 *
 * Both values are mandatory because the assignment file must name a stop of the
 * route (docs/storage_format.md §10) — a free-typed section could silently pair
 * a section with the wrong store. The one exception is a route without a single
 * stop: nothing can be picked then, so the ingredient is saved without a
 * shopping stop (decided with the user).
 *
 * The messages name level 1 „Markt“ and level 2 „Bereich“, the UI's words for
 * them; the data model and the CSV columns keep the English names `Store` and
 * `Section` (decided with the user).
 */
function validateShoppingStop(
  stores: readonly string[],
  store: string | null,
  sections: readonly string[],
  sectionQuery: string,
): string | null {
  if (stores.length === 0) {
    return null;
  }
  if (store === null) {
    return 'Bitte einen Markt auswählen.';
  }
  const section = sectionQuery.trim();
  if (section === '') {
    return `Bitte einen Bereich für „${store}“ auswählen.`;
  }
  if (!sections.includes(section)) {
    return `„${section}“ steht nicht im Einkaufsweg für „${store}“ — bitte einen der angebotenen Bereiche wählen.`;
  }
  return null;
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
  onEdited,
  onClose,
}: NewIngredientSheetProps) {
  const [name, setName] = useState(initialName);
  const [bu, setBu] = useState<'g' | 'ml'>('g');
  /** The reorder point: a base-unit quantity, 0 (the default), or Infinity. */
  const [reorderPoint, setReorderPoint] = useState(0);
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  const [factors, setFactors] = useState<Record<string, string>>({});
  /** Priority inputs keyed by additional-unit name; empty string = not set. */
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  /** The copy-source autocomplete text ("" = nothing typed); applying resets it. */
  const [copyQuery, setCopyQuery] = useState('');
  /** The chosen store — level 1 of the shopping route; null = nothing picked. */
  const [store, setStore] = useState<string | null>(null);
  /**
   * The section input text — level 2 of the shopping route. It is the picked
   * section only while it names one of the chosen store's sections exactly
   * (see validateShoppingStop); the field is a search field, not a free-text one.
   */
  const [sectionQuery, setSectionQuery] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmedName = name.trim();

  /**
   * Whether the name input takes the focus when the sheet opens. On smartphones
   * a focused input pops up the on-screen keyboard and hides the form, so the
   * field is only focused when it is empty: this sheet is normally reached via
   * "Neue Zutat anlegen", which always hands over the already typed name — an
   * empty field therefore only happens in a genuinely blank create flow.
   */
  const focusNameOnOpen = initialName.trim() === '';

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

  /**
   * The rows that would actually be saved (a finite positive factor and a
   * positive-integer priority). The reorder-point preview resolves against
   * exactly these, so a half-typed row neither shows up in the preview nor
   * changes the stored value.
   */
  const validEntries = entries.filter(
    (entry) =>
      Number.isFinite(entry.factor) &&
      entry.factor > 0 &&
      Number.isInteger(entry.priority) &&
      entry.priority > 0,
  );

  /**
   * The draft master-data entry the preview resolves against: the base unit and
   * the not-yet-saved mapping rows of this form (resolveReorderPoint reads the
   * mappings from its argument, so the ingredient need not exist in the
   * registry yet).
   */
  const draftEntry = { bu, entries: validEntries };

  /**
   * The reorder point as it will read and be stored. An exact unit snaps the
   * stored value to its amount (a 160 g Becher turns a selected 150 g into
   * 160 g); the preview uses the draft mappings, so an AU row added below
   * updates the line immediately.
   */
  const reorder = resolveReorderPoint(trimmedName, draftEntry, reorderPoint, bu);

  /**
   * The shopping route as the app currently holds it (core registry, read every
   * render like the ingredient list above): the store chips and — once a store
   * is picked — the section options of exactly that store.
   */
  const stores = shoppingStores();
  const sections = store === null ? [] : shoppingSections(store);
  const section = sectionQuery.trim();

  /**
   * The stop to hand to the parent: the picked pair, or null while the route
   * holds no stops at all (nothing can be picked then, and the ingredient is
   * created without a shopping stop — decided with the user).
   */
  const chosenStop: ShoppingStop | null =
    store !== null && sections.includes(section) ? { store, section } : null;

  /** The message the „Einkauf“ field would report for the current state. */
  const shoppingError = validateShoppingStop(stores, store, sections, sectionQuery);

  /**
   * The options listed under the section field: every section of the chosen
   * store while nothing is typed, so the options are visible without typing
   * (decided with the user — a search field with the list below it, not a
   * collapsed dropdown); the matching ones while a part is typed; none once the
   * text names a section exactly — the list is then empty because the pick
   * moved into the field, not because nothing was found.
   */
  const sectionSuggestions = sections.includes(section)
    ? []
    : sections.filter((candidate) => candidate.toLowerCase().includes(section.toLowerCase()));

  /**
   * The message of the last failed save attempt, shown only while the current
   * form would still produce exactly that message. Deriving it every render
   * (instead of clearing it on input events) makes the error disappear the
   * moment its cause is resolved — typing a still-invalid value keeps it, a
   * different problem is only announced by the next save attempt. The order is
   * the form's order: name, mapping rows, then the „Einkauf“ field.
   */
  const saveErrorNow = currentSaveErrorMessage(trimmedName, mappingRows) ?? shoppingError;
  const shownLocalError = localError !== null && localError === saveErrorNow ? localError : null;

  /** Reports a form edit to the parent (drops the stale Drive error). */
  const markEdited = (): void => onEdited();

  /**
   * Picks a store. A section belongs to exactly one store, so a section picked
   * for the previous store is cleared — it would otherwise read as a valid
   * choice while naming a section the new store does not have.
   */
  const chooseStore = (next: string): void => {
    setStore(next);
    setSectionQuery('');
    markEdited();
  };

  /** Adopts a section option into the search field (same tap-to-apply as the
   *  suggestion lists of the ingredient sheet). */
  const adoptSection = (next: string): void => {
    setSectionQuery(next);
    markEdited();
  };

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
    markEdited();
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

  /**
   * Validates and saves. On failure the exact message is stored; it stays
   * visible only while the form would still produce it (see `shownLocalError`)
   * and disappears the moment its cause is fixed.
   */
  const handleSave = (): void => {
    if (saveErrorNow !== null) {
      setLocalError(saveErrorNow);
      return;
    }
    setLocalError(null);
    onSave(trimmedName, bu, reorder.storedValue, entries, chosenStop);
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
            onChange={(event) => {
              setName(event.target.value);
              markEdited();
            }}
            autoFocus={focusNameOnOpen}
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
                onClick={() => {
                  setBu(option);
                  markEdited();
                }}
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
                onChange={(event) => {
                  setFactors((current) => ({ ...current, [unit.name]: event.target.value }));
                  markEdited();
                }}
              />
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${unit.name}: Priorität`}
                value={priorities[unit.name] ?? ''}
                onChange={(event) => {
                  setPriorities((current) => ({ ...current, [unit.name]: event.target.value }));
                  markEdited();
                }}
              />
            </div>
          ))}
        </div>

        {/* The reorder point: what is on the shelf after a shopping trip. Same
            picker as a recipe quantity (chips + stepper), plus 0 and ∞; the
            preview below resolves against the mapping rows above — unsaved. */}
        <div className="field">
          <span className="field-label">Vorrat</span>
          <QuantityPicker
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

        {/* The line the reorder number will produce: it sits directly under
            „Vorrat“, whose value it shows as the ingredient line, in the same
            small caption style as the „Bereich“ line inside „Einkauf“ below
            (decided with the user). */}
        <div className="field">
          <p className="field-hint">Vorschau</p>
          <p className="aqs-preview" aria-live="polite">
            {reorder.preview}
          </p>
        </div>

        {/* Where the ingredient is bought (docs/storage_format.md §10): level 1
            the store („Markt“ in the UI, one tap on a chip), level 2 the section
            („Bereich“ in the UI) as a search field with that store's sections
            listed below (decided with the user). A route without a single stop
            cannot be picked from: the sheet says so and saves the ingredient
            without a shopping stop. */}
        <div className="field">
          <span className="field-label">Einkauf</span>

          {stores.length === 0 ? (
            <p className="field-hint">
              Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — die Zutat wird ohne Einkaufsort
              gespeichert.
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
                  >
                    {candidate}
                  </button>
                ))}
              </div>

              {/* The section field follows the store: without a store there is no
                  option to offer, and a section belongs to exactly one store. */}
              {store !== null && (
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
                    placeholder="Suchen oder wählen"
                  />
                  {sectionSuggestions.length > 0 && (
                    <ul className="suggestions">
                      {sectionSuggestions.map((candidate) => (
                        <li key={candidate}>
                          <button type="button" onClick={() => adoptSection(candidate)}>
                            {candidate}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Nothing matches the typed text: a quiet report instead of a
                      blank area, so the field never looks broken. Suppressed
                      while the field names a section exactly — the list is empty
                      because the pick moved into the field, not because nothing
                      was found (same wording pattern as the recipe search). */}
                  {section !== '' &&
                    !sections.includes(section) &&
                    sectionSuggestions.length === 0 && (
                      <p className="field-hint" role="status">
                        {`Keinen Bereich „${section}“ in „${store}“ gefunden.`}
                      </p>
                    )}
                </>
              )}
            </>
          )}
        </div>

        {(shownLocalError ?? error) !== null && (
          <p className="field-error" role="alert">
            {shownLocalError ?? error}
          </p>
        )}

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

export default NewIngredientSheet;
