/**
 * Tests for the per-file parser and validator (docs/storage_format.md §7.1).
 *
 * All fixture quantities are real ladder values — e.g. 250, not 240 (the
 * authoritative docs/standard_numbers.csv has no 240; the master data wins).
 */

import { describe, expect, it } from 'vitest';

import { RecipeParseError } from './types.js';
import type { ValidationIssue } from './types.js';
import { parseRecipe } from './parse.js';

/** The finished-dish example of storage_format.md §8 (240 g → 250 g, ladder). */
const FINISHED_DISH = `---
title: Shredded Tofu Wraps
type: finished_dish
subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip
description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.
servings: 6
prep_time: 25 min
total_time: 40 min
ingredients:
  - name: Joghurt
    quantity: 400
    unit: g
  - name: Tortillas
    quantity: 250
    unit: g
    reference: true
  - name: Zitronensaft
    quantity: 15
    unit: ml
  - name: Béchamelsauce
    quantity: 500
    unit: ml
    recipe: Béchamelsauce
---
## Zubereitung
1. Tortillas im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. Joghurt mit Zitronensaft verrühren und würzen.
4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und servieren.
`;

/** The ingredient-recipe example of storage_format.md §8. */
const INGREDIENT_RECIPE = `---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
ingredients:
  - name: Milch
    quantity: 300
    unit: ml
  - name: Butter
    quantity: 25
    unit: g
---
## Zubereitung
1. Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.
2. Unter Rühren köcheln, bis die Sauce bindet.
`;

/** Parses `text`, asserting a RecipeParseError, and returns its issues. */
function parseIssues(text: string): readonly ValidationIssue[] {
  try {
    parseRecipe(text);
    throw new Error('expected parseRecipe to throw a RecipeParseError');
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeParseError);
    return (error as RecipeParseError).issues;
  }
}

/** Asserts that exactly one issue exists at `path` (message may be checked). */
function expectIssueAt(
  issues: readonly ValidationIssue[],
  path: string,
  messagePart?: string,
): void {
  const matching = issues.filter((issue) => issue.path === path);
  expect(
    matching.length,
    `expected exactly one issue at "${path}", got: ${JSON.stringify(issues)}`,
  ).toBe(1);
  if (messagePart !== undefined) {
    expect(matching[0]!.message).toContain(messagePart);
  }
}

describe('parseRecipe — happy paths', () => {
  it('parses the finished-dish example completely', () => {
    const recipe = parseRecipe(FINISHED_DISH);
    expect(recipe.title).toBe('Shredded Tofu Wraps');
    expect(recipe.type).toBe('finished_dish');
    expect(recipe.subtitle).toContain('Tortilla Wraps');
    expect(recipe.description).toContain('Knusprige Wraps');
    expect(recipe.prep_time).toBe('25 min');
    expect(recipe.total_time).toBe('40 min');
    expect(recipe.servings).toBe(6);
    expect(recipe.yield).toBeUndefined();
    expect(recipe.yield_unit).toBeUndefined();

    expect(recipe.ingredients).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
      { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
    ]);
    expect(recipe.steps).toEqual([
      'Tortillas im Ofen erwärmen und warm halten.',
      'Tofu marinieren und scharf anbraten.',
      'Joghurt mit Zitronensaft verrühren und würzen.',
      'Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und servieren.',
    ]);
  });

  it('parses the ingredient-recipe example completely', () => {
    const recipe = parseRecipe(INGREDIENT_RECIPE);
    expect(recipe.type).toBe('ingredient_recipe');
    expect(recipe.yield).toBe(500);
    expect(recipe.yield_unit).toBe('ml');
    expect(recipe.servings).toBeUndefined();
    expect(recipe.ingredients).toEqual([
      { name: 'Milch', quantity: 300, unit: 'ml' },
      { name: 'Butter', quantity: 25, unit: 'g' },
    ]);
    expect(recipe.steps).toHaveLength(2);
  });

  it('omits absent optional fields instead of storing undefined', () => {
    const recipe = parseRecipe(
      '---\ntitle: Minimal\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        'ingredients:\n  - name: Mehl\n    quantity: 500\n    unit: g\n' +
        '---\n## Zubereitung\n1. Backen.\n',
    );
    expect('subtitle' in recipe).toBe(false);
    expect('description' in recipe).toBe(false);
    expect('total_time' in recipe).toBe(false);
    expect('yield_note' in recipe).toBe(false);
  });

  it('accepts an explicit reference: false and empty ingredient lists', () => {
    const recipe = parseRecipe(
      '---\ntitle: Ohne Referenz\ntype: finished_dish\nservings: 2\nprep_time: 5 min\n' +
        'ingredients:\n  - name: Salz\n    quantity: 5\n    unit: g\n    reference: false\n' +
        '---\n## Zubereitung\n1. Würzen.\n',
    );
    expect(recipe.ingredients[0]).toEqual({
      name: 'Salz',
      quantity: 5,
      unit: 'g',
      reference: false,
    });
  });

  it('accepts CRLF line endings and a leading UTF-8 BOM', () => {
    const recipe = parseRecipe('\uFEFF' + FINISHED_DISH.replace(/\n/g, '\r\n'));
    expect(recipe.title).toBe('Shredded Tofu Wraps');
    expect(recipe.steps).toHaveLength(4);
  });

  it('allows blank lines between steps and indented step numbers', () => {
    const recipe = parseRecipe(
      '---\ntitle: Blanks\ntype: finished_dish\nservings: 2\nprep_time: 20 min\n' +
        'ingredients:\n  - name: Reis\n    quantity: 250\n    unit: g\n' +
        '---\n## Zubereitung\n1. Reis kochen.\n\n2. Abkühlen lassen.\n  3. Servieren.\n',
    );
    expect(recipe.steps).toEqual(['Reis kochen.', 'Abkühlen lassen.', 'Servieren.']);
  });
});

