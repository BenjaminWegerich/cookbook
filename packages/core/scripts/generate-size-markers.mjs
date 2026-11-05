#!/usr/bin/env node
/**
 * Generates `src/sizeMarkersData.ts` from `docs/size_markers.csv`.
 *
 * A size marker is a display-only piece of equipment in a step's prose
 * (`{{1 26 cm Backring|size}}`): the recipe stores the written arrangement (one
 * or more molds of a nominal size), and the renderer derives the arrangement
 * for any requested recipe size. The marker definition owns the geometry — the
 * scale (`linear`, `area`, `volume`), the physically available nominal sizes and
 * the display pattern — so adding another round mold is one CSV row and adding
 * a new scaling law is one enum value plus a resolver branch.
 *
 * Canonical CSV format: semicolon-separated, dot decimals, header row, CRLF
 * tolerated. `Sizes` is a space-separated ascending list of positive numbers;
 * `Pattern` uses the placeholders `<N>` (count), `<SIZE>`, `<UNIT>` and `<INF>`
 * (singular/plural form). The pattern always renders `<N>`, including 1 — the
 * recipe text reads “1 26er Backring” / “2 20er Backringe”.
 *
 * Usage:
 *   npm run generate:size-markers   (from packages/core)
 *
 * The generated module is committed so that the framework-free core package
 * and its consumers never parse CSV at runtime (same pattern as the other
 * generators).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CSV_PATH = resolve(ROOT, 'docs/size_markers.csv');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/sizeMarkersData.ts');

/** Exact header of the size-marker table (docs/size_markers.csv). */
const HEADER = 'Marker;Singular;Plural;Unit;Scale;Sizes;Default;Pattern';

/** The supported scaling laws. */
const SCALES = ['linear', 'area', 'volume'];

/** Placeholders allowed in a display pattern. */
const PATTERN_TOKENS = new Set(['<N>', '<SIZE>', '<UNIT>', '<INF>']);

/**
 * Splits one CSV line on semicolons. The table has no quoted cells: every
 * value is a short token, a number list or a display pattern with no `;`.
 */
function splitLine(line) {
  return line.split(';').map((cell) => cell.trim());
}

/** Converts a CSV cell to a number, accepting both '.' and ',' decimals. */
function toNumber(cell) {
  return Number(cell.replace(',', '.'));
}

/**
 * Parses the `Sizes` cell: a space-separated, strictly ascending list of
 * positive finite numbers. The list is the authoritative set of physically
 * available molds; its first and last entries are the effective minimum and
 * maximum.
 */
function parseSizes(cell, marker) {
  const parts = cell.split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) {
    throw new Error(`${CSV_PATH}: empty Sizes for '${marker}'`);
  }
  const sizes = parts.map((part) => toNumber(part));
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`${CSV_PATH}: invalid size '${parts[index]}' for '${marker}'`);
    }
    if (index > 0 && size <= sizes[index - 1]) {
      throw new Error(`${CSV_PATH}: Sizes for '${marker}' must be strictly ascending`);
    }
  }
  return sizes;
}

/**
 * Validates a display pattern. `<N>` and `<SIZE>` are mandatory; `<UNIT>` and
 * `<INF>` are optional. A typo in a placeholder is rejected instead of being
 * rendered literally.
 */
function parsePattern(cell, marker) {
  if (cell === '') {
    throw new Error(`${CSV_PATH}: empty Pattern for '${marker}'`);
  }
  if (!cell.includes('<N>')) {
    throw new Error(`${CSV_PATH}: Pattern for '${marker}' must contain <N>`);
  }
  if (!cell.includes('<SIZE>')) {
    throw new Error(`${CSV_PATH}: Pattern for '${marker}' must contain <SIZE>`);
  }
  for (const match of cell.matchAll(/<[^>]*>/g)) {
    if (!PATTERN_TOKENS.has(match[0])) {
      throw new Error(`${CSV_PATH}: unknown placeholder '${match[0]}' in Pattern for '${marker}'`);
    }
  }
  return cell;
}

