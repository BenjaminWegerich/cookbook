#!/usr/bin/env node
/**
 * Generates `src/shoppingRouteData.ts` from the shopping-route master data:
 *   - docs/shopping_route.csv   (the route: Store;Section, row order = walking order)
 *   - docs/shopping_items.csv   (the assignment: Item;Store;Section)
 *
 * Both files are the seed of the user's authoritative Drive master data
 * (einkaufsweg.csv + einkaufs-zuordnung.csv, apps/web/src/drive/
 * shoppingRouteMasterData.ts) and, like docs/ingredients.csv, they are
 * compiled into a TypeScript module so the framework-free core package and its
 * consumers never parse CSV at runtime (same pattern as
 * generate-additional-data.mjs and generate-ladder.mjs).
 *
 * This generator is also the cross-file drift guard (docs/storage_format.md
 * §10): it refuses to emit anything when a row has an empty cell, when a stop
 * or an item name is duplicated, or when an assignment names a stop that the
 * route does not contain — the same invariants the runtime parsers enforce, so
 * the committed seed can never describe an inconsistent pair of files.
 *
 * The generated module inlines the CSV cell text verbatim (no escaping): the
 * route and item names are user data without quotes, semicolons or line breaks.
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
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shoppingRouteData.ts');

/** Exact header of the route file (docs/shopping_route.csv). */
const ROUTE_HEADER = 'Store;Section';

/** Exact header of the assignment file (docs/shopping_items.csv). */
const ITEMS_HEADER = 'Item;Store;Section';

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
 * Reads the assignment file and validates every named stop against the route.
 * The item name is deliberately not checked against the ingredient list: the
 * assignment's name set is a superset of it (Klopapier, Seife, Blumen).
 */
function buildAssignments(route) {
  const { header, rows } = parseCsv(ITEMS_CSV);
  if (header.join(';') !== ITEMS_HEADER) {
    throw new Error(`${ITEMS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const knownStops = new Set(route.map((stop) => `${stop.store}\u0000${stop.section}`));
  const assignments = [];
  const seenItems = new Set();
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
    if (!knownStops.has(`${store}\u0000${section}`)) {
      throw new Error(
        `${ITEMS_CSV}: stop '${store}; ${section}' of '${item}' (row ${index + 2}) ` +
          `is not in ${ROUTE_CSV}`,
      );
    }
    seenItems.add(item);
    assignments.push({ item, store, section });
  });
  return assignments;
}

/** Renders the generated TypeScript module. */
function render(route, assignments) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED from docs/shopping_route.csv and docs/shopping_items.csv by');
  lines.push(' * scripts/generate-shopping-route.mjs.');
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:shopping-route' (packages/core) after a CSV change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push("import type { ShoppingAssignments, ShoppingRoute } from './shoppingRouteCsv.js';");
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
    '/** The seed item assignment: item name → stop (docs/shopping_items.csv); the name set is a superset of the ingredient list. */',
  );
  lines.push('export const SEED_SHOPPING_ASSIGNMENTS: ShoppingAssignments = {');
  for (const entry of assignments) {
    lines.push(
      `  ${JSON.stringify(entry.item)}: { store: ${JSON.stringify(entry.store)}, ` +
        `section: ${JSON.stringify(entry.section)} },`,
    );
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const route = buildRoute();
const assignments = buildAssignments(route);
let output = render(route, assignments);
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
console.log(`Wrote ${route.length} stop(s) and ${assignments.length} assignment(s) to ${OUT_PATH}`);
