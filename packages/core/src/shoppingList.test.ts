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
 * - the stock values a row's slider snaps to (one stop per result, whole packs,
 *   or ladder rungs) and the stock's translation into its shopping unit
 *   ("2 Stück").
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
  buyAmount,
  needText,
  scaledIngredientsForPlan,
  shoppingNeeds,
  shoppingRow,
  shoppingUnitOf,
  stockCountText,
  stockPool,
  stockPrefill,
  suggestedStocks,
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
    // The sheet's header line shows a dash exactly when the row carries no
    // line at all.
    expect(row.amountText).toBeNull();
  });

  it('rounds up to whole shopping units (a 1000 g pack of flour)', () => {
    // 1150 g less a 1000 g stock = 150 g, and flour is only bought in 1000 g
    // packs (Mehl's shopping unit) → one whole pack, the smallest purchase the
    // dishes' need allows. The pack's amount is what the pack holds (1 kg), not
    // the 150 g that were missing (§6.3, exact unit).
    expect(
      shoppingRow(need({ ingredient: 'Mehl', needed: 1150, reorderPoint: 1000 }), 1000).text,
    ).toBe(`1${NB}Packung Mehl (1${NB}kg)`);
    // 600 g of yoghurt in 400 g Becher → two Becher (800 g).
    expect(shoppingRow(need({ ingredient: 'Joghurt', needed: 600 }), 0).text).toBe(
      `2${NB}Becher Joghurt (800${NB}g)`,
    );
  });

  it('names whole pieces for an approximate shopping unit (Stück, 80 g)', () => {
    // Carrots are bought by the piece, but a piece is only about 80 g (§6.3):
    // 500 g needed → 7 pieces, while the line keeps the amount the dishes need
    // (7 × 80 g = 560 g is the approximate reading, 500 g the authoritative one).
    expect(shoppingRow(need({ ingredient: 'Karotten', needed: 500 }), 0).text).toBe(
      `7${NB}Stück Karotten (500${NB}g)`,
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
    // 12 kg of flour in 1000 g packs = 12 packs: odd but true, and the scheme
    // that bounds a *recipe* display must not shrink a shopping list.
    expect(shoppingRow(need({ ingredient: 'Mehl', needed: 12000 }), 0).text).toBe(
      `12${NB}Packung Mehl (12${NB}kg)`,
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

describe('the amount of a shopping row (amountText)', () => {
  it('is the written line with the ingredient name and its space removed', () => {
    // The row's header line carries the name already, so the line prints only
    // the amount — one source for both readings.
    const becher = shoppingRow(need({ ingredient: 'Joghurt', needed: 850 }), 0);
    expect(becher.text).toBe(`3${NB}Becher Joghurt (1,2${NB}kg)`);
    expect(becher.amountText).toBe(`3${NB}Becher (1,2${NB}kg)`);

    const base = shoppingRow(need({ ingredient: 'Butter', needed: 850 }), 0);
    expect(base.text).toBe(`850${NB}g Butter`);
    expect(base.amountText).toBe(`850${NB}g`);
  });

  it('keeps an ingredient name that occurs inside the arrangement text untouched', () => {
    // No string surgery is done on the rendered line: the amount is built from
    // the same pieces, so a name that happens to repeat (here "Becher") stays
    // in place.
    setIngredientMappings({
      Becher: { bu: 'g', reorderPoint: 0, entries: [{ au: 'Becher', factor: 200, priority: 1 }] },
    });
    const row = shoppingRow(need({ ingredient: 'Becher', needed: 300 }), 0);
    expect(row.text).toBe(`2${NB}Becher Becher (400${NB}g)`);
    expect(row.amountText).toBe(`2${NB}Becher (400${NB}g)`);
  });

  it('steps with the chosen stock, like the line it belongs to', () => {
    // The field beside the stepper follows it: half the need covered leaves
    // half to buy.
    const toBuy = shoppingRow(need({ ingredient: 'Butter', needed: 850 }), 400);
    expect(toBuy.amountText).toBe(`450${NB}g`);
    const covered = shoppingRow(need({ ingredient: 'Butter', needed: 850 }), 850);
    expect(covered.amountText).toBeNull();
  });
});

describe('buyAmount (the rounded-up "kaufen" default)', () => {
  it('rounds an exact purchase up to whole units', () => {
    // 600 g of yoghurt in 400 g Becher → two Becher (800 g).
    expect(buyAmount(need({ ingredient: 'Joghurt', needed: 600 }), 0)).toBe(800);
  });

  it('keeps the missing amount for an approximate shopping unit', () => {
    // 500 g of carrots at about 80 g a piece → 7 pieces, but the authoritative
    // amount stays the 500 g the dishes need (not 7 × 80 g = 560 g).
    expect(buyAmount(need({ ingredient: 'Karotten', needed: 500 }), 0)).toBe(500);
  });

  it('rounds a purchase without a shopping unit up to a whole gram', () => {
    expect(buyAmount(need({ ingredient: 'Butter', needed: 850 }), 400)).toBe(450);
    expect(buyAmount(need({ ingredient: 'Butter', needed: 0.4 }), 0)).toBe(1);
  });

  it('reads zero for a covered need', () => {
    expect(buyAmount(need({ ingredient: 'Mehl', needed: 800, reorderPoint: 1000 }), 800)).toBe(0);
    expect(buyAmount(need({ ingredient: 'Butter', needed: 850 }), 900)).toBe(0);
  });
});

describe('stockPool', () => {
  it('offers one stop per result within six exact shopping units', () => {
    // The user's example: 1200 g of flour in 1000 g packs. Below 200 g on the
    // shelf two packs are bought, from 200 g up exactly one, from the need
    // itself nothing — 300 g, 500 g and 1000 g are all the same case, so only
    // these three stock values are offered.
    expect(stockPool(need({ ingredient: 'Mehl', needed: 1200 }))).toEqual([0, 200, 1200]);
  });

  it('offers one stop per result, up to seven stops', () => {
    // 600 g of yoghurt in 400 g Becher: below 200 g two Becher, from 200 g one,
    // from 600 g none.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 600 }))).toEqual([0, 200, 600]);
    // Six units is the limit: 2400 g in 400 g Becher = 6 → seven stops.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 2400 }))).toEqual([
      0, 400, 800, 1200, 1600, 2000, 2400,
    ]);
  });

  it('switches to whole packs beyond six units', () => {
    // 2800 g in 400 g Becher = 7 packs: the stops walk whole packs and end on
    // the need itself, which covers it completely.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 2800 }))).toEqual([
      0, 400, 800, 1200, 1600, 2000, 2400, 2800,
    ]);
    // A need between two packs: the last stop is the need (nothing to buy), the
    // one below it the largest whole pack count that still leaves a purchase.
    expect(stockPool(need({ ingredient: 'Mehl', needed: 7500 }))).toEqual([
      0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 7500,
    ]);
  });

  it('walks the ladder within one tenth of the need without a shopping unit', () => {
    // Butter has only EL and TL (recipe measures, not shopping units): the stops
    // are 0, the ladder rungs from 85 g (a tenth of the need) up, and the need.
    expect(stockPool(need({ ingredient: 'Butter', needed: 850 }))).toEqual([
      0, 90, 100, 120, 150, 180, 200, 220, 250, 280, 300, 350, 400, 500, 600, 700, 800, 850,
    ]);
  });

  it('does not repeat a need that is itself a ladder rung', () => {
    expect(stockPool(need({ ingredient: 'Butter', needed: 800 }))).toEqual([
      0, 80, 90, 100, 120, 150, 180, 200, 220, 250, 280, 300, 350, 400, 500, 600, 700, 800,
    ]);
  });

  it('walks grams for an approximate shopping unit', () => {
    // Carrots: the slider moves in grams, but the shelf is counted in pieces.
    const values = stockPool(need({ ingredient: 'Karotten', needed: 500 }));
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(500);
  });

  it('falls back to the ladder for an ingredient without master data', () => {
    expect(stockPool(need({ ingredient: 'Tofu', needed: 400 }))).toEqual([
      0, 40, 50, 60, 70, 80, 90, 100, 120, 150, 180, 200, 220, 250, 280, 300, 350, 400,
    ]);
  });

  it('keeps the family unit of an ml ingredient', () => {
    // 1000 ml of milk in 250 ml Becher = 4 → five stops.
    expect(stockPool(need({ ingredient: 'Milch', needed: 1000, baseUnit: 'ml' }))).toEqual([
      0, 250, 500, 750, 1000,
    ]);
  });

  it('keeps an inert one-value pool for a row without a need', () => {
    expect(stockPool(need({ ingredient: 'Mehl', needed: 0 }))).toEqual([0]);
  });
});

