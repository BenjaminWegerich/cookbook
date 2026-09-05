/**
 * Tests for the serializer (docs/storage_format.md — canonical file text).
 */

import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { serializeRecipe } from './serialize.js';
import type { Recipe } from './types.js';

/** A complete finished dish with rows and a reference name. */
function makeDish(overrides: Partial<Recipe> = {}): Recipe {
  return {
    title: 'Shredded Tofu Wraps',
    type: 'finished_dish',
    subtitle: 'Tortilla Wraps',
    description: 'Knusprig.',
    prep_time: '25 min',
    total_time: '40 min',
    servings: 6,
    reference: ['Tortillas'],
    steps: [
      {
        ingredients: [{ name: 'Tortillas', quantity: 250, unit: 'g' }],
        text: 'Tortillas im Ofen erwärmen.',
      },
      { ingredients: [], text: 'Tofu marinieren.' },
    ],
    ingredients: [
      { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
    ],
    ...overrides,
  };
}

describe('serializeRecipe', () => {
  it('writes the canonical step blocks (rows first, then the prose line)', () => {
    const text = serializeRecipe(makeDish());
    expect(text).toBe(
      '---\n' +
        'title: Shredded Tofu Wraps\n' +
        'type: finished_dish\n' +
        'subtitle: Tortilla Wraps\n' +
        'description: Knusprig.\n' +
        'servings: 6\n' +
        'reference:\n' +
        '  - Tortillas\n' +
        'prep_time: 25 min\n' +
        'total_time: 40 min\n' +
        '---\n' +
        '## Zubereitung\n' +
        '1. - 250 g Tortillas\n' +
        '   Tortillas im Ofen erwärmen.\n' +
        '2. Tofu marinieren.\n',
    );
  });

  it('round-trips through parseRecipe (model equality)', () => {
    const text = serializeRecipe(makeDish());
    const reparsed = parseRecipe(text);
    expect(reparsed.steps).toEqual(makeDish().steps);
    expect(reparsed.title).toBe('Shredded Tofu Wraps');
    expect(reparsed.reference).toEqual(['Tortillas']);
    expect(reparsed.ingredients).toEqual(makeDish().ingredients);
  });

  it('writes inline artifacts in the canonical form inside the prose', () => {
    const recipe = makeDish({
      steps: [
        {
          ingredients: [{ name: 'Nudeln', quantity: 500, unit: 'g' }],
          text: 'Nudeln in {{1500 ml Wasser}} kochen, {{100 g}} beiseitelegen.',
        },
      ],
      ingredients: [{ name: 'Nudeln', quantity: 500, unit: 'g' }],
    });
    const text = serializeRecipe(recipe);
    expect(text).toContain('1. - 500 g Nudeln');
    expect(text).toContain('   Nudeln in {{1500 ml Wasser}} kochen, {{100 g}} beiseitelegen.');
  });

  it('serializes an ingredient recipe without reference and with yield', () => {
    const recipe: Recipe = {
      title: 'Béchamelsauce',
      type: 'ingredient_recipe',
      yield: 500,
      yield_unit: 'ml',
      prep_time: '15 min',
      steps: [
        {
          ingredients: [
            { name: 'Butter', quantity: 25, unit: 'g' },
            { name: 'Milch', quantity: 300, unit: 'ml' },
          ],
          text: 'Butter schmelzen, mit Milch aufgießen.',
        },
      ],
      ingredients: [
        { name: 'Butter', quantity: 25, unit: 'g' },
        { name: 'Milch', quantity: 300, unit: 'ml' },
      ],
    };
    const text = serializeRecipe(recipe);
    expect(text).toContain('yield: 500');
    expect(text).toContain('yield_unit: ml');
    expect(text).not.toContain('reference');
    const reparsed = parseRecipe(text);
    expect(reparsed.ingredients).toEqual(recipe.ingredients);
  });

  it('refuses values that cannot be represented faithfully', () => {
    // No steps at all.
    expect(() => serializeRecipe({ ...makeDish(), steps: [] })).toThrow(/at least one step/);

    // Multi-line step text.
    expect(() =>
      serializeRecipe(makeDish({ steps: [{ ingredients: [], text: 'Zeile 1\nZeile 2' }] })),
    ).toThrow(/single line/);

    // Edge whitespace would not round-trip.
    expect(() =>
      serializeRecipe(makeDish({ steps: [{ ingredients: [], text: ' Text ' }] })),
    ).toThrow(/whitespace/);

    // "- " at the prose start would be read back as an ingredient row.
    expect(() =>
      serializeRecipe(makeDish({ steps: [{ ingredients: [], text: '- Text' }] })),
    ).toThrow(/"- "/);

    // Empty step text.
    expect(() =>
      serializeRecipe(makeDish({ steps: [{ ingredients: [], text: '' }] })),
    ).toThrow(/text/);

    // Untrimmed / empty / braced ingredient names.
    expect(() =>
      serializeRecipe(
        makeDish({
          steps: [{ ingredients: [{ name: ' Mehl ', quantity: 400, unit: 'g' }], text: 'x' }],
        }),
      ),
    ).toThrow(/trimmed/);
    expect(() =>
      serializeRecipe(
        makeDish({
          steps: [{ ingredients: [{ name: 'Mehl {', quantity: 400, unit: 'g' }], text: 'x' }],
        }),
      ),
    ).toThrow(/braces/);
  });

  it('refuses a multi-line title and non-finite numbers', () => {
    expect(() => serializeRecipe(makeDish({ title: 'A\nB' }))).toThrow(/title/);
    expect(() => serializeRecipe(makeDish({ servings: Number.NaN }))).toThrow(/servings/);
  });
});
