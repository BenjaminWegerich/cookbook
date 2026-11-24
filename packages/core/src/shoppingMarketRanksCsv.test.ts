/**
 * Tests for the market-rank CSV (docs/storage_format.md §10): the fourth
 * shopping master-data file, its validation against the route, and its
 * round-trip.
 */

import { describe, expect, it } from 'vitest';

import type { ShoppingRoute } from './shoppingRouteCsv.js';
import {
  parseShoppingMarketRanksCsv,
  serializeShoppingMarketRanksCsv,
  type ShoppingMarketRanks,
} from './shoppingMarketRanksCsv.js';

const ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Obst' },
  { store: 'Rewe', section: 'Obst' },
  { store: 'dm', section: 'Drogerie' },
];

const RANKS_TEXT = ['Store;Rank', 'Lidl;1', 'Rewe;2', 'dm;3'].join('\n');

const RANKS: ShoppingMarketRanks = {
  Lidl: 1,
  Rewe: 2,
  dm: 3,
};

describe('parseShoppingMarketRanksCsv', () => {
  it('parses the canonical table', () => {
    expect(parseShoppingMarketRanksCsv(RANKS_TEXT, ROUTE)).toEqual(RANKS);
  });

  it('allows a partial table (missing stores get a fallback rank)', () => {
    expect(parseShoppingMarketRanksCsv('Store;Rank\nRewe;1', ROUTE)).toEqual({ Rewe: 1 });
  });

  it('tolerates CRLF, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${RANKS_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseShoppingMarketRanksCsv(sloppy, ROUTE)).toEqual(RANKS);
  });

  it('throws on an empty file', () => {
    expect(() => parseShoppingMarketRanksCsv('', ROUTE)).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseShoppingMarketRanksCsv('Store;Priority\nLidl;1', ROUTE)).toThrow(/Kopfzeile/);
  });

  it('throws on an empty store or rank cell', () => {
    expect(() => parseShoppingMarketRanksCsv('Store;Rank\n;1', ROUTE)).toThrow(
      /leerer Store oder Rang/,
    );
  });

  it('throws on a store that is not in the route', () => {
    expect(() => parseShoppingMarketRanksCsv('Store;Rank\nKaufland;1', ROUTE)).toThrow(
      /steht nicht im Einkaufsweg/,
    );
  });

  it('throws on a duplicated store', () => {
    expect(() => parseShoppingMarketRanksCsv(`${RANKS_TEXT}\nLidl;4`, ROUTE)).toThrow(
      /doppelter Markt "Lidl"/,
    );
  });

  it('throws on a non-positive or non-integer rank', () => {
    expect(() => parseShoppingMarketRanksCsv('Store;Rank\nLidl;0', ROUTE)).toThrow(
      /positive ganze Zahl/,
    );
    expect(() => parseShoppingMarketRanksCsv('Store;Rank\nLidl;1,5', ROUTE)).toThrow(
      /positive ganze Zahl/,
    );
  });

  it('throws on a duplicated rank', () => {
    expect(() => parseShoppingMarketRanksCsv('Store;Rank\nLidl;1\nRewe;1', ROUTE)).toThrow(
      /denselben Rang 1/,
    );
  });
});

describe('serializeShoppingMarketRanksCsv', () => {
  it('writes one row per store, sorted by rank', () => {
    expect(serializeShoppingMarketRanksCsv({ dm: 3, Rewe: 2, Lidl: 1 }, ROUTE)).toBe(
      `${RANKS_TEXT}\n`,
    );
  });

  it('round-trips: parse(serialize(ranks)) is the ranks', () => {
    const text = serializeShoppingMarketRanksCsv(RANKS, ROUTE);
    expect(parseShoppingMarketRanksCsv(text, ROUTE)).toEqual(RANKS);
  });

  it('fails loudly when a rank names a store outside the route', () => {
    expect(() => serializeShoppingMarketRanksCsv({ Kaufland: 1 }, ROUTE)).toThrow(
      /steht nicht im Einkaufsweg/,
    );
  });
});
