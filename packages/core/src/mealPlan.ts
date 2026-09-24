/**
 * Meal-plan entry recognition (Google Keep "Essensplan" ↔ Cookbook recipes).
 *
 * The meal plan is a plain Keep checklist, so every item is one line of free
 * text. Cookbook raises an item to a recipe card when its text names an
 * existing recipe file (the file name without `.md`, docs/storage_format.md §2),
 * and it writes such an item itself when a dish is planned from the app.
 *
 * Two entry shapes are read:
 *
 * **With the export link** — what the app writes today, so the Keep item carries
 * a link to the cooking view (Keep has no hyperlink-with-text, so the raw URL
 * has to stand in the line):
 *
 *     Kürbissuppe: https://<export-host>/exec?f=<id>&portionen=6
 *     Béchamelsauce: https://<export-host>/exec?f=<id>&menge=500g
 *     Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=6
 *
 * The title is everything before the trailing URL, which is separated by a
 * colon; the chosen size rides in the URL — a query parameter on the export
 * host, a fragment on a bare Drive link — and is read back through
 * `plannedFromUrl` (planLink.ts). A link without a size (`Titel: <url>`) names
 * the dish without one, and the export opens at the recipe's written size.
 *
 * **Without the link** — the shape written before the link existed, and still
 * used when a recipe has no export file:
 *
 *     Kürbissuppe (6 Portionen)
 *     Béchamelsauce (500 g)
 *     Gemüsebrühe (1,5 l)
 *
 * Number and unit are separated by a space or a narrow no-break space (U+202F)
 * — the typography rule of docs/CODING_CONVENTIONS.md gives the Keep text and
 * the app's own display forms the same shape.
 *
 * Together the number and its unit must form a size that *fits* the recipe:
 *
 * - a finished dish takes a serving count, and that count must be one of the
 *   ladder's integer standard numbers 1–30 (docs/user_stories.md D2 — the same
 *   options the exported cooking view offers);
 * - an ingredient recipe takes a yield as a ladder value in the recipe's own
 *   family unit: `g` / `kg` for a `g` yield, `ml` / `l` for an `ml` yield
 *   (docs/storage_format.md §3), and inside the range the export actually bakes
 *   (recipe/yieldViews.ts) — a size whose view does not exist would be a
 *   promise the link cannot keep. `kg` / `l` are display forms and are
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
import {
  convertYieldUnit,
  PLAN_FRAGMENT_SERVINGS,
  PLAN_FRAGMENT_YIELD,
  planSizeQuery,
  plannedFromUrl,
  type PlannedAmount,
} from './planLink.js';
import { yieldViewFitsWrittenYield } from './recipe/yieldViews.js';
import type { RecipeType, Unit } from './recipe/types.js';

/** The parsed shape of one meal-plan entry text. */
export interface ParsedMealPlanText {
  /** The entry text as it arrived (trimmed). */
  text: string;
  /** Recipe-title candidate: the text without its link and its size. */
  title: string;
  /** The parsed size, or null when the text states none. */
  planned: PlannedAmount | null;
  /** The export URL the entry carries, or null for a linkless entry. */
  link: string | null;
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

/**
 * A trailing export URL, separated from the title by whitespace and/or a colon
 * (`Titel: https://…`, `Titel https://…`). It must be the *last* token: an
 * entry with text after the URL is not a Cookbook link line and stays one whole
 * title candidate. The title part is lazy, so the last URL wins.
 */
const TRAILING_LINK =
  /^(?<head>[\s\S]*?)(?:[\s\u00a0\u202f]*:)?[\s\u00a0\u202f]+(?<url>https?:\/\/\S+)[\s\u00a0\u202f]*$/u;

/** Serving words accepted for a finished dish, singular and plural. */
const SERVING_UNITS = new Set(['portion', 'portionen', 'person', 'personen']);

/** The serving options of a finished dish: integer standard numbers 1–30. */
const SERVING_COUNTS: ReadonlySet<number> = new Set(integerLadderValues(1, 30));

/**
 * Splits a text without a link into its recipe-title candidate and the optional
 * size suffix. A suffix that does not parse as a number plus a known unit is
 * left in place (see the module docstring).
 */
function parseYieldSuffix(text: string): { title: string; planned: PlannedAmount | null } {
  const match = YIELD_SUFFIX.exec(text);
  if (match === null || match.groups === undefined) {
    return { title: text, planned: null };
  }
  const title = match.groups.title!.trim();
  const amount = Number(match.groups.amount!.replace(',', '.'));
  const unit = match.groups.unit!.toLowerCase();

  if (SERVING_UNITS.has(unit)) {
    return { title, planned: { kind: 'servings', servings: amount } };
  }
  const conversion = convertYieldUnit(unit);
  if (conversion === undefined) {
    // Unknown unit word: not a size, so the whole text is the title candidate.
    return { title: text, planned: null };
  }
  return {
    title,
    planned: {
      kind: 'yield',
      quantity: amount * conversion.factor,
      baseUnit: conversion.baseUnit,
    },
  };
}

/**
 * Splits one meal-plan entry text into its recipe-title candidate, the optional
 * planned size and the optional export link (see the module docstring). The
 * text is trimmed; a size in the link's fragment wins over a parenthetical
 * suffix, and a suffix that does not parse is left in the title candidate.
 */
export function parseMealPlanText(text: string): ParsedMealPlanText {
  const trimmed = text.trim();

  const linkMatch = TRAILING_LINK.exec(trimmed);
  let head = trimmed;
  let link: string | null = null;
  if (linkMatch !== null && linkMatch.groups !== undefined) {
    const candidate = linkMatch.groups.head!.trim();
    // A line that is nothing but a URL names no dish, so it stays an ordinary
    // (unrecognized) title candidate.
    if (candidate !== '') {
      head = candidate;
      link = linkMatch.groups.url!;
    }
  }

  if (link !== null) {
    const fromUrl = plannedFromUrl(link);
    if (fromUrl !== null) {
      return { text: trimmed, title: head, planned: fromUrl, link };
    }
    // A hand-written link may still carry the old parenthetical size.
    const suffix = parseYieldSuffix(head);
    return { text: trimmed, title: suffix.title, planned: suffix.planned, link };
  }

  const suffix = parseYieldSuffix(trimmed);
  return { text: trimmed, title: suffix.title, planned: suffix.planned, link: null };
}

/**
 * The recipe facts a planned size has to fit (docs/storage_format.md §3):
 * the type decides whether a serving count or a yield is expected, the family
 * unit decides `g`/`kg` vs. `ml`/`l`, and for an ingredient recipe the written
 * yield bounds the yields the export bakes (recipe/yieldViews.ts).
 */
export interface MealPlanRecipeInfo {
  type: RecipeType;
  /** ingredient_recipe only: the family base unit of its yield (`g` / `ml`). */
  yieldUnit?: Unit;
  /**
   * ingredient_recipe only: the written yield in the family base unit. Without
   * it the range check is skipped (a caller that does not know the yield cannot
   * rule a size out), but every app path passes it.
   */
  yieldQuantity?: number;
}

/**
 * True when a parsed size fits the recipe it was matched against. A text
 * without a size (`planned === null`) always fits — the entry only names the
 * dish and takes the recipe as it is. Anything else must be a value in the
 * recipe's own form:
 *
 * - `servings` on a finished dish, one of the integer standard numbers 1–30;
 * - `yield` on an ingredient recipe, in the recipe's own family base unit, a
 *   ladder value (a size off the ladder cannot be scaled deterministically,
 *   docs/quantity_scaling.md §3) and within the export's baked range, so the
 *   entry's link can open exactly that amount.
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
  } catch {
    // Not a ladder value (e.g. "499 g"): the size cannot be scaled.
    return false;
  }
  return recipe.yieldQuantity === undefined
    ? true
    : yieldViewFitsWrittenYield(planned.quantity, recipe.yieldQuantity);
}

/**
 * The display text of a planned size: a serving count ("6 Portionen", "1
 * Portion") or a yield in the recipe's family unit ("500 g", "1,5 l"). Number
 * and unit are joined with a narrow no-break space
 * (docs/CODING_CONVENTIONS.md), and a yield goes through `formatBQ`, so it steps
 * g→kg / ml→l and uses the German decimal comma.
 *
 * This is the one formatter of a meal-plan size: the recipe overview's "Geplant"
 * value and the write path's fallback entry suffix both use it, so what the app
 * shows is exactly what `parseMealPlanText` reads back.
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
 * The human form of an entry: the title plus its size in the old parenthetical
 * shape ("Kürbissuppe (6 Portionen)"), without the export link. This is what
 * the plan card shows and searches, and what the success notice names — the
 * Keep line itself is `<Titel>: <URL>` and reads poorly outside Keep.
 */
export function mealPlanEntryLabel(title: string, planned: PlannedAmount | null): string {
  return planned === null ? title : `${title} (${formatPlannedAmount(planned)})`;
}

/**
 * Gives `url` the size of `planned`, replacing a size the URL already carries
 * (a hand-edited link): this write's size is the only truth, and two would let
 * the reader pick the stale one.
 *
 * The separator follows the URL's shape. An export-host URL already has a query
 * (`?f=<fileId>`) and takes the size as another parameter (`&portionen=6`); a
 * bare Drive viewer URL takes it as the fragment (`#portionen=6`), the shape its
 * page could read if it ran the export's script at all. `plannedFromUrl` reads
 * both back.
 */
function withPlanSize(url: string, planned: PlannedAmount): string {
  const [withoutFragment = url] = url.split('#', 1);
  const [path = withoutFragment, query] = withoutFragment.split('?', 2);
  const keptParams = (query ?? '')
    .split('&')
    .filter(
      (part) =>
        part !== '' &&
        !part.startsWith(`${PLAN_FRAGMENT_SERVINGS}=`) &&
        !part.startsWith(`${PLAN_FRAGMENT_YIELD}=`),
    );
  const base = keptParams.length > 0 ? `${path}?${keptParams.join('&')}` : path;
  const separator = keptParams.length > 0 ? '&' : '#';
  return `${base}${separator}${planSizeQuery(planned)}`;
}

/**
 * The meal-plan entry for a dish at a chosen size.
 *
 * With an export URL, the entry is `<Titel>: <URL>` and the size rides in the
 * URL — "Kürbissuppe: https://<host>/exec?f=<id>&portionen=6",
 * "Béchamelsauce: https://<host>/exec?f=<id>&menge=500g". The Keep item is then
 * a tappable link to the cooking view that opens at exactly that size.
 *
 * Without a URL (the recipe has no export file) the entry falls back to the
 * parenthetical shape — "Kürbissuppe (6 Portionen)" — which the parser reads
 * just the same. The written line is the exact inverse of `parseMealPlanText`:
 * parsing it back yields the title and the same `PlannedAmount`.
 */
export function mealPlanEntryText(
  title: string,
  planned: PlannedAmount,
  exportUrl?: string,
): string {
  if (exportUrl === undefined || exportUrl.trim() === '') {
    return `${title} (${formatPlannedAmount(planned)})`;
  }
  return `${title}: ${withPlanSize(exportUrl.trim(), planned)}`;
}

/**
 * The texts of every meal-plan line that names `title` — checked or not, with
 * or without a link, and whatever size it states.
 *
 * This is the write's removal rule: before the new entry is added, the app drops
 * every other instance of the recipe, so the dish ends up on the plan exactly
 * once. A line is an instance when its *title candidate* — the text without a
 * size suffix and without the export link — equals `title`. The parser decides
 * that: a parenthetical that is not a number plus a known unit stays part of
 * the title, so "Kürbissuppe (6 Teller)" is not an instance of "Kürbissuppe"
 * and is left alone.
 *
 * Deliberately broader than the card recognition: the fit check (recipe type,
 * family unit, ladder value, baked range) decides what can be *scaled*, not what
 * is a duplicate. And the caller passes every Keep item, checked ones included —
 * a ticked-off line is hidden from the card view but is still a duplicate in
 * Keep. The returned texts are trimmed, because the comparison is on the content
 * and not on Keep's surrounding whitespace.
 */
export function mealPlanEntriesForTitle(texts: readonly string[], title: string): string[] {
  return texts
    .map((text) => text.trim())
    .filter((text) => text !== '' && parseMealPlanText(text).title === title);
}
