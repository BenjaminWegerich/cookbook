/**
 * Title-rename support (docs/storage_format.md §6).
 *
 * Renaming a recipe means, as one operation: change `title` in the file, rename
 * the file (and its image), and update every reference to the old title in all
 * other recipe files. The Drive-side file and image renames are the caller's
 * job (web-app storage layer); this module provides the pure content
 * transformation on a collection of parsed recipes.
 *
 * Sub-recipe links are implicit (storage_format.md §4): an ingredient use
 * whose name equals the title of an `ingredient_recipe` *is* that sub-recipe.
 * Renaming an `ingredient_recipe` therefore renames every use of that name in
 * the other recipes — as a step row, as an inline text artifact, and as an
 * entry of a `reference` list (a parent may anchor its portion size to the
 * sub-recipe). Only `ingredient_recipe` titles are referenced this way, so
 * renaming a finished dish never touches the other files.
 *
 * The target recipe itself is excluded from the reference update (§6: "in all
 * other recipe files"). A self-reference inside the target would therefore not
 * be rewritten — such a recipe is invalid anyway (rejected by the cycle check
 * in ./validate.ts, §7.2 extension).
 */

import { replaceArtifacts } from './artifacts.js';
import { deriveIngredients } from './ingredientList.js';
import type { Recipe, Step } from './types.js';

/** Result of a rename: the renamed recipe plus every other recipe that changed. */
export interface RenameResult {
  /** The renamed recipe with its new title (same ingredients, steps, etc.). */
  renamed: Recipe;
  /**
   * Every other recipe whose implicit sub-recipe references pointed at the old
   * title, with those references updated. Recipes that did not change are
   * omitted.
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

  // Only ingredient recipes can be referenced as sub-recipes (finished dishes
  // are never linked); renaming a finished dish therefore changes no other file.
  if (target.type !== 'ingredient_recipe') {
    return { renamed, updated: [] };
  }

  /** Rewrites the rows/artifacts of one step block for a new title. */
  const renameStep = (step: Step): { step: Step; changed: boolean } => {
    let changed = false;
    const ingredients = step.ingredients.map((ingredient) => {
      if (ingredient.name !== oldTitle) return ingredient;
      changed = true;
      return { ...ingredient, name: newTitle };
    });
    const text = replaceArtifacts(step.text, (artifact) => {
      if (artifact.name !== oldTitle) return artifact;
      changed = true;
      return { ...artifact, name: newTitle };
    });
    return { step: { ingredients, text }, changed };
  };

  const updated: Recipe[] = [];
  for (const recipe of recipes) {
    if (recipe === target) continue;
    let changed = false;
    const steps = recipe.steps.map((entry) => {
      const result = renameStep(entry);
      if (result.changed) changed = true;
      return result.step;
    });
    let reference = recipe.reference;
    if (reference !== undefined && reference.includes(oldTitle)) {
      reference = reference.map((name) => (name === oldTitle ? newTitle : name));
      changed = true;
    }
    if (changed) {
      updated.push({
        ...recipe,
        ...(reference !== undefined ? { reference } : {}),
        steps,
        ingredients: deriveIngredients(steps, reference ?? []),
      });
    }
  }

  return { renamed, updated };
}
