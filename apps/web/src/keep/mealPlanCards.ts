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
 * Every recognized entry reads its recipe file once (cached per title, and the
 * file's raw text is cached by the Drive layer, so repeated entries of the same
 * recipe and the overview's own read cost nothing extra): the stated size has to
 * be checked against the recipe, and a size-less entry still has to name the
 * size the dish is cooked at, which only the file knows (see
 * MealPlanCard.writtenPlanned). A read that fails (corrupt file, deleted between
 * list and read) leaves a *suffixed* entry unrecognized instead of guessing —
 * the other recipes of the plan are unaffected. An entry that only names the
 * dish stays recognized without its file (there is nothing to fit); it simply
 * carries no written size, so the shopping-list selection shows none for it.
 *
 * The returned `plannedRecipeTitles` is what puts the "Eingeplant" badge on a
 * card in the "Sammlung" tab; a recipe planned twice, or planned once and
 * referenced by an unrecognized entry as well, still appears exactly once
 * there. `plannedAmounts` carries each planned dish's stated size along, which
 * is what the recipe overview shows as its "Geplant" value.
 */

import {
  mealPlanEntryLabel,
  parseMealPlanText,
  plannedAmountFitsRecipe,
  writtenPlannedAmount,
  type MealPlanRecipeInfo,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import type { KeepItem } from './keepClient';

/** One card of the "Essensplan" tab. */
export interface MealPlanCard {
  /** Stable React key: position in Keep's order plus the entry text. */
  key: string;
  /** The entry's complete text, trimmed (the exact Keep line). */
  text: string;
  /**
   * The entry in human form without its export URL — "Kürbissuppe (6
   * Portionen)", or the whole text when it states no parsable size. This is what
   * an unrecognized card shows and what the search matches; the raw `text` would
   * put a long URL on the card.
   */
  displayText: string;
  /** The recognized recipe (photo + title), or null when unrecognized. */
  recipe: StoredRecipe | null;
  /** The size the entry states, when it fits the recognized recipe. */
  planned: PlannedAmount | null;
  /**
   * The size the recipe is *written* in (core's `writtenPlannedAmount`), or null
   * for an unrecognized card. It is the fallback for a recognized entry that
   * states no size: such an entry means the dish at its written size — that is
   * what its link opens — so the shopping-list selection names this amount
   * instead of showing nothing. `planned` stays exactly what Keep says, so the
   * "Umplanen" overlay still knows whether the entry stated a size.
   */
  writtenPlanned: PlannedAmount | null;
}

/** Everything the recipe list needs from the meal plan. */
export interface MealPlanResolution {
  /** One card per non-checked entry, in Keep's display order. */
  cards: MealPlanCard[];
  /** Titles of recipes recognized on the meal plan ("Eingeplant" badge). */
  plannedRecipeTitles: ReadonlySet<string>;
  /**
   * The size each planned recipe states, keyed by recipe title — what the
   * overview shows as its "Geplant" value. Every title of
   * `plannedRecipeTitles` has an entry here; the value is null when that dish's
   * entry names it without a size.
   */
  plannedAmounts: ReadonlyMap<string, PlannedAmount | null>;
}

/**
 * The fit-relevant facts of a loaded recipe — the shape core's
 * `plannedAmountFitsRecipe` takes. The written yield bounds the yields the
 * export bakes, so the fit check can refuse a size whose cooking view does not
 * exist.
 */
function fitInfo(loaded: Recipe): MealPlanRecipeInfo {
  return {
    type: loaded.type,
    ...(loaded.yield_unit !== undefined ? { yieldUnit: loaded.yield_unit } : {}),
    ...(loaded.yield !== undefined ? { yieldQuantity: loaded.yield } : {}),
  };
}

/**
 * Builds the meal-plan cards and the planned-title set. `token` is the Drive
 * access token, needed for the recipe files: one is read per recognized entry,
 * both to check a stated size against the recipe and to carry the recipe's
 * written size onto the card (see MealPlanCard.writtenPlanned).
 */
export async function resolveMealPlan(
  recipes: StoredRecipe[],
  items: KeepItem[],
  token: string,
): Promise<MealPlanResolution> {
  // Recipe titles are unique within the collection (storage_format.md §2), so
  // a title lookup is unambiguous.
  const recipesByTitle = new Map(recipes.map((recipe) => [recipe.title, recipe]));
  /** Per-title cache of the loaded recipe file, or null when unreadable. */
  const fileByTitle = new Map<string, Recipe | null>();

  const readFile = async (recipe: StoredRecipe): Promise<Recipe | null> => {
    const cached = fileByTitle.get(recipe.title);
    if (cached !== undefined) return cached;
    let loaded: Recipe | null = null;
    try {
      // readRecipe parses freshly and shares only the cached raw text, so
      // repeated entries of the same recipe cost no second Drive request.
      loaded = await readRecipe(token, recipe.fileId);
    } catch {
      loaded = null;
    }
    fileByTitle.set(recipe.title, loaded);
    return loaded;
  };

  const cards: MealPlanCard[] = [];
  const plannedRecipeTitles = new Set<string>();
  const plannedAmounts = new Map<string, PlannedAmount | null>();

  for (const [index, item] of items.entries()) {
    if (item.checked) continue; // ticked off in Keep = not planned any more
    const text = item.text.trim();
    if (text === '') continue;

    const parsed = parseMealPlanText(text);
    const recipe = recipesByTitle.get(parsed.title) ?? null;
    let recognized = false;
    /** The loaded file of a recognized entry (its written size is a card fact). */
    let file: Recipe | null = null;
    if (recipe !== null) {
      // The file is read for a recognized entry also when the entry states no
      // size: the card carries the recipe's written size as the fallback the
      // selection shows, and only the file knows it. It is one read per distinct
      // planned recipe (the cache above, plus readRecipe's own raw-text cache),
      // and a size-less entry — a hand-typed Keep line — is not the common case.
      file = await readFile(recipe);
      recognized =
        parsed.planned === null
          ? true // the entry only names the dish: nothing has to fit
          : file !== null && plannedAmountFitsRecipe(parsed.planned, fitInfo(file));
    }
    if (recognized && recipe !== null) {
      plannedRecipeTitles.add(recipe.title);
      // The overview shows the stated size as its "Geplant" value. A dish
      // planned twice is rare; when it happens, the entry that states a size is
      // the more useful one to carry over, so a size-less duplicate never
      // shadows it.
      const previous = plannedAmounts.get(recipe.title);
      if (previous === undefined || (previous === null && parsed.planned !== null)) {
        plannedAmounts.set(recipe.title, parsed.planned);
      }
    }

    cards.push({
      key: `${index}:${text}`,
      text,
      displayText: mealPlanEntryLabel(parsed.title, parsed.planned),
      recipe: recognized ? recipe : null,
      planned: recognized ? parsed.planned : null,
      writtenPlanned: recognized && file !== null ? writtenPlannedAmount(file) : null,
    });
  }

  return { cards, plannedRecipeTitles, plannedAmounts };
}
