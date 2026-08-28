/**
 * The quantity ladder and deterministic scaling logic.
 *
 * Implements docs/quantity_scaling.md: every value is a rung of the standard
 * number ladder; scaling moves quantities by an integer number of rungs (Δx),
 * never by a multiplicative factor.
 *
 * The rung table (exact / BQ / AQ) lives in `ladderData.ts`, auto-generated
 * from the authoritative docs/standard_numbers.csv (see
 * scripts/generate-ladder.mjs).
 *
 * Floating-point note: BQ values are represented internally as integer
 * thousandths (400 → 400_000) so that the decade rule (×10 / ÷10 per 16 rungs)
 * is exact — plain float multiplication would produce noise such as
 * 0.8 · 0.1 = 0.08000000000000002 and break the pos()/scale() round-trip
 * (docs/quantity_scaling.md §8: no floating-point rounding of results).
 */

import { LADDER_RUNGS, type LadderRung } from './ladderData.js';

/** Smallest table index (rung value 0.1). */
export const MIN_X = -16;
/** Largest table index (rung value 1000). */
export const MAX_X = 48;
/** One decade on the ladder spans 16 steps: 10^(16/16) = 10. */
const STEPS_PER_DECADE = 16;

/** Integer thousandths of one unit; all table BQ values have ≤ 2 decimals. */
const THOUSANDTHS = 1000;
/** 0.1 — smallest BQ value covered by the table. */
const MIN_BQ = 0.1;
/** 1000 — largest BQ value covered by the table. */
const MAX_BQ = 1000;

/** Converts a quantity to integer thousandths, absorbing float noise. */
function toThousandths(value: number): number {
  return Math.round(value * THOUSANDTHS);
}

/** Rungs indexed by x (x = MIN_X … MAX_X). */
const RUNGS_BY_X: ReadonlyMap<number, LadderRung> = new Map(
  LADDER_RUNGS.map((rung) => [rung.x, rung]),
);

/** Rung index by BQ value (as integer thousandths) — the ladder positions. */
const BQ_TO_X: ReadonlyMap<number, number> = new Map(
  LADDER_RUNGS.map((rung) => [toThousandths(rung.bq), rung.x]),
);

/** The ladder covers every rung x = MIN_X … MAX_X exactly once. */
if (RUNGS_BY_X.size !== LADDER_RUNGS.length) {
  throw new Error('ladderData: duplicate rung index detected');
}

/**
 * Returns the BQ value of rung `x` as integer thousandths, applying the decade
 * rule rounded_BQ(x + 16) = 10 · rounded_BQ(x) outside the table.
 */
function bqThousandths(x: number): number {
  let scaledX = x;
  let decadeFactor = 1;
  while (scaledX > MAX_X) {
    scaledX -= STEPS_PER_DECADE;
    decadeFactor *= 10;
  }
  while (scaledX < MIN_X) {
    scaledX += STEPS_PER_DECADE;
    decadeFactor /= 10;
  }
  const rung = RUNGS_BY_X.get(scaledX);
  if (rung === undefined) {
    // Unreachable: the while loops above always land in MIN_X … MAX_X.
    throw new Error(`bqThousandths: no rung for x = ${x}`);
  }
  return toThousandths(rung.bq) * decadeFactor;
}

/**
 * Returns the rung with step index `x` (any integer, via decade periodicity).
 *
 * The AQ fraction form is only defined within the table (x = −16 … 48); outside
 * it the returned `aq` is the table value of the equivalent decade rung and is
 * not meaningful for display (that logic arrives with the additional-unit
 * roadmap task).
 */
export function getRung(x: number): LadderRung {
  let scaledX = x;
  let decadeFactor = 1;
  while (scaledX > MAX_X) {
    scaledX -= STEPS_PER_DECADE;
    decadeFactor *= 10;
  }
  while (scaledX < MIN_X) {
    scaledX += STEPS_PER_DECADE;
    decadeFactor /= 10;
  }
  const rung = RUNGS_BY_X.get(scaledX);
  if (rung === undefined) {
    // Unreachable: the while loops above always land in MIN_X … MAX_X.
    throw new Error(`getRung: no rung for x = ${x}`);
  }
  return {
    x,
    // The exact column is informational only (geometric spacing); float
    // decade arithmetic is acceptable here.
    exact: rung.exact * decadeFactor,
    bq: bqThousandths(x) / THOUSANDTHS,
    aq: rung.aq,
  };
}

