/**
 * Cross-recipe validation (docs/storage_format.md §7.2).
 *
 * Runs per collection, on top of the per-file validation of ./parse.ts:
 * - `title` is unique across the collection;
 * - the sub-recipe link graph is acyclic (a cycle would recurse forever in the
 *   scaling / shopping-list logic that walks the sub-recipe links).
 *
 * Sub-recipe links are implicit (storage_format.md §4): an ingredient use
 * whose name equals the title of an `ingredient_recipe` *is* that sub-recipe.
 * A use counts wherever it appears — as a step row or as an inline text
 * artifact of a step (display-only mentions still render as links).
 *
 * Recipe titles locate the problems (titles are unique after this check), so
 * the issue paths use the title instead of a collection index.
 */

import { splitArtifacts } from './artifacts.js';
import { RecipeCollectionError } from './types.js';
import type { Recipe, ValidationIssue } from './types.js';

/**
 * Every distinct name an ingredient use in this recipe can carry (step rows
 * and inline text artifacts). Text artifacts are parsed from the prose; only
 * their (optional) name is relevant here.
 */
function usedIngredientNames(recipe: Recipe): Set<string> {
  const names = new Set<string>();
  for (const step of recipe.steps) {
    for (const ingredient of step.ingredients) {
      names.add(ingredient.name);
    }
    for (const span of splitArtifacts(step.text).spans) {
      if (span.artifact.name !== undefined) names.add(span.artifact.name);
    }
  }
  return names;
}

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

  // §7.2 extension: the link graph must be acyclic. An ingredient use that
  // names an `ingredient_recipe` links to it (implicit, §4); a cycle (A → B →
  // A) would otherwise recurse forever in the scaling / shopping-list logic
  // that walks the sub-recipe links (recipe_structure.md "The link means…");
  // chains of ingredient recipes are allowed and stay valid.
  const recipeByTitle = new Map(recipes.map((recipe) => [recipe.title, recipe]));
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
    const recipe = recipeByTitle.get(title);
    if (recipe !== undefined) {
      for (const name of usedIngredientNames(recipe)) {
        const target = recipeByTitle.get(name);
        if (target !== undefined && target.type === 'ingredient_recipe') {
          visit(name);
        }
      }
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
