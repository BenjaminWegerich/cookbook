/**
 * Tests for the shopping list's arithmetic (core's shoppingList.ts).
 *
 * The cases are the rules decided with the user, in the order the sheet applies
 * them:
 * - scaling a dish's ingredient list to the size the plan cooks it at, by the
 *   **exact** factor between the requested and the written size;
 * - summing the selected dishes per ingredient (the bundle: two dishes that
 *   each need 300 g need 600 g once, not 300 g twice);
 * - the pantry: the Vorrat starts on `min(need, reorder point)`;
 * - rounding *up* to whole shopping units, or to whole family units without
 *   one — never below the need;
 * - the stock values a row's chips suggest: one stop per result for an exact
 *   shopping unit, otherwise clean **BQ table** values (the old ladder is gone).
 *
 * Quantity text joins number and unit with the narrow no-break space
 * (`NNBSP`, docs/CODING_CONVENTIONS.md), so the expected lines are built with
 * it rather than typed as plain spaces.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { NNBSP } from './additionalUnits.js';
import { ADDITIONAL_UNITS } from './additionalUnitsData.js';
import { resetIngredientMappings, setIngredientMappings } from './ingredientRegistry.js';
import type { PlannedAmount } from './planLink.js';
import type { Ingredient, Recipe } from './recipe/types.js';
import {
  buyAmount,
  masterIngredientsAtFactor,
  masterIngredientsForPlan,
  needAq,
  needText,
  shoppingNeeds,
  shoppingRow,
  shoppingUnitOf,
  stockCountText,
  stockPool,
  stockPrefill,
  suggestedStocks,
  suggestedSubRecipeStocks,
  sumIngredientUses,
  type ShoppingNeed,
} from './shoppingList.js';

/** The typographic space of every displayed quantity (see the file header). */
const NB = NNBSP;

/** A recipe with only the fields these functions read. */
function recipe(fields: Partial<Recipe> & Pick<Recipe, 'type'>): Recipe {
  // A parsed recipe derives its master list from the step rows
  // (storage_format.md §4), so a fixture that names only the list still gets
  // the one step those rows stand for.
  const ingredients = fields.ingredients ?? [];
  const steps = fields.steps ?? (ingredients.length > 0 ? [{ ingredients, text: '' }] : []);
  return {
    title: 'Testrezept',
    prep_time: '25 min',
    ...fields,
    steps,
    ingredients,
  };
}

/** One ingredient use in the given family unit. */
function use(name: string, quantity: number, unit: Ingredient['unit'] = 'g'): Ingredient {
  return { name, quantity, unit };
}

/** The shopping uses of one dish, merged as the bundle sums them. */
function summed(...uses: Ingredient[]) {
  return sumIngredientUses([uses]);
}

/** The three sum-only fields of a use, dropping its contributions and AQ. */
function amounts(
  uses: readonly Ingredient[],
): Array<Pick<Ingredient, 'name' | 'quantity' | 'unit'>> {
  return uses.map(({ name, quantity, unit }) => ({ name, quantity, unit }));
}

