#!/usr/bin/env node
/**
 * Generates `src/storagePlacesData.ts` from `docs/storage_places.csv`.
 *
 * The kitchen storage places are the one ordering the pantry page
 * („Vorräte auswählen — Teil 2: Zutaten“) uses for its ingredient rows: the row
 * order of the CSV is the order the app walks the kitchen (Kühlschrank first,
 * then the freezer, the drawers, the spice shelf, …). The file is deliberately
 * a one-column table: a place is a name, and its position in the file is its
 * only other property.
 *
 * The list is **built-in** master data, not user Drive data (decided with the
 * user): the zones do not need an editor in the web app, and no Drive file
 * overrides them. Changing a zone (or inserting one) therefore means editing
 * `docs/storage_places.csv`, re-running this generator and redeploying — the
 * same path the app's other compiled master tables take.
 *
 * The generator is the seed's guard: it rejects an empty file, a wrong header,
 * an empty place or a duplicated place (case-folded like the ingredient names,
 * so „Ölfach“ and „ölfach“ cannot become two stops of the same walk).
 *
 * Usage:
 *   npm run generate:storage-places   (from packages/core)
 *
 * After every change to the CSV, re-run this script and commit the regenerated
 * file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PLACES_CSV = resolve(ROOT, 'docs/storage_places.csv');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/storagePlacesData.ts');

/** Exact header of the storage-place file (docs/storage_places.csv). */
const PLACES_HEADER = 'Place';

/**
 * The comparison key of a place, mirroring the ingredient master data's
 * case-insensitive name handling: Unicode NFC, lower-case, inner whitespace
 * collapsed, trimmed. Kept local so this script stays a standalone node script.
 */
function placeKey(place) {
  return place.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Reads the one-column CSV. Kept local (same reason as in the shopping-route
 * generator): the script must run without importing the TypeScript sources.
 */
function readPlaces() {
  const text = readFileSync(PLACES_CSV, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`${PLACES_CSV}: file is empty`);
  }
  const header = lines[0].split(';').map((cell) => cell.trim());
  // One trailing empty cell is a spreadsheet artefact; anything else is wrong.
  if (header.length === 2 && header[1] === '') header.pop();
  if (header.join(';') !== PLACES_HEADER) {
    throw new Error(`${PLACES_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const places = [];
  const claimed = new Map();
  lines.slice(1).forEach((line, index) => {
    const cells = line.split(';').map((cell) => cell.trim());
    // Drop exactly one trailing empty cell (spreadsheet export).
    if (cells.length === 2 && cells[1] === '') cells.pop();
    if (cells.length !== 1 || cells[0] === '') {
      throw new Error(
        `${PLACES_CSV}: expected one non-empty place, got ${JSON.stringify(line)} ` +
          `in line ${index + 2}`,
      );
    }
    const place = cells[0];
    const key = placeKey(place);
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(
        `${PLACES_CSV}: '${place}' and '${clash}' (line ${index + 2}) are the same place`,
      );
    }
    claimed.set(key, place);
    places.push(place);
  });
  if (places.length === 0) {
    throw new Error(`${PLACES_CSV}: no places defined`);
  }
  return places;
}

/** Renders the generated TypeScript module. */
function render(places) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED from docs/storage_places.csv by');
  lines.push(' * scripts/generate-storage-places.mjs.');
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:storage-places' (packages/core) after a CSV change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push(
    '/** The kitchen storage places in walking order (docs/storage_places.csv): the pantry page files its ingredient rows in this order. */',
  );
  lines.push('export const STORAGE_PLACES: readonly string[] = [');
  for (const place of places) {
    lines.push(`  ${JSON.stringify(place)},`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

const places = readPlaces();
let output = render(places);
try {
  // Format with Prettier (root devDependency) so the committed generated module
  // is prettier-clean and regeneration is idempotent.
  const { format, resolveConfig } = await import('prettier');
  const config = await resolveConfig(OUT_PATH);
  output = await format(output, { ...config, parser: 'typescript' });
} catch {
  // Prettier not installed — the raw render is still valid TypeScript.
}
writeFileSync(OUT_PATH, output, 'utf8');
console.log(`Wrote ${places.length} storage place(s) to ${OUT_PATH}`);
