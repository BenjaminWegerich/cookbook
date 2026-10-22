/**
 * Runtime helpers for the two quantity master tables (docs/recipe_scaling_algorithm.md §3).
 *
 * The explicit tables live in the generated `quantityData.ts`:
 * - BQ values 1 … 95, each with its clumsiness penalty;
 * - AQ values (counts), each with its penalty and its number schemes.
 *
 * **BQ decade rule.** Above 95 the allowed base quantities continue with the
 * 10 … 95 block multiplied by powers of ten: 100 = 10·10, 110 = 11·10,
 * 950 = 95·10, 1000 = 10·100, and so on. The penalty is copied from the base
 * value (100 → 0, 110 → 0.66). Values 96 … 99 and all other non-block values
 * do not exist. The table starts at 1; values below 1 have no BQ candidate and
 * are displayed in the plain base form when nothing else fits.
 *
 * This module is pure and framework-free. It deliberately does not know about
 * ingredients or units — it only answers "is this a BQ / AQ value?" and
 * "which values lie in this range?".
 */

import {
  AQ_SCHEME_NAMES,
  AQ_SCHEMES,
  AQ_VALUES,
  BQ_TABLE_MAX,
  BQ_VALUES,
  type AQValue,
  type BQValue,
} from './quantityData.js';

/** Smallest allowed BQ value (the smallest table row). */
export const BQ_MIN = BQ_VALUES[0]!.value;
/** Smallest allowed AQ value (1/8). */
export const AQ_TABLE_MIN = AQ_VALUES[0]!.value;
/** Largest allowed AQ value (30). */
export const AQ_TABLE_MAX = AQ_VALUES[AQ_VALUES.length - 1]!.value;

/** Comparison tolerance for generated BQ values and AQ notations. */
const EPSILON = 1e-9;

/** Explicit BQ rows by value. */
const BQ_BY_VALUE: ReadonlyMap<number, BQValue> = new Map(
  BQ_VALUES.map((entry) => [entry.value, entry]),
);

/** The decade base block (10 … 95), used to generate values above 95. */
const BQ_DECADE_BLOCK: readonly BQValue[] = BQ_VALUES.filter(
  (entry) => entry.value >= 10 && entry.value <= BQ_TABLE_MAX,
);

/** AQ rows by numeric value. Floating-point keys match `aqToNumber` exactly. */
const AQ_BY_VALUE: ReadonlyMap<number, AQValue> = new Map(
  AQ_VALUES.map((entry) => [entry.value, entry]),
);

/**
 * Parses a canonical AQ notation (`1/2`, `1+1/4`, `3`) into its numeric value.
 * Tolerates spaces around `+` and `/`. The input comes from the generated
 * table (validated by the generator) or from a hand-written file (normalized by
 * the recipe parser), so this is intentionally forgiving.
 */
export function aqToNumber(notation: string): number {
  const compact = notation.replace(/\s+/g, '');
  const plus = compact.indexOf('+');
  if (plus !== -1) {
    const integer = Number(compact.slice(0, plus));
    const fraction = compact.slice(plus + 1);
    const slash = fraction.indexOf('/');
    return (
      integer +
      Number(fraction.slice(0, slash)) / Number(fraction.slice(slash + 1))
    );
  }
  const slash = compact.indexOf('/');
  if (slash !== -1) {
    return Number(compact.slice(0, slash)) / Number(compact.slice(slash + 1));
  }
  return Number(compact);
}

/** True when `value` is one of the allowed AQ values. */
export function isAQValue(value: number): boolean {
  return AQ_BY_VALUE.has(value);
}

/** The AQ row for a value, or undefined when it is not an allowed AQ value. */
export function aqValueFor(value: number): AQValue | undefined {
  return AQ_BY_VALUE.get(value);
}

/** Canonical notation of an AQ value (e.g. 1.25 → "1+1/4"); throws when unknown. */
export function aqNotation(value: number): string {
  const entry = AQ_BY_VALUE.get(value);
  if (entry === undefined) {
    throw new Error(`aqNotation: ${value} is not an allowed additional quantity`);
  }
  return entry.notation;
}

/**
 * The AQ value nearest to `raw` by absolute difference; ties go to the larger
 * value (docs/recipe_scaling_algorithm.md §6.3). Returns null when `raw` lies
 * outside the AQ range — no additional quantity exists there. This is a
 * display helper for unitless counts, not a scaling step.
 */
