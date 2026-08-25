/**
 * Tests for the serializer (docs/storage_format.md §8).
 *
 * Recipes are constructed as plain objects here so the serializer is tested
 * independently of the parser; the round-trip tests then prove that
 * `parseRecipe(serializeRecipe(r))` restores the exact same recipe.
 */

import { describe, expect, it } from 'vitest';

import type { Recipe } from './types.js';
import { parseRecipe } from './parse.js';
import { serializeRecipe } from './serialize.js';

/** A full finished-dish recipe with every optional field set. */
const WRAPS: Recipe = {
  title: 'Shredded Tofu Wraps',
  type: 'finished_dish',
  subtitle: 'Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip',
  description: 'Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.',
  servings: 6,
  prep_time: '25 min',
  total_time: '40 min',
  ingredients: [
    { name: 'Joghurt', quantity: 400, unit: 'g' },
    { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
    { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
    { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
  ],
  steps: [
    'Tortillas im Ofen erwärmen und warm halten.',
    'Tofu marinieren und scharf anbraten.',
    'Joghurt mit Zitronensaft verrühren und würzen.',
    'Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und servieren.',
  ],
};

/** A full ingredient-recipe with yield_note. */
const BECHAMEL: Recipe = {
  title: 'Béchamelsauce',
  type: 'ingredient_recipe',
  yield: 500,
  yield_unit: 'ml',
  yield_note: 'für 2 Salatköpfe (700 g)',
  prep_time: '15 min',
  ingredients: [
    { name: 'Milch', quantity: 300, unit: 'ml' },
    { name: 'Butter', quantity: 25, unit: 'g' },
  ],
  steps: [
    'Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.',
    'Unter Rühren köcheln, bis die Sauce bindet.',
  ],
};

/** A minimal recipe with no optional fields at all. */
const MINIMAL: Recipe = {
  title: 'Minimal',
  type: 'finished_dish',
  servings: 2,
  prep_time: '10 min',
  ingredients: [{ name: 'Mehl', quantity: 500, unit: 'g' }],
  steps: ['Backen.'],
};

describe('serializeRecipe — canonical output (§8)', () => {
  it('writes the finished-dish example exactly', () => {
    expect(serializeRecipe(WRAPS)).toBe(
      '---\n' +
        'title: Shredded Tofu Wraps\n' +
        'type: finished_dish\n' +
        'subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip\n' +
        'description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.\n' +
        'servings: 6\n' +
        'prep_time: 25 min\n' +
        'total_time: 40 min\n' +
        'ingredients:\n' +
        '  - name: Joghurt\n' +
        '    quantity: 400\n' +
        '    unit: g\n' +
        '  - name: Tortillas\n' +
        '    quantity: 250\n' +
        '    unit: g\n' +
        '    reference: true\n' +
        '  - name: Zitronensaft\n' +
        '    quantity: 15\n' +
        '    unit: ml\n' +
        '  - name: Béchamelsauce\n' +
        '    quantity: 500\n' +
        '    unit: ml\n' +
        '    recipe: Béchamelsauce\n' +
        '---\n' +
        '## Zubereitung\n' +
        '1. Tortillas im Ofen erwärmen und warm halten.\n' +
        '2. Tofu marinieren und scharf anbraten.\n' +
        '3. Joghurt mit Zitronensaft verrühren und würzen.\n' +
        '4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und servieren.\n',
    );
  });

  it('writes the ingredient-recipe example exactly (yield fields, yield_note)', () => {
    expect(serializeRecipe(BECHAMEL)).toBe(
      '---\n' +
        'title: Béchamelsauce\n' +
        'type: ingredient_recipe\n' +
        'yield: 500\n' +
        'yield_unit: ml\n' +
        'yield_note: für 2 Salatköpfe (700 g)\n' +
        'prep_time: 15 min\n' +
        'ingredients:\n' +
        '  - name: Milch\n' +
        '    quantity: 300\n' +
        '    unit: ml\n' +
        '  - name: Butter\n' +
        '    quantity: 25\n' +
        '    unit: g\n' +
        '---\n' +
        '## Zubereitung\n' +
        '1. Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.\n' +
        '2. Unter Rühren köcheln, bis die Sauce bindet.\n',
    );
  });

  it('omits absent optional fields from the output', () => {
    const text = serializeRecipe(MINIMAL);
    expect(text).not.toContain('subtitle');
    expect(text).not.toContain('description');
    expect(text).not.toContain('total_time');
    expect(text).toContain('prep_time: 10 min');
  });

  it('always ends with a single trailing newline', () => {
    expect(serializeRecipe(MINIMAL).endsWith('\n')).toBe(true);
    expect(serializeRecipe(MINIMAL).endsWith('\n\n')).toBe(false);
  });
});

describe('serializeRecipe — round trips', () => {
  it('restores the identical recipe for a full finished dish', () => {
    expect(parseRecipe(serializeRecipe(WRAPS))).toEqual(WRAPS);
  });

  it('restores the identical recipe for a full ingredient recipe', () => {
    expect(parseRecipe(serializeRecipe(BECHAMEL))).toEqual(BECHAMEL);
  });

  it('restores the identical recipe without optional fields', () => {
    expect(parseRecipe(serializeRecipe(MINIMAL))).toEqual(MINIMAL);
  });

  it('keeps explicit reference: false (false is not dropped)', () => {
    const withFalse: Recipe = {
      title: 'Salz',
      type: 'finished_dish',
      servings: 1,
      prep_time: '1 min',
      ingredients: [{ name: 'Salz', quantity: 5, unit: 'g', reference: false }],
      steps: ['Würzen.'],
    };
    expect(parseRecipe(serializeRecipe(withFalse))).toEqual(withFalse);
  });

  it('is a fixed point: canonical text is serialized unchanged', () => {
    const canonical = serializeRecipe(WRAPS);
    expect(serializeRecipe(parseRecipe(canonical))).toBe(canonical);
  });
});

describe('serializeRecipe — representational guards', () => {
  it('rejects steps that span multiple lines', () => {
    const multiline: Recipe = { ...WRAPS, steps: ['Erster Schritt.', 'Zweiter\nSchritt.'] };
    expect(() => serializeRecipe(multiline)).toThrow(/single line/);
  });

  it('rejects steps with edge whitespace (would be trimmed on read)', () => {
    const padded: Recipe = { ...WRAPS, steps: ['Erster Schritt.', '  Zweiter.  '] };
    expect(() => serializeRecipe(padded)).toThrow(/whitespace/);
  });

  it('rejects an empty step list (a body without steps fails on read)', () => {
    const empty: Recipe = { ...WRAPS, steps: [] };
    expect(() => serializeRecipe(empty)).toThrow(/at least one step/);
  });

  it('rejects non-finite quantities, servings, yield and line breaks in names', () => {
    const nanQuantity: Recipe = {
      ...WRAPS,
      ingredients: [{ name: 'X', quantity: Number.NaN, unit: 'g' }],
    };
    expect(() => serializeRecipe(nanQuantity)).toThrow(/finite/);

    const infServings: Recipe = { ...WRAPS, servings: Number.POSITIVE_INFINITY };
    expect(() => serializeRecipe(infServings)).toThrow(/finite/);

    const infYield: Recipe = { ...BECHAMEL, yield: Number.NEGATIVE_INFINITY };
    expect(() => serializeRecipe(infYield)).toThrow(/finite/);

    const brokenTitle: Recipe = { ...WRAPS, title: 'Kaputt\nTitel' };
    expect(() => serializeRecipe(brokenTitle)).toThrow(/single line/);

    const brokenName: Recipe = {
      ...WRAPS,
      ingredients: [{ name: 'Kaputt\rName', quantity: 1, unit: 'g' }],
    };
    expect(() => serializeRecipe(brokenName)).toThrow(/single line/);
  });
});
