/**
 * Shared form logic for the ingredient master data.
 *
 * Two surfaces edit the same fields and must validate them identically:
 * - `NewIngredientSheet` („Neue Zutat anlegen“) creates a master-data entry;
 * - `EditIngredientSheet` („Stammdaten bearbeiten“) changes an existing one.
 *
 * Keeping the parsing, the row model and the German validation messages here
 * means the two sheets can never drift into different rules — the same mistake
 * is worded the same way in both. UI language is German
 * (docs/CODING_CONVENTIONS.md).
 */

import { ADDITIONAL_UNITS, formatDecimal, type IngredientEntry } from '@cookbook/core';

/** One mapping row of a master-data form: the raw factor of one AU. */
export interface MappingRow {
  au: string;
  /** The trimmed factor input; "" = row skipped. */
  factorRaw: string;
}

/** The raw factor inputs of a form plus the selected shopping unit. */
export interface MappingFormState {
  /** Factor inputs keyed by additional-unit name; empty string = row skipped. */
  factors: Record<string, string>;
  /** The selected shopping unit's AU name, or null (bought in the base unit). */
  shoppingUnit: string | null;
}

/** One filled, valid mapping row handed to the persistence layer. */
export interface MappingEntry {
  au: string;
  factor: number;
  /** True for the one mapping whose unit the ingredient is bought in. */
  shoppingUnit: boolean;
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
 * The form's initial input records for an existing entry: its saved mappings,
 * as the strings the inputs show. Factors are formatted with the German
 * decimal comma (the display-layer rule, docs/CODING_CONVENTIONS.md), so a
 * stored 7.5 reads as "7,5" in the field. An ingredient without additional
 * units yields an empty record, so every known unit starts as a blank row.
 */
export function mappingFormFromEntry(entry: Pick<IngredientEntry, 'entries'>): MappingFormState {
  const factors: Record<string, string> = {};
  let shoppingUnit: string | null = null;
  for (const mapping of entry.entries) {
    factors[mapping.au] = formatDecimal(mapping.factor);
    // The master data allows one shopping unit per ingredient (the CSV parser
    // and the generator enforce it), so the first flagged mapping is the pick.
    if (mapping.shoppingUnit) {
      shoppingUnit = mapping.au;
    }
  }
  return { factors, shoppingUnit };
}

/**
 * The filled rows in the order the units are declared (ADDITIONAL_UNITS) — the
 * order in which mappings are validated and persisted. That is deliberately not
 * the order the grid shows: `IngredientMappingsField` displays the same rows
 * alphabetically, but binds every input to its unit by name, so display order
 * and data order cannot conflict. A row with no factor is skipped by
 * `mappingEntriesFromRows`; the blank rows exist so the user can fill them.
 */
export function buildMappingRows(factors: Record<string, string>): MappingRow[] {
  return ADDITIONAL_UNITS.map((unit) => ({
    au: unit.name,
    factorRaw: (factors[unit.name] ?? '').trim(),
  }));
}

/**
 * The rows that carry a mapping. A row whose factor is empty is not a mapping
 * and is left out; the caller validates the rows before saving. `shoppingUnit`
 * is the AU name the form marks as the purchase unit (or null): exactly the row
 * with that name gets the flag, so the form can never write two of them.
 */
export function mappingEntriesFromRows(
  rows: readonly MappingRow[],
  shoppingUnit: string | null,
): MappingEntry[] {
  return rows
    .filter((row) => row.factorRaw !== '')
    .map((row) => ({
      au: row.au,
      factor: parseFactor(row.factorRaw),
      shoppingUnit: row.au === shoppingUnit,
    }));
}

/**
 * Validates the filled mapping rows. Returns a German error message, or null
 * when the rows are ready to save. The messages mirror the Drive parser
 * (core ingredientCsv.ts), so a form mistake reads like a file mistake would.
 *
 * The shopping unit is a per-mapping flag (docs/additional_quantity_specifications.md
 * §3.1), chosen through a single select: the form can only ever mark one row.
 * The one check that remains is that the selected unit still has a factor — the
 * select only offers filled rows, but clearing a factor while its row is
 * selected must not silently drop the purchase unit.
 */
export function validateMappingRows(
  rows: readonly MappingRow[],
  shoppingUnit: string | null,
): string | null {
  for (const row of rows) {
    if (row.factorRaw === '') continue;
    const factor = parseFactor(row.factorRaw);
    if (!Number.isFinite(factor) || factor <= 0) {
      return `Der Faktor für „${row.au}“ muss eine positive Zahl sein.`;
    }
  }
  if (shoppingUnit !== null) {
    const selected = rows.find((row) => row.au === shoppingUnit);
    if (selected === undefined || selected.factorRaw === '') {
      return `Die Einkaufs-Einheit „${shoppingUnit}“ braucht einen Mengen-Faktor.`;
    }
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
