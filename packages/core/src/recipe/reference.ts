/**
 * The reference role of a recipe (docs/recipe_structure.md, reference bullet;
 * docs/storage_format.md §4).
 *
 * A recipe's size is anchored by reference amounts — the portion size for a
 * `finished_dish`, the yield for an `ingredient_recipe`. They are shown as the
 * recipe's muted size readout (the meal-plan overlay, the replace overlay and
 * the HTML export) and scale with every chosen size.
 *
 * Two storage forms feed the same role:
 * - **ingredients** carry it in the front-matter `reference` name list and the
 *   derived master list resolves the flag;
 * - **inline artifacts** carry it on the artifact itself (`|reference`) and
 *   are found in the step prose.
 *
 * This module is the one place that defines the readout's order: the reference
 * ingredients first, in master-list order, then the flagged artifacts in step
 * order (each flagged occurrence). Ingredient references stay first because
 * their order already existed before artifacts could be flagged, so a recipe
 * with both reads the same on top as before.
 */

import { splitArtifacts, type TextArtifact } from './artifacts.js';
import type { MasterIngredient, Recipe } from './types.js';

/** One reference amount: a master-list ingredient or a flagged inline artifact. */
export type ReferenceUse =
  | { kind: 'ingredient'; ingredient: MasterIngredient }
  | { kind: 'artifact'; artifact: TextArtifact };

/**
 * Every reference amount of the recipe, in readout order (see the file
 * header): reference ingredients first, then flagged artifacts in step order.
 */
export function referenceUses(recipe: Recipe): ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  for (const ingredient of recipe.ingredients) {
    if (ingredient.reference === true) uses.push({ kind: 'ingredient', ingredient });
  }
  for (const step of recipe.steps) {
    for (const span of splitArtifacts(step.text).spans) {
      if (span.artifact.reference === true) {
        uses.push({ kind: 'artifact', artifact: span.artifact });
      }
    }
  }
  return uses;
}
