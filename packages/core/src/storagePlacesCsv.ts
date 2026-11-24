/**
 * CSV codec for the kitchen storage-place list — the canonical format of the
 * repo seed (docs/storage_places.csv), used at runtime for the user's
 * authoritative list in the Drive Cookbook folder's `Stammdaten` subfolder
 * (`lagerorte.csv`).
 *
 * The file is a one-column table: a place is a name, and its position in the
 * file is its only other property. The row order therefore IS the kitchen walk
 * the pantry page files its ingredient rows in (docs/storage_places.csv); a
 * user who reorders the rows changes the order of the pantry page.
 *
 * Like the other master data, the format is user-edited: the header must be
 * exactly `Place`, spelling is compared case-folded (Unicode NFC, lower-case,
 * collapsed inner whitespace) so „Ölfach“ and „ölfach“ cannot become two stops
 * of the same walk, and an empty place or an empty list fails loudly. The
 * generator (scripts/generate-storage-places.mjs) enforces the same rules on
 * the seed, so the built-in list and a Drive file cannot drift apart.
 *
 * Common format rules (the row protocol lives in csv.ts): one header row, CRLF
 * and one optional trailing empty cell per row (spreadsheet exports) are
 * tolerated, and a leading UTF-8 BOM is stripped on parse.
 */

import { parseCsvRows } from './csv.js';

/** Exact header of the storage-place file. */
const PLACES_HEADER = 'Place';

/**
 * The comparison key of a place, mirroring the ingredient master data's
 * case-insensitive name handling: Unicode NFC, lower-case, inner whitespace
 * collapsed, trimmed.
 */
function placeKey(place: string): string {
  return place.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Parses the one-column storage-place CSV into the places in file order — the
 * kitchen walking order. Throws on an empty place, a duplicated place
 * (case-folded) and an empty list; a malformed header is reported by
 * `parseCsvRows`.
 */
export function parseStoragePlacesCsv(text: string): readonly string[] {
  const { rows } = parseCsvRows(text, [PLACES_HEADER]);
  const places: string[] = [];
  const claimed = new Map<string, string>();
  for (const row of rows) {
    const place = row[0] ?? '';
    if (place === '') {
      throw new Error('Lagerorte: leerer Lagerort in der Datei.');
    }
    const key = placeKey(place);
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(`Lagerorte: "${place}" und "${clash}" sind derselbe Lagerort.`);
    }
    claimed.set(key, place);
    places.push(place);
  }
  if (places.length === 0) {
    throw new Error('Lagerorte: die Datei enthält keinen Lagerort.');
  }
  return places;
}

/**
 * Serializes the places in walking order to the canonical one-column CSV. The
 * trailing newline keeps a hand-created file identical to a spreadsheet export
 * of a normal master-data file.
 */
export function serializeStoragePlacesCsv(places: readonly string[]): string {
  return [`${PLACES_HEADER}`, ...places].join('\n') + '\n';
}
