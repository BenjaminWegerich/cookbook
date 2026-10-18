/**
 * Tests for the shopping master data (docs/storage_format.md §10,
 * docs/shopping_item_identity.md) — the three CSV codecs, their identity rules,
 * and the consistency of the repository's seed files in `docs/`, which are the
 * built-in data used on first run.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseShoppingItemsCsv,
  parseShoppingRouteCsv,
  parseShoppingSynonymsCsv,
  serializeShoppingItemsCsv,
  serializeShoppingRouteCsv,
  serializeShoppingSynonymsCsv,
  type ShoppingItems,
  type ShoppingRoute,
  type ShoppingSynonyms,
} from './shoppingRouteCsv.js';
import {
  SEED_SHOPPING_ITEMS,
  SEED_SHOPPING_ROUTE,
  SEED_SHOPPING_SYNONYMS,
} from './shoppingRouteData.js';

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

/** The canonical item table (docs format) as a fixture. */
const ITEMS_TEXT = [
  'Item;Store;Section',
  'Karotten;Lidl;Obst und Gemüse',
  'Joghurt;Lidl;Molkerei',
  'TK-Blaubeeren;REWE;TK-Obst',
  'Klopapier;dm;Drogerie',
].join('\n');

const ITEMS: ShoppingItems = {
  Karotten: { store: 'Lidl', section: 'Obst und Gemüse' },
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  'TK-Blaubeeren': { store: 'REWE', section: 'TK-Obst' },
  Klopapier: { store: 'dm', section: 'Drogerie' },
};

/** The canonical synonym table (docs format) as a fixture. */
const SYNONYMS_TEXT = ['Variant;Item', 'Möhren;Karotten', 'Zewa;Klopapier'].join('\n');

