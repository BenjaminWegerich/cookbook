/**
 * Display forms of inline text artifacts (docs/storage_format.md §4).
 *
 * One artifact is derived in one place, but a size marker has two deliberately
 * different surfaces:
 *
 * - `prose` (step text, editor chip, size-mark sheet preview) is a sentence
 *   slot: the article, the written number and the noun follow the stored case;
 * - `readout` (the reference readout) is a bare nominative amount label: a
 *   count of 1 is omitted, 2+ keep the numeral.
 *
 * This module turns an artifact plus a recipe factor and a surface into an
 * {@link ArrangementDisplay}, so the two surfaces share the scaling law and
 * cannot drift on the count/size:
 *
 * - a quantity artifact scales by the exact recipe factor and uses the normal
 *   optimizer (ingredient mention: `renderAQS`, quantity-only: `formatBQ`,
 *   unitless count: `optimizeUnitless`);
 * - a size marker ignores the linear factor and applies its own marker scaling
 *   law through ../sizeMarkers.ts.
 *
 * A quantity artifact may carry the optional per-artifact precision (the
 * quantity-level override). A size marker has no precision by design.
 */

import {
  formatAQValue,
  formatBQ,
  formatDecimal,
  renderAQSDisplay,
  type ArrangementDisplay,
} from '../additionalUnits.js';
import type { PrecisionContext } from '../precision.js';
import { optimizeUnitless } from '../quantityOptimizer.js';
import {
  resolveSizeMarker,
  sizeMarkerFallbackText,
  type SizeMarkerSurface,
} from '../sizeMarkers.js';
import type { TextArtifact } from './artifacts.js';

/** The precision context an artifact passes down (the quantity-level override). */
function artifactContext(artifact: TextArtifact): PrecisionContext {
  if (artifact.kind !== 'quantity' || artifact.precision === undefined) return {};
  return { quantity: artifact.precision };
}

/**
 * One artifact's display at a recipe factor.
 *
 * @param artifact the parsed artifact
 * @param factor exact recipe scale factor (requested / written size); 1 for
 *   the written recipe (the editor's chips)
 * @param surface prose (default) or the reference readout; quantity artifacts
 *   ignore it
 * @returns the display runs; a size marker whose master data is missing falls
 *   back to its written text, like the export
 */
export function artifactDisplay(
  artifact: TextArtifact,
  factor: number,
  surface: SizeMarkerSurface = 'prose',
): ArrangementDisplay {
  if (artifact.kind === 'size') {
    const resolved = resolveSizeMarker(artifact, factor, { surface });
    const text = resolved === undefined ? sizeMarkerFallbackText(artifact) : resolved.text;
    return { text, parts: [{ kind: 'text', value: text }] };
  }

  const quantity = artifact.quantity * factor;
  const context = artifactContext(artifact);
  if (artifact.name !== undefined) {
    return renderAQSDisplay(artifact.name, quantity, artifact.unit ?? 'g', context);
  }
  if (artifact.unit !== undefined) {
    const text = formatBQ(quantity, artifact.unit);
    return { text, parts: [{ kind: 'text', value: text }] };
  }
  const result = optimizeUnitless(quantity, context);
  const text =
    result.notation === undefined ? formatDecimal(result.value) : formatAQValue(result.value);
  return { text, parts: [{ kind: 'text', value: text }] };
}
