/**
 * CSV codecs for the ingredient master data — the canonical format of the
 * repo seeds (docs/ingredients.csv + docs/ingredient_unit_mappings.csv), used
 * at runtime for the user's authoritative master data in the Drive Cookbook
 * folder (zutaten.csv + zutaten-umrechnungen.csv).
 *
 * The master data is split into two files:
 * - the **ingredient list** (`Ingredient;Base Unit`, one row per ingredient):
 *   the source of ingredient names and their fixed base unit. Ingredient-level
 *   fields (e.g. a category) can be added as further columns later without
 *   touching the mapping file;
 * - the **AU mappings** (`Ingredient;Additional Unit;Conversion Factor;Priority`,
 *   one row per ingredient–additional-unit mapping): a pure overlay on the
 *   list — an ingredient without additional units simply has no rows here.
 *   The exactness of a unit is NOT part of this file — it is a property of the
 *   unit itself (docs/additional_units.csv, `Unit Exact`).
 *
 * Common format rules (both files):
 * - one header row; CRLF and one optional trailing empty cell per row
 *   (spreadsheet exports) are tolerated;
 * - dot decimals (canonical); German comma decimals are tolerated on parse
 *   and normalized — everything this module writes uses dots;
 * - a leading UTF-8 BOM (spreadsheet exports) is stripped on parse;
 * - validation mirrors the build-time generator (generate-additional-data.mjs):
 *   known additional units, bu ∈ {g, ml}, factor > 0, positive integer
 *   priority, and no duplicate unit or priority per ingredient.
 *
 * The Drive files are authoritative once they exist: parse errors throw (the
 * caller decides how to surface them), and serialize never silently drops
 * data. mergeIngredientMasterData combines both parsed shapes into the
 * runtime registry shape (ingredientRegistry.ts); splitIngredientMasterData
 * is its inverse.
 */

import {
  ADDITIONAL_UNITS,
  type IngredientEntry,
  type IngredientMapping,
} from './additionalUnitsData.js';
import type { IngredientMappings } from './ingredientRegistry.js';

/** The ingredient list: ingredient name → fixed base unit ("g" or "ml"). */
export type IngredientList = Readonly<Record<string, string>>;

/** AU mappings keyed by ingredient name (each list sorted by ascending priority). */
export type IngredientMappingsByIngredient = Readonly<Record<string, readonly IngredientMapping[]>>;

/** Exact header of the ingredient list CSV. */
const LIST_HEADER = 'Ingredient;Base Unit';

/** Exact header of the AU mappings CSV. */
const MAPPINGS_HEADER = 'Ingredient;Additional Unit;Conversion Factor;Priority';

/**
 * The known additional unit names (Becher, EL, TL).
 * The exactness of a unit is a property of the unit itself and lives in
 * docs/additional_units.csv (`Unit Exact`), not in this mappings file.
 */
const UNIT_NAMES = new Set(ADDITIONAL_UNITS.map((unit) => unit.name));

/** Allowed base units: the g/ml family (kg/l exist only in display). */
const BASE_UNITS = new Set(['g', 'ml']);

/** Converts a CSV cell to a number, accepting both '.' and ',' decimals. */
function toNumber(cell: string): number {
  return Number(cell.trim().replace(',', '.'));
}

/**
 * Splits the text into rows; tolerates CRLF and blank lines and a leading
 * UTF-8 BOM (spreadsheet exports). Throws on an empty file.
 *
 * The first row is the header and must equal `headerText`; its cell count is
 * the expected cell count of every following row. Supporting an older format
 * that lacks a trailing column therefore means passing its header here, too —
 * the row validation follows the header, so such files keep parsing until they
 * are written back in the current format.
 */
function parseRows(text: string, headerText: string): { header: string[]; rows: string[][] } {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(';').map((cell) => cell.trim()));
  if (rows.length === 0) {
    throw new Error('Datei ist leer.');
  }
  const header = rows[0]!;
  const columnCount = headerText.split(';').length;
  for (const cells of rows) {
    // Drop exactly one trailing empty cell produced by spreadsheet exports
    // (e.g. a row or the header ending in ';'); a meaningful empty cell inside
    // stays.
    if (cells.length === columnCount + 1 && cells[cells.length - 1] === '') {
      cells.pop();
    }
    if (cells.length !== columnCount) {
      throw new Error(
        `unerwartete Spaltenzahl in Zeile "${cells.join(';')}" (erwartet ${columnCount}).`,
      );
    }
  }
  const actualHeader = header.join(';');
  if (actualHeader !== headerText) {
    throw new Error(`unerwartete Kopfzeile "${actualHeader}".`);
  }
  return { header, rows: rows.slice(1) };
}

/**
 * Parses the ingredient list CSV (`Ingredient;Base Unit`) into name → base
 * unit. Throws on malformed input (duplicate or empty names, unknown base
 * unit); the returned record preserves the file order.
 */
export function parseIngredientListCsv(text: string): IngredientList {
  const { rows } = parseRows(text, LIST_HEADER);
  const result: Record<string, string> = {};
  for (const row of rows) {
    const [ingredient, bu] = row;
    if (ingredient === undefined || ingredient === '' || bu === undefined || bu === '') {
      throw new Error(`Zutaten-Liste: leere Zutat oder Basis-Einheit in Zeile "${row.join(';')}".`);
    }
    if (!BASE_UNITS.has(bu)) {
      throw new Error(`Zutaten-Liste: unbekannte Basis-Einheit "${bu}" für "${ingredient}".`);
    }
    if (result[ingredient] !== undefined) {
      throw new Error(`Zutaten-Liste: doppelte Zutat "${ingredient}".`);
    }
    result[ingredient] = bu;
  }
  return result;
}

