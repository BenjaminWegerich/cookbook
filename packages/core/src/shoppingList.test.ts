/**
 * Tests for the shopping list's arithmetic (core's shoppingList.ts).
 *
 * The cases are the rules decided with the user, in the order the sheet applies
 * them:
 * - scaling a dish's ingredient list to the size the plan cooks it at;
 * - summing the selected dishes per ingredient (the bundle: two dishes that
 *   each need 300 g need 600 g once, not 300 g twice);
 * - the pantry: the Vorrat starts on `min(need, reorder point)`;
 * - rounding *up* to whole shopping units, or to whole family units without
 *   one — never below the need, and not necessarily a ladder rung;
 * - the stepper's bounds: never above the need, never below 0.
 *
 * Quantity text joins number and unit with the narrow no-break space
 * (`NNBSP`, docs/CODING_CONVENTIONS.md), so the expected lines are built with
 * it rather than typed as plain spaces.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { NNBSP } from './additionalUnits.js';
import { resetIngredientMappings, setIngredientMappings } from './ingredientRegistry.js';
import type { PlannedAmount } from './planLink.js';
import type { Ingredient, Recipe } from './recipe/types.js';
import {
  scaledIngredientsForPlan,
  shoppingNeeds,
  shoppingRow,
  steppedStock,
  stockPrefill,
  sumIngredientUses,
  type ShoppingNeed,
} from './shoppingList.js';

/** The typographic space of every displayed quantity (see the file header). */
const NB = NNBSP;

/** A recipe with only the fields these functions read. */
function recipe(fields: Partial<Recipe> & Pick<Recipe, 'type'>): Recipe {
  return {
    title: 'Testrezept',
    prep_time: '25 min',
    steps: [],
    ingredients: [],
    ...fields,
  };
}

/** One ingredient use in the given family unit. */
function use(name: string, quantity: number, unit: Ingredient['unit'] = 'g'): Ingredient {
  return { name, quantity, unit };
}

/** A need as the sheet holds it (bypassing the registry look-up of `shoppingNeeds`). */
function need(
  fields: Partial<ShoppingNeed> & Pick<ShoppingNeed, 'ingredient' | 'needed'>,
): ShoppingNeed {
  return { baseUnit: 'g', reorderPoint: 0, ...fields };
}

beforeEach(() => {
  resetIngredientMappings();
});

describe('scaledIngredientsForPlan', () => {
  it('scales a dish from its written serving count to the planned one', () => {
    // Written for 4, planned for 8 (4 rungs apart on the ladder): the same step
    // count the export's cooking view applies, so the sheet and the cooking view
    // can never disagree (250 g → 400 g).
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Mehl', 250)],
    });
    expect(scaledIngredientsForPlan(dish, { kind: 'servings', servings: 8 })).toEqual([
      use('Mehl', 400),
    ]);
  });

  it('leaves the list unscaled when the entry states no size', () => {
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Mehl', 250)],
    });
    expect(scaledIngredientsForPlan(dish, null)).toEqual([use('Mehl', 250)]);
  });

  it('scales an ingredient recipe so its yield matches the required amount', () => {
    // Béchamelsauce: written at 500 ml, needed at 1000 ml (5 rungs) — 250 g
    // becomes 500 g (docs/recipe_structure.md, "The link means…").
    const sauce = recipe({
      type: 'ingredient_recipe',
      yield: 500,
      yield_unit: 'ml',
      ingredients: [use('Mehl', 250)],
    });
    expect(
      scaledIngredientsForPlan(sauce, { kind: 'yield', quantity: 1000, baseUnit: 'ml' }),
    ).toEqual([use('Mehl', 500)]);
  });

  it('ignores a planned size of another kind or family unit', () => {
    const dish = recipe({ type: 'finished_dish', servings: 4, ingredients: [use('Mehl', 250)] });
    const foreign: PlannedAmount = { kind: 'yield', quantity: 1000, baseUnit: 'ml' };
    expect(scaledIngredientsForPlan(dish, foreign)).toEqual([use('Mehl', 250)]);
  });

  it('normalizes a display unit (kg / l) to the family base unit', () => {
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Milch', 1, 'l')],
    });
    expect(scaledIngredientsForPlan(dish, { kind: 'servings', servings: 4 })).toEqual([
      use('Milch', 1000, 'ml'),
    ]);
  });
});