describe('suggestedStocks (the stock chips\' suggested values)', () => {
  it('offers the thresholds where the bought amount changes for a shopping unit', () => {
    // 600 g of yoghurt in 400 g Becher: below 200 g two Becher, from 200 g one,
    // from 600 g none — so 0, 200 and 600 are the only relevant stock values.
    // 0 and the need lead (always kept); the chip row displays them ascending.
    expect(suggestedStocks(need({ ingredient: 'Joghurt', needed: 600 }))).toEqual([0, 600, 200]);
  });

  it('names the user example: 1200 g of flour in 1000 g packs', () => {
    expect(suggestedStocks(need({ ingredient: 'Mehl', needed: 1200 }))).toEqual([0, 1200, 200]);
  });

  it('walks whole packs beyond six units, with 0 and the need leading', () => {
    expect(suggestedStocks(need({ ingredient: 'Joghurt', needed: 2400 }))).toEqual([
      0, 2400, 400, 800, 1200, 1600, 2000,
    ]);
  });

  it('offers one rung per mantissa, in the decided priority, without a shopping unit', () => {
    // Butter has only recipe measures (EL/TL). The candidates are the 16 rungs
    // just below the need (90 … 800), ordered by their mantissa's priority:
    // "1" (100), "3" (300), "2" (200), … down to "2.8" (280).
    expect(suggestedStocks(need({ ingredient: 'Butter', needed: 850 }))).toEqual([
      0, 850, 100, 300, 200, 600, 400, 800, 150, 250, 500, 700, 90, 350, 120, 180, 220, 280,
    ]);
  });

  it('does not repeat a need that is itself a ladder rung', () => {
    // 600 g is the rung "6" of its decade: the "6" family then contributes 60,
    // not 600 (which is the need itself and already the second entry).
    expect(suggestedStocks(need({ ingredient: 'Butter', needed: 600 }))).toEqual([
      0, 600, 100, 300, 200, 60, 400, 80, 150, 250, 500, 70, 90, 350, 120, 180, 220, 280,
    ]);
  });

  it('keeps an inert single-value list for a row without a need', () => {
    expect(suggestedStocks(need({ ingredient: 'Mehl', needed: 0 }))).toEqual([0]);
  });
});

