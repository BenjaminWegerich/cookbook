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
 *    "Vorrat" on `min(need, reorder point)` — snapped **down** to the nearest
 *    chip for an exact shopping unit, kept as a custom chip otherwise — and
 *    only `need − Vorrat` is bought; a reorder point that already covers the
 *    need buys nothing.
 *
 * **Scaling is exact.** A planned size names the factor between the requested
 * and the written recipe size (servings or yield), and every target moves by
 * that factor — `V0' = V0 × factor`. There is no ladder rung to round to
 * (docs/quantity_scaling.md §7), so a sum may be any positive number. The
 * millionth rounding below only removes binary floating-point noise; it never
 * moves a need to a table value.
 *
 * The amount that goes on the list is **rounded up**, not to the nearest table
 * value: a shopping amount is not a stored recipe quantity, so it may sit
 * between table values ("850 g Mehl") — but never below what the dishes need.
 * With a shopping unit (§3.1) the amount is rounded up to a whole number of
 * that unit and rendered in the unit's familiar arrangement ("3 Becher Mehl
 * (450 g)"); without one it is rounded up to a whole family unit ("850 g
 * Mehl").
 *
 * The need is named on the sheet as well (`needText`), in the ingredient's
 * familiar reading but never as a *different* amount: an exact unit is shown
 * only when its whole count really brings that amount home, while an
 * approximate unit names the need as a count ("8 Karotten (500 g)"). The
 * additional quantity names the *shopping* unit on the buy side; the need is
 * the authoritative amount.
 *
 * Rounding up is also what makes the stock picker cheap: because a whole number
 * of shopping units is bought, whole ranges of stock produce the *same* list, so
 * the sheet offers only the stock values where the result changes (`stockPool`)
 * instead of one table value per tap. Without an exact shopping unit it offers
 * clean values from the **BQ table** (`suggestedStocks`), not the removed
 * ladder.
 *
 * Everything here is pure and framework-free; the web app supplies the scaled
 * ingredient lists of the selected dishes (keep/shoppingBundle.ts), because
 * loading the recipe files is its job, not the core's.
 */

import {
  auDisplayName,
  formatAQValue,
  formatBQ,
  formatDecimal,
  NNBSP,
  renderQuantityText,
  renderUnitCount,
  shoppingUnitFor,
} from './additionalUnits.js';
import type { AdditionalUnit, IngredientEntry } from './additionalUnitsData.js';
import { mappingsFor } from './ingredientRegistry.js';
import { convertYieldUnit, writtenPlannedAmount, type PlannedAmount } from './planLink.js';
import { allowedBQValuesInRange, isAQValue, schemeValues } from './quantityValues.js';
import type { Ingredient, Recipe } from './recipe/types.js';

/** The two family base units a shopping need lives in (`kg`/`l` are display). */
export type FamilyUnit = 'g' | 'ml';

/** One millionth: the precision that only removes float noise from a sum. */
const SUM_PRECISION = 1_000_000;

/**
 * Rounds a quantity to millionths. Scaling and summing exact targets is correct
 * in the reals, but binary floating point can leave a value like
 * `0.30000000000000004`; this keeps the sums and the comparisons clean without
 * moving the amount to a table value.
 */
function roundMillionths(value: number): number {
  return Math.round(value * SUM_PRECISION) / SUM_PRECISION;
}

/**
 * One ingredient use in the family base unit: `kg` / `l` rows (hand-written
 * files; the parser normalizes them) are converted with their ×1000, so a need
 * is always comparable and every factor in the master data applies.
 *
 * Exported because the multi-level plan (./subRecipePlan) reads yields and uses
 * through the same conversion — the two must never disagree on a family unit.
 */
