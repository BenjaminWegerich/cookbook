/**
 * The link between a meal-plan entry and the recipe's HTML export.
 *
 * A Cookbook-written meal-plan line is `<Titel>: <Export-URL>`, and the chosen
 * size rides in the URL's fragment:
 *
 *     Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=6
 *     Béchamelsauce: https://drive.google.com/file/d/<id>/view#menge=500g
 *
 * Why the fragment and not just the line text: Google Keep has no
 * hyperlink-with-text, so the raw URL has to stand in the line, and the size
 * must therefore live somewhere the URL can carry. The fragment is the one
 * place the writer saves, the app reads back and the exported page's embedded
 * script can read as well — the app shows the planned size from it, and the
 * cooking view opens on it without any runtime scaling.
 *
 * Both keys and both directions live here so the writer (`mealPlan.ts`), the
 * reader (`mealPlan.ts` and the app) and the export's script cannot drift.
 * `#portionen` carries an integer serving count; `#menge` a base quantity in
 * the family unit (`g` / `ml`). `kg` / `l` are accepted on read and normalized,
 * so a hand-written link keeps working. A URL without a fragment names the dish
 * without a size: the export opens at the recipe's written size.
 */

import type { Unit } from './recipe/types.js';

/** URL fragment key that carries a serving count (`#portionen=6`). */
export const PLAN_FRAGMENT_SERVINGS = 'portionen';
/** URL fragment key that carries a yield in the family unit (`#menge=500g`). */
export const PLAN_FRAGMENT_YIELD = 'menge';

/**
 * A size parsed from a meal-plan entry: either a serving count for a finished
 * dish or a yield in the recipe's family base unit for an ingredient recipe.
 * `kg` / `l` suffixes are already converted (×1000) to `g` / `ml`.
 */
export type PlannedAmount =
  { kind: 'servings'; servings: number } | { kind: 'yield'; quantity: number; baseUnit: Unit };

/**
 * Suffix units mapped to a family base unit. `g` / `ml` pass through; `kg` /
 * `l` are display-only forms and carry the ×1000 of the family normalization
 * (docs/storage_format.md §3). Shared by the fragment reader and the legacy
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
 * Formats a quantity for a URL fragment: the plain decimal with a dot, in the
 * family base unit (e.g. `500`, `1.5`). Every stored quantity is a ladder BQ
 * value with at most two decimals, so `String` is exact — no rounding layer is
 * needed, and the same form is used for the export's `data-yield` attribute, so
 * the fragment value and the pre-rendered view always agree.
 */
export function formatLinkQuantity(quantity: number): string {
  return String(quantity);
}

/** The URL fragment that carries `planned` (`#portionen=6`, `#menge=500g`). */
export function planFragment(planned: PlannedAmount): string {
  if (planned.kind === 'servings') {
    return `#${PLAN_FRAGMENT_SERVINGS}=${planned.servings}`;
  }
  return `#${PLAN_FRAGMENT_YIELD}=${formatLinkQuantity(planned.quantity)}${planned.baseUnit}`;
}

/**
 * Reads the planned size out of an export URL's fragment, or null when the URL
 * carries none (a hand-written link, or an entry that names the dish without a
 * size). Numbers may use a comma or a dot — the fragment is written with a dot,
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
