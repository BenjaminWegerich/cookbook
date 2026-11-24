/**
 * Tests for the market preference (docs/shopping_item_identity.md §7):
 * the ranked personal stores and the deterministic fallback for a custom store.
 */

import { describe, expect, it } from 'vitest';

import { shoppingStoreRanks } from './shoppingMarketRanks.js';

describe('shoppingStoreRanks', () => {
  it('uses the static ranks for the personal stores', () => {
    expect([...shoppingStoreRanks(['Rewe', 'Lidl', 'dm'])]).toEqual([
      ['Rewe', 2],
      ['Lidl', 1],
      ['dm', 3],
    ]);
  });

  it('folds case for a hand-edited store spelling', () => {
    expect(shoppingStoreRanks(['REWE']).get('REWE')).toBe(2);
  });

  it('ranks an unknown store after the known ones in route order', () => {
    const ranks = shoppingStoreRanks(['Lidl', 'Alnatura', 'dm', 'Wochenmarkt']);
    expect(ranks.get('Lidl')).toBe(1);
    expect(ranks.get('dm')).toBe(3);
    expect(ranks.get('Alnatura')).toBe(4);
    expect(ranks.get('Wochenmarkt')).toBe(5);
  });

  it('uses an explicit Drive table instead of the seed', () => {
    const ranks = shoppingStoreRanks(['Lidl', 'Rewe', 'dm'], { Rewe: 1, Lidl: 2, dm: 3 });
    expect(ranks.get('Rewe')).toBe(1);
    expect(ranks.get('Lidl')).toBe(2);
  });

  it('keeps ranks unique when two route spellings fold to one seed market', () => {
    // The route may contain "Rewe" and "REWE" as distinct stops. Only the first
    // can take the explicit rank; the second gets the next free one, so the
    // rank file never contains a duplicate rank.
    const ranks = shoppingStoreRanks(['Rewe', 'REWE']);
    expect(new Set(ranks.values()).size).toBe(2);
  });

  it('is empty for an empty route', () => {
    expect([...shoppingStoreRanks([])]).toEqual([]);
  });
});
