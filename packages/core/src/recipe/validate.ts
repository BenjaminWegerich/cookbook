/**
 * Cross-recipe validation (docs/storage_format.md §7.2).
 *
 * Runs per collection, on top of the per-file validation of ./parse.ts:
 * - `title` is unique across the collection;
 * - every `recipe:` reference points to an existing recipe whose `type` is
 *   `ingredient_recipe`;
 * - the link graph is acyclic (a cycle would recurse forever in the
 *   scaling / shopping-list logic that walks the sub-recipe links).
 *
 * Recipe titles locate the problems (titles are unique after this check), so
 * the issue paths use the title instead of a collection index.
 */

import { RecipeCollectionError } from './types.js';
import type { Recipe, ValidationIssue } from './types.js';

/**
 * Validates a whole collection of already-parsed recipes (§7.2).
 *
 * @param recipes every recipe of the collection
 * @throws {RecipeCollectionError} with all problems found (paths + German messages)
 */
export function validateCollection(recipes: readonly Recipe[]): void {
  const issues: ValidationIssue[] = [];

  // §7.2: titles are unique across the collection.
  const firstIndexByTitle = new Map<string, number>();
  recipes.forEach((recipe, index) => {
    const first = firstIndexByTitle.get(recipe.title);
    if (first !== undefined) {
      issues.push({
        path: recipe.title,
        message: `Der Titel "${recipe.title}" ist nicht eindeutig (kommt auch in Rezept ${first + 1} vor).`,
      });
    } else {
      firstIndexByTitle.set(recipe.title, index);
    }
  });

  // §7.2: every recipe: reference points to an existing ingredient_recipe.
  const recipeByTitle = new Map(recipes.map((recipe) => [recipe.title, recipe]));
  for (const recipe of recipes) {
    recipe.ingredients.forEach((ingredient, index) => {
      if (ingredient.recipe === undefined) return;
      const target = recipeByTitle.get(ingredient.recipe);
      const path = `${recipe.title}.ingredients[${index}].recipe`;
      if (target === undefined) {
        issues.push({
          path,
          message: `Das verlinkte Rezept "${ingredient.recipe}" existiert nicht.`,
        });
      } else if (target.type !== 'ingredient_recipe') {
        issues.push({
          path,
          message: `Das verlinkte Rezept "${ingredient.recipe}" muss den Typ ingredient_recipe haben.`,
        });
      }
    });
  }

  // §7.2 extension: the link graph must be acyclic. A cycle (A → B → A) would
  // otherwise recurse forever in the scaling / shopping-list logic that walks
  // the sub-recipe links (recipe_structure.md "The link means…"); chains of
  // ingredient recipes are allowed and stay valid.
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (title: string): void => {
    const current = state.get(title);
    if (current === 'done') return;
    if (current === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(title)), title].join(' → ');
      issues.push({ path: title, message: `Zyklus in den Rezept-Links erkannt: ${cycle}.` });
      return;
    }
    state.set(title, 'visiting');
    stack.push(title);
    for (const ingredient of recipeByTitle.get(title)?.ingredients ?? []) {
      if (ingredient.recipe !== undefined) visit(ingredient.recipe);
    }
    stack.pop();
    state.set(title, 'done');
  };
  for (const recipe of recipes) {
    visit(recipe.title);
  }

  if (issues.length > 0) {
    throw new RecipeCollectionError(issues);
  }
}
