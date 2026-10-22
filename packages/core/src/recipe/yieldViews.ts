/**
 * The yield views of an ingredient-recipe HTML export.
 *
 * A finished dish has a serving count and pre-bakes one view per allowed
 * serving count. An ingredient recipe has a written yield instead; its views are
 * the allowed BQ values in a band around that yield (decided with the user).
 * The band is **±1 decade** (`written/10 … written*10`), which keeps the number
 * of views roughly at the old export size (~65–96) while covering every
 * realistic use. The written yield itself may be any positive number; if it is
 * not a BQ value, the nearest allowed BQ is the default view, because only BQ
 * values are baked (decided with the user).
 *
 * The export and the meal plan share this module, so the meal plan can only
 * promise a size the export really contains.
 */

import { allowedBQValuesInRange, nearestAllowedBQ } from '../quantityValues.js';

/** Decades covered in each direction around the written yield. */
export const YIELD_VIEW_DECADES = 1;

/**
 * Every yield the export of an ingredient recipe bakes a view for: all allowed
 * BQ values in `[written/10, written*10]`, ascending, plus the nearest allowed
 * BQ when that band is empty (a yield below 0.1). The written yield itself is
 * included when it is a BQ value; when it is not, the nearest BQ is the default
 * view (there is no exact written view, because only BQ values are baked).
 *
 * `writtenYield` may be any positive finite number; the parser validates that.
 */
export function yieldViewQuantities(writtenYield: number): number[] {
  if (!(writtenYield > 0) || !Number.isFinite(writtenYield)) {
    throw new Error(`yieldViewQuantities: ${writtenYield} is not a positive finite number`);
  }
  const values = allowedBQValuesInRange(writtenYield / 10, writtenYield * 10).map(
    (entry) => entry.value,
  );
  if (values.length === 0) {
    return [nearestAllowedBQ(writtenYield)];
  }
  return values;
}

/**
 * The default view of an ingredient recipe: the written yield when it is a BQ
 * value, otherwise the allowed BQ value nearest to it (ties toward the larger
 * value). The export marks this view as written, so the recipe opens at the
 * closest amount it can actually show.
 */
export function defaultYieldView(writtenYield: number): number {
  return nearestAllowedBQ(writtenYield);
}

/**
 * True when a planned yield has a baked view in the export of the recipe
 * written at `writtenYield` — i.e. when it is one of `yieldViewQuantities`.
 * Both values must be in the same family unit; the caller checks the unit (see
 * `plannedAmountFitsRecipe`). A malformed value answers false instead of
 * throwing, so one bad meal-plan entry cannot take the list down.
 */
export function yieldViewFitsWrittenYield(plannedYield: number, writtenYield: number): boolean {
  if (!(plannedYield > 0) || !Number.isFinite(plannedYield)) return false;
  try {
    return yieldViewQuantities(writtenYield).some(
      (value) => Math.abs(value - plannedYield) < 1e-9,
    );
  } catch {
    return false;
  }
}
