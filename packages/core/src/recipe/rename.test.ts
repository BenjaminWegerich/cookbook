/**
 * Tests for the title-rename logic (docs/storage_format.md §6).
 */

import { describe, expect, it } from 'vitest';

import type { Recipe } from './types.js';
import { renameRecipeInCollection } from './rename.js';

const WRAPS: Recipe = {
  title: 'Shredded Tofu Wraps',
  type: 'finished_dish',
  servings: 6,
  prep_time: '25 min',
  ingredients: [
    { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
    { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
  ],
  steps: ['Wraps füllen.'],
};

const BECHAMEL: Recipe = {
  title: 'Béchamelsauce',
  type: 'ingredient_recipe',
  yield: 500,
  yield_unit: 'ml',
  prep_time: '15 min',
  ingredients: [{ name: 'Milch', quantity: 300, unit: 'ml' }],
  steps: ['Sauce kochen.'],
};

/** A second dish that also uses the Béchamelsauce. */
const LASAGNE: Recipe = {
  title: 'Lasagne',
  type: 'finished_dish',
  servings: 6,
  prep_time: '40 min',
  ingredients: [
    { name: 'Nudelplatten', quantity: 250, unit: 'g' },
    { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
  ],
  steps: ['Schichten.'],
};

const PASTA: Recipe = {
  title: 'Spaghetti',
  type: 'finished_dish',
  servings: 4,
  prep_time: '10 min',
  ingredients: [{ name: 'Nudeln', quantity: 500, unit: 'g', reference: true }],
  steps: ['Kochen.'],
};

describe('renameRecipeInCollection', () => {
  it('returns the target recipe with the new title', () => {
    const result = renameRecipeInCollection([WRAPS, BECHAMEL], 'Béchamelsauce', 'Käsesauce');
    expect(result.renamed.title).toBe('Käsesauce');
    expect(result.renamed).toEqual({ ...BECHAMEL, title: 'Käsesauce' });
  });

  it('updates every recipe: reference to the old title', () => {
    const result = renameRecipeInCollection(
      [WRAPS, BECHAMEL, LASAGNE, PASTA],
      'Béchamelsauce',
      'Käsesauce',
    );
    // Both dishes referenced the renamed sub-recipe.
    expect(result.updated.map((recipe) => recipe.title).sort()).toEqual([
      'Lasagne',
      'Shredded Tofu Wraps',
    ]);
    for (const recipe of result.updated) {
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.recipe).not.toBe('Béchamelsauce');
      }
    }
    const lasagne = result.updated.find((recipe) => recipe.title === 'Lasagne')!;
    expect(lasagne.ingredients[1]!.recipe).toBe('Käsesauce');
  });

  it('leaves unrelated recipes untouched and out of the result', () => {
    const result = renameRecipeInCollection([WRAPS, BECHAMEL, PASTA], 'Béchamelsauce', 'Käsesauce');
    expect(result.updated.map((recipe) => recipe.title)).toEqual(['Shredded Tofu Wraps']);
    // The original collection objects are never mutated.
    expect(PASTA.ingredients[0]!.recipe).toBeUndefined();
    expect(WRAPS.ingredients[1]!.recipe).toBe('Béchamelsauce');
  });

  it('is a no-op when old and new title are equal', () => {
    const result = renameRecipeInCollection([WRAPS, BECHAMEL], 'Béchamelsauce', 'Béchamelsauce');
    expect(result.renamed).toBe(BECHAMEL);
    expect(result.updated).toEqual([]);
  });

  it('throws when the old title is not in the collection', () => {
    expect(() => renameRecipeInCollection([WRAPS], 'GibtEsNicht', 'Neu')).toThrow(
      /not in the collection/,
    );
  });

  it('preserves all other fields of the renamed recipe', () => {
    const result = renameRecipeInCollection([BECHAMEL], 'Béchamelsauce', 'Käsesauce');
    const { title: _title, ...restOfRenamed } = result.renamed;
    const { title: _title2, ...restOfOriginal } = BECHAMEL;
    expect(restOfRenamed).toEqual(restOfOriginal);
  });
});
