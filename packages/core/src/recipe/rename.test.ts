/**
 * Tests for the title-rename transformation (docs/storage_format.md §6).
 *
 * Sub-recipe links are implicit: renaming an `ingredient_recipe` renames every
 * use of its old title — as a step row, as an inline text artifact and as an
 * entry of a `reference` list — in all other recipes. Renaming a finished dish
 * touches no other file.
 */

import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { renameRecipeInCollection } from './rename.js';
import type { Recipe } from './types.js';

function parse(text: string): Recipe {
  return parseRecipe(text);
}

/** The sub-recipe to be renamed. */
const BECHAMEL = parse(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. - 300 ml Milch
   Milch aufkochen.
`);

/** A finished dish using the sub-recipe in a row, an artifact and as reference. */
const WRAPS = parse(`---
title: Shredded Tofu Wraps
type: finished_dish
servings: 6
prep_time: 20 min
reference:
  - Béchamelsauce
---
## Zubereitung
1. - 250 g Tortillas
   - 500 ml Béchamelsauce
   Tortillas füllen, {{200 ml Béchamelsauce}} dazureichen.
`);

/** A finished dish with an unrelated plain ingredient. */
const PASTA = parse(`---
title: Spaghetti
type: finished_dish
servings: 4
prep_time: 10 min
---
## Zubereitung
1. - 500 g Nudeln
   Nudeln kochen.
`);

describe('renameRecipeInCollection', () => {
  it('renames the target recipe title', () => {
    const { renamed } = renameRecipeInCollection([BECHAMEL, WRAPS], 'Béchamelsauce', 'Käsesauce');
    expect(renamed.title).toBe('Käsesauce');
  });

  it('renames implicit sub-recipe uses in rows, artifacts and the reference list', () => {
    const { updated } = renameRecipeInCollection(
      [BECHAMEL, WRAPS, PASTA],
      'Béchamelsauce',
      'Käsesauce',
    );
    expect(updated).toHaveLength(1);
    const parent = updated[0]!;
    expect(parent.title).toBe('Shredded Tofu Wraps');
    // Step rows renamed (name == old title).
    expect(parent.steps[0]!.ingredients.map((entry) => entry.name)).toEqual([
      'Tortillas',
      'Käsesauce',
    ]);
    // Inline artifact renamed in the prose.
    expect(parent.steps[0]!.text).toBe(
      'Tortillas füllen, {{200 ml Käsesauce}} dazureichen.',
    );
    // The reference list entry followed the renamed ingredient.
    expect(parent.reference).toEqual(['Käsesauce']);
    // The derived master list is recomputed from the renamed rows.
    expect(parent.ingredients.map((entry) => entry.name)).toEqual(['Tortillas', 'Käsesauce']);
  });

  it('leaves recipes without the old title unchanged', () => {
    const { updated } = renameRecipeInCollection([BECHAMEL, WRAPS, PASTA], 'Béchamelsauce', 'Käsesauce');
    expect(updated.some((recipe) => recipe.title === 'Spaghetti')).toBe(false);
  });

  it('renaming a finished dish never touches other files (names are plain ingredients)', () => {
    const usesName = parse(`---
title: Reste-Pfanne
type: finished_dish
servings: 2
prep_time: 10 min
---
## Zubereitung
1. - 200 g Spaghetti
   Spaghetti mit Ei braten.
`);
    const { updated } = renameRecipeInCollection(
      [PASTA, usesName],
      'Spaghetti',
      'Linguine',
    );
    expect(updated).toHaveLength(0);
  });

  it('returns the target unchanged for an identical title', () => {
    const { renamed, updated } = renameRecipeInCollection([BECHAMEL, WRAPS], 'Béchamelsauce', 'Béchamelsauce');
    expect(renamed.title).toBe('Béchamelsauce');
    expect(updated).toHaveLength(0);
  });

  it('throws when the old title is not in the collection', () => {
    expect(() => renameRecipeInCollection([BECHAMEL], 'Fehlt', 'Neu')).toThrow(/not in the collection/);
  });
});
