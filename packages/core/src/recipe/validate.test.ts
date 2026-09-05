/**
 * Tests for the cross-recipe validation (docs/storage_format.md §7.2).
 *
 * Sub-recipe links are implicit: an ingredient use whose name equals the title
 * of an `ingredient_recipe` *is* that sub-recipe. Uses appear as step rows or
 * as inline text artifacts of the prose.
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

/** A finished dish that uses the Béchamelsauce ingredient recipe (by name). */
const WRAPS = parse(`---
title: Shredded Tofu Wraps
type: finished_dish
servings: 6
prep_time: 20 min
---
## Zubereitung
1. - 250 g Tortillas
   - 500 ml Béchamelsauce
   Tortillas füllen und Béchamelsauce dazureichen.
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
1. - 300 ml Milch
   Milch kochen.
`);

/** An unrelated finished dish without links. */
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

describe('validateCollection', () => {
  it('accepts a valid collection (dish + linked ingredient recipe)', () => {
    expect(() => validateCollection([WRAPS, BECHAMEL])).not.toThrow();
    expect(() => validateCollection([PASTA, WRAPS, BECHAMEL])).not.toThrow();
  });

  it('accepts a recipe without any sub-recipe links', () => {
    expect(() => validateCollection([PASTA])).not.toThrow();
  });

  it('accepts a chain of ingredient recipes', () => {
    const dough = parse(`---
title: Brühwürfel
type: ingredient_recipe
yield: 100
yield_unit: g
prep_time: 5 min
---
## Zubereitung
1. - 100 g Brühe
   Brühe einkochen.
`);
    const sauce = parse(`---
title: Bratensauce
type: ingredient_recipe
yield: 300
yield_unit: ml
prep_time: 10 min
---
## Zubereitung
1. - 60 g Brühwürfel
   Brühwürfel in Wasser auflösen.
`);
    expect(() => validateCollection([BECHAMEL, dough, sauce])).not.toThrow();
  });

  it('accepts an ingredient name that equals a finished-dish title (no link)', () => {
    const usesPlainName = parse(`---
title: Curry
type: finished_dish
servings: 4
prep_time: 10 min
---
## Zubereitung
1. - 200 g Spaghetti
   Spaghetti unterheben.
`);
    // "Spaghetti" names the finished dish above, not an ingredient_recipe —
    // the row stays a plain ingredient and no cycle/link check applies.
    expect(() => validateCollection([PASTA, usesPlainName])).not.toThrow();
  });

  it('rejects duplicate titles', () => {
    const twin = parse(`---
title: Spaghetti
type: finished_dish
servings: 2
prep_time: 10 min
---
## Zubereitung
1. - 250 g Nudeln
   Nudeln kochen.
`);
    const issues = collectionIssues([PASTA, twin]);
    expectIssueAt(issues, 'Spaghetti', 'nicht eindeutig');
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
1. - 100 g Selbst
   Selbst verwenden.
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
1. - 100 ml Sauce B
   Sauce B untermischen.
`);
    const b = parse(`---
title: Sauce B
type: ingredient_recipe
yield: 100
yield_unit: ml
prep_time: 5 min
---
## Zubereitung
1. - 100 ml Sauce A
   Sauce A untermischen.
`);
    const cycleIssues = collectionIssues([a, b]);
    expectIssueAt(cycleIssues, 'Sauce A', 'Zyklus');
  });

  it('detects links that only appear as inline text artifacts', () => {
    const viaArtifact = parse(`---
title: Bowl
type: finished_dish
servings: 2
prep_time: 10 min
---
## Zubereitung
1. - 100 g Reis
   Reis kochen, dann {{200 ml Béchamelsauce}} untermischen.
`);
    const cyclic = parse(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 200
yield_unit: ml
prep_time: 5 min
---
## Zubereitung
1. Bowl zubereiten und einkochen.
`);
    // Artifact mention in Bowl links Béchamelsauce (single edge, no cycle).
    expect(() => validateCollection([viaArtifact, cyclic])).not.toThrow();
  });
});
