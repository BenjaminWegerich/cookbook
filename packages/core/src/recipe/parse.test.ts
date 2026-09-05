/**
 * Tests for the per-file parser and validator (docs/storage_format.md §7.1).
 *
 * The step rows are the source of truth for the ingredient list (§4): each
 * step may carry its own rows (`- 250 g Tortillas`) above a prose line; the
 * master list is derived from the rows. The front matter may carry the
 * `reference` name list (finished_dish only).
 *
 * All fixture quantities are real ladder values — e.g. 250, not 240 (the
 * authoritative docs/standard_numbers.csv has no 240; the master data wins).
 */

import { describe, expect, it } from 'vitest';

import { RecipeParseError } from './types.js';
import type { ValidationIssue } from './types.js';
import { parseRecipe } from './parse.js';

/** The finished-dish example of storage_format.md §8 (row form). */
const FINISHED_DISH = `---
title: Shredded Tofu Wraps
type: finished_dish
subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip
description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.
servings: 6
prep_time: 25 min
total_time: 40 min
reference:
  - Tortillas
---
## Zubereitung
1. - 250 g Tortillas
   Tortillas im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. - 400 g Joghurt
   - 15 ml Zitronensaft
   Joghurt mit Zitronensaft verrühren und würzen.
4. - 500 ml Béchamelsauce
   Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und mit Béchamelsauce servieren.
`;