describe('parseRecipe — front matter structure', () => {
  it('rejects text that does not start with the delimiter', () => {
    const issues = parseIssues('# Nur Markdown\n');
    expectIssueAt(issues, 'frontMatter', 'front matter');
  });

  it('rejects a missing closing delimiter', () => {
    const issues = parseIssues('---\ntitle: X\n');
    expectIssueAt(issues, 'frontMatter', 'abschließende');
  });

  it('rejects invalid YAML', () => {
    const issues = parseIssues('---\ntitle: [unclosed\n---\n## Zubereitung\n1. x\n');
    expectIssueAt(issues, 'frontMatter', 'Ungültiges YAML');
  });

  it('rejects duplicate YAML keys (silent data loss)', () => {
    const issues = parseIssues(
      '---\ntitle: Eins\ntitle: Zwei\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'frontMatter', 'Ungültiges YAML');
  });

  it('rejects a front matter that is not a mapping', () => {
    const issues = parseIssues('---\n- a\n- b\n---\n## Zubereitung\n1. x\n');
    expectIssueAt(issues, 'frontMatter', 'YAML-Map');
  });
});

describe('parseRecipe — schema validation (§3)', () => {
  it('rejects a missing title', () => {
    const issues = parseIssues(
      '---\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'title', 'Pflichtfeld');
  });

  it('rejects an empty and a whitespace-padded title', () => {
    const empty = parseIssues(
      '---\ntitle: ""\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(empty, 'title', 'nicht leer');

    const padded = parseIssues(
      '---\ntitle: " Titel "\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(padded, 'title', 'Leerzeichen');
  });

  it('rejects file-name-unsafe title characters', () => {
    const issues = parseIssues(
      '---\ntitle: "Mit: Doppelpunkt"\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'title', 'Zeichen');
  });

  it('rejects an invalid or missing type', () => {
    const invalid = parseIssues(
      '---\ntitle: X\ntype: dessert\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(invalid, 'type', 'finished_dish');

    const missing = parseIssues(
      '---\ntitle: X\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(missing, 'type', 'Pflichtfeld');
  });

  it('rejects unknown top-level and ingredient fields', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nrezeptart: fertig\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n    mengeneinheit: Gramm\n' +
        '---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'rezeptart', 'Unbekanntes Feld');
    expectIssueAt(issues, 'ingredients[0].mengeneinheit', 'Unbekanntes Feld');
  });

  it('forbids servings on ingredient_recipe and yield fields on finished_dish', () => {
    const servingsOnSub = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\nyield: 500\nyield_unit: ml\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(servingsOnSub, 'servings', 'nur für finished_dish');

    const yieldOnDish = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nyield: 500\nyield_unit: ml\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(yieldOnDish, 'yield', 'nur für ingredient_recipe');
    expectIssueAt(yieldOnDish, 'yield_unit', 'nur für ingredient_recipe');
  });

  it('requires the type-specific fields', () => {
    const missingServings = parseIssues(
      '---\ntitle: X\ntype: finished_dish\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(missingServings, 'servings', 'Pflichtfeld');

    const missingYield = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(missingYield, 'yield', 'Pflichtfeld');
    expectIssueAt(missingYield, 'yield_unit', 'Pflichtfeld');
  });

  it('requires prep_time for both recipe types', () => {
    const dish = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(dish, 'prep_time', 'Pflichtfeld');
  });
});

describe('parseRecipe — value validation (§7.1)', () => {
  it('rejects non-integer and non-ladder servings', () => {
    const fractional = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 1.5\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(fractional, 'servings', 'ganze Zahl');

    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 11\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(notLadder, 'servings', 'Standardwert');
  });

  it('rejects non-ladder and zero quantities', () => {
    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: Mehl\n    quantity: 450\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(notLadder, 'ingredients[0].quantity', 'Standardwert');

    const zero = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: Salz\n    quantity: 0\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(zero, 'ingredients[0].quantity', 'positive Zahl');
  });

  it('rejects a quoted (string) quantity and an invalid unit', () => {
    const quoted = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: Mehl\n    quantity: "400"\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(quoted, 'ingredients[0].quantity', 'Zahl');

    const badUnit = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: Mehl\n    quantity: 400\n    unit: Stück\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(badUnit, 'ingredients[0].unit', 'g, kg, ml oder l');
  });

  it('rejects ingredient entries with missing required fields', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - quantity: 400\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'ingredients[0].name', 'Pflichtfeld');
  });

  it('allows at most 2 reference ingredients, only for finished_dish', () => {
    const threeRefs = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: A\n    quantity: 1\n    unit: g\n    reference: true\n' +
        '  - name: B\n    quantity: 1\n    unit: g\n    reference: true\n' +
        '  - name: C\n    quantity: 1\n    unit: g\n    reference: true\n' +
        '---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(threeRefs, 'ingredients', 'Höchstens 2');

    const refOnSub = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\nyield: 500\nyield_unit: ml\n' +
        'ingredients:\n  - name: A\n    quantity: 1\n    unit: g\n    reference: true\n' +
        '---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(refOnSub, 'ingredients[0].reference', 'finished_dish');
  });
});

describe('parseRecipe — body validation (§5)', () => {
  it('requires the body and the exact Zubereitung heading', () => {
    const emptyBody = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n',
    );
    expectIssueAt(emptyBody, 'body', 'Zubereitung');

    const wrongHeading = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n' +
        '---\n# Zubereitung\n1. x\n',
    );
    expectIssueAt(wrongHeading, 'body', '## Zubereitung');
  });

  it('rejects non-step lines and extra headings', () => {
    const prose = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n' +
        '---\n## Zubereitung\n1. Erster Schritt.\nKein nummerierter Schritt.\n',
    );
    expectIssueAt(prose, 'body', 'kein nummerierter Schritt');

    const extraHeading = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n' +
        '---\n## Zubereitung\n1. Erster Schritt.\n## Tipps\n',
    );
    expectIssueAt(extraHeading, 'body', 'Unerwartete Überschrift');
  });

  it('requires steps to start at 1 and be consecutive', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n' +
        '---\n## Zubereitung\n1. Erster.\n3. Dritter.\n',
    );
    expectIssueAt(issues, 'body', 'fortlaufend');
  });

  it('rejects a body without any step', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n' +
        '---\n## Zubereitung\n',
    );
    expectIssueAt(issues, 'body', 'mindestens einen Schritt');
  });

  it('collects several independent problems in one call', () => {
    const issues = parseIssues(
      '---\ntype: dessert\nservings: 11\n' +
        'ingredients:\n  - name: Mehl\n    quantity: 450\n    unit: Stück\n' +
        '---\n## Zubereitung\n1. x\n',
    );
    // Invalid type: per-type checks (e.g. servings) are deliberately skipped so
    // the type problem stays the precise error; independent checks still run.
    expectIssueAt(issues, 'type');
    expectIssueAt(issues, 'title');
    expectIssueAt(issues, 'ingredients[0].quantity');
    expectIssueAt(issues, 'ingredients[0].unit');
  });
});