export function nearestAQEntry(raw: number): AQValue | null {
  if (!(raw > 0) || !Number.isFinite(raw)) {
    return null;
  }
  if (raw < AQ_TABLE_MIN || raw > AQ_TABLE_MAX) {
    return null;
  }
  let best = AQ_VALUES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of AQ_VALUES) {
    const distance = Math.abs(entry.value - raw);
    if (
      distance < bestDistance ||
      (distance === bestDistance && entry.value > best.value)
    ) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/** Penalty of an AQ value, or undefined when it is not an allowed AQ value. */
export function aqPenalty(value: number): number | undefined {
  return AQ_BY_VALUE.get(value)?.penalty;
}

/** Allowed AQ values of one number scheme, ascending; empty for an unknown scheme. */
export function schemeValues(name: string): readonly number[] {
  return AQ_SCHEMES[name] ?? [];
}

/** Number scheme names, in the column order of docs/AQs.csv. */
export { AQ_SCHEME_NAMES, AQ_SCHEMES };

/**
 * True when `value` is an allowed BQ value: an explicit table row (1 … 95) or a
 * generated decade value (10 … 95) × 10^k for k ≥ 1.
 */
export function isAllowedBQ(value: number): boolean {
  if (!Number.isFinite(value) || value < BQ_MIN) {
    return false;
  }
  if (value <= BQ_TABLE_MAX) {
    return BQ_BY_VALUE.has(value);
  }
  return bqPenalty(value) !== undefined;
}

/**
 * The clumsiness penalty of a BQ value, or undefined when the value is not
 * allowed. Generated decade values copy the penalty of their 10 … 95 base.
 */
export function bqPenalty(value: number): number | undefined {
  if (!Number.isFinite(value) || value < BQ_MIN) {
    return undefined;
  }
  if (value <= BQ_TABLE_MAX) {
    return BQ_BY_VALUE.get(value)?.penalty;
  }
  // factor = 10^k such that base = value / factor lies in 10 … 95.
  const factor = 10 ** Math.floor(Math.log10(value / 10));
  if (!Number.isFinite(factor) || factor < 10) {
    return undefined;
  }
  const base = value / factor;
  const rounded = Math.round(base);
  if (Math.abs(base - rounded) > EPSILON) {
    return undefined;
  }
  const entry = BQ_BY_VALUE.get(rounded);
  if (entry === undefined || entry.value < 10 || entry.value > BQ_TABLE_MAX) {
    return undefined;
  }
  return entry.penalty;
}

/**
 * All allowed BQ values in `[min, max]`, ascending. This is the candidate pool
 * for the metric-only branch and for the BQ side of a non-exact pair. The
 * explicit 1 … 95 rows and the generated decade values are merged; no value can
 * appear twice because the generated values start at 100.
 */
export function allowedBQValuesInRange(min: number, max: number): BQValue[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return [];
  }
  const result: BQValue[] = [];
  for (const entry of BQ_VALUES) {
    if (entry.value >= min && entry.value <= max) {
      result.push(entry);
    }
  }
  // Generated decade values: base (10 … 95) × 10^k, k ≥ 1, each copy keeps
  // the base row's penalty.
  for (let factor = 10; 10 * factor <= max; factor *= 10) {
    for (const base of BQ_DECADE_BLOCK) {
      const value = base.value * factor;
      if (value >= min && value <= max) {
        result.push({ value, penalty: base.penalty });
      }
    }
  }
  result.sort((a, b) => a.value - b.value);
  return result;
}

/**
 * The allowed BQ value nearest to `value` by absolute difference; ties go to
 * the larger value. Used only as a last-resort default for an ingredient-recipe
 * yield that is so small that its ±1-decade band contains no BQ value. The
 * table's smallest value (1) is the fallback when even that is impossible.
 */
export function nearestAllowedBQ(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`nearestAllowedBQ: ${value} is not a positive finite number`);
  }
  const lower = Math.max(BQ_MIN, value / 10);
  const upper = value * 10;
  const candidates = allowedBQValuesInRange(lower, Math.max(upper, BQ_MIN));
  if (candidates.length === 0) {
    return BQ_VALUES[0]!.value;
  }
  let best = candidates[0]!;
  let bestDistance = Math.abs(best.value - value);
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.value - value);
    if (distance < bestDistance || (distance === bestDistance && candidate.value > best.value)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.value;
}

/**
 * Formats a number for the canonical file form: at most six decimals, no
 * trailing zeros, a plain `.` decimal separator. Six decimals are enough to
 * round-trip every practical target while removing binary floating-point noise
 * (e.g. 0.30000000000000004 → 0.3). This is a storage formatter; the display
 * layer uses the German comma (additionalUnits.formatDecimal).
 */
export function formatStoredNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`formatStoredNumber: ${value} is not finite`);
  }
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(rounded);
}