export function toFamilyUnit(ingredient: Ingredient): Ingredient {
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
export function familyUnitOf(ingredient: Ingredient): FamilyUnit {
  return toFamilyUnit(ingredient).unit === 'ml' ? 'ml' : 'g';
}

/**
 * The exact scaling factor between the size a recipe is written in and the size
 * it is cooked at, or 1 when the two are not comparable.
 *
 * A planned size that does not name the recipe's own kind or family unit cannot
 * happen for an entry the app recognized (`plannedAmountFitsRecipe`), and a
 * size-less entry falls back to the written size — factor 1 either way. A
 * hand-edited size that is not positive also answers 1 instead of throwing: one
 * malformed entry must not take the whole shopping sheet down with it.
 */
function planScaleFactor(written: PlannedAmount, planned: PlannedAmount | null): number {
  if (planned === null || written.kind !== planned.kind) {
    return 1;
  }
  if (
    written.kind === 'yield' &&
    planned.kind === 'yield' &&
    written.baseUnit !== planned.baseUnit
  ) {
    return 1;
  }
  const from = written.kind === 'servings' ? written.servings : written.quantity;
  const to = planned.kind === 'servings' ? planned.servings : planned.quantity;
  if (!(from > 0) || !(to > 0) || !Number.isFinite(from) || !Number.isFinite(to)) {
    return 1;
  }
  return to / from;
}

/**
 * The recipe's ingredient list scaled to the size the plan cooks it at.
 *
 * The factor is exact (docs/quantity_scaling.md §7): a dish written for 4 and
 * planned for 6 scales every target by 1.5, and an ingredient recipe written at
 * 500 ml and cooked at 750 ml does the same. Nothing is rounded to a table
 * value. `planned` is the size the meal-plan entry states, or null for an entry
 * that states none — such an entry means the dish at its written size, which is
 * what its link opens, so nothing is scaled.
 *
 * The `reference` role is dropped (it only matters in the recipe view), and a
 * quantity the data cannot scale (a hand-written file in an unknown unit) stays
 * unscaled instead of failing the whole bundle.
 *
 * Sub-recipe links are deliberately *not* resolved here: an ingredient named
 * after an `ingredient_recipe` stays one row (decided with the user for this
 * step; the resolution rule is in docs/recipe_structure.md).
 */
export function scaledIngredientsForPlan(
  recipe: Recipe,
  planned: PlannedAmount | null,
): Ingredient[] {
  const factor = planScaleFactor(writtenPlannedAmount(recipe), planned);
  return recipe.ingredients.map((entry) => {
    const ingredient = toFamilyUnit(entry);
    if (factor === 1) {
      return ingredient;
    }
    return { ...ingredient, quantity: roundMillionths(ingredient.quantity * factor) };
  });
}

/**
 * The summed use of one ingredient across all selected dishes. Repeated uses of
 * the same name **within** a recipe are already merged by the recipe's master
 * list; across dishes they are summed here, in order of first appearance.
 *
 * The sum is deliberately *not* rounded to a table value — it is a shopping
 * need, not a stored recipe quantity, and rounding it to the nearer value could
 * round a need *down* and under-buy. The bought amount is rounded up later
 * (`shoppingRow`), which is the only rounding a shopping list needs. Only the
 * millionth rounding removes floating-point noise.
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
          : {
              ...existing,
              quantity: roundMillionths(existing.quantity + ingredient.quantity),
            },
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
 * The amount part of a shopping line on its own (decided with the user): the
 * pantry sheet's "kaufen" side prints only the amount ("1 Packung (1 kg)"),
 * while the Keep write — and the undo of it — needs the full line with the name.
 *
 * It is derived from the very same pieces as `shoppingRow`'s `text`, so both can
 * never drift apart: the ingredient name is substituted as the empty string,
 * which an arrangement renders without its trailing name and without the
 * dangling double space that would leave (`renderUnitCount`).
 *
 * @param count the whole number of shopping units to buy
 * @param au the selected shopping unit
 * @param factor the mapping's conversion factor (base unit per one unit)
 * @param bu the family unit the amount is expressed in
 * @param amount the missing base quantity (see `shoppingRow`)
 * @param entry the ingredient entry that supplies `<INF>` while the name is
 *   hidden (the singular/plural count form of units without `<AU>`)
 */
function renderShoppingAmount(
  count: number,
  au: AdditionalUnit,
  factor: number,
  bu: string,
  amount: number,
  entry: IngredientEntry | undefined,
): string {
  return renderUnitCount('', count, au, factor, bu, amount, entry);
}

/**
 * The "Vorrat" the sheet starts an ingredient on: `min(need, reorder point)`
 * (decided with the user). A reorder point at or above the need covers it
 * completely (nothing to buy — the need itself is the top chip and is returned
 * exactly); one below it is what is assumed to be on the shelf, and the
 * difference is bought. A reorder point of Infinity covers every need.
 *
 * The one place the prefill is adjusted is an **exact** shopping unit: the
 * reorder point is a whole number of packages, but the chips are the stock
 * values where the bought amount changes ("need − k packages"), so a whole-pack
 * reorder point can sit between two of them — it is snapped **down** to the
 * lower chip. With an approximate shopping unit or none at all the reorder
 * point is kept as-is; the sheet shows it as a custom chip ("andere") instead
 * of snapping it to a suggestion.
 */
export function stockPrefill(need: ShoppingNeed): number {
  const needed = need.needed;
  const reorder = Math.max(0, need.reorderPoint);
  if (reorder >= needed) {
    // Covered: the need is the top chip, returned exactly so a hair-thin float
    // difference can never re-file a covered row as needing a purchase.
    return needed;
  }
  const target = shoppingUnitOf(need);
  if (target === null || !target.au.exact) {
    // Approximate or no shopping unit: the reorder point itself is the stock.
    return roundThousandths(reorder);
  }
  // Exact shopping unit: snap down to the nearest package-threshold chip.
  const capped = roundThousandths(reorder);
  let lower = 0;
  for (const value of suggestedStocks(need)) {
    if (value <= capped && value > lower) {
      lower = value;
    }
  }
  return lower;
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
   * The line for the Keep write — the shopping unit's arrangement
   * ("3 Becher Joghurt (1,5 kg)") or the base form ("850 g Cashews"). Null when
   * nothing is to buy; the sheet shows a zero amount then.
   */
  readonly text: string | null;
  /**
   * The same amount without the ingredient name ("3 Becher (450 g)" /
   * "850 g"), shown on the pantry sheet's "kaufen" side. Null exactly when
   * `text` is null.
   */
  readonly amountText: string | null;
}

/**
 * Rounds a quantity to thousandths. The pantry's fields and chips work at this
 * precision, so a sum is normalized before it is displayed or compared. The
 * stored recipe targets are untouched; this is a sheet-local precision.
 */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Builds one sheet row for a chosen Vorrat (decided with the user):
 *
 * - `covered` — the stock covers the need, so there is nothing to buy: `text`
 *   and `amountText` both stay null (the sheet prints a dash where the amount
 *   would stand);
 * - otherwise the missing amount (`need − stock`) is rounded **up**: to a whole
 *   number of the ingredient's shopping unit when it has one (§3.1, "2 Becher
 *   Joghurt (800 g)"), else to a whole family unit ("850 g Cashews", which need
 *   not be a table value). Buying less than the dishes need is never an option,
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
    return { ...base, covered: true, text: null, amountText: null };
  }
  const entry = mappingsFor(need.ingredient);
  const target = shoppingUnitFor(entry, need.baseUnit);
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
      amountText: renderShoppingAmount(
        count,
        target.au,
        target.factor,
        need.baseUnit,
        missing,
        entry,
      ),
    };
  }
  const amount = Math.ceil(missing);
  return {
    ...base,
    covered: false,
    text: `${formatBQ(amount, need.baseUnit)} ${need.ingredient}`,
    amountText: formatBQ(amount, need.baseUnit),
  };
}

