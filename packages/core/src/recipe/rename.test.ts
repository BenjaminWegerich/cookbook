/**
 * Tests for the title-rename logic (docs/storage_format.md §6).
 */

import { describe, expect, it } from 'vitest';

import type { Recipe } from './types.js';
import { deriveIngredients } from './markers.js';
import { renameRecipeInCollection } from './rename.js';

const WRAPS_STEPS = [
  '{{ingredient|Tortillas|250|g|ref}} füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.',
];
const WRAPS: Recipe = {
  title: 'Shredded Tofu Wraps',
  type: 'finished_dish',
  servings: 6,
  prep_time: '25 min',
  ingredients: deriveIngredients(WRAPS_STEPS),
  steps: WRAPS_STEPS,
};

const BECHAMEL: Recipe = {
  title: 'Béchamelsauce',
  type: 'ingredient_recipe',
  yield: 500,
  yield_unit: 'ml',
  prep_time: '15 min',
  ingredients: deriveIngredients(['{{ingredient|Milch|300|ml}} kochen.']),
  steps: ['{{ingredient|Milch|300|ml}} kochen.'],
};

/** A second dish that also uses the Béchamelsauce. */
const LASAGNE_STEPS = [
  '{{ingredient|Nudelplatten|250|g}} schichten. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} darübergeben.',
];
const LASAGNE: Recipe = {
  title: 'Lasagne',
  type: 'finished_dish',
  servings: 6,
  prep_time: '40 min',
  ingredients: deriveIngredients(LASAGNE_STEPS),
  steps: LASAGNE_STEPS,
};

const PASTA: Recipe = {
  title: 'Spaghetti',
  type: 'finished_dish',
  servings: 4,
  prep_time: '10 min',
  ingredients: deriveIngredients(['{{ingredient|Nudeln|500|g|ref}} kochen.']),
  steps: ['{{ingredient|Nudeln|500|g|ref}} kochen.'],
};

describe('renameRecipeInCollection', () => {
  it('returns the target recipe with the new title', () => {
    const result = renameRecipeInCollection([WRAPS, BECHAMEL], 'Béchamelsauce', 'Käsesauce');
    expect(result.renamed.title).toBe('Käsesauce');
    expect(result.renamed).toEqual({ ...BECHAMEL, title: 'Käsesauce' });
  });

  it('updates every |recipe: marker to the old title', () => {
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
      expect(recipe.steps.join(' ')).not.toContain('recipe:Béchamelsauce');
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.recipe).not.toBe('Béchamelsauce');
      }
    }
    const lasagne = result.updated.find((recipe) => recipe.title === 'Lasagne')!;
    expect(lasagne.steps[0]).toContain('recipe:Käsesauce');
    expect(lasagne.ingredients.find((i) => i.name === 'Béchamelsauce')!.recipe).toBe('Käsesauce');
  });

  it('leaves unrelated recipes untouched and out of the result', () => {
    const result = renameRecipeInCollection([WRAPS, BECHAMEL, PASTA], 'Béchamelsauce', 'Käsesauce');
    expect(result.updated.map((recipe) => recipe.title)).toEqual(['Shredded Tofu Wraps']);
    // The original collection objects are never mutated.
    expect(PASTA.ingredients[0]!.recipe).toBeUndefined();
    expect(WRAPS.steps[0]).toContain('recipe:Béchamelsauce');
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
