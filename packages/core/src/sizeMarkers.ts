/**
 * Size markers — display-only equipment sizes that scale with the recipe.
 *
 * A size marker is a third kind of inline artifact beside an ingredient use and
 * a plain quantity (docs/storage_format.md §4):
 *
 *   {{1 26 cm Backring|size}}      one 26 cm ring
 *   {{2 20 cm Backring|size}}      a written recipe that already uses two
 *
 * The recipe stores the written arrangement (count + nominal size). Scaling is
 * derived at render time from the same exact factor that scales the
 * ingredients. The scaling law belongs to the marker definition, not to the
 * recipe:
 *
 * - `linear` — the size is proportional to the quantity (exponent 1);
 * - `area`   — the quantity is proportional to the size squared (exponent 2),
 *              e.g. a round cake ring whose height stays constant;
 * - `volume` — the quantity is proportional to the size cubed (exponent 3).
 *
 * For `area` a doubled recipe therefore increases the ring's diameter by √2,
 * not by 2. The diameter is a physical dimension; the *batter quantity* is the
 * quadratic quantity the user sees in the ingredient list.
 *
 * Count rule: if the calculated equivalent diameter exceeds the largest
 * available size, the batter is split into equal molds. `N` is the smallest
 * number of molds whose ideal per-mold diameter still fits the largest size;
 * the nominal size is then the nearest available one (relative distance, tie
 * to the larger size). This is the “above 30 I use multiple cakes” rule, made
 * data-driven by the marker's `Sizes` list.
 *
 * Precision is deliberately absent: there is no BQ/AQ candidate to score and
 * no target amount to display differently. The result is fully determined by
 * the marker definition, the written arrangement and the recipe factor.
 */

import { formatDecimal } from './additionalUnits.js';
import {
  SIZE_MARKERS,
  type SizeMarkerDefinition,
  type SizeMarkerScale,
} from './sizeMarkersData.js';

/** Exponent of each scaling law: quantity ∝ size^exponent. */
const SCALE_EXPONENTS: Readonly<Record<SizeMarkerScale, number>> = {
  linear: 1,
  area: 2,
  volume: 3,
};

/** Floating-point noise guard for the ceiling count and the nearest-size tie. */
const EPSILON = 1e-9;

/** The current marker registry; starts as the built-in seed. */
let registry: readonly SizeMarkerDefinition[] = SIZE_MARKERS;

/** One size marker use as stored in the recipe (a structural subset of the artifact). */
export interface SizeMarkerUse {
  /** Canonical marker key, e.g. `Backring`. */
  readonly marker: string;
  /** Written count of molds (a positive integer). */
  readonly count: number;
  /** Written nominal size of one mold, in the marker's unit. */
  readonly size: number;
}

/**
 * The derived display of one size marker at a recipe size.
 *
 * `idealSize` is the exact per-mold size before snapping to the available list;
 * it is kept for the live preview (e.g. “rechnerisch 22,5 cm”) and tests. The
 * displayed `size` is always one of the marker's allowed nominal sizes.
 */
export interface ResolvedSizeMarker {
  /** Number of equal molds to use (always at least 1). */
  readonly count: number;
  /** Nominal size of one mold, chosen from the marker's allowed sizes. */
  readonly size: number;
  /** Exact per-mold size before snapping (calculated, not displayed). */
  readonly idealSize: number;
  /** Complete display text, e.g. `2 22er Backringe`. */
  readonly text: string;
}

/** All registered size markers, in master-data order. */
export function allSizeMarkers(): readonly SizeMarkerDefinition[] {
  return registry;
}

/** The definition of one marker, or undefined when the key is unknown. */
export function sizeMarkerFor(marker: string): SizeMarkerDefinition | undefined {
  const key = marker.trim();
  return registry.find((definition) => definition.marker === key);
}

/**
 * Replaces the whole marker registry (used later when the collection's master
 * data is loaded from Drive). The built-in seed remains the default.
 */
export function setSizeMarkers(markers: readonly SizeMarkerDefinition[]): void {
  registry = markers;
}

