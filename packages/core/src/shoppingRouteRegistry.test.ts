/**
 * Tests for the shopping-route runtime registry (docs/storage_format.md §10):
 * the seed it starts from, the derived store/section lists the new-ingredient
 * sheet's pickers are built from, and the assignment lookup used later by the
 * aisle sort.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ShoppingAssignments, ShoppingRoute } from './shoppingRouteCsv.js';
import {
  allShoppingAssignments,
  allShoppingStops,
  resetShoppingRoute,
  setShoppingAssignments,
  setShoppingRoute,
  shoppingSections,
  shoppingStopFor,
  shoppingStores,
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

/** The assignment fixture: one ingredient, one non-ingredient item. */
const ASSIGNMENTS: ShoppingAssignments = {
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  Klopapier: { store: 'REWE', section: 'Obst und Gemüse' },
};

afterEach(() => {
  resetShoppingRoute();
});

describe('shopping-route registry', () => {
  it('starts from the generated seed', () => {
    expect(allShoppingStops().length).toBeGreaterThan(1);
    expect(shoppingStopFor('Karotten')).toBeDefined();
  });

  it('stores a replaced route and assignment', () => {
    setShoppingRoute(ROUTE);
    setShoppingAssignments(ASSIGNMENTS);
    expect(allShoppingStops()).toEqual(ROUTE);
    expect(allShoppingAssignments()).toEqual(ASSIGNMENTS);
  });

  it('restores the seed on reset', () => {
    const seedRoute = allShoppingStops();
    const seedAssignments = allShoppingAssignments();
    setShoppingRoute([]);
    setShoppingAssignments({});
    resetShoppingRoute();
    expect(allShoppingStops()).toEqual(seedRoute);
    expect(allShoppingAssignments()).toEqual(seedAssignments);
    expect(shoppingStopFor('Karotten')).toBeDefined();
  });

  it('looks an item up by its exact, case-sensitive name', () => {
    setShoppingAssignments(ASSIGNMENTS);
    expect(shoppingStopFor('Joghurt')).toEqual({ store: 'Lidl', section: 'Molkerei' });
    // Names are matched exactly (docs/storage_format.md §10): a different
    // spelling is simply an unassigned item, not an error.
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
