#!/usr/bin/env node
/**
 * Generates `src/shoppingRouteData.ts` from the shopping master data:
 *   - docs/shopping_route.csv     (the route: Store;Section, row order = walking order)
 *   - docs/shopping_items.csv     (the item table: Item;Store;Section)
 *   - docs/shopping_synonyms.csv  (the synonym table: Variant;Item)
 *
 * The three files are the seed of the user's authoritative Drive master data
 * (einkaufsweg.csv + einkaufs-artikel.csv + einkaufs-synonyme.csv, apps/web/src/
 * drive/shoppingRouteMasterData.ts) and, like docs/ingredients.csv, they are
 * compiled into a TypeScript module so the framework-free core package and its
 * consumers never parse CSV at runtime (same pattern as
 * generate-additional-data.mjs and generate-ladder.mjs).
 *
 * This generator is also the cross-file drift guard (docs/storage_format.md
 * §10): it refuses to emit anything when a row has an empty cell, when a stop or
 * an item name is duplicated, when an item names a stop the route does not
 * contain, when a variant names an unknown item, or when a variant would shadow
 * an item name — the same invariants the runtime parsers enforce, so the
 * committed seed can never describe an inconsistent set of files.
 *
 * The generated module inlines the CSV cell text verbatim (no escaping): the
 * route, item and variant names are user data without quotes, semicolons or line
 * breaks.
 *
 * Usage:
 *   npm run generate:shopping-route   (from packages/core)
 *
 * After every change to one of the CSVs, re-run this script and commit the
 * regenerated file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUTE_CSV = resolve(ROOT, 'docs/shopping_route.csv');
const ITEMS_CSV = resolve(ROOT, 'docs/shopping_items.csv');
const SYNONYMS_CSV = resolve(ROOT, 'docs/shopping_synonyms.csv');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shoppingRouteData.ts');

/** Exact header of the route file (docs/shopping_route.csv). */
const ROUTE_HEADER = 'Store;Section';

/** Exact header of the item file (docs/shopping_items.csv). */
const ITEMS_HEADER = 'Item;Store;Section';

/** Exact header of the synonym file (docs/shopping_synonyms.csv). */
const SYNONYMS_HEADER = 'Variant;Item';

/**
 * The comparison key of a name, mirroring core's `shoppingNameKey`
 * (src/shoppingRouteCsv.ts) — kept local so this script stays a standalone node
 * script. Unicode NFC, case-folded, inner whitespace collapsed, trimmed; „ß“
 * folds to „ss“. The core test suite compares this generator's output against
 * the runtime parsers, so the two copies cannot drift unnoticed.
 */
function nameKey(name) {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/\u00DF/gu, 'ss')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Parses a `;`-separated CSV into { header, rows } of trimmed cells. Kept local
 * so this script stays a standalone node script: it mirrors the reader of
 * scripts/generate-additional-data.mjs (blank lines and CRLF tolerated, one
 * trailing empty cell per row dropped, a leading BOM stripped) without tying
 * the two generators together.
 */
function parseCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`${path}: file is empty`);
  }
  const header = lines[0].split(';').map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(';').map((cell) => cell.trim());
    // Drop exactly one trailing empty cell produced by spreadsheet exports
    // (e.g. a row ending in ';'); a meaningful empty cell inside the row stays.
    if (cells.length === header.length + 1 && cells[cells.length - 1] === '') {
      cells.pop();
    }
    if (cells.length !== header.length) {
      throw new Error(
        `${path}: expected ${header.length} columns, got ${cells.length} in line: ${line}`,
      );
    }
    return cells;
  });
  return { header, rows };
}

/**
 * Reads the route file. Validates the header, requires both cells of every row
 * and rejects a duplicated stop — "the row order is the route" only holds while
 * no stop appears twice.
 */