describe('shoppingUnitOf', () => {
  it('answers the shopping unit and its factor', () => {
    // Flour is bought in 1000 g packs, carrots in pieces of about 80 g.
    expect(shoppingUnitOf(need({ ingredient: 'Mehl', needed: 1200 }))).toMatchObject({
      au: { name: 'Packung' },
      factor: 1000,
    });
    expect(shoppingUnitOf(need({ ingredient: 'Karotten', needed: 500 }))?.au.name).toBe('Stück');
  });

  it('is null without a shopping unit', () => {
    // Butter has only EL and TL — recipe measures, no shopping unit of its own.
    expect(shoppingUnitOf(need({ ingredient: 'Butter', needed: 500 }))).toBeNull();
  });
});

describe('needText', () => {
  it('names the need as its plain base form, without the additional unit', () => {
    expect(needText(need({ ingredient: 'Joghurt', needed: 600 }))).toBe(`600${NB}g Joghurt`);
    expect(needText(need({ ingredient: 'Karotten', needed: 500 }))).toBe(`500${NB}g Karotten`);
  });

  it('switches to kg/l at 1000, like every base amount', () => {
    expect(needText(need({ ingredient: 'Mehl', needed: 1150 }))).toBe(`1,15${NB}kg Mehl`);
    expect(needText(need({ ingredient: 'Trockenhefe', needed: 60 }))).toBe(`60${NB}g Trockenhefe`);
  });
});

describe('stockCountText', () => {
  it('translates the stock into the shopping unit of an approximate one', () => {
    // 500 g of carrots at about 80 g per piece is six pieces.
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 500)).toBe(`6${NB}Stück`);
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 0)).toBe(`0${NB}Stück`);
  });

  it('counts beyond the number scheme to whole pieces', () => {
    // The scheme bounds what a *recipe* line may say (ten pieces), not how many
    // carrots are on the shelf.
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 2000)).toBe(
      `25${NB}Stück`,
    );
  });

  it('names only whole packs of an exact shopping unit', () => {
    // Flour is bought in 1000 g packs: two packs read as two packs, but 200 g is
    // no whole pack and would name a shelf that cannot exist.
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 2000)).toBe(`2${NB}Packung`);
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 0)).toBe(`0${NB}Packung`);
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 200)).toBeNull();
  });

  it('is null without a shopping unit', () => {
    // Butter is bought in no unit of its own — nothing to translate.
    expect(stockCountText(need({ ingredient: 'Butter', needed: 500 }), 100)).toBeNull();
  });
});
