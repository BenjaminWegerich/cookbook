/**
 * Title-rename support (docs/storage_format.md §6).
 *
 * Renaming a recipe means, as one operation: change `title` in the file, rename
 * the file (and its image), and update every `recipe:` reference to the old
 * title in all other recipe files. The Drive-side file and image renames are
 * the caller's job (web-app storage layer); this module provides the pure
 * content transformation on a collection of parsed recipes.
 *
 * Decided with the user: a sub-recipe ingredient carries the recipe's title as
 * its ingredient name too (name == title invariant, storage_format.md §4), so
 * renaming the sub-recipe also renames the ingredient marker in the parent
 * recipes — the reference follows the recipe in both fields.
 *
 * The target recipe itself is excluded from the reference update (§6: "in all
 * other recipe files"). A self-reference inside the target would therefore not
 * be rewritten — such a recipe is invalid anyway (rejected by the cycle check
 * in ./validate.ts, §7.2 extension).
 */

import { deriveIngredients, replaceMarkers } from './markers.js';
import type { Recipe } from './types.js';

/** Result of a rename: the renamed recipe plus every other recipe that changed. */
export interface RenameResult {
  /** The renamed recipe with its new title (same ingredients, steps, etc.). */
  renamed: Recipe;
  /**
   * Every other recipe whose `|recipe:` markers pointed at the old title,
   * with those references updated. Recipes that did not change are omitted.
   */
  updated: readonly Recipe[];
}

/**
 * Rewrites a collection for a title rename (§6).
 *
 * @param recipes the whole collection (titles unique, per §7.2)
 * @param oldTitle the current title of the recipe to rename
 * @param newTitle the new title
 * @returns the renamed recipe and the other recipes with updated references
 * @throws {Error} when `oldTitle` is not present in the collection
 */
export function renameRecipeInCollection(
  recipes: readonly Recipe[],
  oldTitle: string,
  newTitle: string,
): RenameResult {
  const target = recipes.find((recipe) => recipe.title === oldTitle);
  if (target === undefined) {
    throw new Error(`renameRecipeInCollection: "${oldTitle}" is not in the collection`);
  }
  if (oldTitle === newTitle) {
    return { renamed: target, updated: [] };
  }

  const renamed: Recipe = { ...target, title: newTitle };

  // The recipe: references live in the body markers (§4: the step text is the
  // source of truth); update them in every other recipe and recompute the
  // derived ingredient list from the changed steps. The marker's name is
  // renamed with it (name == title invariant), so parents read "Käsesauce"
  // after a rename of Béchamelsauce.
  const updated: Recipe[] = [];
  for (const recipe of recipes) {
    if (recipe === target) continue;
    let changed = false;
    const steps = recipe.steps.map((step) =>
      replaceMarkers(step, (marker) => {
        if (marker.recipe !== oldTitle) return marker;
        changed = true;
        return { ...marker, name: newTitle, recipe: newTitle };
      }),
    );
    if (changed) {
      updated.push({ ...recipe, steps, ingredients: deriveIngredients(steps) });
    }
  }

  return { renamed, updated };
}