/**
 * Serializes the ingredient list to canonical CSV text (header + rows, LF
 * line endings). Row order follows the record's key order, so a parsed file
 * round-trips byte-stable.
 */
export function serializeIngredientListCsv(list: IngredientList): string {
  const lines = [LIST_HEADER];
  for (const [ingredient, bu] of Object.entries(list)) {
    lines.push(`${ingredient};${bu}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Parses the AU mappings CSV (`Ingredient;Additional Unit;Conversion Factor;
 * Priority`) into name → mappings. Throws on malformed input (unknown unit,
 * invalid factor/priority, duplicate unit or priority); the returned record
 * preserves the file order per ingredient and the ascending-priority order of
 * the rows. The base unit is NOT part of this file — it lives in the
 * ingredient list (mergeIngredientMasterData).
 */
export function parseIngredientMappingsCsv(text: string): IngredientMappingsByIngredient {
  const { rows } = parseRows(text, MAPPINGS_HEADER);
  const byIngredient = new Map<string, IngredientMapping[]>();
  for (const row of rows) {
    const [ingredient, au, factorCell, priorityCell] = row;
    if (ingredient === undefined || ingredient === '') {
      throw new Error(`Zutaten-Umrechnungen: leere Zutat in Zeile "${row.join(';')}".`);
    }
    if (au === undefined || !UNIT_NAMES.has(au)) {
      throw new Error(
        `Zutaten-Umrechnungen: unbekannte Zusatz-Einheit "${au ?? ''}" für "${ingredient}" ` +
          `(bekannt: ${[...UNIT_NAMES].join(', ')}).`,
      );
    }
    const factor = toNumber(factorCell ?? '');
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `Zutaten-Umrechnungen: ungültiger Umrechnungsfaktor "${factorCell}" für "${ingredient}" → "${au}".`,
      );
    }
    const priority = toNumber(priorityCell ?? '');
    if (!Number.isInteger(priority) || priority <= 0) {
      throw new Error(
        `Zutaten-Umrechnungen: Priorität muss eine positive ganze Zahl sein, "${priorityCell}" für "${ingredient}" → "${au}".`,
      );
    }
    const list = byIngredient.get(ingredient) ?? [];
    if (list.some((mapping) => mapping.au === au)) {
      throw new Error(`Zutaten-Umrechnungen: doppelte Umrechnung für "${ingredient}" → "${au}".`);
    }
    if (list.some((mapping) => mapping.priority === priority)) {
      throw new Error(
        `Zutaten-Umrechnungen: doppelte Priorität ${priority} für "${ingredient}" (jede Umrechnung braucht eine eindeutige Priorität).`,
      );
    }
    list.push({ au, factor, priority });
    byIngredient.set(ingredient, list);
  }
  const result: Record<string, readonly IngredientMapping[]> = {};
  for (const [ingredient, list] of byIngredient) {
    list.sort((a, b) => a.priority - b.priority);
    result[ingredient] = list;
  }
  return result;
}

/**
 * Serializes the AU mappings to canonical CSV text (header + rows, dot
 * decimals, LF line endings). Row order follows the record's key order and
 * each ingredient's list order, so a parsed file round-trips byte-stable
 * apart from comma→dot normalization.
 */
export function serializeIngredientMappingsCsv(mappings: IngredientMappingsByIngredient): string {
  const lines = [MAPPINGS_HEADER];
  for (const [ingredient, list] of Object.entries(mappings)) {
    for (const mapping of list) {
      lines.push(`${ingredient};${mapping.au};${mapping.factor};${mapping.priority}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Combines the parsed ingredient list and AU mappings into the runtime
 * registry shape. The list is the authoritative source of ingredient names
 * and base units: an ingredient in the list without mappings is a bare
 * ingredient (empty entries), and a mapping for a name that is not in the
 * list is inconsistent — the file pair must never reach that state.
 */
export function mergeIngredientMasterData(
  list: IngredientList,
  mappings: IngredientMappingsByIngredient,
): IngredientMappings {
  const unknown = Object.keys(mappings).filter((name) => list[name] === undefined);
  if (unknown.length > 0) {
    throw new Error(
      `Zutaten-Stammdaten: Umrechnungen für Zutat(en), die nicht in der Zutaten-Liste stehen: ` +
        `${unknown.join(', ')}.`,
    );
  }
  const result: Record<string, IngredientEntry> = {};
  for (const [ingredient, bu] of Object.entries(list)) {
    result[ingredient] = { bu, entries: mappings[ingredient] ?? [] };
  }
  return result;
}

/**
 * Splits the registry shape back into the ingredient list and the AU mappings
 * (the inverse of mergeIngredientMasterData) — the web app uses this before
 * serializing the two Drive files.
 */
export function splitIngredientMasterData(mappings: IngredientMappings): {
  list: IngredientList;
  mappings: IngredientMappingsByIngredient;
} {
  const list: Record<string, string> = {};
  const byIngredient: Record<string, readonly IngredientMapping[]> = {};
  for (const [ingredient, entry] of Object.entries(mappings)) {
    list[ingredient] = entry.bu;
    // Bare ingredients have no rows in the mappings file — they live in the
    // list only, mirroring what the parser produces.
    if (entry.entries.length > 0) {
      byIngredient[ingredient] = entry.entries;
    }
  }
  return { list, mappings: byIngredient };
}
