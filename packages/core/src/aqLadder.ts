/**
 * The AQ ladder — the standard numbers for additional quantities
 * (docs/quantity_scaling.md §2, docs/additional_quantity_specifications.md §6.1).
 *
 * The AQ column of the standard-number table carries one hand-picked fraction
 * per rung (1/10 … 1000). Unlike the BQ column it is **not** scale-invariant —
 * the fractions are chosen for the human scale and have no decade rule — so the
 * AQ ladder is a plain lookup, bounded to [AQ_MIN, AQ_MAX]. Duplicate fraction
 * forms (e.g. "1/6" on two rungs) collapse into one value; the ladder is the
 * ordered set of distinct AQ values.
 *
 * The AQ values serve two consumers:
 * - the additional-unit display rounds a computed raw quantity to the nearest
 *   AQ value (`roundToAQValue`, docs/additional_quantity_specifications.md §6.1);
 * - unitless inline quantities use the AQ ladder as their own standard numbers:
 *   the picker offers them and scaling moves a count by whole AQ steps
 *   (`scaleAQ`), so a unitless count stays a standard number.
 *
 * The numeric values are derived from `ladderData.ts` so that the generated
 * standard-number table stays the single source of truth.
 */

import { LADDER_RUNGS } from './ladderData.js';

/** Smallest AQ value (1/10); below it no additional quantity exists (§6.1). */
export const AQ_MIN = 0.1;
/** Largest AQ value (1000); above it no additional quantity exists (§6.1). */
export const AQ_MAX = 1000;

/**
 * Parses a canonical AQ fraction ("a", "a/b" or "a+b/c") to its numeric value.
 * The strings come from the generated ladder data (validated at generation
 * time), so no error handling is needed here.
 */
export function aqToNumber(aq: string): number {
  const plus = aq.indexOf('+');
  const slash = aq.indexOf('/');
  if (plus !== -1) {
    const integer = Number(aq.slice(0, plus));
    const fraction = aq.slice(plus + 1);
    const slashInFraction = fraction.indexOf('/');
    return (
      integer +
      Number(fraction.slice(0, slashInFraction)) / Number(fraction.slice(slashInFraction + 1))
    );
  }
  if (slash !== -1) {
    return Number(aq.slice(0, slash)) / Number(aq.slice(slash + 1));
  }
  return Number(aq);
}

/** One distinct AQ value together with its canonical fraction notation. */
interface AQEntry {
  readonly value: number;
  readonly notation: string;
}

/**
 * The distinct AQ values in ascending order, each with its canonical notation.
 * A duplicate notation (e.g. "1/6" on two rungs) is kept once — the ladder is
 * the set of standard numbers, not the set of rungs.
 */
const AQ_ENTRIES: readonly AQEntry[] = (() => {
  const byNotation = new Map<string, AQEntry>();
  for (const rung of LADDER_RUNGS) {
    if (!byNotation.has(rung.aq)) {
      byNotation.set(rung.aq, { value: aqToNumber(rung.aq), notation: rung.aq });
    }
  }
  return [...byNotation.values()].sort((a, b) => a.value - b.value);
})();

/** All distinct AQ values, ascending (the AQ ladder; AQ_MIN … AQ_MAX). */
export const AQ_VALUES: readonly number[] = AQ_ENTRIES.map((entry) => entry.value);

/** Position of an AQ value on the AQ ladder (keyed by its numeric value). */
const AQ_INDEX_BY_VALUE: ReadonlyMap<number, number> = new Map(
  AQ_ENTRIES.map((entry, index) => [entry.value, index]),
);

/** Canonical fraction notation of an AQ value (e.g. 1.25 → "1+1/4"). */
const AQ_NOTATION_BY_VALUE: ReadonlyMap<number, string> = new Map(
  AQ_ENTRIES.map((entry) => [entry.value, entry.notation]),
);

/**
 * Whether `value` is an AQ ladder value. Floating-point values round-trip
 * exactly through `aqToNumber`/`Number`, so direct map membership is sound.
 */
export function isAQValue(value: number): boolean {
  return AQ_INDEX_BY_VALUE.has(value);
}

/** Position of `value` on the AQ ladder; throws when it is not an AQ value. */
export function aqIndex(value: number): number {
  const index = AQ_INDEX_BY_VALUE.get(value);
  if (index === undefined) {
    throw new Error(`aqIndex: ${value} is not a standard number (AQ ladder value)`);
  }
  return index;
}

/**
 * The canonical fraction notation of an AQ value (e.g. 1.25 → "1+1/4",
 * 0.25 → "1/4"). Used to store a unitless inline quantity in its standard form.
 * Throws when `value` is not an AQ ladder value.
 */
export function aqNotation(value: number): string {
  const notation = AQ_NOTATION_BY_VALUE.get(value);
  if (notation === undefined) {
    throw new Error(`aqNotation: ${value} is not a standard number (AQ ladder value)`);
  }
  return notation;
}

/**
 * Rounds a raw quantity to the nearest AQ value measured by absolute
 * difference on the value scale; an exact tie resolves toward the larger value
 * (docs/additional_quantity_specifications.md §6.1). Returns null when `raw`
 * lies below AQ_MIN or above AQ_MAX — no additional quantity exists there.
 */
export function roundToAQValue(raw: number): number | null {
  if (!(raw > 0) || !Number.isFinite(raw)) {
    throw new Error(`roundToAQValue: raw must be a positive finite number, got ${raw}`);
  }
  if (raw < AQ_MIN || raw > AQ_MAX) {
    return null;
  }
  let best = AQ_VALUES[0]!;
  let bestDiff = Infinity;
  for (const value of AQ_VALUES) {
    const diff = Math.abs(raw - value);
    // AQ_VALUES is ascending, so on an exact tie the later value is the larger
    // one — exactly the §6.1 tie rule.
    if (bestDiff === Infinity || diff < bestDiff || (diff === bestDiff && value > best)) {
      best = value;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * The AQ value nearest to `value`, clamped into [AQ_MIN, AQ_MAX]. Unlike
 * `roundToAQValue` this never returns null, so it can normalize an arbitrary
 * positive quantity onto the AQ ladder — e.g. when the unitless mode is entered
 * from a BQ quantity that lies outside the AQ range.
 */
export function nearestAQValue(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`nearestAQValue: value must be a positive finite number, got ${value}`);
  }
  if (value <= AQ_MIN) return AQ_MIN;
  if (value >= AQ_MAX) return AQ_MAX;
  return roundToAQValue(value)!;
}

/**
 * Moves an AQ value by `deltaX` whole steps along the AQ ladder (the unitless
 * analogue of the BQ `scale`). The ladder is bounded (no decade rule), so a
 * step past either end clamps to AQ_MIN / AQ_MAX. `value` must be an AQ value.
 */
export function scaleAQ(value: number, deltaX: number): number {
  if (!Number.isInteger(deltaX)) {
    throw new Error(`scaleAQ: deltaX must be an integer number of AQ steps, got ${deltaX}`);
  }
  const target = aqIndex(value) + deltaX;
  const clamped = Math.min(AQ_VALUES.length - 1, Math.max(0, target));
  return AQ_VALUES[clamped]!;
}
