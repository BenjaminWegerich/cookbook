/**
 * Ingredient merging and master-list derivation (storage_format.md §4).
 *
 * The step rows are the source of truth for the ingredient list: the master
 * list of a recipe is *derived* from the rows of all steps
 * (`deriveIngredients`), with repeated entries of the same name merged by
 * `mergeIngredientUses` — "an ingredient used in several places appears once,
 * with the total amount, at the position of its first use".
 *
 * The `reference` role is recipe-level (the front-matter name list) and is
 * resolved onto the merged entries here; rows never carry it.
 */

import { mappingsFor } from '../ingredientRegistry.js';
import { optimizeQuantity } from '../quantityOptimizer.js';
import type { Ingredient, MasterIngredient, Step } from './types.js';

/** Rounds a derived sum to millionths, removing binary floating-point noise. */
function roundSum(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Merges repeated entries of the same ingredient name into one entry with the
 * summed quantity (storage_format.md §4: "an ingredient used in several places
 * appears once, with the total amount").
 *
 * The master list sums the **displayed BQs** of the individual uses, not the
 * exact targets (V0). That is the amount the cook actually reads on the rows;
 * summing the targets would disagree with those readings. The sum is kept at
 * millionth precision only to remove floating-point noise.
 *
 * Entries are grouped by exact name (trimmed). The first entry's unit is kept.
 * Entries whose quantity cannot be summed meaningfully (different base units
 * for the same name, e.g. g vs ml) are kept as separate entries instead of
 * being merged.
 */
export function mergeIngredientUses(ingredients: readonly Ingredient[]): Ingredient[] {
  const byName = new Map<string, Ingredient[]>();
  for (const ingredient of ingredients) {
    const name = ingredient.name.trim();
    const list = byName.get(name);
    if (list === undefined) {
      byName.set(name, [ingredient]);
    } else {
      list.push(ingredient);
    }
  }

  const merged: Ingredient[] = [];
  for (const [name, entries] of byName) {
    // A group always has at least one entry (it was created by a push above).
    const first = entries[0]!;
    // Only sum when every entry shares the first entry's unit — otherwise the
    // amounts are not comparable and stay separate.
    if (entries.every((entry) => entry.unit === first.unit)) {
      merged.push({
        name,
        quantity: roundSum(entries.reduce((sum, entry) => sum + entry.quantity, 0)),
        unit: first.unit,
      });
    } else {
      // Mixed units: keep each entry as-is (still trimmed).
      merged.push(...entries.map((entry) => ({ ...entry, name: entry.name.trim() })));
    }
  }
  return merged;
}

/**
 * The BQ the row displays for one use: the optimizer's selected BQ with the
 * use's row tolerance and the recipe tolerance. Unknown ingredients (no master
 * data) still get the metric-only BQ; a fallback returns V0. The optimizer
 * never throws for a positive target, but a malformed draft could; the plain
 * target is the safe fallback so deriving the list cannot break the editor.
 */
function displayedBQ(ingredient: Ingredient, recipeTolerance?: number): number {
  try {
    return optimizeQuantity(ingredient.quantity, mappingsFor(ingredient.name), ingredient.unit, {
      ...(ingredient.tolerance !== undefined ? { quantity: ingredient.tolerance } : {}),
      ...(recipeTolerance !== undefined ? { recipe: recipeTolerance } : {}),
    }).bq;
  } catch {
    return ingredient.quantity;
  }
}

/**
 * Derives the master ingredient list of a recipe from its step rows
 * (storage_format.md §4): the rows of all steps in order of first use, merged
 * by exact name with the total of their **displayed BQs**.
 *
 * The `reference` role is resolved from the recipe-level `reference` name list
 * (front matter): a merged entry is a reference entry when its name is listed.
 *
 * @param steps the step rows, already in the recipe's target unit
 * @param reference recipe-level reference names
 * @param recipeTolerance the recipe-level tolerance (front matter), if set;
 *   it participates in each row's display selection
 */
export function deriveIngredients(
  steps: readonly Step[],
  reference: readonly string[] = [],
  recipeTolerance?: number,
): MasterIngredient[] {
  const entries: Ingredient[] = [];
  for (const step of steps) {
    for (const ingredient of step.ingredients) {
      // Replace the target with the BQ the row will display; merge then sums
      // those practical amounts.
      entries.push({ ...ingredient, quantity: displayedBQ(ingredient, recipeTolerance) });
    }
  }
  const referenceNames = new Set(reference.map((name) => name.trim()));
  return mergeIngredientUses(entries).map((entry) =>
    referenceNames.has(entry.name) ? { ...entry, reference: true } : entry,
  );
}
