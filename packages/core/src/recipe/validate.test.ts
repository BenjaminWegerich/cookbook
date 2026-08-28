/**
 * Tests for the cross-recipe validation (docs/storage_format.md §7.2).
 *
 * The fixtures carry their ingredients as body markers (§4 — the step text is
 * the source of truth); the `recipe:` link is the marker's |recipe: flag.
 */

import { describe, expect, it } from 'vitest';

import { RecipeCollectionError } from './types.js';
import type { Recipe, ValidationIssue } from './types.js';
import { parseRecipe } from './parse.js';
import { validateCollection } from './validate.js';

/** Parses `text` (fixtures are valid per §7.1) into a Recipe. */
function parse(text: string): Recipe {
  return parseRecipe(text);
}

/** A finished dish that links the Béchamelsauce ingredient recipe. */
const WRAPS = parse(`---
title: Shredded Tofu Wraps
type: finished_dish
servings: 6
prep_time: 20 min
---
## Zubereitung
1. {{ingredient|Tortillas|250|g|ref}} füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.
`);

/** The linked ingredient recipe. */
const BECHAMEL = parse(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. {{ingredient|Milch|300|ml}} kochen.
`);

/** An unrelated finished dish without links. */
const PASTA = parse(`---
title: Spaghetti
type: finished_dish
servings: 4
prep_time: 10 min
---
## Zubereitung
1. {{ingredient|Nudeln|500|g|ref}} kochen.
`);

/** Asserts that validateCollection throws and returns the issues. */
function collectionIssues(recipes: readonly Recipe[]): readonly ValidationIssue[] {
  try {
    validateCollection(recipes);
    throw new Error('expected validateCollection to throw a RecipeCollectionError');
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeCollectionError);
    return (error as RecipeCollectionError).issues;
  }
}

describe('validateCollection', () => {
  it('accepts a valid collection (dish + linked ingredient recipe)', () => {
    expect(() => validateCollection([WRAPS, BECHAMEL])).not.toThrow();
    expect(() => validateCollection([PASTA, WRAPS, BECHAMEL])).not.toThrow();
  });

  it('accepts a recipe without any recipe: links', () => {
    expect(() => validateCollection([PASTA])).not.toThrow();
  });

  it('accepts a chain of ingredient recipes', () => {
    const dough = parse(`---
title: Teig
type: ingredient_recipe
yield: 500
yield_unit: g
prep_time: 15 min
---
## Zubereitung
1. {{ingredient|Mehl|300|g}} kneten.
`);
    expect(() => validateCollection([BECHAMEL, dough])).not.toThrow();
  });

  it('rejects duplicate titles', () => {
    const twin = parse(`---
title: Spaghetti
type: finished_dish
servings: 2
prep_time: 10 min
---
## Zubereitung
1. {{ingredient|Nudeln|250|g}} kochen.
`);
    const issues = collectionIssues([PASTA, twin]);
    expectIssueAt(issues, 'Spaghetti', 'nicht eindeutig');
  });

  it('rejects a dangling recipe: reference', () => {
    const issues = collectionIssues([WRAPS]); // Béchamelsauce is missing
    expectIssueAt(issues, 'Shredded Tofu Wraps.ingredients[1].recipe', 'existiert nicht');
  });

  it('rejects a recipe: reference to a finished_dish', () => {
    const linksDish = parse(`---
title: Tofu-Füllung
type: ingredient_recipe
yield: 500
yield_unit: g
prep_time: 10 min
---
## Zubereitung
1. {{ingredient|Füllung|400|g|recipe:Spaghetti}} unterheben.
`);
    const issues = collectionIssues([PASTA, linksDish]);
    expectIssueAt(issues, 'Tofu-Füllung.ingredients[0].recipe', 'ingredient_recipe');
  });

  it('rejects self-referencing and cyclic link graphs', () => {
    const selfRef = parse(`---
title: Selbst
type: ingredient_recipe
yield: 100
yield_unit: g
prep_time: 5 min
---
## Zubereitung
1. {{ingredient|Eigen|100|g|recipe:Selbst}} mischen.
`);
    const selfIssues = collectionIssues([selfRef]);
    expectIssueAt(selfIssues, 'Selbst', 'Zyklus');

    const a = parse(`---
title: Sauce A
type: ingredient_recipe
yield: 100
yield_unit: ml
prep_time: 5 min
---
## Zubereitung
1. {{ingredient|Anteil B|100|ml|recipe:Sauce B}} mischen.
`);
    const b = parse(`---
title: Sauce B
type: ingredient_recipe
yield: 100
yield_unit: ml
prep_time: 5 min
---
## Zubereitung
1. {{ingredient|Anteil A|100|ml|recipe:Sauce A}} mischen.
`);
    const cycleIssues = collectionIssues([a, b]);
    expectIssueAt(cycleIssues, 'Sauce A', 'Zyklus');
  });
});

/** Asserts that exactly one issue exists at `path`. */
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
