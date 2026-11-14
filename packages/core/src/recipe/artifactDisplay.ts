/**
 * Display forms of inline text artifacts (docs/storage_format.md §4).
 *
 * One artifact renders the same way wherever it appears: in the step prose, on
 * the editor's chip, and in the reference readout of a scaled recipe. This
 * module is the single place that turns an artifact plus a recipe factor into
 * an {@link ArrangementDisplay}, so those three surfaces cannot drift apart.
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
import { resolveSizeMarker, sizeMarkerFallbackText } from '../sizeMarkers.js';
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
 * @returns the display runs; a size marker whose master data is missing falls
 *   back to its written text, like the export
 */
export function artifactDisplay(artifact: TextArtifact, factor: number): ArrangementDisplay {
  if (artifact.kind === 'size') {
    const resolved = resolveSizeMarker(artifact, factor);
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