const SYNONYMS: ShoppingSynonyms = {
  Möhren: 'Karotten',
  Zewa: 'Klopapier',
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

  it('parses a comma-separated spreadsheet export', () => {
    // Same tolerance as the ingredient master data (csv.ts): a comma-delimited
    // export loads, and the next write emits the canonical semicolon form.
    const comma = ROUTE_TEXT.replaceAll(';', ',');
    expect(parseShoppingRouteCsv(comma)).toEqual(ROUTE);
    expect(serializeShoppingRouteCsv(parseShoppingRouteCsv(comma))).toBe(`${ROUTE_TEXT}\n`);
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

describe('serializeShoppingRouteCsv', () => {
  it('writes the canonical format in route order', () => {
    expect(serializeShoppingRouteCsv(ROUTE)).toBe(`${ROUTE_TEXT}\n`);
  });

  it('round-trips: parse(serialize(route)) is the route', () => {
    expect(parseShoppingRouteCsv(serializeShoppingRouteCsv(ROUTE))).toEqual(ROUTE);
  });

  it('keeps the order of the stops it is given', () => {
    const reversed = [...ROUTE].reverse();
    expect(serializeShoppingRouteCsv(reversed).split('\n').slice(1, 3)).toEqual([
      'dm;Drogerie',
      'REWE;TK-Obst',
    ]);
  });

  it('fails loudly instead of emitting text the parser would reject', () => {
    // The format has no quoting (csv.ts): a semicolon inside a cell cannot be
    // read back, so the round-trip check in the serializer must throw.
    const broken: ShoppingRoute = [{ store: 'Lidl', section: 'Obst;Gemüse' }];
    expect(() => serializeShoppingRouteCsv(broken)).toThrow(/Spaltenzahl/);
  });
});

describe('parseShoppingItemsCsv', () => {
  it('parses the canonical format into a name → stop lookup', () => {
    expect(parseShoppingItemsCsv(ITEMS_TEXT, ROUTE)).toEqual(ITEMS);
  });

  it('carries no order: the same rows in another order parse equal', () => {
    const reordered = [
      'Item;Store;Section',
      'Klopapier;dm;Drogerie',
      'TK-Blaubeeren;REWE;TK-Obst',
      'Karotten;Lidl;Obst und Gemüse',
      'Joghurt;Lidl;Molkerei',
    ].join('\n');
    expect(parseShoppingItemsCsv(reordered, ROUTE)).toEqual(ITEMS);
  });

  it('accepts an item name the ingredient list does not know (superset name set)', () => {
    // Klopapier, Seife and Blumen have no base unit and no reorder point, so
    // they cannot live in the ingredient master data — this file is their only
    // home, and it is deliberately not checked against the ingredient list.
    const text = `${ITEMS_TEXT}\nSeife;dm;Drogerie`;
    expect(parseShoppingItemsCsv(text, ROUTE).Seife).toEqual({
      store: 'dm',
      section: 'Drogerie',
    });
  });

  it('allows several items in the same stop', () => {
    const text = `${ITEMS_TEXT}\nSeife;dm;Drogerie`;
    const items = parseShoppingItemsCsv(text, ROUTE);
    expect(items.Klopapier).toEqual(items.Seife);
  });

  it('tolerates CRLF, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${ITEMS_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseShoppingItemsCsv(sloppy, ROUTE)).toEqual(ITEMS);
  });

  it('throws on an empty file', () => {
    expect(() => parseShoppingItemsCsv('', ROUTE)).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseShoppingItemsCsv('Item;Store\nKarotten;Lidl', ROUTE)).toThrow(/Kopfzeile/);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseShoppingItemsCsv(`${ITEMS_TEXT}\nSeife;dm;Drogerie;extra`, ROUTE)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty item, store or section cell', () => {
    expect(() =>
      parseShoppingItemsCsv(ITEMS_TEXT.replace('Klopapier;dm;Drogerie', ';dm;Drogerie'), ROUTE),
    ).toThrow(/leerer Artikel, Store oder Section/);
  });

  it('throws on a duplicated item', () => {
    expect(() => parseShoppingItemsCsv(`${ITEMS_TEXT}\nKlopapier;Lidl;Molkerei`, ROUTE)).toThrow(
      /doppelter Artikel "Klopapier"/,
    );
  });

  it('throws when an item names a stop that is not in the route', () => {
    expect(() =>
      parseShoppingItemsCsv(
        ITEMS_TEXT.replace('Klopapier;dm;Drogerie', 'Klopapier;dm;Haushalt'),
        ROUTE,
      ),
    ).toThrow(/Einkaufsort "dm; Haushalt" für "Klopapier" steht nicht im Einkaufsweg/);
  });

  it('rejects two item names that differ only in letter case', () => {
    // Names are compared case-folded (docs/shopping_item_identity.md §2), so two
    // such rows would make every line that names one of them ambiguous.
    expect(() => parseShoppingItemsCsv(`${ITEMS_TEXT}\nkarotten;dm;Drogerie`, ROUTE)).toThrow(
      /nur in Groß-\/Kleinschreibung/,
    );
  });
});

describe('serializeShoppingItemsCsv', () => {
  it('writes the canonical format with the stop of every item', () => {
    expect(serializeShoppingItemsCsv(ITEMS, ROUTE)).toBe(`${ITEMS_TEXT}\n`);
  });

  it('round-trips: parse(serialize(items)) is the items', () => {
    const text = serializeShoppingItemsCsv(ITEMS, ROUTE);
    expect(parseShoppingItemsCsv(text, ROUTE)).toEqual(ITEMS);
  });

  it('keeps the record order it is given instead of sorting', () => {
    // A hand-sorted spreadsheet must survive a write unchanged: the item file's
    // row order carries no meaning, so the serializer never imposes one.
    const reversed: ShoppingItems = Object.fromEntries(Object.entries(ITEMS).reverse());
    const rows = serializeShoppingItemsCsv(reversed, ROUTE).split('\n').slice(1, 3);
    expect(rows).toEqual(['Klopapier;dm;Drogerie', 'TK-Blaubeeren;REWE;TK-Obst']);
  });

  it('fails loudly when an item names a stop outside the route', () => {
    const broken: ShoppingItems = { Seife: { store: 'dm', section: 'Haushalt' } };
    expect(() => serializeShoppingItemsCsv(broken, ROUTE)).toThrow(/steht nicht im Einkaufsweg/);
  });
});

describe('parseShoppingSynonymsCsv', () => {
  it('parses the canonical format into variant → item', () => {
    expect(parseShoppingSynonymsCsv(SYNONYMS_TEXT, ITEMS)).toEqual(SYNONYMS);
  });

  it('accepts an empty table (the header alone)', () => {
    // A synonym table starts empty and grows out of the user's real list
    // (docs/shopping_item_identity.md §4): the header row is all it holds.
    expect(parseShoppingSynonymsCsv('Variant;Item', ITEMS)).toEqual({});
  });

  it('tolerates CRLF, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${SYNONYMS_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseShoppingSynonymsCsv(sloppy, ITEMS)).toEqual(SYNONYMS);
  });

  it('throws on an empty file', () => {
    expect(() => parseShoppingSynonymsCsv('', ITEMS)).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseShoppingSynonymsCsv('Variant;Artikel\nMöhren;Karotten', ITEMS)).toThrow(
      /Kopfzeile/,
    );
  });

  it('throws on an empty variant or item cell', () => {
    expect(() => parseShoppingSynonymsCsv('Variant;Item\n;Karotten', ITEMS)).toThrow(
      /leerer Variant oder Item/,
    );
  });

  it('throws when a variant names an item that does not exist', () => {
    expect(() => parseShoppingSynonymsCsv('Variant;Item\nZewa;Küchenpapier', ITEMS)).toThrow(
      /Item "Küchenpapier" für Variant "Zewa" steht nicht in den Einkaufsartikeln/,
    );
  });

  it('rejects a variant that would shadow an item name', () => {
    // §5: a canonical item name must never be shadowed by a synonym — and the
    // comparison is case-folded like the matching itself.
    expect(() => parseShoppingSynonymsCsv('Variant;Item\nKarotten;Joghurt', ITEMS)).toThrow(
      /ist bereits ein Artikelname/,
    );
    expect(() => parseShoppingSynonymsCsv('Variant;Item\nkarotten;Joghurt', ITEMS)).toThrow(
      /ist bereits ein Artikelname/,
    );
  });

  it('rejects two variants that differ only in letter case', () => {
    expect(() =>
      parseShoppingSynonymsCsv('Variant;Item\nmöhren;Karotten\nMöhren;Karotten', ITEMS),
    ).toThrow(/nur in Groß-\/Kleinschreibung/);
  });
});

