/**
 * Shared ingredient display helpers.
 *
 * The editor's ingredient lists and the meal-plan overlay render the same
 * ingredient rows, so the display wording must come from one place — a second
 * copy could drift into a different arrangement or unit form.
 */

import { NNBSP, renderAQS, type Unit } from '@cookbook/core';

/**
 * `renderAQS` with a defensive fallback: an ingredient whose display form
 * cannot be derived (e.g. the master data is not loaded) falls back to the
 * plain base form instead of breaking the view. Both paths join number and unit
 * with the narrow no-break space (docs/CODING_CONVENTIONS.md); the fallback is
 * deliberately built here rather than through `formatBQ`, because it must never
 * throw again.
 */
export function safeRenderAQS(name: string, quantity: number, unit: Unit): string {
  try {
    return renderAQS(name, quantity, unit);
  } catch {
    return `${quantity}${NNBSP}${unit} ${name}`;
  }
}
