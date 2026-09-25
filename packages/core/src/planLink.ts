/**
 * The link between a meal-plan entry and the recipe's HTML export.
 *
 * A Cookbook-written meal-plan line is `<Titel>: <Export-URL>`, and the chosen
 * size rides in that URL:
 *
 *     Kürbissuppe: https://<export-host>/exec?f=<id>&portionen=6
 *     Béchamelsauce: https://<export-host>/exec?f=<id>&menge=500g
 *     Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=6
 *
 * The host form is the one the app writes: Keep has no hyperlink-with-text, so
 * the raw URL has to stand in the line, and only a page the export host serves
 * itself can run the cooking view's script. A Drive link renders the file
 * without its script (observed in Keep's in-app browser, where the serving and
 * step buttons stay dead) and does not pass the fragment through, so both the
 * size and the controls are lost there. The Drive form stays supported for a
 * build without a host.
 *
 * Both keys and both directions live here so the writer (`mealPlan.ts`), the
 * reader (`mealPlan.ts` and the app) and the export's script cannot drift.
 * `portionen` carries an integer serving count; `menge` a base quantity in the
 * family unit (`g` / `ml`). `kg` / `l` are accepted on read and normalized, so
 * a hand-written link keeps working. A URL without a size names the dish
 * without one: the export opens at the recipe's written size.
 */

import type { Recipe, Unit } from './recipe/types.js';

/** URL parameter that carries a serving count (`portionen=6`). */
export const PLAN_FRAGMENT_SERVINGS = 'portionen';
/** URL parameter that carries a yield in the family unit (`menge=500g`). */
export const PLAN_FRAGMENT_YIELD = 'menge';
/**
 * Id of the `<style>` element the export host injects to preselect the promised
 * size before (or without) the page's script. The host spells the id out — it
 * runs in Apps Script, which cannot import this module — so the name is kept
 * here and in `apps/export-host/Code.gs`, and both sides must change together.
 */
export const PLAN_PRESELECT_ELEMENT_ID = 'cookbook-preselect';

/**
 * A size parsed from a meal-plan entry: either a serving count for a finished
 * dish or a yield in the recipe's family base unit for an ingredient recipe.
 * `kg` / `l` suffixes are already converted (×1000) to `g` / `ml`.
 */
export type PlannedAmount =
  { kind: 'servings'; servings: number } | { kind: 'yield'; quantity: number; baseUnit: Unit };

/**
 * The size a recipe is written in, in the shape a meal-plan entry states a size:
 * a finished dish's serving count, an ingredient recipe's yield in its family
 * base unit (`g` / `ml`; `kg` / `l` are display forms, docs/storage_format.md §3).
 *
 * This is what a meal-plan entry *without* a size means. Its link carries no
 * size, so the export opens at the written size, and the "Einplanen" overlay
 * starts on it. Anything that has to name the size a planned dish is really
 * cooked at therefore falls back to it: the recipe overview's "Geplant" value
 * and the shopping-list selection (the overview has the loaded recipe, the
 * selection reads it through keep/mealPlanCards).
 *
 * The defaults (1 serving, 1000 g / ml) only apply to a recipe that states no
 * size at all, which the storage format does not allow (docs/storage_format.md
 * §4). They exist so a caller never has to invent a number, and they are the
 * same starting values the "Einplanen" overlay pre-selects.
 */
export function writtenPlannedAmount(recipe: Recipe): PlannedAmount {
  if (recipe.type === 'finished_dish') {
    return { kind: 'servings', servings: recipe.servings ?? 1 };
  }
  // The yield goes through the same family conversion a size parsed from a link
  // takes, so `kg` / `l` land in the base unit with their ×1000 — a parsed
  // recipe is already normalized (recipe/parse.ts), but this module must not
  // depend on the caller having gone through the parser.
  const conversion = convertYieldUnit(recipe.yield_unit ?? 'g');
  return {
    kind: 'yield',
    quantity: (recipe.yield ?? 1000) * (conversion?.factor ?? 1),
    baseUnit: conversion?.baseUnit ?? 'g',
  };
}