/**
 * Returns the rung position x of a standard number `value` (a BQ ladder value).
 *
 * Values outside the table are normalized by whole decades (e.g. 0.05 → x = −21,
 * 1200 → x = 49). Throws if `value` is not a ladder value — non-standard
 * numbers do not exist in the app (docs/quantity_scaling.md §3).
 */
export function pos(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    // Guards the decade loop below: 0, negatives, NaN and Infinity would
    // otherwise never leave it.
    throw new Error(`pos: ${value} is not a standard number (ladder BQ value)`);
  }
  // Normalize whole decades on the float first: converting to thousandths
  // before this would silently round values below 0.001 (e.g. 0.0012 → 1
  // thousandth) and break the closedness invariant of §3.
  let scaled = value;
  let decadeOffset = 0;
  while (scaled > MAX_BQ) {
    scaled /= 10;
    decadeOffset += STEPS_PER_DECADE;
  }
  while (scaled < MIN_BQ) {
    scaled *= 10;
    decadeOffset -= STEPS_PER_DECADE;
  }
  const int = toThousandths(scaled);
  const x = BQ_TO_X.get(int);
  if (x === undefined) {
    throw new Error(`pos: ${value} is not a standard number (ladder BQ value)`);
  }
  return x + decadeOffset;
}

/**
 * Returns the BQ ladder value at step index `x` (any integer).
 *
 * Inverse of `pos`; outside the table the decade rule
 * rounded_BQ(x + 16) = 10 · rounded_BQ(x) applies.
 */
export function roundedBQ(x: number): number {
  return bqThousandths(x) / THOUSANDTHS;
}

/**
 * Rounds an arbitrary positive number to the nearest ladder rung (BQ value).
 *
 * Used where two ladder values are combined and the result would otherwise
 * fall off the ladder — e.g. summing an ingredient that appears in several
 * steps (§4: "appears once, with the total amount"): 400 g + 750 g = 1150 g,
 * which is not a standard number; the nearest rung is 1200 g, so the merged
 * entry stays a standard number (docs/quantity_scaling.md §3: non-standard
 * numbers do not exist in the app).
 *
 * The hand-picked BQ values deviate slightly from the geometric rung
 * positions, so the nearest rung is found by searching a small window around
 * the geometric estimate instead of a closed formula. Exact ladder values
 * round to themselves (distance 0).
 */
export function roundToRung(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new Error(`roundToRung: ${value} is not a positive finite number`);
  }
  // Geometric rung estimate: x = 16 · log10(value) (rungs are ~10^(x/16)).
  const estimate = Math.round(16 * Math.log10(value));
  let bestX = estimate;
  let bestDistance = Number.POSITIVE_INFINITY;
  // ±4 rungs covers the deviation of every hand-picked value from its
  // geometric position (never more than about half a rung in the table).
  for (let x = estimate - 4; x <= estimate + 4; x++) {
    const candidate = roundedBQ(x);
    const distance = Math.abs(candidate - value);
    // On an exact tie, prefer the larger rung (consistent with roundToAQ).
    if (distance < bestDistance || (distance === bestDistance && x > bestX)) {
      bestDistance = distance;
      bestX = x;
    }
  }
  return roundedBQ(bestX);
}

/**
 * Returns the difference between two targets in ladder steps:
 * Δx = pos(to) − pos(from). Negative when scaling down.
 */
export function difference(from: number, to: number): number {
  return pos(to) - pos(from);
}

/**
 * Returns all integer ladder values within `[min, max]`, ascending.
 *
 * Used for the serving options of the HTML export: the allowed serving counts
 * are the integer standard numbers 1–30, i.e. 18 options
 * (docs/user_stories.md, decision 7 / D2).
 */
export function integerLadderValues(min: number, max: number): number[] {
  const result: number[] = [];
  for (let x = pos(min); ; x++) {
    const bq = roundedBQ(x);
    if (bq > max) {
      break;
    }
    if (Number.isInteger(bq)) {
      result.push(bq);
    }
  }
  return result;
}

/**
 * Scales a BQ ladder value `amount` by `deltaX` rungs up (positive) or down
 * (negative) the ladder. The result is always another ladder value (the ladder
 * is closed under scaling, docs/quantity_scaling.md §3).
 */
export function scale(amount: number, deltaX: number): number {
  if (!Number.isInteger(deltaX)) {
    throw new Error(`scale: deltaX must be an integer number of rungs, got ${deltaX}`);
  }
  return roundedBQ(pos(amount) + deltaX);
}
