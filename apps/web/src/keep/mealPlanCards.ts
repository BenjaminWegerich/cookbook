/**
 * Resolves the Keep meal plan into the cards of the "Essensplan" tab and the
 * "Eingeplant" titles of the "Sammlung" tab.
 *
 * One non-checked Keep item becomes one card, in the order Keep shows it:
 *
 * - **Recognized** — the entry's text (without its optional yield suffix) is
 *   the exact title of a recipe file, and a suffix that is present fits the
 *   recipe (see `parseMealPlanText` / `plannedAmountFitsRecipe` in
 *   @cookbook/core). The card shows the known recipe format (photo, title).
 * - **Unrecognized** — everything else, including a known title whose suffix
 *   does not fit. The card shows a placeholder image derived from the text and
 *   the entry's complete text as its title.
 *
 * The recipe file is only read when it really changes the answer: a title-only
 * entry needs no file (nothing has to fit), so the common meal-plan line costs
 * no Drive round-trip. A read that fails (corrupt file, deleted between list
 * and read) leaves a suffixed entry unrecognized instead of guessing — the
 * other recipes of the plan are unaffected.
 *
 * The returned `plannedRecipeTitles` is what puts the "Eingeplant" badge on a
 * card in the "Sammlung" tab; a recipe planned twice, or planned once and
 * referenced by an unrecognized entry as well, still appears exactly once
 * there.
 */

import {
  parseMealPlanText,
  plannedAmountFitsRecipe,
  type MealPlanRecipeInfo,
  type PlannedAmount,
} from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import type { KeepItem } from './keepClient';

/** One card of the "Essensplan" tab. */
export interface MealPlanCard {
  /** Stable React key: position in Keep's order plus the entry text. */
  key: string;
  /** The entry's complete text, trimmed. */
  text: string;
  /** The recognized recipe (photo + title), or null when unrecognized. */
  recipe: StoredRecipe | null;
  /** The size the entry states, when it fits the recognized recipe. */
  planned: PlannedAmount | null;
}

/** Everything the recipe list needs from the meal plan. */
export interface MealPlanResolution {
  /** One card per non-checked entry, in Keep's display order. */
  cards: MealPlanCard[];
  /** Titles of recipes recognized on the meal plan ("Eingeplant" badge). */
  plannedRecipeTitles: ReadonlySet<string>;
}

/**
 * Builds the meal-plan cards and the planned-title set. `token` is the Drive
 * access token, needed only for the recipe files that a yield suffix has to be
 * checked against.
 */
export async function resolveMealPlan(
  recipes: StoredRecipe[],
  items: KeepItem[],
  token: string,
): Promise<MealPlanResolution> {
  // Recipe titles are unique within the collection (storage_format.md §2), so
  // a title lookup is unambiguous.
  const recipesByTitle = new Map(recipes.map((recipe) => [recipe.title, recipe]));
  /** Per-title cache: the fit-relevant facts, or null when unreadable. */
  const metaByTitle = new Map<string, MealPlanRecipeInfo | null>();

  const readMeta = async (recipe: StoredRecipe): Promise<MealPlanRecipeInfo | null> => {
    const cached = metaByTitle.get(recipe.title);
    if (cached !== undefined) return cached;
    let meta: MealPlanRecipeInfo | null = null;
    try {
      // readRecipe parses freshly and shares only the cached raw text, so
      // repeated entries of the same recipe cost no second Drive request.
      const loaded = await readRecipe(token, recipe.fileId);
      meta = {
        type: loaded.type,
        ...(loaded.yield_unit !== undefined ? { yieldUnit: loaded.yield_unit } : {}),
      };
    } catch {
      meta = null;
    }
    metaByTitle.set(recipe.title, meta);
    return meta;
  };

  const cards: MealPlanCard[] = [];
  const plannedRecipeTitles = new Set<string>();

  for (const [index, item] of items.entries()) {
    if (item.checked) continue; // ticked off in Keep = not planned any more
    const text = item.text.trim();
    if (text === '') continue;

    const parsed = parseMealPlanText(text);
    const recipe = recipesByTitle.get(parsed.title) ?? null;
    let recognized = false;
    if (recipe !== null) {
      if (parsed.planned === null) {
        // The entry only names the dish: nothing has to fit.
        recognized = true;
      } else {
        const meta = await readMeta(recipe);
        recognized = meta !== null && plannedAmountFitsRecipe(parsed.planned, meta);
      }
    }
    if (recognized && recipe !== null) plannedRecipeTitles.add(recipe.title);

    cards.push({
      key: `${index}:${text}`,
      text,
      recipe: recognized ? recipe : null,
      planned: recognized ? parsed.planned : null,
    });
  }

  return { cards, plannedRecipeTitles };
}
