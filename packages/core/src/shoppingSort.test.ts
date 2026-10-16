/**
 * Tests for the shopping-list identity work (docs/shopping_item_identity.md):
 * deriving a line's name field, resolving it to an item at read time, the
 * suggestions for an unresolved line, and the target order derived from the
 * route.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ShoppingItems, ShoppingRoute, ShoppingSynonyms } from './shoppingRouteCsv.js';
import {
  resetShoppingRoute,
  setShoppingItems,
  setShoppingRoute,
  setShoppingSynonyms,
} from './shoppingRouteRegistry.js';
import {
  analyzeShoppingList,
  matchShoppingItem,
  shoppingItemSuggestions,
  shoppingNameField,
  shoppingSortOrder,
  type ShoppingSortLine,
} from './shoppingSort.js';

/** Narrow no-break space, the separator the app writes between number and unit. */
const N = '\u202F';

/** A small route: Lidl (two sections) then REWE (one section). */
const ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Molkerei' },
  { store: 'Lidl', section: 'Trockensortiment' },
  { store: 'REWE', section: 'Obst und Gemüse' },
];

/** Item table covering the app's ingredient lines, non-ingredients and look-alikes. */
const ITEMS: ShoppingItems = {
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  Butter: { store: 'Lidl', section: 'Molkerei' },
  Mehl: { store: 'Lidl', section: 'Trockensortiment' },
  Karotten: { store: 'REWE', section: 'Obst und Gemüse' },
  Klopapier: { store: 'REWE', section: 'Obst und Gemüse' },
  Petersilie: { store: 'REWE', section: 'Obst und Gemüse' },
  Blaubeeren: { store: 'REWE', section: 'Obst und Gemüse' },
  'TK-Blaubeeren': { store: 'REWE', section: 'Obst und Gemüse' },
  'Weiße Bohnen': { store: 'REWE', section: 'Obst und Gemüse' },
};

/** Two synonyms: one plain, one whose item is a non-ingredient. */
const SYNONYMS: ShoppingSynonyms = {
  Möhren: 'Karotten',
  Zewa: 'Klopapier',
};

afterEach(() => {
  resetShoppingRoute();
});

describe('shoppingNameField', () => {
  it('undoes the app’s shopping-unit shape', () => {
    expect(shoppingNameField('2 Becher Joghurt (800 g)')).toBe('Joghurt');
    expect(shoppingNameField('1 Packung Mehl (1 kg)')).toBe('Mehl');
    expect(shoppingNameField('6 Stück Karotten (500 g)')).toBe('Karotten');
    // The app separates number and unit with a narrow no-break space.
    expect(shoppingNameField(`2${N}Becher${N}Joghurt${N}(800${N}g)`)).toBe('Joghurt');
  });

  it('undoes the app’s plural unit form', () => {
    // A count above one makes the app write the unit's plural form
    // (docs/additional_quantity_specifications.md §3), so the derived
    // vocabulary carries it too.
    expect(shoppingNameField('2 Packungen Mehl (2 kg)')).toBe('Mehl');
    expect(shoppingNameField(`2${N}Packungen${N}Mehl${N}(2${N}kg)`)).toBe('Mehl');
  });

  it('undoes the app’s base shape, including the kg / l display step', () => {
    expect(shoppingNameField('850 g Butter')).toBe('Butter');
    expect(shoppingNameField('1,15 kg Mehl')).toBe('Mehl');
    expect(shoppingNameField('750 ml Milch')).toBe('Milch');
    expect(shoppingNameField(`3${N}kg${N}Mehl`)).toBe('Mehl');
  });

  it('carries no knowledge of what exists: it only reverses a text shape', () => {
    // Tofu is not in the item table; the field is still derived from the shape.
    expect(shoppingNameField('600 g Tofu')).toBe('Tofu');
  });

  it('normalizes Unicode and whitespace, keeping the user’s spelling', () => {
    expect(shoppingNameField('  850   g   Mehl  ')).toBe('Mehl');
    expect(shoppingNameField('Cafe\u0301')).toBe('Café');
  });

  it('leaves a hand-typed line without decoration unchanged', () => {
    expect(shoppingNameField('Klopapier')).toBe('Klopapier');
    expect(shoppingNameField('Wandfarbe weiß')).toBe('Wandfarbe weiß');
  });

  it('does not undo a shape the app never writes', () => {
    // "Handvoll" is neither a shopping unit nor a base unit, so the leading "1"
    // is not decoration either — the line stays as it is and is answered by a
    // suggestion (docs/shopping_item_identity.md §2).
    expect(shoppingNameField('1 Handvoll Petersilie')).toBe('1 Handvoll Petersilie');
    // EL and TL are the display forms of Esslöffel/Teelöffel, which are recipe
    // measures, not shopping units: the app never writes them onto a shopping
    // line, so they are not part of the vocabulary.
    expect(shoppingNameField('2 EL Zucker')).toBe('2 EL Zucker');
  });

  it('is empty for an empty line', () => {
    expect(shoppingNameField('   ')).toBe('');
  });
});

