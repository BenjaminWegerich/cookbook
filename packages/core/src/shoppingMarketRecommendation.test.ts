/**
 * Tests for the trip-market recommendation (docs/shopping_item_identity.md §7):
 * mandatory markets, the coverage-first minimum set, the >10 priority rule, the
 * live allocation and the guarantee that every relevant item gets a market when
 * the recommendation is selected.
 */

import { describe, expect, it } from 'vitest';

import type { ShoppingStop } from './shoppingRouteCsv.js';
import {
  assignShoppingDemand,
  recommendShoppingMarkets,
  shoppingMarketWouldTake,
  type ShoppingItemDemand,
} from './shoppingMarketRecommendation.js';

/** A location at one market (the section is irrelevant to the algorithm). */
function stop(store: string): ShoppingStop {
  return { store, section: 'X' };
}

/** A demand item available at the given markets. */
function item(name: string, ...stores: string[]): ShoppingItemDemand {
  return { item: name, locations: stores.map(stop) };
}

/** A rank map that makes every listed store unique, in argument order. */
function ranks(...stores: string[]): ReadonlyMap<string, number> {
  return new Map(stores.map((store, index) => [store, index + 1]));
}

describe('recommendShoppingMarkets', () => {
  it('selects a mandatory market and never leaves its only-here item uncovered', () => {
    const recommendation = recommendShoppingMarkets(
      [item('Zitronensaft', 'dm'), item('Karotten', 'Lidl', 'dm')],
      ranks('Lidl', 'dm'),
    );
    expect(recommendation.selected).toEqual(['dm']);
    const dm = recommendation.options.find((option) => option.store === 'dm');
    expect(dm).toMatchObject({
      mandatory: true,
      coverage: true,
      onlyHereCount: 1,
      assignedCount: 2,
    });
  });

  it('uses the smallest coverage set, not one market per item', () => {
    // Five items at A+B and five at B+C: B covers both groups, so the minimum
    // cover is {B} rather than {A,C}. No priority market takes >10 items.
    const demand = [
      ...Array.from({ length: 5 }, (_, index) => item(`a${index}`, 'A', 'B')),
      ...Array.from({ length: 5 }, (_, index) => item(`c${index}`, 'B', 'C')),
    ];
    const recommendation = recommendShoppingMarkets(demand, ranks('A', 'B', 'C'));
    expect(recommendation.selected).toEqual(['B']);
    expect(recommendation.options.find((option) => option.store === 'B')).toMatchObject({
      coverage: true,
      assignedCount: 10,
    });
  });

  it('breaks a coverage tie by the priority profile', () => {
    // Three items form a triangle; every two-market set covers all. {A,B} keeps
    // two items at rank 1 and one at rank 2; {A,C} keeps two at rank 1 and one
    // at rank 3; {B,C} has no rank-1 item. {A,B} must win.
    const recommendation = recommendShoppingMarkets(
      [item('x', 'A', 'B'), item('y', 'B', 'C'), item('z', 'A', 'C')],
      ranks('A', 'B', 'C'),
    );
    expect(recommendation.selected).toEqual(['A', 'B']);
  });

  it('adds a coverage market even when it takes only one item', () => {
    // No mandatory market: every item has an alternative. The only way to
    // cover x is A or B, so the recommendation must select one, even though it
    // takes just one item. y is covered by the same A.
    const recommendation = recommendShoppingMarkets(
      [item('x', 'A', 'B'), item('y', 'A', 'C')],
      ranks('A', 'B', 'C'),
    );
    expect(recommendation.selected).toEqual(['A']);
    expect(
      assignShoppingDemand(
        [item('x', 'A', 'B'), item('y', 'A', 'C')],
        recommendation.selected,
        ranks('A', 'B', 'C'),
      ).uncovered,
    ).toEqual([]);
  });

  it('covers ten multi-location items even though no priority market clears the threshold', () => {
    // The former threshold-only rule left these ten items without a market.
    // Coverage is a hard constraint now, so the recommendation adds the
    // best-ranked market for them (Rewe) and every item is assigned.
    const demand = [
      item('only', 'dm'),
      ...Array.from({ length: 10 }, (_, index) => item(`i${index}`, 'Rewe', 'Lidl')),
    ];
    const recommendation = recommendShoppingMarkets(demand, ranks('Rewe', 'Lidl', 'dm'));
    expect(recommendation.selected).toContain('Rewe');
    expect(recommendation.selected).toContain('dm');
    const assignment = assignShoppingDemand(
      demand,
      recommendation.selected,
      ranks('Rewe', 'Lidl', 'dm'),
    );
    expect(assignment.uncovered).toEqual([]);
  });

  it('adds a priority market only when it takes over more than 10 items', () => {
    const ten = Array.from({ length: 10 }, (_, index) => item(`i${index}`, 'A', 'D'));
    const tenRecommendation = recommendShoppingMarkets(
      [item('only', 'D'), ...ten],
      ranks('A', 'D'),
    );
    expect(tenRecommendation.selected).toEqual(['D']);
    expect(tenRecommendation.options.find((option) => option.store === 'A')).toMatchObject({
      priority: false,
      selected: false,
      wouldTakeCount: 10,
    });

    const eleven = Array.from({ length: 11 }, (_, index) => item(`i${index}`, 'A', 'D'));
    const elevenRecommendation = recommendShoppingMarkets(
      [item('only', 'D'), ...eleven],
      ranks('A', 'D'),
    );
    expect(elevenRecommendation.selected).toEqual(['A', 'D']);
    expect(elevenRecommendation.options.find((option) => option.store === 'A')).toMatchObject({
      priority: true,
      selected: true,
      assignedCount: 11,
    });
  });

  it('still covers every item when no market reaches the priority threshold', () => {
    // Three groups of eight form a triangle; no market would take more than 10
    // items as a priority addition, but coverage must still be complete.
    const demand = [
      ...Array.from({ length: 8 }, (_, index) => item(`ab${index}`, 'A', 'B')),
      ...Array.from({ length: 8 }, (_, index) => item(`bc${index}`, 'B', 'C')),
      ...Array.from({ length: 8 }, (_, index) => item(`ac${index}`, 'A', 'C')),
    ];
    const recommendation = recommendShoppingMarkets(demand, ranks('A', 'B', 'C'));
    expect(recommendation.selected.length).toBeGreaterThan(0);
    expect(recommendation.selected.length).toBeLessThan(3);
    const assignment = assignShoppingDemand(demand, recommendation.selected, ranks('A', 'B', 'C'));
    expect(assignment.uncovered).toEqual([]);
  });

  it('counts only distinct demand entries, so duplicate lines do not inflate a count', () => {
    const demand = Array.from({ length: 11 }, (_, index) => item(`i${index}`, 'A', 'D'));
    const recommendation = recommendShoppingMarkets(
      [item('only', 'D'), ...demand],
      ranks('A', 'D'),
    );
    expect(recommendation.options.find((option) => option.store === 'A')?.assignedCount).toBe(11);
  });

  it('returns nothing for an empty demand', () => {
    expect(recommendShoppingMarkets([], ranks('A'))).toEqual({ selected: [], options: [] });
  });
});

