/**
 * The shopping list's arithmetic: what a bundle of planned dishes needs, what
 * the pantry covers, and what is left to buy.
 *
 * This module is the step between the two Keep actions. The meal plan names the
 * dishes; the shopping list needs *ingredients*, and an ingredient several
 * dishes share must be bought once, in whole packages. Two rules make the
 * difference (decided with the user):
 *
 * 1. **Bundle, then round.** Each dish's ingredient list is scaled to the size
 *    the plan cooks it at, the scaled lists are summed per ingredient, and only
 *    the *sum* is rounded up to whole shopping units. Two dishes that each need
 *    300 g tofu (200 g blocks) therefore buy three blocks, not two plus two.
 * 2. **The pantry comes first.** Every ingredient has a reorder point in the
 *    master data (docs/storage_format.md §9) — the amount that is on the shelf
 *    after a shopping trip, independent of the plan. The sheet starts the
 *    "Vorrat" on `min(need, reorder point)`, and only `need − Vorrat` is bought;
 *    a reorder point that already covers the need buys nothing.
 *
 * The "Einkaufen" amount is **rounded up**, not to the nearest ladder rung: a
 * shopping amount is not a stored recipe quantity, so it may sit between rungs
 * ("850 g Mehl") — but never below what the dishes need. With a shopping unit
 * (§3.1) the amount is rounded up to a whole number of that unit and rendered
 * in the unit's familiar arrangement ("3 Becher Mehl (450 g)"); without one it
 * is rounded up to a whole family unit ("850 g Mehl").
 *
 * Everything here is pure and framework-free; the web app supplies the scaled
 * ingredient lists of the selected dishes (keep/shoppingBundle.ts), because
 * loading the recipe files is its job, not the core's.
 */

import { formatBQ, renderUnitCount, shoppingUnitFor } from './additionalUnits.js';
import { mappingsFor } from './ingredientRegistry.js';
import { difference, rungAbove, rungBelow, scale } from './ladder.js';
import { convertYieldUnit, writtenPlannedAmount, type PlannedAmount } from './planLink.js';
import type { Ingredient, Recipe } from './recipe/types.js';

/** The two family base units a shopping need lives in (`kg`/`l` are display). */
export type FamilyUnit = 'g' | 'ml';

/**
 * One ingredient use in the family base unit: `kg` / `l` rows (hand-written
 * files; the parser normalizes them) are converted with their ×1000, so a need
 * is always comparable and every factor in the master data applies.
 */
function toFamilyUnit(ingredient: Ingredient): Ingredient {
  const unit = ingredient.unit;
  if (unit === 'g' || unit === 'ml') {
    return ingredient;
  }
  const conversion = convertYieldUnit(unit);
  // Unreachable for a parsed recipe: `unit` is one of the four known units.
  if (conversion === undefined) {
    return ingredient;
  }
  return {
    name: ingredient.name,
    quantity: ingredient.quantity * conversion.factor,
    unit: conversion.baseUnit,
  };
}

/** The family base unit of an ingredient use (see `toFamilyUnit`). */
function familyUnitOf(ingredient: Ingredient): FamilyUnit {
  return toFamilyUnit(ingredient).unit === 'ml' ? 'ml' : 'g';
}

/**
 * The ladder-step difference between the size a recipe is written in and the
 * size it is cooked at, or 0 when the two are not comparable.
 *
 * A planned size that does not name the recipe's own kind or family unit cannot
 * happen for an entry the app recognized (`plannedAmountFitsRecipe`), and a
 * size-less entry falls back to the written size — 0 steps either way. A
 * hand-edited size that is not a ladder value (docs/quantity_scaling.md §3)
 * also answers 0 instead of throwing: one malformed entry must not take the
 * whole shopping sheet down with it.
 */
function planScaleSteps(written: PlannedAmount, planned: PlannedAmount | null): number {
  if (planned === null || written.kind !== planned.kind) {
    return 0;
  }
  if (
    written.kind === 'yield' &&
    planned.kind === 'yield' &&
    written.baseUnit !== planned.baseUnit
  ) {
    return 0;
  }
  const from = written.kind === 'servings' ? written.servings : written.quantity;
  const to = planned.kind === 'servings' ? planned.servings : planned.quantity;
  try {
    return difference(from, to);
  } catch {
    return 0;
  }
}

