/**
 * Tests for the size a recipe is written in (core's `writtenPlannedAmount`).
 *
 * The helper is what the app names wherever a meal-plan entry states no size,
 * so its cases are the shapes the plan has to survive:
 * - a finished dish → its serving count;
 * - an ingredient recipe → its yield, normalized to the family base unit
 *   (`kg` / `l` are display forms, docs/storage_format.md §3);
 * - a recipe without a written size (invalid, so normally impossible) → the
 *   same defensive defaults the "Einplanen" overlay starts on.
 */

import { describe, expect, it } from 'vitest';

import { writtenPlannedAmount } from './planLink.js';
import type { Recipe } from './recipe/types.js';

/** A recipe of the given type, with only the fields the helper reads. */
function recipe(fields: Partial<Recipe> & Pick<Recipe, 'type'>): Recipe {
  return {
    title: 'Testrezept',
    prep_time: '25 min',
    steps: [],
    ingredients: [],
    ...fields,
  };
}

describe('writtenPlannedAmount', () => {
  it('names a finished dish by its serving count', () => {
    expect(writtenPlannedAmount(recipe({ type: 'finished_dish', servings: 6 }))).toEqual({
      kind: 'servings',
      servings: 6,
    });
  });

  it('falls back to one serving for a dish without a written count', () => {
    expect(writtenPlannedAmount(recipe({ type: 'finished_dish' }))).toEqual({
      kind: 'servings',
      servings: 1,
    });
  });

  it('names an ingredient recipe by its yield in the family base unit', () => {
    expect(
      writtenPlannedAmount(recipe({ type: 'ingredient_recipe', yield: 500, yield_unit: 'g' })),
    ).toEqual({ kind: 'yield', quantity: 500, baseUnit: 'g' });
    expect(
      writtenPlannedAmount(recipe({ type: 'ingredient_recipe', yield: 250, yield_unit: 'ml' })),
    ).toEqual({ kind: 'yield', quantity: 250, baseUnit: 'ml' });
  });

  it('normalizes a display unit (kg / l) to the family base unit', () => {
    expect(
      writtenPlannedAmount(recipe({ type: 'ingredient_recipe', yield: 1.5, yield_unit: 'l' })),
    ).toEqual({ kind: 'yield', quantity: 1500, baseUnit: 'ml' });
    expect(
      writtenPlannedAmount(recipe({ type: 'ingredient_recipe', yield: 2, yield_unit: 'kg' })),
    ).toEqual({ kind: 'yield', quantity: 2000, baseUnit: 'g' });
  });

  it('falls back to 1000 g for an ingredient recipe without a written yield', () => {
    expect(writtenPlannedAmount(recipe({ type: 'ingredient_recipe' }))).toEqual({
      kind: 'yield',
      quantity: 1000,
      baseUnit: 'g',
    });
  });
});
