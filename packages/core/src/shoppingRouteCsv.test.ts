/**
 * Tests for the shopping-route master data (docs/storage_format.md §10) — the
 * two CSV codecs and the consistency of the repository's seed files in
 * `docs/`, which are the built-in data used on first run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseShoppingAssignmentsCsv,
  parseShoppingRouteCsv,
  type ShoppingAssignments,
  type ShoppingRoute,
} from './shoppingRouteCsv.js';

/** Repository `docs/` folder, resolved from this file's location. */
const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../docs');

/** The canonical route (docs format) as a fixture. */
const ROUTE_TEXT = [
  'Store;Section',
  'Lidl;Obst und Gemüse',
  'Lidl;Molkerei',
  'REWE;Obst und Gemüse',
  'REWE;TK-Obst',
  'dm;Drogerie',
].join('\n');

const ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Obst und Gemüse' },
  { store: 'Lidl', section: 'Molkerei' },
  { store: 'REWE', section: 'Obst und Gemüse' },
  { store: 'REWE', section: 'TK-Obst' },
  { store: 'dm', section: 'Drogerie' },
];

/** The canonical assignment (docs format) as a fixture. */
const ASSIGNMENTS_TEXT = [
  'Item;Store;Section',
  'Karotten;Lidl;Obst und Gemüse',
  'Joghurt;Lidl;Molkerei',
  'TK-Blaubeeren;REWE;TK-Obst',
  'Klopapier;dm;Drogerie',
].join('\n');

const ASSIGNMENTS: ShoppingAssignments = {
  Karotten: { store: 'Lidl', section: 'Obst und Gemüse' },
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  'TK-Blaubeeren': { store: 'REWE', section: 'TK-Obst' },
  Klopapier: { store: 'dm', section: 'Drogerie' },
};