/**
 * The recipe's ingredient list scaled to the size the plan cooks it at
 * (docs/recipe_structure.md: scaling moves every quantity by the same number of
 * ladder steps). `planned` is the size the meal-plan entry states, or null for
 * an entry that states none — such an entry means the dish at its written size,
 * which is what its link opens, so nothing is scaled.
 *
 * The `reference` role is dropped (it only matters in the recipe view), and a
 * quantity the ladder cannot scale (a hand-written file) stays unscaled instead
 * of failing the whole bundle.
 *
 * Sub-recipe links are deliberately *not* resolved here: an ingredient named
 * after an `ingredient_recipe` stays one row (decided with the user for this
 * step; the resolution rule is in docs/recipe_structure.md).
 */
export function scaledIngredientsForPlan(
  recipe: Recipe,
  planned: PlannedAmount | null,
): Ingredient[] {
  const deltaX = planScaleSteps(writtenPlannedAmount(recipe), planned);
  return recipe.ingredients.map((entry) => {
    const ingredient = toFamilyUnit(entry);
    if (deltaX === 0) {
      return ingredient;
    }
    try {
      return { ...ingredient, quantity: scale(ingredient.quantity, deltaX) };
    } catch {
      return ingredient;
    }
  });
}

/**
 * The summed use of one ingredient across all selected dishes. Repeated uses of
 * the same name **within** a recipe are already merged by the recipe's master
 * list; across dishes they are summed here, in order of first appearance.
 *
 * The sum is deliberately *not* rounded to a ladder rung — it is a shopping
 * need, not a stored recipe quantity, and rounding it (to the nearer rung) could
 * round a need *down* and under-buy. The bought amount is rounded up later
 * (`shoppingRow`), which is the only rounding a shopping list needs.
 *
 * As in the recipe's own merge, entries of the same name are only summed when
 * they share a unit; a mismatched unit (g against ml for one name) stays a
 * separate row instead of being added meaninglessly.
 */
export function sumIngredientUses(lists: readonly (readonly Ingredient[])[]): Ingredient[] {
  const byNameAndUnit = new Map<string, Ingredient>();
  for (const list of lists) {
    for (const raw of list) {
      const ingredient = toFamilyUnit(raw);
      const key = `${ingredient.name}\u0000${ingredient.unit}`;
      const existing = byNameAndUnit.get(key);
      byNameAndUnit.set(
        key,
        existing === undefined
          ? { ...ingredient }
          : { ...existing, quantity: existing.quantity + ingredient.quantity },
      );
    }
  }
  return [...byNameAndUnit.values()];
}

/** One ingredient of the sheet: the need and the pantry level it is compared with. */
export interface ShoppingNeed {
  /** The ingredient name (the row's label and part of the written line). */
  readonly ingredient: string;
  /** Family base unit of `needed` and of the reorder point. */
  readonly baseUnit: FamilyUnit;
  /** The amount all selected dishes need together, in `baseUnit` (exact sum). */
  readonly needed: number;
  /**
   * The reorder point from the ingredient master data (docs/storage_format.md
   * §9): 0 (only ever bought for a recipe), a positive base quantity, or
   * Infinity (always in stock, e.g. water). 0 for an ingredient the master data
   * does not know, or knows in another family unit — nothing is assumed about
   * stock then.
   */
  readonly reorderPoint: number;
}

/**
 * Turns summed ingredient uses into the sheet's rows by looking up the master
 * data of each ingredient (the runtime registry, so the user's own
 * `zutaten.csv` is what counts).
 */
export function shoppingNeeds(uses: readonly Ingredient[]): ShoppingNeed[] {
  return uses.map((use) => {
    const baseUnit = familyUnitOf(use);
    const entry = mappingsFor(use.name);
    const known = entry !== undefined && entry.bu === baseUnit;
    return {
      ingredient: use.name,
      baseUnit,
      needed: use.quantity,
      reorderPoint: known ? entry.reorderPoint : 0,
    };
  });
}

/**
 * The "Vorrat" the sheet starts an ingredient on: `min(need, reorder point)`
 * (decided with the user). A reorder point above the need covers it completely
 * (nothing to buy); one below it is what is assumed to be on the shelf, and the
 * difference is bought. A reorder point of Infinity covers every need.
 */
export function stockPrefill(need: ShoppingNeed): number {
  return Math.min(need.needed, Math.max(0, need.reorderPoint));
}

