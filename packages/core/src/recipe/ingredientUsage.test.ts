/**
 * Tests for `recipeUsesIngredient` (storage_format.md §4): the export refresh
 * uses it to find the recipes a changed ingredient can affect. Both counted step
 * rows (the derived master list) and inline `{{… Name}}` artifacts count as a
 * use — an ingredient can appear only in the prose.
 */

import { describe, expect, it } from 'vitest';

import { recipeUsesIngredient } from './ingredientList.js';
import { parseRecipe } from './parse.js';

const RECIPE = `---
title: Testgericht
type: finished_dish
servings: 4
prep_time: 10 min
---
## Zubereitung
1. - 100 g Mehl
   Mehl mit {{200 ml Milch}} verrühren.
2. {{1/3}} der Sauce dazugeben.
`;

describe('recipeUsesIngredient', () => {
  const recipe = parseRecipe(RECIPE);

  it('finds an ingredient used as a counted step row', () => {
    expect(recipeUsesIngredient(recipe, 'Mehl')).toBe(true);
  });

  it('finds an ingredient used only in an inline artifact', () => {
    // Milch has no counted row; it appears only inside the step prose.
    expect(recipe.ingredients.some((ingredient) => ingredient.name === 'Milch')).toBe(false);
    expect(recipeUsesIngredient(recipe, 'Milch')).toBe(true);
  });

  it('ignores prose without an artifact and unitless counts', () => {
    expect(recipeUsesIngredient(recipe, 'Sauce')).toBe(false);
  });

  it('compares names exactly', () => {
    expect(recipeUsesIngredient(recipe, 'Meh')).toBe(false);
    expect(recipeUsesIngredient(recipe, 'Mehl ')).toBe(false);
  });
});