describe('matchShoppingItem', () => {
  it('matches the app’s shopping-unit and base line shapes', () => {
    setShoppingItems(ITEMS);
    expect(matchShoppingItem('2 Becher Joghurt (800 g)')).toBe('Joghurt');
    expect(matchShoppingItem('850 g Butter')).toBe('Butter');
    expect(matchShoppingItem('1 Packung Mehl (1 kg)')).toBe('Mehl');
    expect(matchShoppingItem('2 Packungen Mehl (2 kg)')).toBe('Mehl');
    expect(matchShoppingItem('6 Stück Karotten (500 g)')).toBe('Karotten');
  });

  it('matches a bare hand-typed item name', () => {
    setShoppingItems(ITEMS);
    expect(matchShoppingItem('Klopapier')).toBe('Klopapier');
  });

  it('matches case-folded, including the German ß', () => {
    setShoppingItems(ITEMS);
    expect(matchShoppingItem('joghurt')).toBe('Joghurt');
    expect(matchShoppingItem('JOGHURT')).toBe('Joghurt');
    expect(matchShoppingItem('WEISSE BOHNEN')).toBe('Weiße Bohnen');
  });

  it('resolves a variant to its item', () => {
    setShoppingItems(ITEMS);
    setShoppingSynonyms(SYNONYMS);
    expect(matchShoppingItem('Möhren')).toBe('Karotten');
    expect(matchShoppingItem('500 g Möhren')).toBe('Karotten');
    expect(matchShoppingItem('zewa')).toBe('Klopapier');
  });

  it('requires the whole name field to be the name, never a part of it', () => {
    setShoppingItems(ITEMS);
    setShoppingSynonyms(SYNONYMS);
    // The line names no item at its head; it merely contains item names.
    expect(matchShoppingItem('Muffins mit Blaubeeren')).toBeNull();
    expect(matchShoppingItem('TK-Blaubeeren extra')).toBeNull();
    expect(matchShoppingItem('Mehl Type 405')).toBeNull();
    expect(matchShoppingItem('500 g Reis')).toBeNull();
    expect(matchShoppingItem('Wandfarbe')).toBeNull();
  });

  it('does not undo an unknown unit just to reach a known name', () => {
    setShoppingItems(ITEMS);
    // Petersilie exists, but "1 Handvoll Petersilie" is not that name field.
    expect(matchShoppingItem('1 Handvoll Petersilie')).toBeNull();
  });

  it('returns null for an empty line', () => {
    setShoppingItems(ITEMS);
    expect(matchShoppingItem('')).toBeNull();
  });
});