describe('assignShoppingDemand', () => {
  it('chooses the best-ranked selected location', () => {
    const demand = [item('Karotten', 'Lidl', 'Rewe')];
    const assignment = assignShoppingDemand(demand, ['Lidl', 'Rewe'], ranks('Rewe', 'Lidl'));
    expect(assignment.chosen.get('Karotten')).toEqual(stop('Rewe'));
    expect(assignment.downgraded).toEqual([]);
  });

  it('reports uncovered and downgraded items', () => {
    const demand = [item('Karotten', 'Lidl', 'Rewe'), item('Zitronensaft', 'dm')];
    const assignment = assignShoppingDemand(demand, ['Lidl'], ranks('Rewe', 'Lidl', 'dm'));
    expect(assignment.uncovered).toEqual(['Zitronensaft']);
    expect(assignment.downgraded).toEqual(['Karotten']);
    expect(assignment.marketCounts.get('Lidl')).toBe(1);
  });

  it('counts what an unselected market would take over', () => {
    const demand = [item('a', 'A', 'D'), item('b', 'A', 'D')];
    expect(shoppingMarketWouldTake(demand, new Set(['D']), 'A', ranks('A', 'D'))).toBe(2);
    expect(shoppingMarketWouldTake(demand, new Set(['A', 'D']), 'A', ranks('A', 'D'))).toBe(2);
  });
});
