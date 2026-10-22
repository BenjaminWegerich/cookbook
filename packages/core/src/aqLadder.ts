/**
 * Additional-quantity values and their notation.
 *
 * This module is the **legacy bridge** for the old additional-unit code (the
 * shopping list, pantry and the pre-optimizer display helpers). The
 * authoritative values now live in `quantityData.ts`, generated from
 * docs/AQs.csv. The new recipe display uses `quantityOptimizer.ts` and the
 * number schemes directly; after the shopping list is migrated, the remaining
 * `scaleAQ` / `nearestAQValue` helpers can be removed.
 *
 * Unlike the old ladder, the AQ values are not a scale-invariant ladder and
 * have no decade rule: they are the plain set 1/8 … 30 from the table. The
 * functions below are lookups and clamping helpers, not a second source of
 * truth.
 */

import { AQ_VALUES as AQ_ROWS, type AQValue } from './quantityData.js';
import {
  AQ_TABLE_MAX,
  AQ_TABLE_MIN,
  aqNotation,
  aqToNumber,
  isAQValue,
  nearestAQEntry as nearestAQ,
} from './quantityValues.js';

/** Smallest AQ value (1/8). */
export const AQ_MIN = AQ_TABLE_MIN;
/** Largest AQ value (30). */
export const AQ_MAX = AQ_TABLE_MAX;
/** Parses a canonical AQ notation to its numeric value. */
export { aqToNumber };
/** True when a number is an allowed AQ value. */
export { isAQValue };
/** Canonical notation of an AQ value (throws when unknown). */
export { aqNotation };

/** One distinct AQ value with its canonical notation. */
interface AQEntry {
  readonly value: number;
  readonly notation: string;
}

/** All AQ values, ascending, with their notation. */
const AQ_ENTRIES: readonly AQEntry[] = AQ_ROWS.map((row: AQValue) => ({
  value: row.value,
  notation: row.notation,
}));

/** All distinct AQ values, ascending (the AQ table; 1/8 … 30). */
export const AQ_VALUES: readonly number[] = AQ_ENTRIES.map((entry) => entry.value);

/** Position of an AQ value in the table. */
const AQ_INDEX_BY_VALUE: ReadonlyMap<number, number> = new Map(
  AQ_ENTRIES.map((entry, index) => [entry.value, index]),
);

/** Position of `value` on the AQ table; throws when it is not an AQ value. */
export function aqIndex(value: number): number {
  const index = AQ_INDEX_BY_VALUE.get(value);
  if (index === undefined) {
    throw new Error(`aqIndex: ${value} is not an allowed additional quantity`);
  }
  return index;
}

/**
 * Rounds a raw quantity to the nearest AQ value, measured by absolute
 * difference; an exact tie resolves toward the larger value. Returns null when
 * `raw` lies outside the AQ range (no additional quantity exists there).
 *
 * This is a display helper, not a scaling step. The new optimizer enumerates
 * the candidates itself; the shopping/pantry code still uses this helper until
 * its migration.
 */
export function roundToAQValue(raw: number): number | null {
  if (!(raw > 0) || !Number.isFinite(raw)) {
    throw new Error(`roundToAQValue: raw must be a positive finite number, got ${raw}`);
  }
  const nearest = nearestAQ(raw);
  return nearest === null ? null : nearest.value;
}

/**
 * The AQ value nearest to `value`, clamped into [AQ_MIN, AQ_MAX]. Unlike
 * `roundToAQValue` this never returns null, so it can normalize an arbitrary
 * positive quantity onto the AQ table.
 */
export function nearestAQValue(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`nearestAQValue: value must be a positive finite number, got ${value}`);
  }
  if (value <= AQ_MIN) return AQ_MIN;
  if (value >= AQ_MAX) return AQ_MAX;
  return nearestAQ(value)!.value;
}

/**
 * Moves an AQ value by `deltaX` whole steps along the AQ table (legacy helper
 * for the old unitless/stock code). The table is bounded, so a step past either
 * end clamps to AQ_MIN / AQ_MAX. `value` must be an AQ value.
 */
export function scaleAQ(value: number, deltaX: number): number {
  if (!Number.isInteger(deltaX)) {
    throw new Error(`scaleAQ: deltaX must be an integer number of AQ steps, got ${deltaX}`);
  }
  const target = aqIndex(value) + deltaX;
  const clamped = Math.min(AQ_VALUES.length - 1, Math.max(0, target));
  return AQ_VALUES[clamped]!;
}