/** One row of the sheet, ready to render: the need, the chosen stock, the bought amount. */
export interface ShoppingRow {
  readonly ingredient: string;
  readonly baseUnit: FamilyUnit;
  readonly needed: number;
  readonly reorderPoint: number;
  /** The Vorrat the row currently holds (clamped to 0 … needed). */
  readonly stock: number;
  /** True when the stock covers the whole need: nothing to buy, lower part. */
  readonly covered: boolean;
  /**
   * The line for the "Einkaufen" column and for the Keep write — the shopping
   * unit's arrangement ("3 Becher Mehl (450 g)") or the base form
   * ("850 g Butter"). Null when nothing is to buy; the sheet shows a dash then.
   */
  readonly text: string | null;
}

/**
 * Rounds a quantity to thousandths. Ladder values carry at most two decimals,
 * so a sum of them is exact to the thousandth; the rounding only removes the
 * floating-point noise of that sum (1150 + 1e-13 must not round up to 1151 g).
 */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Builds one sheet row for a chosen Vorrat (decided with the user):
 *
 * - `covered` — the stock covers the need, so there is nothing to buy. The
 *   sheet's lower part is exactly the rows where this is true, and its
 *   "Einkaufen" column shows a dash;
 * - otherwise the missing amount (`need − stock`) is rounded **up**: to a whole
 *   number of the ingredient's shopping unit when it has one (§3.1, "2 Becher
 *   Joghurt (800 g)"), else to a whole family unit ("850 g Butter", which need
 *   not be a ladder rung). Buying less than the dishes need is never an option,
 *   so this is the only direction that may round.
 *
 * The count of a shopping unit is not gated by the unit's number scheme: the
 * scheme bounds how a *recipe* amount is displayed, while a shopping list has
 * to name the whole packages it takes ("40 Becher Mehl (6 kg)" is odd but
 * true). The stock is clamped to the possible range, so a caller cannot produce
 * a negative "Einkaufen" through this function.
 */
export function shoppingRow(need: ShoppingNeed, stock: number): ShoppingRow {
  const clamped = Math.min(need.needed, Math.max(0, roundThousandths(stock)));
  const missing = roundThousandths(Math.max(0, need.needed - clamped));
  const base = {
    ingredient: need.ingredient,
    baseUnit: need.baseUnit,
    needed: need.needed,
    reorderPoint: need.reorderPoint,
    stock: clamped,
  };
  if (!(missing > 0)) {
    return { ...base, covered: true, text: null };
  }
  const target = shoppingUnitFor(mappingsFor(need.ingredient), need.baseUnit);
  if (target !== null) {
    const count = Math.ceil(roundThousandths(missing / target.factor));
    return {
      ...base,
      covered: false,
      text: renderUnitCount(
        need.ingredient,
        count,
        target.au,
        target.factor,
        need.baseUnit,
        missing,
      ),
    };
  }
  const amount = Math.ceil(missing);
  return { ...base, covered: false, text: `${formatBQ(amount, need.baseUnit)} ${need.ingredient}` };
}

/**
 * One stepper tap on the "Vorrat": the next ladder rung up or down, or null
 * when the bound blocks that direction.
 *
 * The stock is not a stored quantity, so it is not bound to the ladder:
 *
 * - **up** — the next rung, but never above the need (that is what keeps
 *   "Einkaufen" from becoming negative); from the floor (0, or below `minimum`)
 *   it lands on `minimum`, the smallest quantity the app's pickers offer. When
 *   the next rung would overshoot the need, the need itself is the step, so the
 *   last tap can always reach "nothing to buy";
 * - **down** — the previous rung, never below 0; from `minimum` it lands on 0.
 *
 * `minimum` is the caller's pool floor (the web app's `QUANTITY_MIN`: quantities
 * below 1 g / 1 ml are not offered by any picker) and `needed` the row's need.
 */
export function steppedStock(
  stock: number,
  needed: number,
  direction: 1 | -1,
  minimum = 1,
): number | null {
  if (direction === 1) {
    if (!(stock < needed)) {
      return null;
    }
    const next = stock <= 0 || stock < minimum ? minimum : rungAbove(stock);
    const clamped = Math.min(next, needed);
    return clamped > stock ? clamped : null;
  }
  if (!(stock > 0)) {
    return null;
  }
  const previous = stock <= minimum ? 0 : rungBelow(stock);
  const clamped = Math.max(previous, 0);
  return clamped < stock ? clamped : null;
}