/** The ingredient-recipe example of storage_format.md §8 (row form). */
const INGREDIENT_RECIPE = `---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. - 25 g Butter
   - 300 ml Milch
   Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.
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
    expect(recipe.reference).toEqual(['Tortillas']);

    expect(recipe.steps).toEqual([
      {
        ingredients: [{ name: 'Tortillas', quantity: 250, unit: 'g' }],
        text: 'Tortillas im Ofen erwärmen und warm halten.',
      },
      { ingredients: [], text: 'Tofu marinieren und scharf anbraten.' },
      {
        ingredients: [
          { name: 'Joghurt', quantity: 400, unit: 'g' },
          { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
        ],
        text: 'Joghurt mit Zitronensaft verrühren und würzen.',
      },
      {
        ingredients: [{ name: 'Béchamelsauce', quantity: 500, unit: 'ml' }],
        text: 'Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und mit Béchamelsauce servieren.',
      },
    ]);

    // Derived from the step rows: order of first appearance, reference resolved
    // from the front-matter name list.
    expect(recipe.ingredients).toEqual([
      { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
      { name: 'Béchamelsauce', quantity: 500, unit: 'ml' },
    ]);
  });

  it('parses the ingredient-recipe example completely', () => {
    const recipe = parseRecipe(INGREDIENT_RECIPE);
    expect(recipe.type).toBe('ingredient_recipe');
    expect(recipe.yield).toBe(500);
    expect(recipe.yield_unit).toBe('ml');
    expect(recipe.servings).toBeUndefined();
    expect(recipe.reference).toBeUndefined();
    expect(recipe.ingredients).toEqual([
      { name: 'Butter', quantity: 25, unit: 'g' },
      { name: 'Milch', quantity: 300, unit: 'ml' },
    ]);
    expect(recipe.steps).toHaveLength(2);
  });

  it('derives a recipe without rows to an empty ingredient list', () => {
    const recipe = parseRecipe(
      '---\ntitle: Minimal\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. Backen.\n',
    );
    expect(recipe.ingredients).toEqual([]);
    expect('subtitle' in recipe).toBe(false);
    expect('description' in recipe).toBe(false);
    expect('total_time' in recipe).toBe(false);
    expect('reference' in recipe).toBe(false);
  });

  it('merges repeated rows of one ingredient with the summed quantity', () => {
    const recipe = parseRecipe(
      '---\ntitle: Summiert\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n' +
        '1. - 200 g Joghurt\n   Joghurt anrühren.\n' +
        '2. - 200 g Joghurt\n   Joghurt unterheben.\n',
    );
    expect(recipe.ingredients).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });

  it('normalizes hand-written kg/l rows and comma decimals to the family form', () => {
    const recipe = parseRecipe(
      '---\ntitle: Normalisiert\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 1,5 l Wasser\n   - 0.2 kg Reis\n   Wasser aufgießen und Reis kochen.\n',
    );
    expect(recipe.steps[0]!.ingredients).toEqual([
      { name: 'Wasser', quantity: 1500, unit: 'ml' },
      { name: 'Reis', quantity: 200, unit: 'g' },
    ]);
  });

  it('normalizes inline artifact text to the canonical family form', () => {
    const recipe = parseRecipe(
      '---\ntitle: Artifakt\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. Nudeln in {{1,5 l Wasser}} kochen, dann {{100 g}} unterheben.\n',
    );
    expect(recipe.steps[0]!.text).toBe(
      'Nudeln in {{1500 ml Wasser}} kochen, dann {{100 g}} unterheben.',
    );
    // Inline artifacts never count toward the ingredient list.
    expect(recipe.ingredients).toEqual([]);
  });

  it('allows unitless quantity-only artifacts in the step text', () => {
    const recipe = parseRecipe(
      '---\ntitle: Einheitenlos\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. {{3}} Minuten ziehen lassen, dann {{1,5}} l Wasser ergänzen.\n',
    );
    expect(recipe.steps[0]!.text).toBe(
      '{{3}} Minuten ziehen lassen, dann {{1.5}} l Wasser ergänzen.',
    );
    expect(recipe.ingredients).toEqual([]);
  });

  it('accepts CRLF line endings and a leading UTF-8 BOM', () => {
    const recipe = parseRecipe('\uFEFF' + FINISHED_DISH.replace(/\n/g, '\r\n'));
    expect(recipe.title).toBe('Shredded Tofu Wraps');
    expect(recipe.steps).toHaveLength(4);
    expect(recipe.ingredients).toHaveLength(4);
  });

  it('allows blank lines between steps and indented step numbers', () => {
    const recipe = parseRecipe(
      '---\ntitle: Blanks\ntype: finished_dish\nservings: 2\nprep_time: 20 min\n' +
        '---\n## Zubereitung\n1. - 250 g Reis\n   Reis kochen.\n\n2. Abkühlen lassen.\n  3. Servieren.\n',
    );
    expect(recipe.steps).toEqual([
      { ingredients: [{ name: 'Reis', quantity: 250, unit: 'g' }], text: 'Reis kochen.' },
      { ingredients: [], text: 'Abkühlen lassen.' },
      { ingredients: [], text: 'Servieren.' },
    ]);
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
      '---\ntitle: Eins\ntitle: Zwei\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
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
      '---\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'title', 'Pflichtfeld');
  });

  it('rejects an empty and a whitespace-padded title', () => {
    const empty = parseIssues(
      '---\ntitle: ""\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(empty, 'title', 'nicht leer');

    const padded = parseIssues(
      '---\ntitle: " Titel "\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(padded, 'title', 'Leerzeichen');
  });

  it('rejects file-name-unsafe title characters', () => {
    const issues = parseIssues(
      '---\ntitle: "Mit: Doppelpunkt"\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(issues, 'title', 'Zeichen');
  });

  it('rejects an invalid or missing type', () => {
    const invalid = parseIssues(
      '---\ntitle: X\ntype: dessert\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(invalid, 'type', 'finished_dish');

    const missing = parseIssues('---\ntitle: X\nservings: 2\n---\n## Zubereitung\n1. x\n');
    expectIssueAt(missing, 'type', 'Pflichtfeld');
  });

  it('rejects unknown top-level fields', () => {
    const unknown = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nrezeptart: fertig\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(unknown, 'rezeptart', 'Unbekanntes Feld');

    // The old marker format stored an `ingredients` list in the front matter;
    // the master list is derived from the step rows now — an explicit field is
    // simply an unknown field.
    const oldFormat = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(oldFormat, 'ingredients', 'Unbekanntes Feld');
  });

  it('forbids servings on ingredient_recipe and yield fields on finished_dish', () => {
    const servingsOnSub = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\nyield: 500\nyield_unit: ml\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(servingsOnSub, 'servings', 'nur für finished_dish');

    const yieldOnDish = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nyield: 500\nyield_unit: ml\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(yieldOnDish, 'yield', 'nur für ingredient_recipe');
    expectIssueAt(yieldOnDish, 'yield_unit', 'nur für ingredient_recipe');
  });

  it('requires the type-specific fields', () => {
    const missingServings = parseIssues(
      '---\ntitle: X\ntype: finished_dish\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(missingServings, 'servings', 'Pflichtfeld');

    const missingYield = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(missingYield, 'yield', 'Pflichtfeld');
    expectIssueAt(missingYield, 'yield_unit', 'Pflichtfeld');
  });

  it('requires prep_time for both recipe types', () => {
    const dish = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(dish, 'prep_time', 'Pflichtfeld');
  });
});

describe('parseRecipe — reference validation (§4)', () => {
  it('rejects non-integer and non-ladder servings', () => {
    const fractional = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 1.5\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(fractional, 'servings', 'ganze Zahl');

    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 11\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(notLadder, 'servings', 'Standardwert');
  });

  it('allows 0, 1 or 2 reference names, only for finished_dish', () => {
    const three = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        'reference: [A, B, C]\n' +
        '---\n## Zubereitung\n1. - 1 g A\n   - 1 g B\n   - 1 g C\n   Text.\n',
    );
    expectIssueAt(three, 'reference', 'Höchstens 2');

    const onSub = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\nyield: 500\nyield_unit: ml\nprep_time: 10 min\n' +
        'reference: [A]\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(onSub, 'reference', 'nur für finished_dish');
  });

  it('requires every reference name to occur in the recipe rows', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        'reference:\n  - Reis\n' +
        '---\n## Zubereitung\n1. - 250 g Tortillas\n   Tortillas erwärmen.\n',
    );
    expectIssueAt(issues, 'reference[0]', 'kommt im Rezept nicht vor');
  });
});

describe('parseRecipe — rows and artifacts validation (§4)', () => {
  it('rejects non-ladder and non-positive row quantities', () => {
    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 450 g Mehl\n   Vermengen.\n',
    );
    expectIssueAt(notLadder, 'steps[0].ingredients[0]', 'Standardwert');

    // A zero amount is not a valid amount-first phrase at all.
    const zero = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 0 g Mehl\n   Vermengen.\n',
    );
    expectIssueAt(zero, 'steps[0].ingredients[0]', 'keine gültige Zutaten-Zeile');
  });

  it('rejects rows without a name, with an invalid unit or missing quantity', () => {
    const noName = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 400 g\n   Vermengen.\n',
    );
    expectIssueAt(noName, 'steps[0].ingredients[0]', 'keine gültige Zutaten-Zeile');

    const badUnit = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 400 Stück Mehl\n   Vermengen.\n',
    );
    expectIssueAt(badUnit, 'steps[0].ingredients[0]', 'keine gültige Zutaten-Zeile');

    const noQuantity = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - Mehl\n   Vermengen.\n',
    );
    expectIssueAt(noQuantity, 'steps[0].ingredients[0]', 'keine gültige Zutaten-Zeile');
  });

  it('rejects malformed and non-ladder inline artifacts in step text', () => {
    const malformed = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. Mit {{100 g}} und {{irgendwas}} mischen.\n',
    );
    expectIssueAt(malformed, 'steps[0].text', 'Ungültiger Mengen-Baustein');

    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. Mit {{450 g}} Mehl mischen.\n',
    );
    expectIssueAt(notLadder, 'steps[0].text', 'Standardwert');
  });

  it('rejects a step whose prose starts with "- "', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - Kurz stocken lassen, dann servieren.\n',
    );
    // "- Kurz …" is not a valid row (no quantity) and no prose line follows.
    expectIssueAt(issues, 'steps[0].ingredients[0]');
    expectIssueAt(issues, 'steps[0]', 'einen Text');
  });
});

describe('parseRecipe — body validation (§5)', () => {
  it('requires the body and the exact Zubereitung heading', () => {
    const emptyBody = parseIssues('---\ntitle: X\ntype: finished_dish\nservings: 2\n---\n');
    expectIssueAt(emptyBody, 'body', 'Zubereitung');

    const wrongHeading = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n---\n# Zubereitung\n1. x\n',
    );
    expectIssueAt(wrongHeading, 'body', '## Zubereitung');
  });

  it('rejects non-step lines and extra headings', () => {
    const prose = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        '---\n## Zubereitung\n1. Erster Schritt.\nKein nummerierter Schritt.\n',
    );
    expectIssueAt(prose, 'body', 'kein nummerierter Schritt');

    const extraHeading = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        '---\n## Zubereitung\n1. Erster Schritt.\n## Tipps\n',
    );
    expectIssueAt(extraHeading, 'body', 'Unerwartete Überschrift');
  });

  it('requires steps to start at 1 and be consecutive', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        '---\n## Zubereitung\n1. Erster.\n3. Dritter.\n',
    );
    expectIssueAt(issues, 'body', 'fortlaufend');
  });

  it('rejects a body without any step', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n---\n## Zubereitung\n',
    );
    expectIssueAt(issues, 'body', 'mindestens einen Schritt');
  });

  it('rejects a row step whose prose is missing', () => {
    const issues = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. - 250 g Reis\n2. - 250 g Reis\n   Reis kochen.\n',
    );
    expectIssueAt(issues, 'steps[0]', 'einen Text');
  });

  it('collects several independent problems in one call', () => {
    const issues = parseIssues(
      '---\ntype: dessert\nservings: 11\nprep_time: 10 min\n---\n## Zubereitung\n1. - 450 g Mehl\n   Vermengen.\n',
    );
    // Invalid type: per-type checks (e.g. servings) are deliberately skipped so
    // the type problem stays the precise error; independent checks still run.
    expectIssueAt(issues, 'type');
    expectIssueAt(issues, 'title');
    expectIssueAt(issues, 'steps[0].ingredients[0]');
  });
});
