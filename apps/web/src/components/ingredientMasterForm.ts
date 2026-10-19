/**
 * Shared form logic for the ingredient master data.
 *
 * Two surfaces edit the same fields and must validate them identically:
 * - `NewIngredientSheet` („Neue Zutat anlegen“) creates a master-data entry;
 * - `EditIngredientSheet` („Zutat bearbeiten“) changes an existing one.
 *
 * Keeping the parsing, the row model and the German validation messages here
 * means the two sheets can never drift into different rules — the same mistake
 * is worded the same way in both. UI language is German
 * (docs/CODING_CONVENTIONS.md).
 */

import { ADDITIONAL_UNITS, formatDecimal, type IngredientEntry } from '@cookbook/core';

/** One mapping row of a master-data form: the raw factor + priority of one AU. */
export interface MappingRow {
  au: string;
  /** The trimmed factor input; "" = row skipped. */
  factorRaw: string;
  /** The trimmed priority input; "" = not yet entered. */
  priorityRaw: string;
}

/** The two raw input records of a form, keyed by additional-unit name. */
export interface MappingFormState {
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  factors: Record<string, string>;
  /** Priority inputs keyed by additional-unit name; empty string = not set. */
  priorities: Record<string, string>;
}

/** One filled, valid mapping row handed to the persistence layer. */
export interface MappingEntry {
  au: string;
  factor: number;
  /** Positive integer, unique per ingredient; 1 = most preferred. */
  priority: number;
}

/**
 * Parses a factor input. The grid shows the German decimal comma and rewrites
 * a typed dot to it, but the parser still tolerates both spellings; the stored
 * CSV keeps the canonical dot. Returns NaN for empty/invalid input.
 */
export function parseFactor(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

/**
 * Parses a priority input. Returns NaN for empty/invalid input; non-integer
 * values ("2,5") stay non-integers so the validation can reject them.
 */
export function parsePriority(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

/**
 * The form's initial input records for an existing entry: its saved mappings,
 * as the strings the inputs show. Factors are formatted with the German
 * decimal comma (the display-layer rule, docs/CODING_CONVENTIONS.md), so a
 * stored 7.5 reads as "7,5" in the field. An ingredient without additional
 * units yields two empty records, so every known unit starts as a blank row.
 */
export function mappingFormFromEntry(entry: Pick<IngredientEntry, 'entries'>): MappingFormState {
  const factors: Record<string, string> = {};
  const priorities: Record<string, string> = {};
  for (const mapping of entry.entries) {
    factors[mapping.au] = formatDecimal(mapping.factor);
    priorities[mapping.au] = String(mapping.priority);
  }
  return { factors, priorities };
}

/**
 * The filled rows in the order the units are declared (ADDITIONAL_UNITS), which
 * is also the order the grid renders them. A row with no factor is skipped by
 * `mappingEntriesFromRows`; the blank rows exist so the user can fill them.
 */
export function buildMappingRows(
  factors: Record<string, string>,
  priorities: Record<string, string>,
): MappingRow[] {
  return ADDITIONAL_UNITS.map((unit) => ({
    au: unit.name,
    factorRaw: (factors[unit.name] ?? '').trim(),
    priorityRaw: (priorities[unit.name] ?? '').trim(),
  }));
}

/**
 * The rows that carry a mapping, sorted by ascending priority (the registry
 * invariant, see additionalUnitsData.ts). A row whose factor is empty is not a
 * mapping and is left out; the caller validates the rows before saving.
 */
export function mappingEntriesFromRows(rows: readonly MappingRow[]): MappingEntry[] {
  return rows
    .filter((row) => row.factorRaw !== '')
    .map((row) => ({
      au: row.au,
      factor: parseFactor(row.factorRaw),
      priority: parsePriority(row.priorityRaw),
    }))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Validates the filled mapping rows. Returns a German error message, or null
 * when the rows are ready to save. The messages are the same ones the Drive
 * parser uses (core ingredientCsv.ts), so a form mistake reads like a file
 * mistake would.
 */
export function validateMappingRows(rows: readonly MappingRow[]): string | null {
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
 * Validates the optional Singular/Plural pair. The pair is atomic in the stored
 * format: both cells are filled for a name with a count form, both are empty for
 * an invariant name (Zucker, Milch). A half-filled pair is rejected, because the
 * empty side would silently fall back to the canonical name.
 */
export function validateDisplayForms(singular: string, plural: string): string | null {
  const singularText = singular.trim();
  const pluralText = plural.trim();
  if ((singularText === '') !== (pluralText === '')) {
    return 'Bitte Singular und Plural beide ausfüllen oder beide leer lassen — ein invarianter Name braucht keine Anzeigeform.';
  }
  // The master data is a semicolon CSV. The write path round-trips the text
  // before saving, so a delimiter in a cell would not corrupt anything — it
  // would only fail with the parser's column-count message. Naming the three
  // characters here turns that into an error the user can act on.
  if (/[;"\r\n]/.test(singularText) || /[;"\r\n]/.test(pluralText)) {
    return 'Singular und Plural dürfen kein Semikolon, keine Anführungszeichen und keinen Zeilenumbruch enthalten.';
  }
  return null;
}

/**
 * The display forms to persist: both strings, or both null for an invariant
 * name. Call only after `validateDisplayForms` returned null.
 */
export function displayFormsFromValues(
  singular: string,
  plural: string,
): { singular: string | null; plural: string | null } {
  const singularText = singular.trim();
  const pluralText = plural.trim();
  return {
    singular: singularText === '' ? null : singularText,
    plural: pluralText === '' ? null : pluralText,
  };
}