/**
 * The bought amount of one row for a chosen Vorrat, rounded **up** to whole
 * shopping units (or to whole grams/millilitres without one) — the same
 * arithmetic `shoppingRow` applies, returned as a bare number instead of a
 * written line. This is the "kaufen" amount the pantry sheet starts on when the
 * Vorrat changes; a typed amount overrides it without rounding.
 */
export function buyAmount(need: ShoppingNeed, stock: number): number {
  const clamped = Math.min(need.needed, Math.max(0, roundThousandths(stock)));
  const missing = roundThousandths(Math.max(0, need.needed - clamped));
  const target = shoppingUnitFor(mappingsFor(need.ingredient), need.baseUnit);
  if (target === null) {
    return Math.ceil(missing);
  }
  if (!(missing > 0)) {
    return 0;
  }
  const count = Math.ceil(roundThousandths(missing / target.factor));
  return target.au.exact ? roundThousandths(count * target.factor) : missing;
}

/**
 * The largest number of whole shopping units a need may round up to and still
 * get one chip per possible result (decided with the user). Beyond it the row
 * would carry more chips than a phone row can offer cleanly, so the picker
 * falls back to whole packs.
 */
const MAX_RESULT_UNITS = 6;

/**
 * The stock values a row can jump to (decided with the user), ascending from 0
 * to the need. The sheet's job is to keep the *result* right without making the
 * user hunt for an amount the app can work out itself, so the pool holds
 * exactly the stock values at which the bought amount changes — every one of
 * them becomes a chip (components/StockChips):
 *
 * - an ingredient bought in an **exact** shopping unit (§3.1) whose need rounds
 *   up to at most `MAX_RESULT_UNITS` units gets **one value per possible result**.
 *   With 1200 g of flour needed and a 1000 g pack, only two stock values change
 *   anything: below 200 g two packs are bought, from 200 g up exactly one, and
 *   from the need itself nothing. 300 g, 500 g or 1000 g on the shelf are all
 *   the same case, so the values are `0, need − (n−1)·factor, …, need − factor,
 *   need` — one per result, however unevenly the amounts are spaced;
 * - a larger need in exact packs gets the **whole packs** up to the need
 *   (`0, factor, 2·factor, …, need`);
 * - everything else — no exact shopping unit, or an approximate one ("Stück") —
 *   gets the clean values of the **BQ table** within one tenth of the need, plus
 *   0 and the need itself.
 *
 * The last value always covers the need completely, so no stock can make the
 * bought amount negative. Within one bucket the stored stock value is
 * irrelevant — nothing is written back to the master data, only the shopping
 * list is written — so a value may stand for a whole range.
 *
 * Reads the runtime registry, so the user's own master data decides which of
 * the three shapes a row gets.
 */
