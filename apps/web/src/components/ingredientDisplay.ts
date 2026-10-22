/**
 * Shared ingredient display helpers.
 *
 * The editor's ingredient lists and the meal-plan overlay render the same
 * ingredient rows, so the display wording must come from one place — a second
 * copy could drift into a different arrangement or unit form.
 */

import {
  NNBSP,
  renderAQS,
  renderAQSDisplay,
  type ArrangementDisplay,
  type ToleranceContext,
  type Unit,
} from '@cookbook/core';

/**
 * `renderAQS` with a defensive fallback: an ingredient whose display form
 * cannot be derived (e.g. the master data is not loaded) falls back to the
 * plain base form instead of breaking the view. Both paths join number and unit
 * with the narrow no-break space (docs/CODING_CONVENTIONS.md); the fallback is
 * deliberately built here rather than through `formatBQ`, because it must never
 * throw again.
 *
 * Used by the reference readouts, which stay plain muted text
 * (docs/DESIGN.md §5.11) and therefore do not split the arrangement's note.
 */
export function safeRenderAQS(
  name: string,
  quantity: number,
  unit: Unit,
  context: ToleranceContext = {},
): string {
  try {
    return renderAQS(name, quantity, unit, context);
  } catch {
    return `${quantity}${NNBSP}${unit} ${name}`;
  }
}

/**
 * `renderAQSDisplay` with the same defensive fallback as `safeRenderAQS`: a
 * failed display form becomes one plain text run, so an ingredient row never
 * breaks the view over missing master data.
 *
 * Used by the ingredient lists and the amount previews, which render the
 * arrangement's note as a muted, italic aside (`ArrangementLine`).
 */
export function safeRenderAQSDisplay(
  name: string,
  quantity: number,
  unit: Unit,
  context: ToleranceContext = {},
): ArrangementDisplay {
  try {
    return renderAQSDisplay(name, quantity, unit, context);
  } catch {
    const text = `${quantity}${NNBSP}${unit} ${name}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
}
