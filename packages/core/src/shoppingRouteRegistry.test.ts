/**
 * Tests for the shopping-route runtime registry (docs/storage_format.md §10):
 * the seed it starts from, the derived store/section lists the new-ingredient
 * sheet's pickers are built from, and the item/synonym lookup used later by the
 * aisle sort.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ShoppingItems, ShoppingRoute, ShoppingSynonyms } from './shoppingRouteCsv.js';
import {
  allShoppingItems,
  allShoppingStops,
  allShoppingSynonyms,
  resetShoppingRoute,
  setShoppingItems,
  setShoppingRoute,
  setShoppingSynonyms,
  shoppingItemNames,
  shoppingSections,
  shoppingStopFor,
  shoppingStores,
  shoppingVariantsFor,
} from './shoppingRouteRegistry.js';

/**
 * A small route fixture: two stores, one of them with two sections. Lidl is
 * deliberately listed again at the end, so the store list has to collapse it.
 */
const ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Molkerei' },
  { store: 'REWE', section: 'Obst und Gemüse' },
  { store: 'Lidl', section: 'Trockensortiment' },
];

/** The item fixture: one ingredient, one non-ingredient item. */
const ITEMS: ShoppingItems = {
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  Klopapier: { store: 'REWE', section: 'Obst und Gemüse' },
};

/** The synonym fixture: one variant per item. */
const SYNONYMS: ShoppingSynonyms = {
  Möhren: 'Karotten',
  Zewa: 'Klopapier',
};

afterEach(() => {
  resetShoppingRoute();
});

describe('shopping-route registry', () => {
  it('starts from the generated seed', () => {
    expect(allShoppingStops().length).toBeGreaterThan(1);
    expect(shoppingStopFor('Karotten')).toBeDefined();
  });

  it('stores a replaced route, item table and synonym table', () => {
    setShoppingRoute(ROUTE);
    setShoppingItems(ITEMS);
    setShoppingSynonyms(SYNONYMS);
    expect(allShoppingStops()).toEqual(ROUTE);
    expect(allShoppingItems()).toEqual(ITEMS);
    expect(allShoppingSynonyms()).toEqual(SYNONYMS);
  });

  it('restores the seed on reset', () => {
    const seedRoute = allShoppingStops();
    const seedItems = allShoppingItems();
    const seedSynonyms = allShoppingSynonyms();
    setShoppingRoute([]);
    setShoppingItems({});
    setShoppingSynonyms({});
    resetShoppingRoute();
    expect(allShoppingStops()).toEqual(seedRoute);
    expect(allShoppingItems()).toEqual(seedItems);
    expect(allShoppingSynonyms()).toEqual(seedSynonyms);
    expect(shoppingStopFor('Karotten')).toBeDefined();
  });

  it('looks an item up by its exact name', () => {
    setShoppingItems(ITEMS);
    expect(shoppingStopFor('Joghurt')).toEqual({ store: 'Lidl', section: 'Molkerei' });
    // The lookup itself is exact: folding happens in the line matching
    // (shoppingSort.ts), where a differently cased line is folded onto the name.
    expect(shoppingStopFor('joghurt')).toBeUndefined();
    expect(shoppingStopFor('Seife')).toBeUndefined();
  });
});

describe('shoppingStores', () => {
  it('lists each store once, in the order of its first stop', () => {
    setShoppingRoute(ROUTE);
    expect(shoppingStores()).toEqual(['Lidl', 'REWE']);
  });

  it('is empty for an empty route', () => {
    setShoppingRoute([]);
    expect(shoppingStores()).toEqual([]);
  });
});

describe('shoppingSections', () => {
  it('lists the sections of one store in walking order', () => {
    setShoppingRoute(ROUTE);
    expect(shoppingSections('Lidl')).toEqual(['Molkerei', 'Trockensortiment']);
    expect(shoppingSections('REWE')).toEqual(['Obst und Gemüse']);
  });

  it('does not mix up the same section name in two stores', () => {
    // "Obst und Gemüse" may exist in several stores; the pair is the key, so
    // only the sections of the asked-for store are returned.
    setShoppingRoute([
      { store: 'Lidl', section: 'Obst und Gemüse' },
      { store: 'REWE', section: 'Obst und Gemüse' },
    ]);
    expect(shoppingSections('Lidl')).toEqual(['Obst und Gemüse']);
    expect(shoppingSections('REWE')).toEqual(['Obst und Gemüse']);
    expect(shoppingSections('dm')).toEqual([]);
  });

  it('is empty for an unknown store', () => {
    setShoppingRoute(ROUTE);
    expect(shoppingSections('dm')).toEqual([]);
  });
});

describe('shoppingItemNames', () => {
  it('lists every item once, alphabetically by German collation', () => {
    setShoppingItems({ Zwiebeln: ROUTE[0]!, Äpfel: ROUTE[0]!, Mehl: ROUTE[0]! });
    // Umlauts sort with their base letter in German collation (ä before m),
    // which is what a reference list expects.
    expect(shoppingItemNames()).toEqual(['Äpfel', 'Mehl', 'Zwiebeln']);
  });

  it('is empty for an empty item table', () => {
    setShoppingItems({});
    expect(shoppingItemNames()).toEqual([]);
  });
});

describe('shoppingVariantsFor', () => {
  it('lists exactly the variants of one item', () => {
    setShoppingSynonyms({ Möhren: 'Karotten', Zewa: 'Klopapier', Mohrrüben: 'Karotten' });
    expect(shoppingVariantsFor('Karotten')).toEqual(['Möhren', 'Mohrrüben']);
    expect(shoppingVariantsFor('Klopapier')).toEqual(['Zewa']);
  });

  it('is empty for an item without synonyms', () => {
    setShoppingSynonyms(SYNONYMS);
    expect(shoppingVariantsFor('Butter')).toEqual([]);
  });
});
