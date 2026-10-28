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
import { splitArtifacts } from './artifacts.js';
import type { Ingredient, MasterIngredient, Recipe, Step } from './types.js';

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
 * Entries are grouped by exact name (trimmed) **and base unit**. Same-unit uses
 * of one name are always merged, even when another use of that name is in a
 * different unit; the different-unit uses stay separate entries because their
 * amounts are not comparable (g vs ml). Grouping by both fields is what lets
 * `masterUsesFor` reconstruct exactly the uses behind one master row.
 */
export function mergeIngredientUses(ingredients: readonly Ingredient[]): Ingredient[] {
  const byNameAndUnit = new Map<string, Ingredient[]>();
  for (const ingredient of ingredients) {
    const key = `${ingredient.name.trim()}\u0000${ingredient.unit}`;
    const list = byNameAndUnit.get(key);
    if (list === undefined) {
      byNameAndUnit.set(key, [ingredient]);
    } else {
      list.push(ingredient);
    }
  }

  const merged: Ingredient[] = [];
  for (const entries of byNameAndUnit.values()) {
    // A group always has at least one entry (it was created by a push above).
    const first = entries[0]!;
    merged.push({
      name: first.name.trim(),
      quantity: roundSum(entries.reduce((sum, entry) => sum + entry.quantity, 0)),
      unit: first.unit,
    });
  }
  return merged;
}

/**
 * The BQ the row displays for one use: the optimizer's selected BQ with the
 * use's optional per-quantity precision (the ingredient master data supplies the
 * mandatory ingredient level). Unknown ingredients (no master data) still get
 * the metric-only BQ; a fallback returns V0. The optimizer never throws for a
 * positive target, but a malformed draft could; the plain target is the safe
 * fallback so deriving the list cannot break the editor.
 */
function displayedBQ(ingredient: Ingredient): number {
  try {
    return optimizeQuantity(ingredient.quantity, mappingsFor(ingredient.name), ingredient.unit, {
      ...(ingredient.precision !== undefined ? { quantity: ingredient.precision } : {}),
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
 */
export function deriveIngredients(
  steps: readonly Step[],
  reference: readonly string[] = [],
): MasterIngredient[] {
  const entries: Ingredient[] = [];
  for (const step of steps) {
    for (const ingredient of step.ingredients) {
      // Replace the target with the BQ the row will display; merge then sums
      // those practical amounts.
      entries.push({ ...ingredient, quantity: displayedBQ(ingredient) });
    }
  }
  const referenceNames = new Set(reference.map((name) => name.trim()));
  return mergeIngredientUses(entries).map((entry) =>
    referenceNames.has(entry.name) ? { ...entry, reference: true } : entry,
  );
}

/**
 * Whether a recipe can display the given ingredient anywhere
 * (storage_format.md §4): in a counted step row or in an inline `{{… Name}}`
 * artifact.
 *
 * The derived master list already covers every counted step row, so checking
 * `recipe.ingredients` is enough for the ingredient lists. Inline artifacts are
 * *not* part of that list — an ingredient may appear only in the prose — so the
 * step texts are scanned separately.
 *
 * Callers use this to find the recipes an ingredient's master-data change can
 * make stale: both surfaces bake display forms from the runtime registry (the
 * HTML export, the app's lists), so a change affects the recipe when the name
 * occurs in either place. Names are compared exactly; the parser trims them.
 *
 * @param recipe a parsed recipe
 * @param name the canonical ingredient name
 */
export function recipeUsesIngredient(recipe: Recipe, name: string): boolean {
  if (recipe.ingredients.some((ingredient) => ingredient.name === name)) {
    return true;
  }
  return recipe.steps.some((step) =>
    splitArtifacts(step.text).spans.some((span) => span.artifact.name === name),
  );
}