describe('shoppingItemSuggestions', () => {
  it('suggests an item name contained in the name field', () => {
    setShoppingItems(ITEMS);
    expect(shoppingItemSuggestions('1 Handvoll Petersilie')).toEqual(['Petersilie']);
  });

  it('suggests items the name field is a prefix of, names first', () => {
    setShoppingItems(ITEMS);
    expect(shoppingItemSuggestions('Blaubeer')).toEqual(['Blaubeeren', 'TK-Blaubeeren']);
    expect(shoppingItemSuggestions('Meh')).toEqual(['Mehl']);
  });

  it('takes candidates from the item names, not from the variants', () => {
    setShoppingItems(ITEMS);
    setShoppingSynonyms(SYNONYMS);
    // "Möhren" is a variant; the candidate set must not grow with the variants.
    expect(shoppingItemSuggestions('Möhren')).toEqual([]);
  });

  it('honours the limit and is empty without a name field', () => {
    setShoppingItems(ITEMS);
    expect(shoppingItemSuggestions('Blaubeer', 1)).toEqual(['Blaubeeren']);
    expect(shoppingItemSuggestions('   ')).toEqual([]);
  });
});

describe('analyzeShoppingList', () => {
  it('classifies each line by the item it resolved to', () => {
    setShoppingItems(ITEMS);
    setShoppingSynonyms(SYNONYMS);
    const lines = [
      { text: '2 Becher Joghurt (800 g)', checked: false },
      { text: '600 g Tofu', checked: false },
      { text: '500 g Möhren', checked: false },
      { text: 'Klopapier', checked: true },
    ];
    expect(analyzeShoppingList(lines)).toEqual([
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' },
      { text: '600 g Tofu', checked: false, item: null },
      { text: '500 g Möhren', checked: false, item: 'Karotten' },
      { text: 'Klopapier', checked: true, item: 'Klopapier' },
    ]);
  });
});

describe('the built-in seed (no fixture)', () => {
  it('resolves the app’s own line shapes and bare hand-typed names', () => {
    // The shipped seed (docs/shopping_items.csv) must stay resolvable through
    // the pipeline; a new seed row whose name collides with the decoration
    // vocabulary would break this.
    expect(matchShoppingItem('2 Becher Joghurt (800 g)')).toBe('Joghurt');
    expect(matchShoppingItem('850 g Mehl')).toBe('Mehl');
    expect(matchShoppingItem('Klopapier')).toBe('Klopapier');
    expect(matchShoppingItem('1 Handvoll Petersilie')).toBeNull();
  });
});

describe('shoppingSortOrder', () => {
  it('orders ignored, then assigned by route, then checked — stable within a stop', () => {
    setShoppingRoute(ROUTE);
    setShoppingItems(ITEMS);

    // Keep's own order is deliberately not the route order.
    const lines: ShoppingSortLine[] = [
      { text: 'Wandfarbe', checked: false, item: null }, // ignored
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' }, // Lidl/Molkerei
      { text: '6 Stück Karotten (500 g)', checked: false, item: 'Karotten' }, // REWE/Obst
      { text: '1 Packung Mehl (1 kg)', checked: false, item: 'Mehl' }, // Lidl/Trocken
      { text: 'Klopapier', checked: true, item: 'Klopapier' }, // checked
      { text: '1 Handvoll Petersilie', checked: false, item: null }, // resolved to a stop
    ];

    const order = shoppingSortOrder(lines, (text) =>
      text === 'Wandfarbe' ? 'ignore' : { store: 'Lidl', section: 'Trockensortiment' },
    );

    expect(order).toEqual([
      'Wandfarbe', // ignored, top
      '2 Becher Joghurt (800 g)', // Lidl/Molkerei
      '1 Packung Mehl (1 kg)', // Lidl/Trockensortiment (before the resolved one, stable)
      '1 Handvoll Petersilie', // Lidl/Trockensortiment (resolved)
      '6 Stück Karotten (500 g)', // REWE/Obst und Gemüse
      'Klopapier', // checked, bottom
    ]);
  });

  it('keeps ignored lines in Keep’s own order at the top', () => {
    setShoppingRoute(ROUTE);
    setShoppingItems(ITEMS);
    const lines: ShoppingSortLine[] = [
      { text: 'Wandfarbe', checked: false, item: null },
      { text: 'Blumen', checked: false, item: null },
      { text: '2 Becher Joghurt (800 g)', checked: false, item: 'Joghurt' },
    ];
    const order = shoppingSortOrder(lines, () => 'ignore');
    expect(order).toEqual(['Wandfarbe', 'Blumen', '2 Becher Joghurt (800 g)']);
  });
});
