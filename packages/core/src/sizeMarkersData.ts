/**
 * AUTO-GENERATED from docs/size_markers.csv by
 * scripts/generate-size-markers.mjs.
 * Do not edit by hand — re-run 'npm run generate:size-markers' (packages/core)
 * after a CSV change.
 */

/** How the marker's nominal size follows the recipe quantity. */
export type SizeMarkerScale =
  /** The size itself is proportional to the quantity (exponent 1). */
  | 'linear'
  /** The quantity is proportional to the size squared (exponent 2), e.g. a
   *  round cake ring whose height stays constant. */
  | 'area'
  /** The quantity is proportional to the size cubed (exponent 3), e.g. a
   *  geometrically similar 3-D mold. */
  | 'volume';

/** One size-marked piece of equipment from the master data. */
export interface SizeMarkerDefinition {
  /** Canonical key, used in the stored artifact ('… Backring|size'). */
  readonly marker: string;
  /** Singular display form, used when the derived count is 1. */
  readonly singular: string;
  /** Plural display form, used when the derived count is above 1. */
  readonly plural: string;
  /** Canonical unit of the nominal sizes (e.g. 'cm'). */
  readonly unit: string;
  /** Scaling law between the recipe quantity and the marker's size. */
  readonly scale: SizeMarkerScale;
  /** Physically available nominal sizes, ascending; first/last bound the display. */
  readonly sizes: readonly number[];
  /** Size a fresh marker starts with; always one of 'sizes'. */
  readonly defaultSize: number;
  /** Display template; placeholders <N> <SIZE> <UNIT> <INF>. Always renders <N>. */
  readonly pattern: string;
}

/** All size markers, in table order. */
export const SIZE_MARKERS: readonly SizeMarkerDefinition[] = [
  {
    marker: 'Backring',
    singular: 'Backring',
    plural: 'Backringe',
    unit: 'cm',
    scale: 'area',
    sizes: [16, 18, 20, 22, 24, 26, 28, 30],
    defaultSize: 26,
    pattern: '<N> <SIZE>er <INF>',
  },
];
