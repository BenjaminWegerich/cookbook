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

  it('rounds a non-ladder sum to the nearest ladder rung (400 + 750 = 1150 → 1200)', () => {
    const result = mergeIngredientUses([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Joghurt', quantity: 750, unit: 'g' },
    ]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 1200, unit: 'g' }]);
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
    expect(deriveIngredients(withArtifacts)).toEqual([{ name: 'Nudeln', quantity: 500, unit: 'g' }]);
  });
});
