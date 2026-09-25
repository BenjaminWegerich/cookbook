/**
 * CSV codecs for the ingredient master data — the canonical format of the
 * repo seeds (docs/ingredients.csv + docs/ingredient_unit_mappings.csv), used
 * at runtime for the user's authoritative master data in the Drive Cookbook
 * folder (zutaten.csv + zutaten-umrechnungen.csv).
 *
 * The master data is split into two files:
 * - the **ingredient list** (`Ingredient;Base Unit;Reorder Point`, one row per
 *   ingredient): the source of ingredient names, their fixed base unit and
 *   their reorder point — the base-unit quantity definitely on stock directly
 *   after a shopping trip, independent of the meal plan (0 = only ever bought
 *   for a recipe; `inf` = always in stock, e.g. water). The reorder point is a
 *   mandatory cell and need not be a ladder value. Ingredient-level fields
 *   (e.g. a category) can be added as further columns later without touching
 *   the mapping file. Files written before the reorder-point column existed
 *   still parse under the legacy two-column header: they load with the neutral
 *   reorder point 0 and gain the full column the next time they are written;
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
 * - a reorder-point cell is a non-negative number or the token `inf` for
 *   infinite stock (parsed case-insensitively, written canonically as `inf`);
 *   an empty cell is an error — the field is mandatory;
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

/** One ingredient-list row: the fixed base unit plus the ingredient's reorder point. */
export interface IngredientListEntry {
  /** Fixed base unit family of the ingredient, "g" or "ml". */
  readonly bu: string;
  /**
   * Base-unit quantity that is definitely on stock directly after a shopping
   * trip, independent of the meal plan: 0 = the ingredient is only ever bought
   * for a recipe, Infinity = always in stock (e.g. water). Not necessarily a
   * ladder value; never empty.
   */
  readonly reorderPoint: number;
}

/** The ingredient list: ingredient name → base unit + reorder point. */
export type IngredientList = Readonly<Record<string, IngredientListEntry>>;

/** AU mappings keyed by ingredient name (each list sorted by ascending priority). */
export type IngredientMappingsByIngredient = Readonly<Record<string, readonly IngredientMapping[]>>;

/** Exact header of the current ingredient list CSV. */
const LIST_HEADER = 'Ingredient;Base Unit;Reorder Point';

/**
 * Header of the ingredient list as written before the reorder-point column
 * existed. Such files still parse (see parseIngredientListCsv) and load with
 * the neutral reorder point 0; the next write upgrades them to LIST_HEADER.
 */
const LEGACY_LIST_HEADER = 'Ingredient;Base Unit';

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
 * Parses a reorder-point cell into a number: a non-negative base quantity or
 * the token `inf` for infinite stock, parsed case-insensitively. The cell is
 * mandatory — an empty cell is an error (an absent column, by contrast, is the
 * legacy case handled in parseIngredientListCsv).
 */