/** The master-data AU object by name, for hand-built contributions. */
function au(name: string) {
  const unit = ADDITIONAL_UNITS.find((entry) => entry.name === name);
  if (unit === undefined) throw new Error(`unknown additional unit: ${name}`);
  return unit;
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

describe('masterIngredientsForPlan', () => {
  it('uses the master quantity the recipe shows at the planned size', () => {
    // Written for 4, planned for 6: the step use is 375 g, and the master row
    // the cook reads names the near BQ table value — 400 g, not 250 × 1.5
    // (docs/quantity_scaling.md §6).
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Mehl', 250)],
    });
    expect(masterIngredientsForPlan(dish, { kind: 'servings', servings: 6 })).toEqual([
      use('Mehl', 400),
    ]);
  });

  it('scales an ingredient recipe by the yield factor', () => {
    // Béchamelsauce: written at 500 ml, needed at 750 ml — factor 1.5, so the
    // 300 ml of milk read 450 ml (docs/recipe_structure.md).
    const sauce = recipe({
      type: 'ingredient_recipe',
      yield: 500,
      yield_unit: 'ml',
      ingredients: [use('Milch', 300, 'ml')],
    });
    expect(
      masterIngredientsForPlan(sauce, { kind: 'yield', quantity: 750, baseUnit: 'ml' }),
    ).toEqual([use('Milch', 450, 'ml')]);
  });

  it('uses the displayed master amount, not the exact scaled target', () => {
    // 100 g for 3 servings, cooked for 5: the exact target is 166,666… g, but
    // the master row names the BQ table value 160 g. The shopping need follows
    // what the recipe shows, never the hidden target.
    const dish = recipe({
      type: 'finished_dish',
      servings: 3,
      ingredients: [use('Mehl', 100)],
    });
    expect(masterIngredientsForPlan(dish, { kind: 'servings', servings: 5 })).toEqual([
      use('Mehl', 160),
    ]);
  });

  it('keeps the written master amount when the entry states no size', () => {
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Mehl', 250)],
    });
    expect(masterIngredientsForPlan(dish, null)).toEqual([use('Mehl', 250)]);
  });

  it('ignores a planned size of another kind or family unit', () => {
    const dish = recipe({ type: 'finished_dish', servings: 4, ingredients: [use('Mehl', 250)] });
    const foreign: PlannedAmount = { kind: 'yield', quantity: 1000, baseUnit: 'ml' };
    expect(masterIngredientsForPlan(dish, foreign)).toEqual([use('Mehl', 250)]);
  });

  it('normalizes a display unit (kg / l) and carries the master line’s AQ', () => {
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Milch', 1, 'l')],
    });
    const [entry] = masterIngredientsForPlan(dish, { kind: 'servings', servings: 4 });
    expect(entry).toMatchObject({ name: 'Milch', quantity: 1000, unit: 'ml' });
    // 1 l of milk is exactly one 1000 ml pack, and the contribution carries
    // that reading for the aggregate display.
    expect(entry?.aq).toMatchObject({
      value: 1,
      factor: 1000,
      au: { name: 'Packung (unteilbar)' },
    });
  });

  it('falls back to the stored amount at the factor without step uses', () => {
    // Only hand-edited data can leave a master row without step rows; the
    // bundle must not fail on it (the parsed format derives the list from them).
    const dish = recipe({
      type: 'finished_dish',
      servings: 4,
      ingredients: [use('Mehl', 250)],
      steps: [],
    });
    expect(masterIngredientsForPlan(dish, { kind: 'servings', servings: 6 })).toEqual([
      use('Mehl', 375),
    ]);
  });

  it('derives the master list at a cook factor (sub-recipes)', () => {
    const sauce = recipe({
      type: 'ingredient_recipe',
      yield: 500,
      yield_unit: 'ml',
      ingredients: [use('Milch', 300, 'ml')],
    });
    expect(masterIngredientsAtFactor(sauce, 1.5)).toEqual([use('Milch', 450, 'ml')]);
  });
});

describe('sumIngredientUses', () => {
  it('sums one ingredient across the bundle and keeps the order of first use', () => {
    const first = [use('Tofu', 300), use('Mehl', 250)];
    const second = [use('Tofu', 300)];
    expect(amounts(sumIngredientUses([first, second]))).toEqual([
      use('Tofu', 600),
      use('Mehl', 250),
    ]);
  });

  it('keeps a need that is no table value exactly (no rounding down)', () => {
    // 400 + 750 = 1150: the nearest BQ would be 1200, and rounding to the
    // nearer value could also round *down* — a shopping need must not.
    expect(amounts(sumIngredientUses([[use('Mehl', 400)], [use('Mehl', 750)]]))).toEqual([
      use('Mehl', 1150),
    ]);
  });

  it('keeps every constituent amount for the aggregate display', () => {
    // The total's AQ may not repeat one dish's count, so the merge carries the
    // individual master amounts along (docs/quantity_scaling.md §6).
    const merged = sumIngredientUses([[use('Mehl', 400)], [use('Mehl', 750)]]);
    expect(merged[0]!.contributions.map((contribution) => contribution.quantity)).toEqual([
      400, 750,
    ]);
  });

  it('removes floating-point noise without moving the amount', () => {
    expect(sumIngredientUses([[use('Mehl', 0.1)], [use('Mehl', 0.2)]])[0]!.quantity).toBe(0.3);
  });

  it('does not sum the same name in different units', () => {
    expect(amounts(sumIngredientUses([[use('Milch', 500, 'ml'), use('Milch', 200, 'g')]]))).toEqual(
      [use('Milch', 500, 'ml'), use('Milch', 200, 'g')],
    );
  });
});

