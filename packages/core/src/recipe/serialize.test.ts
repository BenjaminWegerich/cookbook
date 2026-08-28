/**
 * Tests for the serializer (docs/storage_format.md §8).
 *
 * Recipes are constructed as plain objects here so the serializer is tested
 * independently of the parser; the round-trip tests then prove that
 * `parseRecipe(serializeRecipe(r))` restores the exact same recipe. Since the
 * ingredient list is derived from the body markers (§4), the fixture recipes
 * carry their ingredients inline in the steps and their `ingredients` field
 * matches what `deriveIngredients` produces.
 */

import { describe, expect, it } from 'vitest';

import type { Recipe } from './types.js';
import { deriveIngredients } from './markers.js';
import { parseRecipe } from './parse.js';
import { serializeRecipe } from './serialize.js';

/** A full finished-dish recipe with every optional field set. */
const WRAPS_STEPS = [
  '{{ingredient|Tortillas|250|g|ref}} im Ofen erwärmen und warm halten.',
  'Tofu marinieren und scharf anbraten.',
  '{{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren und würzen.',
  'Wraps mit Tofu, Joghurt-Dip und Gemüse füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.',
];
const WRAPS: Recipe = {
  title: 'Shredded Tofu Wraps',
  type: 'finished_dish',
  subtitle: 'Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip',
  description: 'Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.',
  servings: 6,
  prep_time: '25 min',
  total_time: '40 min',
  ingredients: deriveIngredients(WRAPS_STEPS),
  steps: WRAPS_STEPS,
};

/** A full ingredient-recipe. */
const BECHAMEL_STEPS = [
  '{{ingredient|Butter|25|g}} schmelzen, Mehl anschwitzen und mit {{ingredient|Milch|300|ml}} aufgießen.',
  'Unter Rühren köcheln, bis die Sauce bindet.',
];
const BECHAMEL: Recipe = {
  title: 'Béchamelsauce',
  type: 'ingredient_recipe',
  yield: 500,
  yield_unit: 'ml',
  prep_time: '15 min',
  ingredients: deriveIngredients(BECHAMEL_STEPS),
  steps: BECHAMEL_STEPS,
};

/** A minimal recipe with no optional fields at all. */
const MINIMAL_STEPS = ['{{ingredient|Mehl|500|g}} unterheben.'];
const MINIMAL: Recipe = {
  title: 'Minimal',
  type: 'finished_dish',
  servings: 2,
  prep_time: '10 min',
  ingredients: deriveIngredients(MINIMAL_STEPS),
  steps: MINIMAL_STEPS,
};

describe('serializeRecipe — canonical output (§8)', () => {
  it('writes the finished-dish example exactly (no ingredients front matter)', () => {
    expect(serializeRecipe(WRAPS)).toBe(
      '---\n' +
        'title: Shredded Tofu Wraps\n' +
        'type: finished_dish\n' +
        'subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip\n' +
        'description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.\n' +
        'servings: 6\n' +
        'prep_time: 25 min\n' +
        'total_time: 40 min\n' +
        '---\n' +
        '## Zubereitung\n' +
        '1. {{ingredient|Tortillas|250|g|ref}} im Ofen erwärmen und warm halten.\n' +
        '2. Tofu marinieren und scharf anbraten.\n' +
        '3. {{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren und würzen.\n' +
        '4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.\n',
    );
  });

  it('writes the ingredient-recipe example exactly (yield fields)', () => {
    expect(serializeRecipe(BECHAMEL)).toBe(
      '---\n' +
        'title: Béchamelsauce\n' +
        'type: ingredient_recipe\n' +
        'yield: 500\n' +
        'yield_unit: ml\n' +
        'prep_time: 15 min\n' +
        '---\n' +
        '## Zubereitung\n' +
        '1. {{ingredient|Butter|25|g}} schmelzen, Mehl anschwitzen und mit {{ingredient|Milch|300|ml}} aufgießen.\n' +
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

  it('round-trips markers with reference and recipe flags', () => {
    const linked: Recipe = {
      ...WRAPS,
      steps: ['{{ingredient|Béchamelsauce|500|ml|ref|recipe:Béchamelsauce}} erwärmen.'],
      ingredients: deriveIngredients([
        '{{ingredient|Béchamelsauce|500|ml|ref|recipe:Béchamelsauce}} erwärmen.',
      ]),
    };
    expect(parseRecipe(serializeRecipe(linked))).toEqual(linked);
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

  it('rejects non-finite servings, yield and line breaks in the title', () => {
    const infServings: Recipe = { ...WRAPS, servings: Number.POSITIVE_INFINITY };
    expect(() => serializeRecipe(infServings)).toThrow(/finite/);

    const infYield: Recipe = { ...BECHAMEL, yield: Number.NEGATIVE_INFINITY };
    expect(() => serializeRecipe(infYield)).toThrow(/finite/);

    const brokenTitle: Recipe = { ...WRAPS, title: 'Kaputt\nTitel' };
    expect(() => serializeRecipe(brokenTitle)).toThrow(/single line/);
  });
});
