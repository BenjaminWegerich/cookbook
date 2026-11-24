/**
 * Tests for the kitchen storage-place list — the CSV codec of the Drive file
 * `lagerorte.csv`, its ordering/identity rules, and the consistency of the repo
 * seed in docs/storage_places.csv.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStoragePlacesCsv, serializeStoragePlacesCsv } from './storagePlacesCsv.js';
import { SEED_STORAGE_PLACES } from './storagePlacesData.js';

/** Repository `docs/` folder, resolved from this file's location. */
const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../docs');

const PLACES_TEXT = ['Place', 'Kühlschrank', 'Gefrierschrank', 'Schublade 1'].join('\n');
const PLACES = ['Kühlschrank', 'Gefrierschrank', 'Schublade 1'];

describe('parseStoragePlacesCsv', () => {
  it('parses the one-column list in file order', () => {
    expect(parseStoragePlacesCsv(PLACES_TEXT)).toEqual(PLACES);
  });

  it('tolerates CRLF, a BOM and a trailing empty cell per row', () => {
    const text = `\uFEFFPlace;\r\nKühlschrank;\r\nGefrierschrank;\r\n`;
    expect(parseStoragePlacesCsv(text)).toEqual(['Kühlschrank', 'Gefrierschrank']);
  });

  it('rejects an empty place', () => {
    expect(() => parseStoragePlacesCsv('Place\n;\nKühlschrank')).toThrow(/leerer Lagerort/);
  });

  it('rejects an empty list', () => {
    expect(() => parseStoragePlacesCsv('Place\n')).toThrow(/enthält keinen Lagerort/);
  });

  it('rejects two places that differ only in case or spacing', () => {
    expect(() => parseStoragePlacesCsv('Place\nÖlfach\nölfach')).toThrow(/derselbe Lagerort/);
    expect(() => parseStoragePlacesCsv('Place\nSchublade 1\nSchublade   1')).toThrow(
      /derselbe Lagerort/,
    );
  });

  it('rejects a wrong header', () => {
    expect(() => parseStoragePlacesCsv('Ort\nKühlschrank')).toThrow(/unerwartete Kopfzeile/);
  });
});

describe('serializeStoragePlacesCsv', () => {
  it('writes the canonical one-column form and round-trips', () => {
    const text = serializeStoragePlacesCsv(PLACES);
    expect(text).toBe(`${PLACES_TEXT}\n`);
    expect(parseStoragePlacesCsv(text)).toEqual(PLACES);
  });
});

describe('seed consistency', () => {
  it('matches the generated SEED_STORAGE_PLACES', () => {
    const seed = readFileSync(join(DOCS_DIR, 'storage_places.csv'), 'utf8');
    expect(SEED_STORAGE_PLACES).toEqual(parseStoragePlacesCsv(seed));
  });
});
