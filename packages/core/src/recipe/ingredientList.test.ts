/**
 * Tests for the ingredient merging used by the marker derivation
 * (storage_format.md §4: an ingredient used in several places appears once,
 * with the total amount).
 */

import { describe, expect, it } from 'vitest';

import { mergeIngredientUses } from './ingredientList.js';
import type { Ingredient } from './types.js';

const JOGHURT: Ingredient = { name: 'Joghurt', quantity: 400, unit: 'g' };
const TORTILLAS: Ingredient = { name: 'Tortillas', quantity: 250, unit: 'g', reference: true };
const ZITRONENSAFT: Ingredient = { name: 'Zitronensaft', quantity: 15, unit: 'ml' };
const BECHAMEL: Ingredient = {
  name: 'Béchamelsauce',
  quantity: 500,
  unit: 'ml',
  recipe: 'Béchamelsauce',
};

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

  it('keeps reference when any entry sets it', () => {
    const result = mergeIngredientUses([
      { name: 'Tortillas', quantity: 100, unit: 'g' },
      { name: 'Tortillas', quantity: 150, unit: 'g', reference: true },
    ]);
    expect(result).toEqual([{ name: 'Tortillas', quantity: 250, unit: 'g', reference: true }]);
  });

  it('takes the recipe link from the first entry that has one', () => {
    const result = mergeIngredientUses([
      { name: 'Béchamelsauce', quantity: 300, unit: 'ml' },
      { name: 'Béchamelsauce', quantity: 200, unit: 'ml', recipe: 'Béchamelsauce' },
    ]);
    expect(result).toEqual([
      { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
    ]);
  });

  it('keeps same-name entries with different units separate', () => {
    const result = mergeIngredientUses([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 0.2, unit: 'kg' },
    ]);
    expect(result).toEqual([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 0.2, unit: 'kg' },
    ]);
  });

  it('trims names', () => {
    const result = mergeIngredientUses([{ name: '  Joghurt ', quantity: 400, unit: 'g' }]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });
});