function parseReorderPointCell(cell: string, ingredient: string): number {
  if (cell === '') {
    throw new Error(`Zutaten-Liste: leerer Meldebestand für "${ingredient}".`);
  }
  if (cell.toLowerCase() === 'inf') {
    return Infinity;
  }
  const value = toNumber(cell);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Zutaten-Liste: ungültiger Meldebestand "${cell}" für "${ingredient}" ` +
        `(erlaubt: Zahl ≥ 0 oder inf).`,
    );
  }
  return value;
}

/** Canonical CSV cell form of a reorder point: `inf` for Infinity, else the number. */
function formatReorderPointCell(value: number): string {
  return value === Infinity ? 'inf' : String(value);
}

/**
 * Splits the text into rows; tolerates CRLF and blank lines and a leading
 * UTF-8 BOM (spreadsheet exports). Throws on an empty file.
 *
 * The first row is the header and must equal one of `acceptedHeaders`; the
 * matched header's cell count is the expected cell count of every following
 * row. Supporting an older format that lacks a trailing column therefore means
 * passing its header here, too — the row validation follows the matched header,
 * so such files keep parsing until they are written back in the current format.
 */
function parseRows(
  text: string,
  acceptedHeaders: readonly string[],
): { header: string[]; rows: string[][] } {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(';').map((cell) => cell.trim()));
  if (rows.length === 0) {
    throw new Error('Datei ist leer.');
  }
  const header = rows[0]!;
  // A single trailing empty cell on the header (a line ending in ';', common
  // in spreadsheet exports) is dropped before the header text is matched; the
  // per-row loop below drops it for every other row.
  if (header.length > 1 && header[header.length - 1] === '') {
    header.pop();
  }
  const actualHeader = header.join(';');
  const matchedHeader = acceptedHeaders.find((candidate) => candidate === actualHeader);
  if (matchedHeader === undefined) {
    throw new Error(`unerwartete Kopfzeile "${actualHeader}".`);
  }
  const columnCount = matchedHeader.split(';').length;
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
  return { header, rows: rows.slice(1) };
}

/**
 * Parses the ingredient list CSV (`Ingredient;Base Unit;Reorder Point`) into
 * name → base unit + reorder point. Throws on malformed input (empty or
 * duplicate names, unknown base unit, missing or invalid reorder point); the
 * returned record preserves the file order.
 *
 * A file under the legacy two-column header (`Ingredient;Base Unit`) still
 * parses; every ingredient then gets the neutral reorder point 0, and the next
 * serialization writes the full three-column format.
 */
export function parseIngredientListCsv(text: string): IngredientList {
  const { rows } = parseRows(text, [LIST_HEADER, LEGACY_LIST_HEADER]);
  const result: Record<string, IngredientListEntry> = {};
  for (const row of rows) {
    const [ingredient, bu, reorderCell] = row;
    if (ingredient === undefined || ingredient === '' || bu === undefined || bu === '') {
      throw new Error(`Zutaten-Liste: leere Zutat oder Basis-Einheit in Zeile "${row.join(';')}".`);
    }
    if (!BASE_UNITS.has(bu)) {
      throw new Error(`Zutaten-Liste: unbekannte Basis-Einheit "${bu}" für "${ingredient}".`);
    }
    if (result[ingredient] !== undefined) {
      throw new Error(`Zutaten-Liste: doppelte Zutat "${ingredient}".`);
    }
    // A legacy row has no reorder-point cell at all; those files predate the
    // column and load with the neutral 0 until the next write adds the column.
    result[ingredient] = {
      bu,
      reorderPoint: reorderCell === undefined ? 0 : parseReorderPointCell(reorderCell, ingredient),
    };
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
  for (const [ingredient, entry] of Object.entries(list)) {
    lines.push(`${ingredient};${entry.bu};${formatReorderPointCell(entry.reorderPoint)}`);
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
  const { rows } = parseRows(text, [MAPPINGS_HEADER]);
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
 * registry shape. The list is the authoritative source of ingredient names,
 * base units and reorder points: an ingredient in the list without mappings is
 * a bare ingredient (empty entries), and a mapping for a name that is not in
 * the list is inconsistent — the file pair must never reach that state.
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
  for (const [ingredient, entry] of Object.entries(list)) {
    result[ingredient] = {
      bu: entry.bu,
      reorderPoint: entry.reorderPoint,
      entries: mappings[ingredient] ?? [],
    };
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
  const list: Record<string, IngredientListEntry> = {};
  const byIngredient: Record<string, readonly IngredientMapping[]> = {};
  for (const [ingredient, entry] of Object.entries(mappings)) {
    list[ingredient] = { bu: entry.bu, reorderPoint: entry.reorderPoint };
    // Bare ingredients have no rows in the mappings file — they live in the
    // list only, mirroring what the parser produces.
    if (entry.entries.length > 0) {
      byIngredient[ingredient] = entry.entries;
    }
  }
  return { list, mappings: byIngredient };
}