describe('sumIngredientUses', () => {
  it('sums one ingredient across the bundle and keeps the order of first use', () => {
    const first = [use('Tofu', 300), use('Mehl', 250)];
    const second = [use('Tofu', 300)];
    expect(sumIngredientUses([first, second])).toEqual([use('Tofu', 600), use('Mehl', 250)]);
  });

  it('keeps a need that is not a ladder rung exactly (no rounding down)', () => {
    // 400 + 750 = 1150: the nearest rung would be 1200, and rounding to the
    // nearer rung could also round *down* — a shopping need must not.
    expect(sumIngredientUses([[use('Mehl', 400)], [use('Mehl', 750)]])).toEqual([
      use('Mehl', 1150),
    ]);
  });

  it('does not sum the same name in different units', () => {
    expect(sumIngredientUses([[use('Milch', 500, 'ml'), use('Milch', 200, 'g')]])).toEqual([
      use('Milch', 500, 'ml'),
      use('Milch', 200, 'g'),
    ]);
  });
});

describe('shoppingNeeds', () => {
  it('carries the reorder point of the ingredient master data', () => {
    expect(shoppingNeeds([use('Mehl', 800)])).toEqual([
      { ingredient: 'Mehl', baseUnit: 'g', needed: 800, reorderPoint: 1000 },
    ]);
  });

  it('assumes no stock for an ingredient the master data does not know', () => {
    expect(shoppingNeeds([use('Tofu', 600)])).toEqual([
      { ingredient: 'Tofu', baseUnit: 'g', needed: 600, reorderPoint: 0 },
    ]);
  });

  it('assumes no stock when the master data knows another family unit', () => {
    expect(shoppingNeeds([use('Mehl', 500, 'ml')])).toEqual([
      { ingredient: 'Mehl', baseUnit: 'ml', needed: 500, reorderPoint: 0 },
    ]);
  });
});

describe('stockPrefill', () => {
  it('takes the smaller of need and reorder point', () => {
    // "800 g Mehl needed, 1000 g reorder point" — the Vorrat shows 800 g, so
    // nothing is bought (the user's own example).
    expect(stockPrefill(need({ ingredient: 'Mehl', needed: 800, reorderPoint: 1000 }))).toBe(800);
    expect(stockPrefill(need({ ingredient: 'Mehl', needed: 1500, reorderPoint: 1000 }))).toBe(1000);
  });

  it('treats an infinite reorder point as a covered need', () => {
    expect(
      stockPrefill(
        need({ ingredient: 'Wasser', needed: 1500, reorderPoint: Number.POSITIVE_INFINITY }),
      ),
    ).toBe(1500);
  });

  it('starts on zero without a reorder point', () => {
    expect(stockPrefill(need({ ingredient: 'Milch', needed: 500, baseUnit: 'ml' }))).toBe(0);
  });
});