describe('parseShoppingRouteCsv', () => {
  it('parses the canonical format into the ordered route', () => {
    expect(parseShoppingRouteCsv(ROUTE_TEXT)).toEqual(ROUTE);
  });

  it('keeps the same section in two stores as two distinct stops', () => {
    // "Obst und Gemüse" exists at Lidl and at REWE; the store/section pair is
    // the key, so neither is a duplicate of the other.
    const route = parseShoppingRouteCsv(ROUTE_TEXT);
    expect(route.filter((stop) => stop.section === 'Obst und Gemüse')).toEqual([
      { store: 'Lidl', section: 'Obst und Gemüse' },
      { store: 'REWE', section: 'Obst und Gemüse' },
    ]);
  });

  it('tolerates CRLF, blank lines, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${ROUTE_TEXT.replaceAll('\n', ';\r\n').replace('\r\n', '\r\n\r\n')}`;
    expect(parseShoppingRouteCsv(sloppy)).toEqual(ROUTE);
  });

  it('throws on an empty file', () => {
    expect(() => parseShoppingRouteCsv('')).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseShoppingRouteCsv('Store;Aisle\nLidl;Obst')).toThrow(/Kopfzeile/);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseShoppingRouteCsv(`${ROUTE_TEXT}\ndm;Drogerie;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty store or section cell', () => {
    expect(() => parseShoppingRouteCsv(ROUTE_TEXT.replace('dm;Drogerie', 'dm;'))).toThrow(
      /leerer Store oder leere Section/,
    );
  });

  it('throws on a duplicated stop', () => {
    expect(() => parseShoppingRouteCsv(`${ROUTE_TEXT}\ndm;Drogerie`)).toThrow(
      /doppelter Einkaufsort "dm; Drogerie"/,
    );
  });
});

describe('parseShoppingAssignmentsCsv', () => {
  it('parses the canonical format into a name → stop lookup', () => {
    expect(parseShoppingAssignmentsCsv(ASSIGNMENTS_TEXT, ROUTE)).toEqual(ASSIGNMENTS);
  });

  it('carries no order: the same rows in another order parse equal', () => {
    const reordered = [
      'Item;Store;Section',
      'Klopapier;dm;Drogerie',
      'TK-Blaubeeren;REWE;TK-Obst',
      'Karotten;Lidl;Obst und Gemüse',
      'Joghurt;Lidl;Molkerei',
    ].join('\n');
    expect(parseShoppingAssignmentsCsv(reordered, ROUTE)).toEqual(ASSIGNMENTS);
  });

  it('accepts an item name the ingredient list does not know (superset name set)', () => {
    // Klopapier, Seife and Blumen have no base unit and no reorder point, so
    // they cannot live in the ingredient master data — this file is their only
    // home, and it is deliberately not checked against the ingredient list.
    const text = `${ASSIGNMENTS_TEXT}\nSeife;dm;Drogerie`;
    expect(parseShoppingAssignmentsCsv(text, ROUTE).Seife).toEqual({
      store: 'dm',
      section: 'Drogerie',
    });
  });

  it('allows several items in the same stop', () => {
    const text = `${ASSIGNMENTS_TEXT}\nSeife;dm;Drogerie`;
    const assignments = parseShoppingAssignmentsCsv(text, ROUTE);
    expect(assignments.Klopapier).toEqual(assignments.Seife);
  });

  it('tolerates CRLF, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${ASSIGNMENTS_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseShoppingAssignmentsCsv(sloppy, ROUTE)).toEqual(ASSIGNMENTS);
  });

  it('throws on an empty file', () => {
    expect(() => parseShoppingAssignmentsCsv('', ROUTE)).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseShoppingAssignmentsCsv('Item;Store\nKarotten;Lidl', ROUTE)).toThrow(
      /Kopfzeile/,
    );
  });

  it('throws on a row with too many columns', () => {
    expect(() =>
      parseShoppingAssignmentsCsv(`${ASSIGNMENTS_TEXT}\nSeife;dm;Drogerie;extra`, ROUTE),
    ).toThrow(/unerwartete Spaltenzahl/);
  });

  it('throws on an empty item, store or section cell', () => {
    expect(() =>
      parseShoppingAssignmentsCsv(
        ASSIGNMENTS_TEXT.replace('Klopapier;dm;Drogerie', ';dm;Drogerie'),
        ROUTE,
      ),
    ).toThrow(/leerer Artikel, Store oder Section/);
  });

  it('throws on a duplicated item', () => {
    expect(() =>
      parseShoppingAssignmentsCsv(`${ASSIGNMENTS_TEXT}\nKlopapier;Lidl;Molkerei`, ROUTE),
    ).toThrow(/doppelter Artikel "Klopapier"/);
  });

  it('throws when an assignment names a stop that is not in the route', () => {
    expect(() =>
      parseShoppingAssignmentsCsv(
        ASSIGNMENTS_TEXT.replace('Klopapier;dm;Drogerie', 'Klopapier;dm;Haushalt'),
        ROUTE,
      ),
    ).toThrow(/Einkaufsort "dm; Haushalt" für "Klopapier" steht nicht im Einkaufsweg/);
  });
});

describe('shopping-route seed files (docs/)', () => {
  /** Reads a seed file from the repository `docs/` folder. */
  const readSeed = (name: string): string => readFileSync(join(DOCS_DIR, name), 'utf8');

  it('parses as a consistent pair: every assigned stop exists in the route', () => {
    const route = parseShoppingRouteCsv(readSeed('shopping_route.csv'));
    const assignments = parseShoppingAssignmentsCsv(readSeed('shopping_items.csv'), route);
    expect(route.length).toBeGreaterThan(1);
    expect(Object.keys(assignments).length).toBeGreaterThan(1);
  });

  it('covers items that are not recipe ingredients', () => {
    // The whole point of the separate assignment file: Klopapier, Seife and
    // Blumen exist in no ingredient list.
    const route = parseShoppingRouteCsv(readSeed('shopping_route.csv'));
    const assignments = parseShoppingAssignmentsCsv(readSeed('shopping_items.csv'), route);
    expect(assignments.Klopapier).toBeDefined();
    expect(assignments.Seife).toBeDefined();
    expect(assignments.Blumen).toBeDefined();
  });
});