describe('serializeShoppingSynonymsCsv', () => {
  it('writes the canonical format with the item of every variant', () => {
    expect(serializeShoppingSynonymsCsv(SYNONYMS, ITEMS)).toBe(`${SYNONYMS_TEXT}\n`);
  });

  it('writes an empty table as the header alone', () => {
    expect(serializeShoppingSynonymsCsv({}, ITEMS)).toBe('Variant;Item\n');
  });

  it('round-trips: parse(serialize(synonyms)) is the synonyms', () => {
    const text = serializeShoppingSynonymsCsv(SYNONYMS, ITEMS);
    expect(parseShoppingSynonymsCsv(text, ITEMS)).toEqual(SYNONYMS);
  });

  it('fails loudly when a variant names an unknown item', () => {
    const broken: ShoppingSynonyms = { Zewa: 'Küchenpapier' };
    expect(() => serializeShoppingSynonymsCsv(broken, ITEMS)).toThrow(
      /steht nicht in den Einkaufsartikeln/,
    );
  });
});

describe('shopping master-data seed files (docs/)', () => {
  /** Reads a seed file from the repository `docs/` folder. */
  const readSeed = (name: string): string => readFileSync(join(DOCS_DIR, name), 'utf8');

  it('parses as a consistent set: every stop exists in the route', () => {
    const route = parseShoppingRouteCsv(readSeed('shopping_route.csv'));
    const items = parseShoppingItemsCsv(readSeed('shopping_items.csv'), route);
    expect(route.length).toBeGreaterThan(1);
    expect(Object.keys(items).length).toBeGreaterThan(1);
  });

  it('covers items that are not recipe ingredients', () => {
    // The whole point of the separate item table: Klopapier, Seife and Blumen
    // exist in no ingredient list.
    const route = parseShoppingRouteCsv(readSeed('shopping_route.csv'));
    const items = parseShoppingItemsCsv(readSeed('shopping_items.csv'), route);
    expect(items.Klopapier).toBeDefined();
    expect(items.Seife).toBeDefined();
    expect(items.Blumen).toBeDefined();
  });

  it('parses the synonym seed against the item seed', () => {
    const route = parseShoppingRouteCsv(readSeed('shopping_route.csv'));
    const items = parseShoppingItemsCsv(readSeed('shopping_items.csv'), route);
    expect(() => parseShoppingSynonymsCsv(readSeed('shopping_synonyms.csv'), items)).not.toThrow();
  });

  it('matches the generated seed module the runtime starts from', () => {
    // The compiled seed (shoppingRouteData.ts) is what the app ships; it is
    // generated from these three CSVs. This test is the drift guard between the
    // authoritative repository files and the module — re-run
    // `npm run generate:shopping-route` when it fails.
    expect(SEED_SHOPPING_ROUTE).toEqual(parseShoppingRouteCsv(readSeed('shopping_route.csv')));
    expect(SEED_SHOPPING_ITEMS).toEqual(
      parseShoppingItemsCsv(readSeed('shopping_items.csv'), SEED_SHOPPING_ROUTE),
    );
    expect(SEED_SHOPPING_SYNONYMS).toEqual(
      parseShoppingSynonymsCsv(readSeed('shopping_synonyms.csv'), SEED_SHOPPING_ITEMS),
    );
  });
});
