/**
 * Resolves the *selected* meal-plan cards into the ingredient rows of the pantry
 * sheet ("Vorräte auswählen").
 *
 * The counterpart of ./mealPlanCards for the shopping flow: there the entry's
 * size is resolved onto a card, here the card's recipe is loaded and reduced to
 * the ingredient needs of the bundle.
 *
 * Per selected dish:
 * 1. the recipe file is read (the same cached read the resolution used, so
 *    repeated dishes and the earlier step cost no second Drive request);
 * 2. its ingredient list is scaled to the size the plan cooks it at (core's
 *    `scaledIngredientsForPlan`: the entry's stated size, or its written size
 *    when the entry states none — the same fallback the card carries).
 *
 * The scaled lists then go to core in one call, which sums them per ingredient
 * and looks up the master data's reorder points (`shoppingNeeds`). The whole
 * point of the bundle is that this happens **once for all selected dishes**: an
 * ingredient two dishes share is rounded to whole packs once, not per dish.
 *
 * A card without a recipe (an entry the app could not recognize) is skipped —
 * the selection page never offers one, so this is only a guard.
 *
 * A recipe file that cannot be read is an error, not a silent gap: dropping one
 * dish would quietly produce a shopping list that is missing its ingredients.
 * The page shows the reason and stays open.
 */

import {
  scaledIngredientsForPlan,
  shoppingNeeds,
  sumIngredientUses,
  type Ingredient,
  type ShoppingNeed,
} from '@cookbook/core';

import { readRecipe } from '../drive/recipeStorage';
import type { MealPlanCard } from './mealPlanCards';

/** The ingredient needs of a bundle of dishes: what the pantry sheet renders. */
export interface ShoppingBundle {
  /** One row per ingredient, in order of first use across the selected dishes. */
  readonly needs: ShoppingNeed[];
  /** How many dishes contributed — the "Y Rezepte" of the success notice. */
  readonly recipes: number;
}

/**
 * Builds the bundle of the given cards (see the file header). `token` is the
 * Drive access token that the recipe files are read with.
 */
export async function resolveShoppingBundle(
  cards: readonly MealPlanCard[],
  token: string,
): Promise<ShoppingBundle> {
  const lists: Ingredient[][] = [];
  for (const card of cards) {
    if (card.recipe === null) continue;
    const recipe = await readRecipe(token, card.recipe.fileId);
    // `planned ?? writtenPlanned` is the size the dish is really cooked at: what
    // the Keep entry states, or — when it states none — the size the recipe is
    // written in. Null can only happen when the file could not be read during
    // the resolution, which the read above has just done successfully; the
    // unscaled list is then the honest reading.
    const planned = card.planned ?? card.writtenPlanned;
    lists.push(scaledIngredientsForPlan(recipe, planned));
  }
  return { needs: shoppingNeeds(sumIngredientUses(lists)), recipes: lists.length };
}
