import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IngredientMappings } from './ingredientRegistry.js';
import { resetIngredientMappings, setIngredientMappings } from './ingredientRegistry.js';
import {
  comparePantryNeeds,
  sortPantryNeeds,
  storagePlaceOf,
  storagePlaceRank,
} from './pantrySort.js';
import type { ShoppingNeed } from './shoppingList.js';
import { STORAGE_PLACES } from './storagePlacesData.js';

/** One need with the amount/reorder pair the ordering reads. */
function need(
  ingredient: string,
  needed: number,
  reorderPoint: number,
  baseUnit: 'g' | 'ml' = 'g',
): ShoppingNeed {
  return { ingredient, baseUnit, needed, reorderPoint };
}

/** A registry entry with only the fields the ordering touches. */
function entry(storagePlace?: string) {
  return {
    bu: 'g',
    precision: 'medium' as const,
    reorderPoint: 0,
    entries: [],
    ...(storagePlace === undefined ? {} : { storagePlace }),
  };
}

/**
 * The fixture: two fridge rows, one freezer row, two drawer rows and two
 * unsorted rows. The reorder points make some rows "to buy" (reorder below the
 * need) and some "covered" (reorder at/above the need).
 */
const REGISTRY: IngredientMappings = {
  Milch: entry('Kühlschrank'),
  Butter: entry('Kühlschrank'),
  Joghurt: entry('Kühlschrank'),
  Erbsen: entry('Gefrierschrank'),
  Mehl: entry('Schublade 2'),
  Zucker: entry('Schublade 2'),
  Safran: entry('Gewürzregal'),
  Salz: entry(),
  Pfeffer: entry(),
};

const NEEDS: ShoppingNeed[] = [
  need('Zucker', 200, 200), // covered
  need('Salz', 10, 0), // to buy, unsorted
  need('Mehl', 500, 100), // to buy
  need('Butter', 250, 250), // covered
  need('Safran', 1, 0), // to buy
  need('Joghurt', 500, 500), // covered
  need('Pfeffer', 5, 5), // covered, unsorted
  need('Milch', 500, 0), // to buy
  need('Erbsen', 300, 0), // to buy
];

const names = (needs: readonly ShoppingNeed[]): string[] => needs.map((row) => row.ingredient);

beforeEach(() => {
  setIngredientMappings(REGISTRY);
});

afterEach(() => {
  resetIngredientMappings();
});

describe('storagePlaceOf', () => {
  it('reads the place from the registry', () => {
    expect(storagePlaceOf('Mehl')).toBe('Schublade 2');
    expect(storagePlaceOf('Salz')).toBeNull();
  });

  it('treats an unknown ingredient or an unknown place as unsorted', () => {
    setIngredientMappings({ ...REGISTRY, Fremd: entry('Dachboden') });
    expect(storagePlaceOf('Unbekannt')).toBeNull();
    expect(storagePlaceOf('Fremd')).toBeNull();
  });

  it('ranks the places in the walking order and the unsorted group last', () => {
    expect(storagePlaceRank('Milch')).toBe(0);
    expect(storagePlaceRank('Erbsen')).toBe(1);
    expect(storagePlaceRank('Mehl')).toBe(3); // after Schublade 1 (index 2)
    expect(storagePlaceRank('Salz')).toBe(STORAGE_PLACES.length);
  });
});

describe('sortPantryNeeds', () => {
  it('files by storage place, then purchase before covered, then German alphabetical', () => {
    expect(names(sortPantryNeeds(NEEDS))).toEqual([
      // Kühlschrank: the two to-buy rows first, then the covered ones
      'Milch',
      'Butter',
      'Joghurt',
      // Gefrierschrank
      'Erbsen',
      // Schublade 2 (Schublade 1 has no ingredient)
      'Mehl',
      'Zucker',
      // Gewürzregal
      'Safran',
      // unsorted: to buy first, then covered
      'Salz',
      'Pfeffer',
    ]);
  });

  it('keeps the order a snapshot of the data, not of a chosen stock', () => {
    // The comparison reads the reorder point / prefill only; there is no stock
    // parameter the page could pass. The same array therefore always orders the
    // same way.
    expect(names(sortPantryNeeds(NEEDS))).toEqual(names(sortPantryNeeds([...NEEDS].reverse())));
  });

  it('does not mutate the caller’s array', () => {
    const input = [...NEEDS];
    sortPantryNeeds(input);
    expect(input).toEqual(NEEDS);
  });

  it('sorts a same-named pair by base unit', () => {
    const a = need('Mehl', 100, 0, 'g');
    const b = need('Mehl', 100, 0, 'ml');
    expect(comparePantryNeeds(a, b)).toBeLessThan(0);
    expect(comparePantryNeeds(b, a)).toBeGreaterThan(0);
  });
});
