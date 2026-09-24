/**
 * The yield views of an ingredient-recipe HTML export.
 *
 * An ingredient recipe has no serving count; its size is a yield in the
 * recipe's own family unit (`g` / `ml`). The exported cooking view therefore
 * offers yields instead of servings — and the meal plan's promised size has to
 * be one the export can actually show, or the link in the Keep line would open
 * the wrong amount.
 *
 * One rule serves both sides so they cannot drift:
 *
 * - the export bakes every ladder rung within ±`YIELD_VIEW_DECADES` decades of
 *   the recipe's *written* yield (`yieldViewQuantities`), so the offered range
 *   moves with the recipe instead of being a global bound;
 * - the meal plan accepts a planned yield only inside that same range
 *   (`yieldViewFitsWrittenYield`), which is why `mealPlanEntryText` can always
 *   select the exact view it promised.
 *
 * ±2 decades = ±32 rungs: a recipe written at 500 g is planned and cooked
 * between 5 g and 50 kg (the app's own quantity pool narrows that further),
 * which covers every realistic use; the file grows by the extra views, not by
 * any logic, so decision 7's "no runtime scaling" still holds.
 */

import { STEPS_PER_DECADE, pos, roundedBQ } from '../ladder.js';

/** Rungs covered in each direction around the written yield: ±2 decades. */
export const YIELD_VIEW_DECADES = 2;
/** The same range as a number of ladder steps (±32). */
export const YIELD_VIEW_STEPS = YIELD_VIEW_DECADES * STEPS_PER_DECADE;

/**
 * Every yield the export of an ingredient recipe bakes a view for: the ladder
 * rungs from `pos(writtenYield) − YIELD_VIEW_STEPS` to `+ YIELD_VIEW_STEPS`,
 * ascending, in the family base unit. The written yield itself sits in the
 * middle (it is a ladder rung by definition), so the unscaled view is always
 * among them.
 *
 * `writtenYield` must be a ladder value; the recipe validator guarantees that
 * for a stored recipe (docs/storage_format.md §3).
 */
export function yieldViewQuantities(writtenYield: number): number[] {
  const center = pos(writtenYield);
  const quantities: number[] = [];
  for (let x = center - YIELD_VIEW_STEPS; x <= center + YIELD_VIEW_STEPS; x++) {
    quantities.push(roundedBQ(x));
  }
  return quantities;
}

/**
 * True when a planned yield has a baked view in the export of the recipe
 * written at `writtenYield` — i.e. when the two rungs are at most
 * `YIELD_VIEW_STEPS` apart.
 *
 * Both values must be ladder values in the same family unit; the caller checks
 * the unit (see `plannedAmountFitsRecipe`). A value that is not on the ladder
 * (a hand-edited recipe file, docs/quantity_scaling.md §3) answers `false`
 * instead of throwing: one malformed recipe must not take the whole meal-plan
 * list down with it.
 */
export function yieldViewFitsWrittenYield(plannedYield: number, writtenYield: number): boolean {
  try {
    return Math.abs(pos(plannedYield) - pos(writtenYield)) <= YIELD_VIEW_STEPS;
  } catch {
    return false;
  }
}
