/**
 * Meal-plan entry recognition (Google Keep "Essensplan" ↔ Cookbook recipes).
 *
 * The meal plan is a plain Keep checklist, so every item is one line of free
 * text. Cookbook raises an item to a recipe card when its text names an
 * existing recipe file (the file name without `.md`, docs/storage_format.md
 * §2). The entry may carry the size to cook in parentheses after the title, in
 * the form agreed with the user:
 *
 *     Kürbissuppe (6 Portionen)
 *     Béchamelsauce (500 g)
 *     Gemüsebrühe (1,5 l)
 *
 * Number and unit are separated by a space or a narrow no-break space
 * (U+202F) — the typography rule of docs/CODING_CONVENTIONS.md gives the Keep
 * text and the app's own display forms the same shape. Together they must form
 * a size that *fits* the recipe:
 *
 * - a finished dish takes a serving count, and that count must be one of the
 *   ladder's integer standard numbers 1–30 (docs/user_stories.md D2 — the
 *   same options the exported cooking view offers);
 * - an ingredient recipe takes a yield as a ladder value in the recipe's own
 *   family unit: `g` / `kg` for a `g` yield, `ml` / `l` for an `ml` yield
 *   (docs/storage_format.md §3). `kg` / `l` are display forms and are
 *   normalized to the family base unit (`g` / `ml`) here.
 *
 * A text whose parenthetical part does not parse as a number plus a known unit
 * is *not* split: the whole text stays the title candidate, so it never
 * matches a recipe title unless a recipe actually carries that name. That is
 * what keeps "Kürbissuppe (6 Teller)" from being recognized as "Kürbissuppe".
 *
 * Framework-free and deterministic (docs/ARCHITECTURE.md): the web app and the
 * later shopping-list flow both consume it, and it is covered by unit tests.
 */

import { integerLadderValues, pos } from './ladder.js';
import type { RecipeType, Unit } from './recipe/types.js';

/**
 * A size parsed from an entry's yield suffix: either a serving count for a
 * finished dish or a yield in the recipe's family base unit for an ingredient
 * recipe. `kg` / `l` suffixes are already converted (×1000) to `g` / `ml`.
 */
export type PlannedAmount =
  { kind: 'servings'; servings: number } | { kind: 'yield'; quantity: number; baseUnit: Unit };

/** The parsed shape of one meal-plan entry text. */
export interface ParsedMealPlanText {
  /** The entry text as it arrived (trimmed). */
  text: string;
  /** Recipe-title candidate: the text without its yield suffix. */
  title: string;
  /** The parsed size, or null when the text carries no valid suffix. */
  planned: PlannedAmount | null;
}

/**
 * The optional yield suffix, anchored at the end of the entry text:
 * whitespace (space or narrow no-break space) + `(` + number + whitespace +
 * unit word + `)`. The unit is restricted to letters, so a number alone or a
 * free-text note in parentheses is never mistaken for a size. The title part
 * is lazy, so the *last* fitting parenthetical wins and a title that itself
 * ends in one (e.g. "Tiramisu (klassisch)") is kept intact.
 */
const YIELD_SUFFIX =
  /^(?<title>.*?)[\s\u00a0\u202f]+\((?<amount>\d+(?:[.,]\d+)?)[\s\u00a0\u202f]+(?<unit>\p{L}+)\)$/u;

/** Serving words accepted for a finished dish, singular and plural. */
const SERVING_UNITS = new Set(['portion', 'portionen', 'person', 'personen']);

/**
 * Suffix units mapped to a family base unit. `g` / `ml` pass through; `kg` /
 * `l` are display-only forms and carry the ×1000 of the family normalization
 * (docs/storage_format.md §3).
 */
const YIELD_UNITS: ReadonlyMap<string, { baseUnit: Unit; factor: number }> = new Map([
  ['g', { baseUnit: 'g', factor: 1 }],
  ['kg', { baseUnit: 'g', factor: 1000 }],
  ['ml', { baseUnit: 'ml', factor: 1 }],
  ['l', { baseUnit: 'ml', factor: 1000 }],
]);

/** The serving options of a finished dish: integer standard numbers 1–30. */
const SERVING_COUNTS: ReadonlySet<number> = new Set(integerLadderValues(1, 30));

/**
 * Splits one meal-plan entry text into its recipe-title candidate and the
 * optional planned size. The text is trimmed; a suffix that does not parse as
 * a number plus a known unit is left in place (see the module docstring).
 */
export function parseMealPlanText(text: string): ParsedMealPlanText {
  const trimmed = text.trim();
  const match = YIELD_SUFFIX.exec(trimmed);
  if (match === null || match.groups === undefined) {
    return { text: trimmed, title: trimmed, planned: null };
  }
  const title = match.groups.title!.trim();
  const amount = Number(match.groups.amount!.replace(',', '.'));
  const unit = match.groups.unit!.toLowerCase();

  if (SERVING_UNITS.has(unit)) {
    return { text: trimmed, title, planned: { kind: 'servings', servings: amount } };
  }
  const conversion = YIELD_UNITS.get(unit);
  if (conversion === undefined) {
    // Unknown unit word: not a size, so the whole text is the title candidate.
    return { text: trimmed, title: trimmed, planned: null };
  }
  return {
    text: trimmed,
    title,
    planned: {
      kind: 'yield',
      quantity: amount * conversion.factor,
      baseUnit: conversion.baseUnit,
    },
  };
}

/**
 * The recipe facts a planned size has to fit (docs/storage_format.md §3):
 * the type decides whether a serving count or a yield is expected, and for an
 * ingredient recipe the yield's family unit decides `g`/`kg` vs. `ml`/`l`.
 */
export interface MealPlanRecipeInfo {
  type: RecipeType;
  /** ingredient_recipe only: the family base unit of its yield (`g` / `ml`). */
  yieldUnit?: Unit;
}

/**
 * True when a parsed size fits the recipe it was matched against. A text
 * without a suffix (`planned === null`) always fits — the entry only names the
 * dish and takes the recipe as it is. Anything else must be a ladder value in
 * the recipe's own form:
 *
 * - `servings` on a finished dish, one of the integer standard numbers 1–30;
 * - `yield` on an ingredient recipe, in the recipe's own family base unit and
 *   a ladder value (a size off the ladder cannot be scaled deterministically,
 *   docs/quantity_scaling.md §3).
 */
export function plannedAmountFitsRecipe(
  planned: PlannedAmount | null,
  recipe: MealPlanRecipeInfo,
): boolean {
  if (planned === null) {
    return true;
  }
  if (planned.kind === 'servings') {
    return recipe.type === 'finished_dish' && SERVING_COUNTS.has(planned.servings);
  }
  if (recipe.type !== 'ingredient_recipe' || recipe.yieldUnit === undefined) {
    return false;
  }
  if (planned.baseUnit !== recipe.yieldUnit) {
    return false;
  }
  try {
    pos(planned.quantity);
    return true;
  } catch {
    // Not a ladder value (e.g. "499 g"): the size cannot be scaled.
    return false;
  }
}