/** Reads and validates the CSV rows. */
function readRows() {
  const text = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines[0].trim() !== HEADER) {
    throw new Error(`${CSV_PATH}: expected header '${HEADER}'`);
  }

  const rows = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    if (cells.length !== 8) {
      throw new Error(`${CSV_PATH}: expected 8 cells in '${line}' (found ${cells.length})`);
    }
    const [marker, singular, plural, unit, scale, sizesCell, defaultCell, patternCell] = cells;
    if (marker === '') {
      throw new Error(`${CSV_PATH}: empty Marker in '${line}'`);
    }
    if (seen.has(marker)) {
      throw new Error(`${CSV_PATH}: duplicate Marker '${marker}'`);
    }
    seen.add(marker);
    if (!SCALES.includes(scale)) {
      throw new Error(
        `${CSV_PATH}: invalid Scale '${scale}' for '${marker}' (use ${SCALES.join(', ')})`,
      );
    }
    if (unit === '') {
      throw new Error(`${CSV_PATH}: empty Unit for '${marker}'`);
    }
    if ((singular === '') !== (plural === '')) {
      throw new Error(
        `${CSV_PATH}: incomplete Singular/Plural pair for '${marker}' ` +
          `(fill both or leave both empty)`,
      );
    }
    const sizes = parseSizes(sizesCell, marker);
    const defaultSize = toNumber(defaultCell);
    if (!Number.isFinite(defaultSize) || !sizes.includes(defaultSize)) {
      throw new Error(
        `${CSV_PATH}: invalid Default '${defaultCell}' for '${marker}' ` +
          `(use one of its Sizes: ${sizes.join(', ')})`,
      );
    }
    rows.push({
      marker,
      singular: singular === '' ? marker : singular,
      plural: plural === '' ? marker : plural,
      unit,
      scale,
      sizes,
      defaultSize,
      pattern: parsePattern(patternCell, marker),
    });
  }
  if (rows.length === 0) {
    throw new Error(`${CSV_PATH}: no size-marker rows`);
  }
  return rows;
}

/** Renders one entry as a TypeScript object literal. */
function entrySource(row) {
  const sizes = row.sizes.map((size) => String(size)).join(', ');
  return (
    '  {\n' +
    `    marker: ${quote(row.marker)},\n` +
    `    singular: ${quote(row.singular)},\n` +
    `    plural: ${quote(row.plural)},\n` +
    `    unit: ${quote(row.unit)},\n` +
    `    scale: ${quote(row.scale)},\n` +
    `    sizes: [${sizes}],\n` +
    `    defaultSize: ${String(row.defaultSize)},\n` +
    `    pattern: ${quote(row.pattern)},\n` +
    '  },'
  );
}

/** Renders a string as a single-quoted TypeScript literal (Prettier style). */
function quote(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

const rows = readRows();
const output = `/**
 * AUTO-GENERATED from docs/size_markers.csv by
 * scripts/generate-size-markers.mjs.
 * Do not edit by hand — re-run 'npm run generate:size-markers' (packages/core)
 * after a CSV change.
 */

/** How the marker's nominal size follows the recipe quantity. */
export type SizeMarkerScale =
  /** The size itself is proportional to the quantity (exponent 1). */
  | 'linear'
  /** The quantity is proportional to the size squared (exponent 2), e.g. a
   *  round cake ring whose height stays constant. */
  | 'area'
  /** The quantity is proportional to the size cubed (exponent 3), e.g. a
   *  geometrically similar 3-D mold. */
  | 'volume';

/** One size-marked piece of equipment from the master data. */
export interface SizeMarkerDefinition {
  /** Canonical key, used in the stored artifact ('… Backring|size'). */
  readonly marker: string;
  /** Singular display form, used when the derived count is 1. */
  readonly singular: string;
  /** Plural display form, used when the derived count is above 1. */
  readonly plural: string;
  /** Canonical unit of the nominal sizes (e.g. 'cm'). */
  readonly unit: string;
  /** Scaling law between the recipe quantity and the marker's size. */
  readonly scale: SizeMarkerScale;
  /** Physically available nominal sizes, ascending; first/last bound the display. */
  readonly sizes: readonly number[];
  /** Size a fresh marker starts with; always one of 'sizes'. */
  readonly defaultSize: number;
  /** Display template; placeholders <N> <SIZE> <UNIT> <INF>. Always renders <N>. */
  readonly pattern: string;
}

/** All size markers, in table order. */
export const SIZE_MARKERS: readonly SizeMarkerDefinition[] = [
${rows.map(entrySource).join('\n')}
];
`;

writeFileSync(OUT_PATH, output, 'utf8');