export function stockPool(need: ShoppingNeed): readonly number[] {
  const needed = roundThousandths(need.needed);
  if (!(needed > 0) || !Number.isFinite(needed)) {
    // A row without a finite need cannot buy anything; a one-value pool keeps
    // its chips inert instead of inventing values below zero (and an infinite
    // range would never terminate).
    return [0];
  }
  const target = shoppingUnitOf(need);
  if (target !== null && target.au.exact) {
    const count = Math.ceil(roundThousandths(needed / target.factor));
    if (count <= MAX_RESULT_UNITS) {
      const values = [0];
      // Ascending: the more units are missing, the lower the stock boundary.
      for (let missingUnits = count - 1; missingUnits >= 1; missingUnits -= 1) {
        values.push(roundThousandths(needed - missingUnits * target.factor));
      }
      values.push(needed);
      return values;
    }
    const values = [0];
    for (let units = 1; units < count; units += 1) {
      values.push(roundThousandths(units * target.factor));
    }
    values.push(needed);
    return values;
  }
  // Fine-grained: 0, the allowed BQ values within one tenth of the need, and
  // the need itself (which need not be a table value — a need is a sum over
  // dishes).
  const values = [0];
  for (const entry of allowedBQValuesInRange(needed / 10, needed)) {
    const value = roundThousandths(entry.value);
    if (value > 0 && value < needed) {
      values.push(value);
    }
  }
  values.push(needed);
  return values;
}

/**
 * The clean BQ values a row suggests when it has no exact package threshold to
 * offer: 0 and the need first, then the allowed BQ values within one tenth of
 * the need, best first. "Best" is the BQ table's own clumsiness penalty, then
 * the value closest to the need — so 800 g, 700 g, 600 g … lead for a need of
 * 850 g, and an awkward value only appears when no cleaner one is available.
 *
 * The list is a suggestion pool, not a rounding rule: a stock may be any amount
 * the user types. The UI keeps the leading values when the chip row runs out of
 * space and displays the survivors in increasing order.
 */
function bqStockSuggestions(needed: number): number[] {
  if (!(needed > 0) || !Number.isFinite(needed)) {
    return [0];
  }
  const values = [0, needed];
  const candidates = allowedBQValuesInRange(needed / 10, needed)
    .filter((entry) => roundThousandths(entry.value) < needed)
    .sort((a, b) => a.penalty - b.penalty || b.value - a.value);
  for (const entry of candidates) {
    const value = roundThousandths(entry.value);
    if (!values.includes(value)) {
      values.push(value);
    }
  }
  return values;
}

/**
 * The stock values a row's chips suggest, in the order the row keeps them when
 * space runs out (decided with the user): **0 and the required quantity first**
 * (always kept), then the remaining candidates in decreasing priority. The chip
 * row itself displays the kept values in **increasing** order — the priority
 * here only decides *which* survive a narrow screen, never the display order.
 *
 * - **With an exact shopping unit**, the relevant values are the stock
 *   thresholds where the bought amount changes (core's `stockPool`): a 1200 g
 *   need in 1000 g packs offers only 0, 200 and 1200. The middle thresholds
 *   follow in ascending order behind 0 and the need.
 * - **Without an exact shopping unit** (an approximate piece unit, grams,
 *   millilitres), one value per clean BQ below the need, in penalty order — the
 *   new quantity model has no ladder to walk.
 *
 * Every value is rounded to the thousandth and each appears once, strictly
 * inside [0, needed] with 0 and the need included exactly once.
 */