/**
 * Suffix units mapped to a family base unit. `g` / `ml` pass through; `kg` /
 * `l` are display-only forms and carry the ×1000 of the family normalization
 * (docs/storage_format.md §3). Shared by the URL reader and the legacy
 * parenthetical parser (`mealPlan.ts`).
 */
export function convertYieldUnit(unit: string): { baseUnit: Unit; factor: number } | undefined {
  switch (unit.toLowerCase()) {
    case 'g':
      return { baseUnit: 'g', factor: 1 };
    case 'kg':
      return { baseUnit: 'g', factor: 1000 };
    case 'ml':
      return { baseUnit: 'ml', factor: 1 };
    case 'l':
      return { baseUnit: 'ml', factor: 1000 };
    default:
      return undefined;
  }
}

/**
 * Formats a quantity for a URL: the plain decimal with a dot, in the family
 * base unit (e.g. `500`, `1.5`). Every stored quantity is a ladder BQ value with
 * at most two decimals, so `String` is exact — no rounding layer is needed, and
 * the same form is used for the export's `data-yield` attribute, so the URL
 * value and the pre-rendered view always agree.
 */
export function formatLinkQuantity(quantity: number): string {
  return String(quantity);
}

/**
 * The size of `planned` as a bare URL parameter (`portionen=6`, `menge=500g`).
 * The caller decides the separator: a host URL (`?f=…`) takes it as another
 * query parameter, a bare Drive viewer URL as the fragment.
 */
export function planSizeQuery(planned: PlannedAmount): string {
  if (planned.kind === 'servings') {
    return `${PLAN_FRAGMENT_SERVINGS}=${planned.servings}`;
  }
  return `${PLAN_FRAGMENT_YIELD}=${formatLinkQuantity(planned.quantity)}${planned.baseUnit}`;
}

/**
 * Reads the planned size out of an export URL, or null when the URL carries
 * none (a hand-written link, or an entry that names the dish without a size).
 * Both the query form the export host uses and the fragment form of a Drive
 * link are accepted. Numbers may use a comma or a dot — the app writes a dot,
 * but a hand-edited link should not fail on the German form.
 */
export function plannedFromUrl(url: string): PlannedAmount | null {
  const servings = new RegExp(`(?:^|[#&])${PLAN_FRAGMENT_SERVINGS}=(\\d+)(?![.,\\d])`).exec(url);
  if (servings !== null) {
    return { kind: 'servings', servings: Number(servings[1]) };
  }
  const yieldMatch = new RegExp(
    `(?:^|[#&])${PLAN_FRAGMENT_YIELD}=(\\d+(?:[.,]\\d+)?)(\\p{L}+)`,
    'u',
  ).exec(url);
  if (yieldMatch === null) {
    return null;
  }
  const quantity = Number(yieldMatch[1]!.replace(',', '.'));
  const conversion = convertYieldUnit(yieldMatch[2]!);
  if (conversion === undefined || !(quantity > 0)) {
    return null;
  }
  return { kind: 'yield', quantity: quantity * conversion.factor, baseUnit: conversion.baseUnit };
}

/**
 * Gives `url` the size of `planned`, replacing a size the URL already carries
 * (a hand-edited link): the caller's size is the only truth, and two would let
 * the reader pick the stale one.
 *
 * The separator follows the URL's shape. An export-host URL already has a query
 * (`?f=<fileId>`) and takes the size as another parameter (`&portionen=6`); a
 * bare Drive viewer URL takes it as the fragment (`#portionen=6`), the shape its
 * page could read if it ran the export's script at all. `plannedFromUrl` reads
 * both back.
 *
 * This is also the target the app hands to the link shortener: the short link's
 * *target* must carry the size, because a redirect does not reliably forward a
 * fragment or an extra parameter, so the size is baked in before shortening.
 */
export function withPlanSize(url: string, planned: PlannedAmount): string {
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
