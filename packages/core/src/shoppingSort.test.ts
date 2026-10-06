/**
 * Tests for the shopping-list sort (docs/storage_format.md §10): matching a Keep
 * line back to an assignment item name, recovering the item name for a line
 * without one, and deriving the target order from the route.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ShoppingAssignments, ShoppingRoute } from './shoppingRouteCsv.js';
import { resetShoppingRoute, setShoppingAssignments, setShoppingRoute } from './shoppingRouteRegistry.js';
import {
  analyzeShoppingList,
  matchShoppingItem,
  shoppingItemName,
  shoppingSortOrder,
  type ShoppingSortLine,
} from './shoppingSort.js';

/** A small route: Lidl (two sections) then REWE (one section). */
const ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Molkerei' },
  { store: 'Lidl', section: 'Trockensortiment' },
  { store: 'REWE', section: 'Obst und Gemüse' },
];

/** Assignment covering both the app's ingredient lines and non-ingredient items. */
const ASSIGNMENTS: ShoppingAssignments = {
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  Mehl: { store: 'Lidl', section: 'Trockensortiment' },
  Karotten: { store: 'REWE', section: 'Obst und Gemüse' },
  Klopapier: { store: 'REWE', section: 'Obst und Gemüse' },
};

afterEach(() => {
  resetShoppingRoute();
});

describe('matchShoppingItem', () => {
  it('matches the app’s shopping-unit and base line shapes', () => {
    setShoppingAssignments(ASSIGNMENTS);
    expect(matchShoppingItem('2 Becher Joghurt (800 g)')).toBe('Joghurt');
    expect(matchShoppingItem('850 g Butter')).toBeNull(); // Butter has no row here
    expect(matchShoppingItem('1 Packung Mehl (1 kg)')).toBe('Mehl');
    expect(matchShoppingItem('6 Stück Karotten (500 g)')).toBe('Karotten');
  });

  it('matches a bare hand-typed item name', () => {
    setShoppingAssignments(ASSIGNMENTS);
    expect(matchShoppingItem('Klopapier')).toBe('Klopapier');
  });

  it('returns null for a line that names no assigned item', () => {
    setShoppingAssignments(ASSIGNMENTS);
    expect(matchShoppingItem('Wandfarbe')).toBeNull();
    expect(matchShoppingItem('500 g Reis')).toBeNull();
  });

  it('keeps an overlapping name apart by its word boundary', () => {
    // "Blaubeeren" must not match inside "TK-Blaubeeren" (hyphen is a word
    // character); the longer name wins where both would match.
    setShoppingAssignments({ Blaubeeren: { store: 'Lidl', section: 'Molkerei' } });
    expect(matchShoppingItem('1 Packung TK-Blaubeeren (300 g)')).toBeNull();

    setShoppingAssignments({
      Blaubeeren: { store: 'Lidl', section: 'Molkerei' },
      'TK-Blaubeeren': { store: 'REWE', section: 'Obst und Gemüse' },
    });
    expect(matchShoppingItem('1 Packung TK-Blaubeeren (300 g)')).toBe('TK-Blaubeeren');
  });

  it('returns null when two equal-length names both match', () => {
    setShoppingAssignments({
      Salz: { store: 'Lidl', section: 'Molkerei' },
      Reis: { store: 'Lidl', section: 'Trockensortiment' },
    });
    // "Salz" and "Reis" are both 4 characters and both whole words here.
    expect(matchShoppingItem('Salz Reis')).toBeNull();
  });
});

describe('shoppingItemName', () => {
  it('prefers the ingredient master data over the decoration fallback', () => {
    // "Joghurt" is a registered ingredient (the seed), so the vocabulary wins
    // even though the decoration fallback would reach the same name.
    expect(shoppingItemName('2 Becher Joghurt (800 g)')).toBe('Joghurt');
    expect(shoppingItemName('850 g Butter')).toBe('Butter');
    expect(shoppingItemName('1,15 kg Mehl')).toBe('Mehl');
  });

  it('falls back to stripping the decoration for an unregistered name', () => {
    expect(shoppingItemName('600 g Tofu')).toBe('Tofu');
    expect(shoppingItemName('3 Stück Brokkoli (500 g)')).toBe('Brokkoli');
  });

  it('keeps a hand-typed line without decoration unchanged', () => {
    expect(shoppingItemName('Klopapier')).toBe('Klopapier');
    expect(shoppingItemName('Wandfarbe weiß')).toBe('Wandfarbe weiß');
  });
});

describe('analyzeShoppingList', () => {
  it('classifies each line by its matched assignment item', () => {
    setShoppingAssignments(ASSIGNMENTS);
    const lines = [
      { text: '2 Becher Joghurt (800 g)', checked: false },
      { text: '600 g Tofu', checked: false },
      { text: 'Klopapier', checked: true },
    ];
    expect(analyzeShoppingList(lines)).toEqual([
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' },
      { text: '600 g Tofu', checked: false, item: null },
      { text: 'Klopapier', checked: true, item: 'Klopapier' },
    ]);
  });
});

describe('shoppingSortOrder', () => {
  it('orders ignored, then assigned by route, then checked — stable within a stop', () => {
    setShoppingRoute(ROUTE);
    setShoppingAssignments(ASSIGNMENTS);

    // Keep's own order is deliberately not the route order.
    const lines: ShoppingSortLine[] = [
      { text: 'Wandfarbe', checked: false, item: null }, // ignored
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' }, // Lidl/Molkerei
      { text: '6 Stück Karotten (500 g)', checked: false, item: 'Karotten' }, // REWE/Obst
      { text: '1 Packung Mehl (1 kg)', checked: false, item: 'Mehl' }, // Lidl/Trocken
      { text: 'Klopapier', checked: true, item: 'Klopapier' }, // checked
      { text: '600 g Tofu', checked: false, item: null }, // resolved to a stop
    ];

    const order = shoppingSortOrder(lines, (text) =>
      text === 'Wandfarbe' ? 'ignore' : { store: 'Lidl', section: 'Trockensortiment' },
    );

    expect(order).toEqual([
      'Wandfarbe', // ignored, top
      '2 Becher Joghurt (800 g)', // Lidl/Molkerei
      '1 Packung Mehl (1 kg)', // Lidl/Trockensortiment (before the resolved tofu, stable)
      '600 g Tofu', // Lidl/Trockensortiment (resolved)
      '6 Stück Karotten (500 g)', // REWE/Obst und Gemüse
      'Klopapier', // checked, bottom
    ]);
  });

  it('keeps ignored lines in Keep’s own order at the top', () => {
    setShoppingRoute(ROUTE);
    setShoppingAssignments(ASSIGNMENTS);
    const lines: ShoppingSortLine[] = [
      { text: 'Wandfarbe', checked: false, item: null },
      { text: 'Blumen', checked: false, item: null },
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' },
    ];
    const order = shoppingSortOrder(lines, () => 'ignore');
    expect(order).toEqual(['Wandfarbe', 'Blumen', '2 Becher Joghurt (800 g)']);
  });
});
