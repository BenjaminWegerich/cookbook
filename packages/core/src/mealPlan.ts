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

import { NNBSP, formatBQ, formatDecimal } from './additionalUnits.js';
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

/**
 * The display text of a planned size: a serving count ("6 Portionen", "1
 * Portion") or a yield in the recipe's family unit ("500 g", "1,5 l"). Number
 * and unit are joined with a narrow no-break space
 * (docs/CODING_CONVENTIONS.md), and a yield goes through `formatBQ`, so it steps
 * g→kg / ml→l and uses the German decimal comma.
 *
 * This is the one formatter of a meal-plan size: the recipe overview's "Geplant"
 * value and the write path's entry suffix both use it, so what the app shows is
 * exactly what `parseMealPlanText` reads back.
 */
export function formatPlannedAmount(planned: PlannedAmount): string {
  if (planned.kind === 'servings') {
    // Serving counts are the integer standard numbers 1–30 (SERVING_COUNTS).
    const word = planned.servings === 1 ? 'Portion' : 'Portionen';
    return `${formatDecimal(planned.servings)}${NNBSP}${word}`;
  }
  return formatBQ(planned.quantity, planned.baseUnit);
}

/**
 * The meal-plan entry for a dish at a chosen size: the recipe title plus the
 * size suffix the parser expects — "Kürbissuppe (6 Portionen)",
 * "Béchamelsauce (500 g)", "Gemüsebrühe (1,5 l)". The space before the
 * parenthesis is a plain space, which is one of the separators the parser
 * accepts (the module docstring).
 *
 * The exact inverse of `parseMealPlanText`: parsing this text back yields the
 * recipe title and the same `PlannedAmount`, so a written entry is recognized
 * again by the app that wrote it.
 */
export function mealPlanEntryText(title: string, planned: PlannedAmount): string {
  return `${title} (${formatPlannedAmount(planned)})`;
}

/**
 * The texts of every meal-plan line that names `title` — checked or not, and
 * whatever size it states.
 *
 * This is the write's removal rule: before the new entry is added, the app drops
 * every other instance of the recipe, so the dish ends up on the plan exactly
 * once. A line is an instance when its *title candidate* — the text without a
 * parsed size suffix — equals `title`. The parser decides that: a parenthetical
 * that is not a number plus a known unit stays part of the title, so
 * "Kürbissuppe (6 Teller)" is not an instance of "Kürbissuppe" and is left alone.
 *
 * Deliberately broader than the card recognition: the fit check (recipe type,
 * family unit, ladder value) decides what can be *scaled*, not what is a
 * duplicate. And the caller passes every Keep item, checked ones included — a
 * ticked-off line is hidden from the card view but is still a duplicate in Keep.
 * The returned texts are trimmed, because the comparison is on the content and
 * not on Keep's surrounding whitespace.
 */
export function mealPlanEntriesForTitle(texts: readonly string[], title: string): string[] {
  return texts
    .map((text) => text.trim())
    .filter((text) => text !== '' && parseMealPlanText(text).title === title);
}