describe('shoppingNeeds', () => {
  it('carries the reorder point of the ingredient master data', () => {
    expect(shoppingNeeds(summed(use('Mehl', 800)))).toMatchObject([
      { ingredient: 'Mehl', baseUnit: 'g', needed: 800, reorderPoint: 1000 },
    ]);
  });

  it('assumes no stock for an ingredient the master data does not know', () => {
    expect(shoppingNeeds(summed(use('Tofu', 600)))).toMatchObject([
      { ingredient: 'Tofu', baseUnit: 'g', needed: 600, reorderPoint: 0 },
    ]);
  });

  it('assumes no stock when the master data knows another family unit', () => {
    expect(shoppingNeeds(summed(use('Mehl', 500, 'ml')))).toMatchObject([
      { ingredient: 'Mehl', baseUnit: 'ml', needed: 500, reorderPoint: 0 },
    ]);
  });

  it('carries the summed contributions into the row', () => {
    // The sheet's need line needs the individual master amounts; the row is the
    // only place that keeps them once the uses are merged.
    const [row] = shoppingNeeds(summed(use('Mehl', 800)));
    expect(row?.contributions?.map((contribution) => contribution.quantity)).toEqual([800]);
  });
});

describe('stockPrefill', () => {
  it('takes the smaller of need and reorder point', () => {
    // "800 g Mehl needed, 1000 g reorder point" — the Vorrat shows 800 g, so
    // nothing is bought (the user's own example). The need is the top chip and
    // is returned exactly.
    expect(stockPrefill(need({ ingredient: 'Mehl', needed: 800, reorderPoint: 1000 }))).toBe(800);
  });

  it('snaps a reorder point between two chips down to the lower chip', () => {
    // 1500 g Mehl needed in 1000 g packs: the chips are 0 / 500 / 1500 (the
    // stock values where the bought amount changes). A 1000 g reorder point sits
    // between 500 and 1500, so the Vorrat starts on the lower chip, 500 g.
    expect(stockPrefill(need({ ingredient: 'Mehl', needed: 1500, reorderPoint: 1000 }))).toBe(500);
  });

  it('keeps a reorder point between chips as-is without an exact unit', () => {
    // Cashews have no additional unit at all: a 110 g reorder point for a 400 g
    // need is kept, not snapped — the sheet shows it as a custom ("andere") chip.
    expect(stockPrefill(need({ ingredient: 'Cashews', needed: 400, reorderPoint: 110 }))).toBe(110);
  });

  it('keeps a reorder point between chips as-is with an approximate shopping unit', () => {
    // Karotten are bought per Stück, an *approximate* shopping unit: a 300 g
    // reorder point is the stock itself, not snapped to a package threshold.
    expect(stockPrefill(need({ ingredient: 'Karotten', needed: 500, reorderPoint: 300 }))).toBe(
      300,
    );
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
    // 600 g of yoghurt in 500 g Becher → two Becher (1 kg).
    expect(shoppingRow(need({ ingredient: 'Joghurt', needed: 600 }), 0).text).toBe(
      `2${NB}Becher Joghurt (1${NB}kg)`,
    );
  });

  it('names whole pieces for an approximate shopping unit (Stück, 70 g)', () => {
    // Carrots are bought by the piece, but a piece is only about 70 g (§6.3):
    // 500 g needed → 8 pieces, while the line keeps the amount the dishes need
    // (8 × 70 g is the approximate reading, 500 g the authoritative one).
    expect(shoppingRow(need({ ingredient: 'Karotten', needed: 500 }), 0).text).toBe(
      `8${NB}Karotten (500${NB}g)`,
    );
  });

  it('names the exact BE-first unit through the ingredient count forms', () => {
    // Aquafaba is bought by the can behind "Stück (BE zuerst, exakt)"; the
    // arrangement leads with the base amount and names the can as the count.
    const row = shoppingRow(need({ ingredient: 'Aquafaba', needed: 180, baseUnit: 'ml' }), 0);
    expect(row.text).toBe(`180${NB}ml Aquafaba (1${NB}Dose Kichererbsen)`);
    // The name-less "kaufen" side keeps the count form, too.
    expect(row.amountText).toBe(`180${NB}ml (1${NB}Dose Kichererbsen)`);
  });

  it('falls back to the family unit without a shopping unit, rounded up to a whole unit', () => {
    // Cashews have no additional unit: 850 g are bought as 850 g — a value that
    // need not be a table value.
    expect(shoppingRow(need({ ingredient: 'Cashews', needed: 850 }), 0).text).toBe(
      `850${NB}g Cashews`,
    );
    // A fraction of a gram still rounds up to a whole gram.
    expect(shoppingRow(need({ ingredient: 'Cashews', needed: 0.4 }), 0).text).toBe(
      `1${NB}g Cashews`,
    );
  });

  it('switches to kg / l from 1000 upwards, like every quantity display', () => {
    expect(shoppingRow(need({ ingredient: 'Cashews', needed: 2000 }), 0).text).toBe(
      `2${NB}kg Cashews`,
    );
  });

  it('never rounds a floating-point artefact up (1150 g stays 1150 g)', () => {
    const noisy = need({ ingredient: 'Cashews', needed: 400 + 750 * 1.0000000000000002 });
    expect(noisy.needed).toBeCloseTo(1150, 9);
    expect(shoppingRow(noisy, 0).text).toBe(`1,15${NB}kg Cashews`);
  });

  it('clamps the stock into the possible range', () => {
    expect(shoppingRow(need({ ingredient: 'Cashews', needed: 500 }), -20).stock).toBe(0);
    expect(shoppingRow(need({ ingredient: 'Cashews', needed: 500 }), 900).covered).toBe(true);
  });

  it('counts whole packages beyond the unit’s number scheme', () => {
    // 12 kg of flour in 1000 g packs = 12 packs: odd but true, and the scheme
    // that bounds a *recipe* display must not shrink a shopping list.
    expect(shoppingRow(need({ ingredient: 'Mehl', needed: 12000 }), 0).text).toBe(
      `12${NB}Packungen Mehl (12${NB}kg)`,
    );
  });

  it('uses the loaded master data for the shopping unit', () => {
    // The user's own zutaten.csv replaces the registry; the bundling case is the
    // bullwhip effect this flow exists to avoid — two dishes of 300 g tofu in
    // 200 g Becher buy three Becher, not four.
    setIngredientMappings({
      Tofu: {
        bu: 'g',
        precision: 'medium',
        reorderPoint: 0,
        entries: [{ au: 'Becher', factor: 200, shoppingUnit: true }],
      },
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
    expect(becher.text).toBe(`2${NB}Becher Joghurt (1${NB}kg)`);
    expect(becher.amountText).toBe(`2${NB}Becher (1${NB}kg)`);

    const base = shoppingRow(need({ ingredient: 'Cashews', needed: 850 }), 0);
    expect(base.text).toBe(`850${NB}g Cashews`);
    expect(base.amountText).toBe(`850${NB}g`);
  });

  it('keeps an ingredient name that occurs inside the arrangement text untouched', () => {
    // No string surgery is done on the rendered line: the amount is built from
    // the same pieces, so a name that happens to repeat (here "Becher") stays
    // in place.
    setIngredientMappings({
      Becher: {
        bu: 'g',
        precision: 'medium',
        reorderPoint: 0,
        entries: [{ au: 'Becher', factor: 200, shoppingUnit: true }],
      },
    });
    const row = shoppingRow(need({ ingredient: 'Becher', needed: 300 }), 0);
    expect(row.text).toBe(`2${NB}Becher Becher (400${NB}g)`);
    expect(row.amountText).toBe(`2${NB}Becher (400${NB}g)`);
  });

  it('steps with the chosen stock, like the line it belongs to', () => {
    // The field beside the stepper follows it: half the need covered leaves
    // half to buy.
    const toBuy = shoppingRow(need({ ingredient: 'Cashews', needed: 850 }), 400);
    expect(toBuy.amountText).toBe(`450${NB}g`);
    const covered = shoppingRow(need({ ingredient: 'Cashews', needed: 850 }), 850);
    expect(covered.amountText).toBeNull();
  });
});

describe('buyAmount (the rounded-up "kaufen" default)', () => {
  it('rounds an exact purchase up to whole units', () => {
    // 600 g of yoghurt in 500 g Becher → two Becher (1 kg).
    expect(buyAmount(need({ ingredient: 'Joghurt', needed: 600 }), 0)).toBe(1000);
  });

  it('keeps the missing amount for an approximate shopping unit', () => {
    // 500 g of carrots at about 70 g a piece → 8 pieces, but the authoritative
    // amount stays the 500 g the dishes need (not 8 × 70 g).
    expect(buyAmount(need({ ingredient: 'Karotten', needed: 500 }), 0)).toBe(500);
  });

  it('rounds a purchase without a shopping unit up to a whole gram', () => {
    expect(buyAmount(need({ ingredient: 'Cashews', needed: 850 }), 400)).toBe(450);
    expect(buyAmount(need({ ingredient: 'Cashews', needed: 0.4 }), 0)).toBe(1);
  });

  it('reads zero for a covered need', () => {
    expect(buyAmount(need({ ingredient: 'Mehl', needed: 800, reorderPoint: 1000 }), 800)).toBe(0);
    expect(buyAmount(need({ ingredient: 'Cashews', needed: 850 }), 900)).toBe(0);
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

  it('offers one stop per result, up to six units', () => {
    // 600 g of yoghurt in 500 g Becher: below 100 g two Becher, from 100 g one,
    // from 600 g none.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 600 }))).toEqual([0, 100, 600]);
    // Six units is the limit: 2400 g in 500 g Becher = 5 → six stops.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 2400 }))).toEqual([
      0, 400, 900, 1400, 1900, 2400,
    ]);
  });

  it('switches to whole packs beyond six units', () => {
    // 3500 g in 500 g Becher = 7 packs: the stops walk whole packs and end on
    // the need itself, which covers it completely.
    expect(stockPool(need({ ingredient: 'Joghurt', needed: 3500 }))).toEqual([
      0, 500, 1000, 1500, 2000, 2500, 3000, 3500,
    ]);
    // A need between two packs: the last stop is the need (nothing to buy), the
    // one below it the largest whole pack count that still leaves a purchase.
    expect(stockPool(need({ ingredient: 'Mehl', needed: 7500 }))).toEqual([
      0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 7500,
    ]);
  });

  it('walks the BQ table within one tenth of the need without an exact unit', () => {
    // Cashews have no unit: the stops are 0, the allowed BQ values from 40 g
    // (a tenth of the need) up, and the need. No old ladder values are invented.
    const values = stockPool(need({ ingredient: 'Cashews', needed: 400 }));
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(400);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values).toContain(300);
    expect(values).toContain(200);
    expect(values).toContain(100);
  });

  it('uses the BQ table for an approximate shopping unit too', () => {
    // Carrots: the bought amount jumps only at whole pieces, but a stock is not
    // a package count — the clean base quantities are the useful suggestions.
    const values = stockPool(need({ ingredient: 'Karotten', needed: 500 }));
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(500);
    expect(values).toContain(300);
  });

  it('falls back to the BQ table for an ingredient without master data', () => {
    const values = stockPool(need({ ingredient: 'Tofu', needed: 400 }));
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(400);
    expect(values).toContain(300);
  });

  it('keeps the family unit of an ml ingredient', () => {
    // 1000 ml of milk in 1000 ml packs = 1 → two stops.
    expect(stockPool(need({ ingredient: 'Milch', needed: 1000, baseUnit: 'ml' }))).toEqual([
      0, 1000,
    ]);
  });

  it('keeps an inert one-value pool for a row without a need', () => {
    expect(stockPool(need({ ingredient: 'Mehl', needed: 0 }))).toEqual([0]);
  });
});

describe("suggestedStocks (the stock chips' suggested values)", () => {
  it('offers the thresholds where the bought amount changes for an exact unit', () => {
    // 600 g of yoghurt in 500 g Becher: below 100 g two Becher, from 100 g one,
    // from 600 g none — so 0, 600 and 100 are the only relevant stock values.
    // 0 and the need lead (always kept); the chip row displays them ascending.
    expect(suggestedStocks(need({ ingredient: 'Joghurt', needed: 600 }))).toEqual([0, 600, 100]);
  });

  it('names the user example: 1200 g of flour in 1000 g packs', () => {
    expect(suggestedStocks(need({ ingredient: 'Mehl', needed: 1200 }))).toEqual([0, 1200, 200]);
  });

  it('walks whole packs beyond six units, with 0 and the need leading', () => {
    expect(suggestedStocks(need({ ingredient: 'Joghurt', needed: 2400 }))).toEqual([
      0, 2400, 400, 900, 1400, 1900,
    ]);
  });

  it('offers clean BQ values, best first, without an exact shopping unit', () => {
    // Cashews have no unit. The candidates are the BQ values within a tenth of
    // the need, ordered by the table's own clumsiness penalty and then by
    // distance to the need: 800, 700, 600 … lead.
    const values = suggestedStocks(need({ ingredient: 'Cashews', needed: 850 }));
    expect(values.slice(0, 5)).toEqual([0, 850, 800, 700, 600]);
    expect(values).toContain(500);
  });

  it('offers no package thresholds for an approximate shopping unit', () => {
    // Carrots are bought by the piece, but a stock is a weight: the suggestions
    // are clean BQ amounts, not "n × 70 g" package thresholds.
    const values = suggestedStocks(need({ ingredient: 'Karotten', needed: 500 }));
    expect(values[0]).toBe(0);
    expect(values[1]).toBe(500);
    expect(values).toContain(300);
    expect(values).not.toContain(434.7);
  });

  it('keeps an inert single-value list for a row without a need', () => {
    expect(suggestedStocks(need({ ingredient: 'Mehl', needed: 0 }))).toEqual([0]);
  });
});

describe('suggestedSubRecipeStocks', () => {
  it('offers BQ amounts even when the title has an exact shopping unit', () => {
    // A sub-recipe's stock is cooked food, not a package on a shelf: even a
    // name registered with a 1000 g exact pack must not offer package
    // thresholds.
    const needForSubRecipe = need({ ingredient: 'Mehl', needed: 1200 });
    expect(suggestedStocks(needForSubRecipe)).toEqual([0, 1200, 200]);
    const values = suggestedSubRecipeStocks(needForSubRecipe);
    expect(values[0]).toBe(0);
    expect(values[1]).toBe(1200);
    expect(values).toContain(300);
    expect(values.length).toBeGreaterThan(3);
  });

  it('matches the ordinary BQ suggestions for an ingredient without an exact unit', () => {
    const cashews = need({ ingredient: 'Cashews', needed: 850 });
    expect(suggestedSubRecipeStocks(cashews)).toEqual(suggestedStocks(cashews));
  });
});

describe('shoppingUnitOf', () => {
  it('answers the shopping unit and its factor', () => {
    // Flour is bought in 1000 g packs, carrots in pieces of about 70 g.
    expect(shoppingUnitOf(need({ ingredient: 'Mehl', needed: 1200 }))).toMatchObject({
      au: { name: 'Packung (unteilbar)' },
      factor: 1000,
    });
    expect(shoppingUnitOf(need({ ingredient: 'Karotten', needed: 500 }))?.au.name).toBe(
      'Stück (ZE zuerst)',
    );
  });

  it('is null without a shopping unit', () => {
    expect(shoppingUnitOf(need({ ingredient: 'Cashews', needed: 500 }))).toBeNull();
  });

  it('reads the flag per ingredient, not per unit', () => {
    // „Stück“ is how a carrot is bought; the same unit is a clove — a recipe
    // measure — for garlic, so garlic has no purchase unit and is bought by
    // weight.
    expect(shoppingUnitOf(need({ ingredient: 'Karotten', needed: 500 }))?.au.name).toBe(
      'Stück (ZE zuerst)',
    );
    expect(shoppingUnitOf(need({ ingredient: 'frischer Knoblauch', needed: 12 }))).toBeNull();
    expect(shoppingRow(need({ ingredient: 'frischer Knoblauch', needed: 12 }), 0).text).toBe(
      `12${NB}g frischer Knoblauch`,
    );
  });
});

describe('needText', () => {
  it('names the need in its familiar reading without changing the amount', () => {
    // A need that no whole exact pack brings home stays in the base form.
    expect(needText(need({ ingredient: 'Joghurt', needed: 600 }))).toBe(`600${NB}g Joghurt`);
    // An approximate unit names the count beside the authoritative amount.
    expect(needText(need({ ingredient: 'Karotten', needed: 500 }))).toBe(
      `7${NB}Karotten (500${NB}g)`,
    );
  });

  it('shows an exact unit only when its count really brings the need home', () => {
    // 500 g of yoghurt is exactly one 500 g Becher; 1150 g of flour is not a
    // whole number of 1000 g packs and stays in the base form.
    expect(needText(need({ ingredient: 'Joghurt', needed: 500 }))).toBe(
      `1${NB}Becher Joghurt (500${NB}g)`,
    );
    expect(needText(need({ ingredient: 'Mehl', needed: 1150 }))).toBe(`1,15${NB}kg Mehl`);
  });

  it('keeps the BE-first arrangement of an exact unit', () => {
    expect(needText(need({ ingredient: 'Aquafaba', needed: 180, baseUnit: 'ml' }))).toBe(
      `180${NB}ml Aquafaba (1${NB}Dose Kichererbsen)`,
    );
  });

  it('falls back to the base form without an additional unit', () => {
    expect(needText(need({ ingredient: 'Cashews', needed: 60 }))).toBe(`60${NB}g Cashews`);
  });
});

describe('needAq', () => {
  it('names the count the need line shows, not a re-reading of the grams', () => {
    // Three dishes whose master lines each read "1 Aubergine (333 g)": the need
    // line says "3 Auberginen (1 kg)", and the chip that completes the need must
    // say the same. A nearest-quarter re-reading of 1 kg would say "2¾".
    const stueck = au('Stück (ZE zuerst)');
    const auberginen = need({
      ingredient: 'Auberginen',
      needed: 1000,
      contributions: [
        { quantity: 333, aq: { au: stueck, value: 1, factor: 350 } },
        { quantity: 333, aq: { au: stueck, value: 1, factor: 350 } },
        { quantity: 334, aq: { au: stueck, value: 1, factor: 350 } },
      ],
    });
    expect(needText(auberginen)).toBe(`3${NB}Auberginen (1${NB}kg)`);
    expect(needAq(auberginen)).toBe(3);
  });

  it('answers null without contributions or for a metric-only need', () => {
    expect(needAq(need({ ingredient: 'Auberginen', needed: 1000 }))).toBeNull();
    expect(needAq(need({ ingredient: 'Cashews', needed: 60 }))).toBeNull();
  });
});

describe('needText with the dishes’ master lines', () => {
  it('adds the counts when every dish shows the same unit', () => {
    // Two dishes whose master lines read "1 Becher" and "½ Becher": the total
    // is their exact count sum, "1 ½ Becher", with the summed amount.
    const becher = au('Becher');
    expect(
      needText(
        need({
          ingredient: 'Joghurt',
          needed: 750,
          contributions: [
            { quantity: 500, aq: { au: becher, value: 1, factor: 500 } },
            { quantity: 250, aq: { au: becher, value: 0.5, factor: 500 } },
          ],
        }),
      ),
    ).toBe(`1${NB}½${NB}Becher Joghurt (750${NB}g)`);
  });

  it('renders a single dish’s need like its master line', () => {
    // One dish: the aggregate is that masterpiece itself, arrangement and all.
    const becher = au('Becher');
    expect(
      needText(
        need({
          ingredient: 'Joghurt',
          needed: 500,
          contributions: [{ quantity: 500, aq: { au: becher, value: 1, factor: 500 } }],
        }),
      ),
    ).toBe(`1${NB}Becher Joghurt (500${NB}g)`);
  });

  it('never repeats one dish’s count in the total', () => {
    // The user's case: one dish reads "1 Packung (1 kg)", another adds 20 g.
    // "1 Packung (1,02 kg)" would look like the first dish alone, so the total
    // stays metric (the exact pack count is not the total either).
    const packung = au('Packung (unteilbar)');
    expect(
      needText(
        need({
          ingredient: 'Mehl',
          needed: 1020,
          contributions: [
            { quantity: 1000, aq: { au: packung, value: 1, factor: 1000 } },
            { quantity: 20 },
          ],
        }),
      ),
    ).toBe(`1,02${NB}kg Mehl`);
  });

  it('raises an approximate count above every dish’s count', () => {
    // The carrot dish shows "7 Karotten"; the extra 50 g may not be folded into
    // a repeated "7", so the total names the next count (8) beside the amount.
    const stueck = au('Stück (ZE zuerst)');
    expect(
      needText(
        need({
          ingredient: 'Karotten',
          needed: 550,
          contributions: [
            { quantity: 500, aq: { au: stueck, value: 7, factor: 70 } },
            { quantity: 50 },
          ],
        }),
      ),
    ).toBe(`8${NB}Karotten (550${NB}g)`);
  });

  it('keeps the base form when no count restates the total', () => {
    // 500 g reads "1 Becher", 400 g is metric: no exact count = 900 g, and an
    // exact unit may not pair a count with a different amount.
    const becher = au('Becher');
    expect(
      needText(
        need({
          ingredient: 'Joghurt',
          needed: 900,
          contributions: [
            { quantity: 500, aq: { au: becher, value: 1, factor: 500 } },
            { quantity: 400 },
          ],
        }),
      ),
    ).toBe(`900${NB}g Joghurt`);
  });
});

describe('stockCountText', () => {
  it('translates the stock into the shopping unit of an approximate one', () => {
    // 500 g of carrots at about 70 g per piece is seven pieces.
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 500)).toBe(`7${NB}Stück`);
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 0)).toBe(`0${NB}Stück`);
  });

  it('counts beyond the number scheme to whole pieces', () => {
    // The scheme bounds what a *recipe* line may say (ten pieces), not how many
    // carrots are on the shelf.
    expect(stockCountText(need({ ingredient: 'Karotten', needed: 800 }), 2000)).toBe(
      `28${NB}Stück`,
    );
  });

  it('names only whole packs of an exact shopping unit', () => {
    // Flour is bought in 1000 g packs: two packs read as two packs, but 200 g is
    // no whole pack and would name a shelf that cannot exist. An empty shelf is
    // still plural („0 Packungen“).
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 2000)).toBe(
      `2${NB}Packungen`,
    );
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 0)).toBe(`0${NB}Packungen`);
    expect(stockCountText(need({ ingredient: 'Mehl', needed: 2000 }), 200)).toBeNull();
  });

  it('is null without a shopping unit', () => {
    // Cashews have no unit of their own — nothing to translate.
    expect(stockCountText(need({ ingredient: 'Cashews', needed: 500 }), 100)).toBeNull();
  });
});