describe('shoppingRow', () => {
  it('covers the need fully when the stock is enough', () => {
    const row = shoppingRow(need({ ingredient: 'Mehl', needed: 800, reorderPoint: 1000 }), 800);
    expect(row.covered).toBe(true);
    expect(row.text).toBeNull();
  });

  it('rounds up to whole shopping units (Becher, 150 g)', () => {
    // 1150 g less a 1000 g stock = 150 g → exactly one Becher.
    expect(
      shoppingRow(need({ ingredient: 'Mehl', needed: 1150, reorderPoint: 1000 }), 1000).text,
    ).toBe(`1${NB}Becher Mehl (150${NB}g)`);
    // 600 g of yoghurt in 400 g Becher → two Becher (800 g).
    expect(shoppingRow(need({ ingredient: 'Joghurt', needed: 600 }), 0).text).toBe(
      `2${NB}Becher Joghurt (800${NB}g)`,
    );
  });

  it('falls back to the family unit without a shopping unit, rounded up to a whole unit', () => {
    // Butter has only EL (a recipe measure, not a shopping unit): 850 g is
    // bought as 850 g — a value that is not a ladder rung.
    expect(shoppingRow(need({ ingredient: 'Butter', needed: 850 }), 0).text).toBe(
      `850${NB}g Butter`,
    );
    // A fraction of a gram still rounds up to a whole gram.
    expect(shoppingRow(need({ ingredient: 'Butter', needed: 0.4 }), 0).text).toBe(`1${NB}g Butter`);
  });

  it('switches to kg / l from 1000 upwards, like every quantity display', () => {
    expect(shoppingRow(need({ ingredient: 'Butter', needed: 2000 }), 0).text).toBe(
      `2${NB}kg Butter`,
    );
  });

  it('never rounds a floating-point artefact up (1150 g stays 1150 g)', () => {
    const noisy = need({ ingredient: 'Butter', needed: 400 + 750 * 1.0000000000000002 });
    expect(noisy.needed).toBeCloseTo(1150, 9);
    expect(shoppingRow(noisy, 0).text).toBe(`1,15${NB}kg Butter`);
  });

  it('clamps the stock into the possible range', () => {
    expect(shoppingRow(need({ ingredient: 'Butter', needed: 500 }), -20).stock).toBe(0);
    expect(shoppingRow(need({ ingredient: 'Butter', needed: 500 }), 900).covered).toBe(true);
  });

  it('counts whole packages beyond the unit’s number scheme', () => {
    // 2000 g of flour in 150 g Becher = 14 Becher (2,1 kg): odd but true, and
    // the scheme that bounds a *recipe* display must not shrink a shopping list.
    expect(shoppingRow(need({ ingredient: 'Mehl', needed: 2000 }), 0).text).toBe(
      `14${NB}Becher Mehl (2,1${NB}kg)`,
    );
  });

  it('uses the loaded master data for the shopping unit', () => {
    // The user's own zutaten.csv replaces the registry; the bundling case is the
    // bullwhip effect this flow exists to avoid — two dishes of 300 g tofu in
    // 200 g Becher buy three Becher, not four.
    setIngredientMappings({
      Tofu: { bu: 'g', reorderPoint: 0, entries: [{ au: 'Becher', factor: 200, priority: 1 }] },
    });
    const bundling = sumIngredientUses([[use('Tofu', 300)], [use('Tofu', 300)]]);
    const rows = shoppingNeeds(bundling).map((entry) => shoppingRow(entry, 0));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(`3${NB}Becher Tofu (600${NB}g)`);
  });
});

describe('steppedStock', () => {
  it('steps rung by rung', () => {
    expect(steppedStock(1000, 3000, 1)).toBe(1200);
    expect(steppedStock(1000, 3000, -1)).toBe(900);
  });

  it('steps from an off-ladder stock onto the ladder', () => {
    expect(steppedStock(1150, 2000, 1)).toBe(1200);
    expect(steppedStock(1150, 2000, -1)).toBe(1000);
  });

  it('starts from zero on the smallest offered quantity', () => {
    expect(steppedStock(0, 800, 1)).toBe(1);
    expect(steppedStock(1, 800, -1)).toBe(0);
  });

  it('never steps above the need (Einkaufen can never become negative)', () => {
    expect(steppedStock(1150, 1150, 1)).toBeNull();
    expect(steppedStock(500, 500, 1)).toBeNull();
    // The rung above 1000 would overshoot a need of 1150: the need is the step.
    expect(steppedStock(1000, 1150, 1)).toBe(1150);
  });

  it('never steps below zero', () => {
    expect(steppedStock(0, 800, -1)).toBeNull();
  });

  it('honours a caller pool floor', () => {
    expect(steppedStock(0, 800, 1, 10)).toBe(10);
    expect(steppedStock(10, 800, -1, 10)).toBe(0);
  });
});