export function suggestedStocks(need: ShoppingNeed): readonly number[] {
  const needed = roundThousandths(need.needed);
  if (!(needed > 0) || !Number.isFinite(needed)) {
    return [0];
  }
  const target = shoppingUnitOf(need);
  if (target !== null && target.au.exact) {
    const pool = stockPool(need);
    return [0, needed, ...pool.filter((value) => value !== 0 && value !== needed)];
  }
  return bqStockSuggestions(needed);
}

/**
 * The stock values a cooked sub-recipe row suggests: always the BQ-based list,
 * never package thresholds. A sub-recipe's stock is *cooked food*, not a package
 * on a shelf, so even a sub-recipe whose name is registered with an exact
 * shopping unit offers amounts a pot can hold (./subRecipePlan,
 * components/SubRecipeSelect).
 */
export function suggestedSubRecipeStocks(need: ShoppingNeed): readonly number[] {
  return bqStockSuggestions(roundThousandths(need.needed));
}

/**
 * The nearest count of an additional unit for a raw count (see
 * `stockCountText`): 0 or a value of the unit's number scheme (§6.1), the
 * nearest by absolute distance, ties toward the larger count like the display
 * formatters. Above the scheme's range the raw count itself is rounded to a
 * whole number — the field answers "roughly how many is that", while the scheme
 * bounds what a *recipe* line may say.
 */
function nearestCount(au: AdditionalUnit, raw: number): number {
  // 0 is not an AQ value but a legitimate count: an empty shelf is zero pieces.
  const candidates = [0, ...schemeValues(au.numberScheme)];
  const largest = candidates[candidates.length - 1] ?? 0;
  if (raw >= largest) {
    return Math.round(raw);
  }
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - raw);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The need of one row as a line of its own: what the selected dishes need
 * together, in the ingredient's familiar reading but always naming that exact
 * amount — an exact unit only when its whole count really brings it home, an
 * approximate unit as its count plus the authoritative base amount ("8 Karotten
 * (500 g)"), or the plain base form ("600 g Joghurt"). The shopping unit on the
 * buy side may name a *different* amount (it is rounded up to whole packages),
 * so the need keeps its own reading.
 */
export function needText(need: ShoppingNeed): string {
  return renderQuantityText(need.ingredient, need.needed, need.baseUnit);
}

/**
 * The shopping unit of one row's ingredient, with its factor (family base unit
 * per one unit), or null when the master data gives the ingredient none
 * (§3.1). The pantry sheet shows the stock's whole count in this unit beside the
 * stock picker, and reads a count typed into that field in it.
 */
export function shoppingUnitOf(need: ShoppingNeed): { au: AdditionalUnit; factor: number } | null {
  return shoppingUnitFor(mappingsFor(need.ingredient), need.baseUnit);
}

/**
 * The stock translated into the ingredient's shopping unit ("2 Stück", "1
 * Packung") — the pantry sheet's field beside the stock picker, which can also
 * be tapped to type a count. Null when there is nothing to count: either the
 * ingredient has no shopping unit, or its unit is **exact** (§3.1) and the
 * stock is not a whole number of it. The sheet prints a dash then, because
 * "0,2 Packung" would name a shelf that cannot exist.
 *
 * An **approximate** unit's factor is an average (§6.3): grams on the shelf and
 * pieces in a recipe are two readings of one stock, so its count is the nearest
 * value of the unit's number scheme (§6.1), rendered in the §8 glyph typography
 * ("1 ½ Stück"). The stock is not required to be a table value: it comes from
 * the reorder point or from a typed number.
 */
export function stockCountText(need: ShoppingNeed, stock: number): string | null {
  const target = shoppingUnitOf(need);
  if (target === null) {
    return null;
  }
  const raw = Math.max(0, roundThousandths(stock)) / target.factor;
  let count: number;
  if (target.au.exact) {
    const whole = roundThousandths(raw);
    if (!Number.isInteger(whole)) {
      return null;
    }
    count = whole;
  } else {
    count = nearestCount(target.au, raw);
  }
  const notation = isAQValue(count) ? formatAQValue(count) : formatDecimal(count);
  // The unit shows its singular or plural display form for the count (§3).
  return `${notation}${NNBSP}${auDisplayName(target.au, count)}`;
}