/** Restores the built-in seed (used by tests between cases). */
export function resetSizeMarkers(): void {
  registry = SIZE_MARKERS;
}

/**
 * The nearest allowed nominal size to `ideal`, by relative distance (the same
 * log-distance idea as the quantity optimizer). A tie goes to the larger size,
 * mirroring the optimizer's higher-BQ tie-break; a value below the smallest
 * entry therefore snaps up to the smallest mold.
 */
function nearestSize(sizes: readonly number[], ideal: number): number {
  let best = sizes[0]!;
  let bestDistance = Math.abs(Math.log(best / ideal));
  for (const size of sizes.slice(1)) {
    const distance = Math.abs(Math.log(size / ideal));
    if (distance < bestDistance - EPSILON) {
      best = size;
      bestDistance = distance;
    } else if (Math.abs(distance - bestDistance) <= EPSILON && size > best) {
      best = size;
    }
  }
  return best;
}

/**
 * Formats one derived arrangement with the marker's display pattern.
 *
 * The pattern always contains `<N>`, so even a count of 1 reads `1 26er
 * Backring`; `<INF>` selects the singular or plural noun and `<UNIT>` exposes
 * the stored unit for markers whose pattern needs it (e.g. `30 cm Kastenform`).
 */
export function formatSizeMarker(
  definition: SizeMarkerDefinition,
  count: number,
  size: number,
): string {
  const noun = count === 1 ? definition.singular : definition.plural;
  return definition.pattern
    .replaceAll('<N>', String(count))
    .replaceAll('<SIZE>', formatDecimal(size))
    .replaceAll('<UNIT>', definition.unit)
    .replaceAll('<INF>', noun);
}

/**
 * Derives the displayed arrangement for one marker use at a recipe factor.
 *
 * @param use the written arrangement (marker key, count, nominal size)
 * @param factor exact recipe scale factor (requested / written size)
 * @returns the derived display, or undefined for an unknown marker, an
 *   invalid factor, or a non-positive base count/size (draft data). Callers
 *   fall back to the written text in that case; validation reports the issue.
 */
export function resolveSizeMarker(
  use: SizeMarkerUse,
  factor: number,
): ResolvedSizeMarker | undefined {
  const definition = sizeMarkerFor(use.marker);
  if (definition === undefined) return undefined;
  if (!Number.isFinite(factor) || factor <= 0) return undefined;
  if (!Number.isInteger(use.count) || use.count < 1) return undefined;
  if (!Number.isFinite(use.size) || use.size <= 0) return undefined;

  const sizes = definition.sizes;
  if (sizes.length === 0) return undefined;
  const largest = sizes[sizes.length - 1]!;
  const exponent = SCALE_EXPONENTS[definition.scale];

  // f = 1 is the written recipe: keep its arrangement identity, even when a
  // larger available mold would happen to cover the same area with fewer molds.
  if (factor === 1) {
    return {
      count: use.count,
      size: use.size,
      idealSize: use.size,
      text: formatSizeMarker(definition, use.count, use.size),
    };
  }

  // Quantity proxy: the total batter area/volume the written arrangement
  // represents, scaled by the recipe factor. Splitting into N equal molds
  // divides it by N.
  const total = factor * use.count * use.size ** exponent;
  const rawCount = total / largest ** exponent;
  const count = Math.max(1, Math.ceil(rawCount - EPSILON));
  const idealSize = (total / count) ** (1 / exponent);
  const size = nearestSize(sizes, idealSize);

  return {
    count,
    size,
    idealSize,
    text: formatSizeMarker(definition, count, size),
  };
}

/**
 * The written text of a size artifact, used as a safe fallback while a draft
 * references an unknown marker or an invalid arrangement. It never throws and
 * never consults the registry.
 */
export function sizeMarkerFallbackText(use: SizeMarkerUse & { readonly unit: string }): string {
  return `${use.count} ${formatDecimal(use.size)} ${use.unit} ${use.marker}`;
}
