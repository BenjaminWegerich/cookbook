/**
 * Tests for the ingredient merging and the master-list derivation
 * (storage_format.md §4: the step rows are the source of truth; an ingredient
 * used in several places appears once, with the total amount).
 */

import { describe, expect, it } from 'vitest';

import { deriveIngredients, mergeIngredientUses } from './ingredientList.js';
import type { Step } from './types.js';

describe('mergeIngredientUses', () => {
  it('merges repeated entries of the same name with the summed quantity', () => {
    const result = mergeIngredientUses([
      { name: 'Joghurt', quantity: 200, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
    ]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });

  it('keeps a non-standard sum exact (400 + 750 = 1150)', () => {
    const result = mergeIngredientUses([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Joghurt', quantity: 750, unit: 'g' },
    ]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 1150, unit: 'g' }]);
  });

  it('keeps same-name entries with different units separate', () => {
    const result = mergeIngredientUses([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
    ]);
    expect(result).toEqual([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
    ]);
  });

  it('keeps the order of first appearance', () => {
    const result = mergeIngredientUses([
      { name: 'Reis', quantity: 300, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
      { name: 'Reis', quantity: 100, unit: 'g' },
    ]);
    expect(result).toEqual([
      { name: 'Reis', quantity: 400, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
    ]);
  });

  it('trims names', () => {
    const result = mergeIngredientUses([{ name: '  Joghurt ', quantity: 400, unit: 'g' }]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });
});

describe('deriveIngredients', () => {
  const steps: Step[] = [
    {
      ingredients: [{ name: 'Joghurt', quantity: 200, unit: 'g' }],
      text: 'Anrühren.',
    },
    {
      ingredients: [{ name: 'Zitronensaft', quantity: 15, unit: 'ml' }],
      text: 'Zugeben.',
    },
    {
      ingredients: [{ name: 'Joghurt', quantity: 200, unit: 'g' }],
      text: 'Unterheben.',
    },
  ];

  it('merges the rows of all steps in order of first use', () => {
    expect(deriveIngredients(steps)).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
    ]);
  });

  it('sums the displayed BQs, not the exact targets', () => {
    // Each 450 g Joghurt row displays as 1 Becher (500 g); the master list is
    // 1000 g, not the exact 900 g.
    const roundedRows: Step[] = [
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'B.' },
    ];
    expect(deriveIngredients(roundedRows)).toEqual([{ name: 'Joghurt', quantity: 1000, unit: 'g' }]);
  });

  it('uses the rounded exact-unit BQ when summing', () => {
    // 1/3 of a 200 g pack displays as 67 g; two rows make 134 g.
    const exactRows: Step[] = [
      { ingredients: [{ name: 'Naturtofu', quantity: 66.67, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Naturtofu', quantity: 66.67, unit: 'g' }], text: 'B.' },
    ];
    expect(deriveIngredients(exactRows)).toEqual([{ name: 'Naturtofu', quantity: 134, unit: 'g' }]);
  });

  it('flags the merged entries whose name is in the reference list', () => {
    expect(deriveIngredients(steps, ['Zitronensaft'])).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml', reference: true },
    ]);
  });

  it('resolves reference by trimmed name', () => {
    const result = deriveIngredients(steps, ['  Zitronensaft ']);
    expect(result[1]).toEqual({ name: 'Zitronensaft', quantity: 15, unit: 'ml', reference: true });
  });

  it('never counts inline artifacts (they live in the prose, not the rows)', () => {
    const withArtifacts: Step[] = [
      { ingredients: [], text: 'Nudeln in {{1500 ml Wasser}} kochen.' },
      { ingredients: [{ name: 'Nudeln', quantity: 500, unit: 'g' }], text: 'Würzen.' },
    ];
    expect(deriveIngredients(withArtifacts)).toEqual([
      { name: 'Nudeln', quantity: 500, unit: 'g' },
    ]);
  });
});
