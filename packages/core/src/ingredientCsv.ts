/**
 * CSV codec for the ingredient master data — the canonical format of
 * docs/ingredient_unit_mappings.csv, used at runtime for the user's
 * authoritative master data file (zutaten-stammdaten.csv in the Drive
 * Cookbook folder).
 *
 * Canonical format (same as the repo CSV):
 * - semicolon-separated columns `Ingredient;Base Unit;Additional Unit;Conversion Factor;Priority`;
 * - one header row; CRLF and one optional trailing empty cell per row
 *   (spreadsheet exports) are tolerated;
 * - dot decimals (canonical); German comma decimals are tolerated on parse
 *   and normalized — everything this module writes uses dots;
 * - validation mirrors the build-time generator (generate-additional-data.mjs):
 *   known additional units, bu ∈ {g, ml}, factor > 0, positive integer
 *   priority, and no duplicate unit or priority per ingredient.
 *
 * The Drive file is authoritative once it exists: parse errors throw (the
 * caller decides how to surface them), and serialize never silently drops
 * data.
 */

import { ADDITIONAL_UNITS, type IngredientMapping } from './additionalUnitsData.js';
import type { IngredientMappings } from './ingredientRegistry.js';

/** Exact header of the canonical master data CSV. */
const HEADER = 'Ingredient;Base Unit;Additional Unit;Conversion Factor;Priority';

/** Column count of the canonical format (5). */
const COLUMN_COUNT = HEADER.split(';').length;

/** The known additional unit names (Becher, EL, TL). */
const UNIT_NAMES = new Set(ADDITIONAL_UNITS.map((unit) => unit.name));

/** Allowed base units: the g/ml family (kg/l exist only in display). */
const BASE_UNITS = new Set(['g', 'ml']);

/** Converts a CSV cell to a number, accepting both '.' and ',' decimals. */
function toNumber(cell: string): number {
  return Number(cell.trim().replace(',', '.'));
}

/** Splits the text into rows; tolerates CRLF and blank lines. */
function parseRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = line.split(';').map((cell) => cell.trim());
      // Drop exactly one trailing empty cell produced by spreadsheet exports
      // (e.g. a row ending in ';'); a meaningful empty cell inside stays.
      if (cells.length === COLUMN_COUNT + 1 && cells[cells.length - 1] === '') {
        cells.pop();
      }
      if (cells.length !== COLUMN_COUNT) {
        throw new Error(
          `Zutaten-Stammdaten: unerwartete Spaltenzahl in Zeile "${line}" (erwartet ${COLUMN_COUNT}).`,
        );
      }
      return cells;
    });
}

/**
 * Parses master data CSV text into the registry shape, validating every row.
 * Throws with an English message on malformed input (the caller surfaces it
 * to the user); the returned record preserves the file order per ingredient
 * and the ascending-priority order of the rows.
 */
export function parseIngredientMappingsCsv(text: string): IngredientMappings {
  // Spreadsheet exports often start with a UTF-8 BOM — strip it before the
  // header check, or every such file would fail with a confusing error.
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  if (rows.length === 0) {
    throw new Error('Zutaten-Stammdaten: Datei ist leer.');
  }
  // The empty-file check above guarantees rows[0] exists.
  const header = rows[0]!;
  if (header.join(';') !== HEADER) {
    throw new Error(`Zutaten-Stammdaten: unerwartete Kopfzeile "${header.join(';')}".`);
  }
  const byIngredient = new Map<string, IngredientMapping[]>();
  for (const row of rows.slice(1)) {
    const [ingredient, bu, au, factorCell, priorityCell] = row;
    if (ingredient === undefined || ingredient === '' || bu === undefined || bu === '') {
      throw new Error(
        `Zutaten-Stammdaten: leere Zutat oder Basis-Einheit in Zeile "${row.join(';')}".`,
      );
    }
    if (!BASE_UNITS.has(bu)) {
      throw new Error(`Zutaten-Stammdaten: unbekannte Basis-Einheit "${bu}" für "${ingredient}".`);
    }
    if (au === undefined || !UNIT_NAMES.has(au)) {
      throw new Error(
        `Zutaten-Stammdaten: unbekannte Zusatz-Einheit "${au ?? ''}" für "${ingredient}" ` +
          `(bekannt: ${[...UNIT_NAMES].join(', ')}).`,
      );
    }
    const factor = toNumber(factorCell ?? '');
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `Zutaten-Stammdaten: ungültiger Umrechnungsfaktor "${factorCell}" für "${ingredient}" → "${au}".`,
      );
    }
    const priority = toNumber(priorityCell ?? '');
    if (!Number.isInteger(priority) || priority <= 0) {
      throw new Error(
        `Zutaten-Stammdaten: Priorität muss eine positive ganze Zahl sein, "${priorityCell}" für "${ingredient}" → "${au}".`,
      );
    }
    const list = byIngredient.get(ingredient) ?? [];
    if (list.some((mapping) => mapping.au === au)) {
      throw new Error(`Zutaten-Stammdaten: doppelte Umrechnung für "${ingredient}" → "${au}".`);
    }
    if (list.some((mapping) => mapping.priority === priority)) {
      throw new Error(
        `Zutaten-Stammdaten: doppelte Priorität ${priority} für "${ingredient}" (jede Umrechnung braucht eine eindeutige Priorität).`,
      );
    }
    list.push({ bu, au, factor, priority });
    byIngredient.set(ingredient, list);
  }
  const result: Record<string, readonly IngredientMapping[]> = {};
  for (const [ingredient, list] of byIngredient) {
    list.sort((a, b) => a.priority - b.priority);
    result[ingredient] = list;
  }
  return result;
}

/** One master data row in canonical column order (for serialization). */
export interface IngredientCsvRow {
  ingredient: string;
  bu: string;
  au: string;
  factor: number;
  priority: number;
}

/**
 * Serializes the registry shape to canonical CSV text (header + rows, dot
 * decimals, LF line endings). Row order follows the record's key order and
 * each ingredient's list order, so a parsed file round-trips byte-stable
 * apart from comma→dot normalization.
 */
export function serializeIngredientMappingsCsv(mappings: IngredientMappings): string {
  const lines = [HEADER];
  for (const [ingredient, list] of Object.entries(mappings)) {
    for (const mapping of list) {
      lines.push(`${ingredient};${mapping.bu};${mapping.au};${mapping.factor};${mapping.priority}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
