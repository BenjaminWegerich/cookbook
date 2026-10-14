/**
 * Resolves the *selected* meal-plan cards into the two things the shopping flow
 * needs: the selected dishes' scaled ingredient lists, and the recipes of every
 * sub-recipe those dishes reach — at any depth.
 *
 * The counterpart of ./mealPlanCards for the shopping flow: there the entry's
 * size is resolved onto a card, here the card's recipe is loaded, scaled and
 * walked for implicit sub-recipe links (docs/recipe_structure.md, "The link
 * means …"). Per selected dish:
 *
 * 1. the recipe file is read (the same cached read the resolution used, so
 *    repeated dishes and the earlier step cost no second Drive request);
 * 2. its ingredient list is scaled to the size the plan cooks it at (core's
 *    `scaledIngredientsForPlan`: the entry's stated size, or its written size
 *    when the entry states none — the same fallback the card carries);
 * 3. every ingredient name that is an `ingredient_recipe` of the collection is
 *    followed: its file is read and its own ingredient list is scanned in turn.
 *
 * **Only `ingredient_recipe` titles are links** (./recipe/rename.ts): a name
 * that matches a finished dish — or no recipe at all — stays an ordinary
 * ingredient and reaches the bottom level unchanged. A name that *is* a recipe
 * of the collection but whose file cannot be read is an error, not a silent
 * gap: falling back to "buy it" would quietly produce a shopping list that
 * misses everything the sub-recipe is made of.
 *
 * The walk stops at the last sub-recipe level; the arithmetic over the graph —
 * requirements, stocks, cooking amounts, and the bottom level the second pantry
 * step buys — is core's `planSubRecipes`. This module owns only the Drive reads,
 * because loading recipe files is the web app's job.
 *
 * A card without a recipe (an entry the app could not recognize) is skipped —
 * the selection page never offers one, so this is only a guard.
 */

import {
  planSubRecipes,
  resolveSubRecipePlan,
  scaledIngredientsForPlan,
  shoppingNeeds,
  sumIngredientUses,
  type Ingredient,
  type Recipe,
  type ShoppingNeed,
  type SubRecipePlan,
  type SubRecipeResolution,
} from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import type { MealPlanCard } from './mealPlanCards';

/**
 * The resolved input of the bundled shopping flow: what both pantry steps
 * compute from. It is deliberately *not* the finished plan — the user's cooking
 * decisions change that plan while the first step is open, so the steps derive
 * it themselves from these inputs on every render (`subRecipePlanFor`).
 */
export interface ShoppingInputs {
  /**
   * The selected dishes' ingredient lists, in the selection's order, each
   * scaled to the size the plan cooks it at.
   */
  readonly dishLists: readonly (readonly Ingredient[])[];
  /**
   * Every ingredient recipe reachable from the selected dishes, keyed by the
   * name the dishes use for it (an implicit link is a name, see the file
   * header). Empty when the bundle holds no sub-recipe at all — the second
   * pantry step then shows exactly the ingredients of the selected dishes.
   */
  readonly recipesByTitle: ReadonlyMap<string, Recipe>;
  /** How many dishes contributed — the "Y Rezepte" of the success notice. */
  readonly recipes: number;
}

/**
 * Builds the inputs of the given cards (see the file header). `token` is the
 * Drive access token the recipe files are read with; `collection` is the
 * recipe list, which names the recipes a sub-recipe link can point at.
 */
export async function resolveShoppingBundle(
  cards: readonly MealPlanCard[],
  token: string,
  collection: readonly StoredRecipe[],
): Promise<ShoppingInputs> {
  // Recipe titles are unique within the collection (storage_format.md §2), so a
  // title lookup is unambiguous.
  const storedByTitle = new Map(collection.map((entry) => [entry.title, entry]));

  /** Candidates already examined: the ingredient recipe, or null (no link). */
  const links = new Map<string, Recipe | null>();
  /** The ingredient lists still to be scanned for further sub-recipe uses. */
  const pending: Array<readonly Ingredient[]> = [];
  const dishLists: Ingredient[][] = [];

  for (const card of cards) {
    if (card.recipe === null) continue;
    const recipe = await readRecipe(token, card.recipe.fileId);
    // `planned ?? writtenPlanned` is the size the dish is really cooked at: what
    // the Keep entry states, or — when it states none — the size the recipe is
    // written in.
    const planned = card.planned ?? card.writtenPlanned;
    const list = scaledIngredientsForPlan(recipe, planned);
    dishLists.push(list);
    pending.push(list);
  }

  // The closure walk: a discovered sub-recipe queues its own ingredient list,
  // so the loop reaches every depth. `links` keeps it terminating — a name is
  // examined once, and a cycle between two sub-recipes is left for core's
  // `planSubRecipes` to report instead of being walked here twice.
  while (pending.length > 0) {
    const list = pending.shift()!;
    for (const use of list) {
      if (links.has(use.name)) continue;
      const stored = storedByTitle.get(use.name);
      if (stored === undefined) {
        links.set(use.name, null);
        continue;
      }
      // A candidate that is in the collection but unreadable is an error (see
      // the file header); `readRecipe` throws, and the step shows the reason.
      const recipe = await readRecipe(token, stored.fileId);
      const link = recipe.type === 'ingredient_recipe' ? recipe : null;
      links.set(use.name, link);
      if (link !== null) {
        pending.push(link.ingredients);
      }
    }
  }

  const recipesByTitle = new Map<string, Recipe>();
  for (const [name, link] of links) {
    if (link !== null) {
      recipesByTitle.set(name, link);
    }
  }

  return { dishLists, recipesByTitle, recipes: dishLists.length };
}

/**
 * The multi-level plan of a bundle with the chosen cooking decisions applied —
 * what the first pantry step ("Teil 1: Zutaten-Rezepte") renders. `decisions`
 * is the chosen stock per sub-recipe name; a name without one keeps its prefill.
 */
export function subRecipePlanFor(
  inputs: ShoppingInputs,
  decisions: ReadonlyMap<string, number> = new Map(),
): SubRecipePlan {
  return planSubRecipes(inputs.dishLists, inputs.recipesByTitle, decisions);
}

/**
 * The plan of a bundle with the chosen cooking decisions *and* the requirements
 * the user already acknowledged applied — the rows step 1 renders, with the
 * invalidated ones marked and only the decisions that still apply (core's
 * `resolveSubRecipePlan`, which owns both the rule and its cascade).
 */
export function resolvedSubRecipePlanFor(
  inputs: ShoppingInputs,
  decisions: ReadonlyMap<string, number> = new Map(),
  acknowledged: ReadonlyMap<string, number> = new Map(),
): SubRecipeResolution {
  return resolveSubRecipePlan(inputs.dishLists, inputs.recipesByTitle, decisions, acknowledged);
}

/**
 * The bottom-level ingredient needs of a bundle with the chosen cooking
 * decisions applied — what the second pantry step ("Teil 2: Zutaten") renders
 * and buys. It is the summed need of the selected dishes *and* of every cooked
 * sub-recipe, so the bundling rule (one rounded purchase per ingredient across
 * all dishes) applies across the whole graph.
 */
export function bottomLevelNeedsFor(
  inputs: ShoppingInputs,
  decisions: ReadonlyMap<string, number> = new Map(),
): ShoppingNeed[] {
  const plan = subRecipePlanFor(inputs, decisions);
  return shoppingNeeds(sumIngredientUses([plan.bottomUses]));
}
