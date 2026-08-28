/**
 * Tests for the per-file parser and validator (docs/storage_format.md §7.1).
 *
 * Since the ingredient list is derived from the step text (markers, §4 —
 * decided with the user), the fixtures carry no `ingredients` front matter;
 * ingredients appear inline in the steps as {{ingredient|…}} markers.
 *
 * All fixture quantities are real ladder values — e.g. 250, not 240 (the
 * authoritative docs/standard_numbers.csv has no 240; the master data wins).
 */

import { describe, expect, it } from 'vitest';

import { RecipeParseError } from './types.js';
import type { ValidationIssue } from './types.js';
import { parseRecipe } from './parse.js';

/** The finished-dish example of storage_format.md §8 (marker form). */
const FINISHED_DISH = `---
title: Shredded Tofu Wraps
type: finished_dish
subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip
description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.
servings: 6
prep_time: 25 min
total_time: 40 min
---
## Zubereitung
1. {{ingredient|Tortillas|250|g|ref}} im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. {{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren und würzen.
4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.
`;

/** The ingredient-recipe example of storage_format.md §8 (marker form). */
const INGREDIENT_RECIPE = `---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. {{ingredient|Butter|25|g}} schmelzen, Mehl anschwitzen und mit {{ingredient|Milch|300|ml}} aufgießen.
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

    // Derived from the markers: order of first appearance in the steps.
    expect(recipe.ingredients).toEqual([
      { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
      { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
    ]);
    expect(recipe.steps).toHaveLength(4);
  });

  it('parses the ingredient-recipe example completely', () => {
    const recipe = parseRecipe(INGREDIENT_RECIPE);
    expect(recipe.type).toBe('ingredient_recipe');
    expect(recipe.yield).toBe(500);
    expect(recipe.yield_unit).toBe('ml');
    expect(recipe.servings).toBeUndefined();
    expect(recipe.ingredients).toEqual([
      { name: 'Butter', quantity: 25, unit: 'g' },
      { name: 'Milch', quantity: 300, unit: 'ml' },
    ]);
    expect(recipe.steps).toHaveLength(2);
  });

  it('derives a recipe without markers to an empty ingredient list', () => {
    const recipe = parseRecipe(
      '---\ntitle: Minimal\ntype: finished_dish\nservings: 4\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. Backen.\n',
    );
    expect(recipe.ingredients).toEqual([]);
    expect('subtitle' in recipe).toBe(false);
    expect('description' in recipe).toBe(false);
    expect('total_time' in recipe).toBe(false);
  });

  it('leaves the reference flag absent when no marker carries |ref', () => {
    const recipe = parseRecipe(
      '---\ntitle: Ohne Referenz\ntype: finished_dish\nservings: 2\nprep_time: 5 min\n' +
        '---\n## Zubereitung\n1. {{ingredient|Salz|5|g}} würzen.\n',
    );
    expect(recipe.ingredients).toEqual([{ name: 'Salz', quantity: 5, unit: 'g' }]);
    expect('reference' in recipe.ingredients[0]!).toBe(false);
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
        '---\n## Zubereitung\n1. {{ingredient|Reis|250|g}} kochen.\n\n2. Abkühlen lassen.\n  3. Servieren.\n',
    );
    expect(recipe.steps).toEqual([
      '{{ingredient|Reis|250|g}} kochen.',
      'Abkühlen lassen.',
      'Servieren.',
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

  it('rejects unknown top-level fields and a front-matter ingredients list', () => {
    const unknown = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nrezeptart: fertig\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(unknown, 'rezeptart', 'Unbekanntes Feld');

    const oldFormat = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\n' +
        'ingredients:\n  - name: X\n    quantity: 1\n    unit: g\n---\n## Zubereitung\n1. x\n',
    );
    expectIssueAt(oldFormat, 'ingredients', 'abgeleitet');
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

describe('parseRecipe — marker validation (§4)', () => {
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

  it('rejects non-ladder and zero marker quantities', () => {
    const notLadder = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Mehl|450|g}} vermengen.\n',
    );
    expectIssueAt(notLadder, 'steps[0]', 'Standardwert');

    const zero = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Salz|0|g}} würzen.\n',
    );
    expectIssueAt(zero, 'steps[0]', 'positive Zahl');
  });

  it('rejects malformed markers (quoted quantity, invalid unit, missing fields)', () => {
    const quoted = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Mehl|"400"|g}} vermengen.\n',
    );
    expectIssueAt(quoted, 'steps[0]', 'Ungültiger Zutaten-Marker');

    const badUnit = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Mehl|400|Stück}} vermengen.\n',
    );
    expectIssueAt(badUnit, 'steps[0]', 'Ungültiger Zutaten-Marker');

    const missingFields = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Joghurt}} verrühren.\n',
    );
    expectIssueAt(missingFields, 'steps[0]', 'Ungültiger Zutaten-Marker');
  });

  it('allows at most 2 reference markers, only for finished_dish', () => {
    const threeRefs = parseIssues(
      '---\ntitle: X\ntype: finished_dish\nservings: 2\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n' +
        '1. {{ingredient|A|1|g|ref}} und {{ingredient|B|1|g|ref}} und {{ingredient|C|1|g|ref}}.\n',
    );
    expectIssueAt(threeRefs, 'body', 'Höchstens 2');

    const refOnSub = parseIssues(
      '---\ntitle: X\ntype: ingredient_recipe\nyield: 500\nyield_unit: ml\nprep_time: 10 min\n' +
        '---\n## Zubereitung\n1. {{ingredient|A|1|g|ref}}.\n',
    );
    expectIssueAt(refOnSub, 'body', 'finished_dish');
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

  it('collects several independent problems in one call', () => {
    const issues = parseIssues(
      '---\ntype: dessert\nservings: 11\nprep_time: 10 min\n---\n## Zubereitung\n1. {{ingredient|Mehl|450|Stück}} vermengen.\n',
    );
    // Invalid type: per-type checks (e.g. servings) are deliberately skipped so
    // the type problem stays the precise error; independent checks still run.
    expectIssueAt(issues, 'type');
    expectIssueAt(issues, 'title');
    expectIssueAt(issues, 'steps[0]');
  });
});