function buildRoute() {
  const { header, rows } = parseCsv(ROUTE_CSV);
  if (header.join(';') !== ROUTE_HEADER) {
    throw new Error(`${ROUTE_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const stops = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    const [store, section] = row;
    if (store === '' || section === '') {
      throw new Error(`${ROUTE_CSV}: empty store or section in row ${index + 2}: ${row.join(';')}`);
    }
    const key = `${store}\u0000${section}`;
    if (seen.has(key)) {
      throw new Error(`${ROUTE_CSV}: duplicate stop '${store}; ${section}' in row ${index + 2}`);
    }
    seen.add(key);
    stops.push({ store, section });
  });
  return stops;
}

/**
 * Reads the item file and validates every named stop against the route. The
 * item name is deliberately not checked against the ingredient list: the item
 * table's name set is a superset of it (Klopapier, Seife, Blumen).
 */
function buildItems(route) {
  const { header, rows } = parseCsv(ITEMS_CSV);
  if (header.join(';') !== ITEMS_HEADER) {
    throw new Error(`${ITEMS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const knownStops = new Set(route.map((stop) => `${stop.store}\u0000${stop.section}`));
  const items = [];
  const seenItems = new Set();
  const claimed = new Map();
  rows.forEach((row, index) => {
    const [item, store, section] = row;
    if (item === '' || store === '' || section === '') {
      throw new Error(
        `${ITEMS_CSV}: empty item, store or section in row ${index + 2}: ${row.join(';')}`,
      );
    }
    if (seenItems.has(item)) {
      throw new Error(`${ITEMS_CSV}: duplicate item '${item}' in row ${index + 2}`);
    }
    const key = nameKey(item);
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(
        `${ITEMS_CSV}: '${item}' and '${clash}' (row ${index + 2}) differ only in letter case`,
      );
    }
    if (!knownStops.has(`${store}\u0000${section}`)) {
      throw new Error(
        `${ITEMS_CSV}: stop '${store}; ${section}' of '${item}' (row ${index + 2}) ` +
          `is not in ${ROUTE_CSV}`,
      );
    }
    seenItems.add(item);
    claimed.set(key, item);
    items.push({ item, store, section });
  });
  return items;
}

/**
 * Reads the synonym file and validates it against the item table: every named
 * item must exist, and a variant must not shadow an item name — comparison is
 * case-folded like the runtime matching itself.
 */
function buildSynonyms(items) {
  const { header, rows } = parseCsv(SYNONYMS_CSV);
  if (header.join(';') !== SYNONYMS_HEADER) {
    throw new Error(`${SYNONYMS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const itemNames = new Set(items.map((entry) => entry.item));
  const itemKeys = new Set(items.map((entry) => nameKey(entry.item)));
  const synonyms = [];
  const claimed = new Map();
  rows.forEach((row, index) => {
    const [variant, item] = row;
    if (variant === '' || item === '') {
      throw new Error(
        `${SYNONYMS_CSV}: empty variant or item in row ${index + 2}: ${row.join(';')}`,
      );
    }
    if (!itemNames.has(item)) {
      throw new Error(
        `${SYNONYMS_CSV}: item '${item}' of variant '${variant}' (row ${index + 2}) ` +
          `is not in ${ITEMS_CSV}`,
      );
    }
    const key = nameKey(variant);
    if (itemKeys.has(key)) {
      throw new Error(
        `${SYNONYMS_CSV}: variant '${variant}' (row ${index + 2}) is already an item name`,
      );
    }
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(
        `${SYNONYMS_CSV}: '${variant}' and '${clash}' (row ${index + 2}) differ only in letter case`,
      );
    }
    claimed.set(key, variant);
    synonyms.push({ variant, item });
  });
  return synonyms;
}

/** Renders the generated TypeScript module. */
function render(route, items, synonyms) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED from docs/shopping_route.csv, docs/shopping_items.csv and');
  lines.push(' * docs/shopping_synonyms.csv by scripts/generate-shopping-route.mjs.');
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:shopping-route' (packages/core) after a CSV change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push(
    "import type { ShoppingItems, ShoppingRoute, ShoppingSynonyms } from './shoppingRouteCsv.js';",
  );
  lines.push('');
  lines.push(
    '/** The seed route: the stops in the order the shops are visited and the sections are walked (docs/shopping_route.csv). */',
  );
  lines.push('export const SEED_SHOPPING_ROUTE: ShoppingRoute = [');
  for (const stop of route) {
    lines.push(
      `  { store: ${JSON.stringify(stop.store)}, section: ${JSON.stringify(stop.section)} },`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push(
    '/** The seed item table: item name → stop (docs/shopping_items.csv); the name set is a superset of the ingredient list. */',
  );
  lines.push('export const SEED_SHOPPING_ITEMS: ShoppingItems = {');
  for (const entry of items) {
    lines.push(
      `  ${JSON.stringify(entry.item)}: { store: ${JSON.stringify(entry.store)}, ` +
        `section: ${JSON.stringify(entry.section)} },`,
    );
  }
  lines.push('};');
  lines.push('');
  lines.push(
    '/** The seed synonym table: variant text → item name (docs/shopping_synonyms.csv). */',
  );
  lines.push('export const SEED_SHOPPING_SYNONYMS: ShoppingSynonyms = {');
  for (const entry of synonyms) {
    lines.push(`  ${JSON.stringify(entry.variant)}: ${JSON.stringify(entry.item)},`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const route = buildRoute();
const items = buildItems(route);
const synonyms = buildSynonyms(items);
let output = render(route, items, synonyms);
try {
  // Format with Prettier (root devDependency, used by `npm run format`) so the
  // committed generated module is prettier-clean and regeneration is
  // idempotent — `npm run format` would otherwise produce diff noise.
  // The project config (.prettierrc.json) is resolved explicitly because the
  // generator's CWD may differ from the repo root.
  const { format, resolveConfig } = await import('prettier');
  const config = await resolveConfig(OUT_PATH);
  output = await format(output, { ...config, parser: 'typescript' });
} catch {
  // Prettier not installed — the raw render is still valid TypeScript.
}
writeFileSync(OUT_PATH, output, 'utf8');
console.log(
  `Wrote ${route.length} stop(s), ${items.length} item(s) and ${synonyms.length} synonym(s) to ${OUT_PATH}`,
);
