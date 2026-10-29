/**
 * Adaptive quantity suggestions for the quantity field's chip row.
 *
 * The row offers complete arrangements ("1 Becher (500 g)", "400 g") for the
 * amounts around the field's current value `V0`, not arbitrary round numbers.
 * The procedure is the one agreed with the user:
 *
 * 1. **Candidates.** Every allowed BQ in the band `[V0 / 2, 2 · V0]`, plus every
 *    exact-package/piece anchor in that band whose count the unit's number
 *    scheme allows (`q · c`). Example: with `V0 = 94` and a 125 g pack whose
 *    scheme is integers, 125 is a candidate, 62.5 is not (scheme) and 250 is not
 *    (band). Non-exact units (spoons, pieces) need no candidates of their own:
 *    the optimizer derives them for every BQ.
 * 2. **Normalize to the tap state.** Each candidate is optimized, then the
 *    optimizer is run again on the resulting BQ, until the BQ and the arrangement
 *    are stable. This is exactly what the field will show after the chip is
 *    tapped, because tapping stores the displayed BQ. A candidate without a
 *    stable tap state is dropped. The intrinsic penalty score of a chip is the
 *    winner's score at that tap state.
 * 3. **One chip per BQ.** Duplicate results keep the lower score.
 * 4. **One chip per AQ/AU.** A spoon count that appears at two BQs keeps the
 *    lower score (metric-only results are not grouped: they have no AQ).
 * 5. **Rank** by `0.5 · score + 0.5 · distance`, where
 *    `distance = |log₂(BQ / V0)|` (0 for the current value, 1 at either band
 *    edge). Log distance makes ½× and 2× equally far. Ties prefer the lower
 *    score, then the smaller distance, then the higher BQ.
 * 6. **Fit one line.** The web app measures every chip and walks the ranked
 *    list; a chip that fits is taken, a chip that does not is skipped and the
 *    next one is tried (components/SuggestionChips). The active chip is not
 *    reserved: a row without an active chip says that the current `V0` has no
 *    particularly good arrangement, which is allowed and worth knowing.
 * 7. **Display** the chosen chips in ascending BQ order.
 *
 * Tapping a chip stores its **displayed, rounded BQ** (decided with the user);
 * the normalization in step 2 guarantees that the field then reads exactly the
 * chip's label. Approximate units are not filtered next to packages: their own
 * score and distance decide.
 *
 * Unitless inline counts use the same rounds with the AQ table as the primary
 * number table (there are no BQs, AUs or exact anchors).
 *
 * The functions are pure and never touch the DOM; the web app wraps the
 * `ArrangementDisplay` in `ArrangementLine` for the styled note run.
 */

import { ADDITIONAL_UNITS, type AdditionalUnit } from './additionalUnitsData.js';
import { AQ_SCHEMES, AQ_VALUES } from './quantityData.js';
import {
  CANDIDATE_BAND_FACTOR,
  logDistance,
  optimizeQuantity,
  optimizeUnitless,
  withinCandidateBand,
  type OptimizableEntry,
  type OptimizedQuantity,
  type OptimizedUnitless,
} from './quantityOptimizer.js';
import { allowedBQValuesInRange } from './quantityValues.js';
import {
  formatAQValue,
  renderOptimizedChipDisplay,
  type ArrangementDisplay,
} from './additionalUnits.js';
import type { PrecisionContext } from './precision.js';

/**
 * The precision context of a chip row, plus an optional hard target cap.
 *
 * `allowedValues` exists for callers whose field may only hold one of a fixed
 * set of targets: the meal plan offers an ingredient recipe's pre-baked yield
 * views, so a chip outside that list would promise a size the export link
 * cannot open. The ingredient sheet leaves the cap out and gets the full band.
 */
export interface QuantitySuggestionContext extends PrecisionContext {
  /**
   * When set, a chip is only offered when the value it would store is in this
   * list (up to floating-point noise). Order is irrelevant; the ranking below
   * still decides which chips survive and in which order they are tried.
   */
  readonly allowedValues?: readonly number[];
}

/** One suggested chip: the target to store and the arrangement it displays. */
export interface QuantitySuggestion {
  /** The BQ to store when the chip is tapped (the displayed, rounded amount). */
  readonly value: number;
  /** The arrangement the field will show for `value`, without the name. */
  readonly display: ArrangementDisplay;
  /** The winner's total penalty score at `value` (0 = cleanest). */
  readonly score: number;
  /** `|log₂(value / V0)|`: 0 at the current value, 1 at either band edge. */
  readonly distance: number;
}

/** Weight of the intrinsic penalty score in the ranking (0 … 1). */
export const SUGGESTION_PENALTY_WEIGHT = 0.5;

/** Weight of the log distance in the ranking (0 … 1); the two weights sum to 1. */
export const SUGGESTION_DISTANCE_WEIGHT = 0.5;

/** Additional units by canonical name, for the exactness lookup. */
const AU_BY_NAME: ReadonlyMap<string, AdditionalUnit> = new Map(
  ADDITIONAL_UNITS.map((unit) => [unit.name, unit]),
);

/** Relative epsilon for comparing floating-point quantities (1/3 of a pack, …). */
const VALUE_EPSILON = 1e-9;

/** How many tap-state normalization passes are attempted before dropping. */
const TAP_NORMALIZATION_LIMIT = 3;

/** True when two quantities are the same value up to floating-point noise. */
function sameValue(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= VALUE_EPSILON * scale;
}

/** A display with one plain text run (metric values and unitless counts). */
function plainDisplay(text: string): ArrangementDisplay {
  return { text, parts: [{ kind: 'text', value: text }] };
}

/** A suggestion plus the AQ/AU identity needed by round 4 (absent for metric). */
interface ScoredSuggestion {
  readonly suggestion: QuantitySuggestion;
  readonly aq?: { readonly value: number; readonly auName: string } | undefined;
}

/** True when two optimizer results describe the same arrangement. */
function sameArrangement(a: OptimizedQuantity, b: OptimizedQuantity): boolean {
  if (!sameValue(a.bq, b.bq)) {
    return false;
  }
  if ((a.aq === undefined) !== (b.aq === undefined)) {
    return false;
  }
  if (a.aq === undefined || b.aq === undefined) {
    return true;
  }
  return a.aq.au.name === b.aq.au.name && sameValue(a.aq.value, b.aq.value);
}

/**
 * Round 2 for a family quantity: optimize the candidate, then repeatedly
 * optimize the BQ the field would hold after tapping until the result stops
 * moving. Returns the stable tap state, or null when it does not settle within
 * the budget (such a chip would lie about what the field shows after the tap).
 */
function familyTapState(
  candidate: number,
  entry: OptimizableEntry | undefined,
  bu: string,
  context: PrecisionContext,
): OptimizedQuantity | null {
  let current = optimizeQuantity(candidate, entry, bu, context);
  for (let step = 0; step < TAP_NORMALIZATION_LIMIT; step += 1) {
    if (current.fallback) {
      return null;
    }
    const tapped = optimizeQuantity(current.bq, entry, bu, context);
    if (tapped.fallback) {
      return null;
    }
    if (sameArrangement(tapped, current)) {
      return tapped;
    }
    current = tapped;
  }
  return null;
}

/** Round 2 for a unitless count: the same normalization on the AQ table. */
function unitlessTapState(candidate: number, context: PrecisionContext): OptimizedUnitless | null {
  let current = optimizeUnitless(candidate, context);
  for (let step = 0; step < TAP_NORMALIZATION_LIMIT; step += 1) {
    if (current.fallback) {
      return null;
    }
    const tapped = optimizeUnitless(current.value, context);
    if (tapped.fallback) {
      return null;
    }
    if (sameValue(tapped.value, current.value)) {
      return tapped;
    }
    current = tapped;
  }
  return null;
}

/**
 * Round 1: every allowed BQ in the band, plus every exact-unit anchor in the
 * band whose count the unit's scheme allows. The list is deduplicated by value;
 * a listed BQ that happens to equal an exact anchor needs no second pass.
 */
function familyCandidates(v0: number, entry: OptimizableEntry | undefined): number[] {
  const lower = v0 / CANDIDATE_BAND_FACTOR;
  const upper = v0 * CANDIDATE_BAND_FACTOR;
  const candidates = allowedBQValuesInRange(lower, upper).map((bq) => bq.value);
  if (entry === undefined) {
    return candidates;
  }
  for (const mapping of entry.entries) {
    const au = AU_BY_NAME.get(mapping.au);
    // Only exact units can name an amount the BQ table does not contain.
    // Unknown units are unreachable with generated data; skipping keeps a
    // hand-edited mapping from breaking the whole row.
    if (au === undefined || !au.exact) {
      continue;
    }
    for (const count of AQ_SCHEMES[au.numberScheme] ?? []) {
      const target = count * mapping.factor;
      if (!withinCandidateBand(target, v0)) {
        continue;
      }
      if (!candidates.some((known) => sameValue(known, target))) {
        candidates.push(target);
      }
    }
  }
  return candidates;
}

/** Rounds 3 and 4 for family suggestions. */
function dedupeFamily(items: readonly ScoredSuggestion[]): ScoredSuggestion[] {
  // Round 3: one chip per displayed BQ, keeping the lower score. After round 2
  // the BQ determines the arrangement, so this is a pure duplicate collapse.
  const byBq = new Map<string, ScoredSuggestion>();
  for (const item of items) {
    const key = item.suggestion.value.toFixed(6);
    const existing = byBq.get(key);
    if (existing === undefined || item.suggestion.score < existing.suggestion.score) {
      byBq.set(key, item);
    }
  }

  // Round 4: one chip per (AQ, AU), keeping the lower score (decided with the
  // user, not the closest BQ). Metric-only results carry no AQ and stay.
  const metric: ScoredSuggestion[] = [];
  const byUnit = new Map<string, ScoredSuggestion>();
  for (const item of byBq.values()) {
    if (item.aq === undefined) {
      metric.push(item);
      continue;
    }
    const key = `${item.aq.auName}|${item.aq.value.toFixed(6)}`;
    const existing = byUnit.get(key);
    if (existing === undefined || item.suggestion.score < existing.suggestion.score) {
      byUnit.set(key, item);
    }
  }
  return [...metric, ...byUnit.values()];
}

/** Round 3 for unitless counts: one chip per count, keeping the lower score. */
function dedupeUnitless(items: readonly ScoredSuggestion[]): ScoredSuggestion[] {
  const byValue = new Map<string, ScoredSuggestion>();
  for (const item of items) {
    const key = item.suggestion.value.toFixed(6);
    const existing = byValue.get(key);
    if (existing === undefined || item.suggestion.score < existing.suggestion.score) {
      byValue.set(key, item);
    }
  }
  return [...byValue.values()];
}

/** The combined ranking score of round 5. */
function weightedScore(suggestion: QuantitySuggestion): number {
  return (
    SUGGESTION_PENALTY_WEIGHT * suggestion.score + SUGGESTION_DISTANCE_WEIGHT * suggestion.distance
  );
}

/** Round 5 ordering; the ties are deterministic. */
function compareSuggestions(a: ScoredSuggestion, b: ScoredSuggestion): number {
  const weightA = weightedScore(a.suggestion);
  const weightB = weightedScore(b.suggestion);
  if (Math.abs(weightA - weightB) > 1e-9) {
    return weightA - weightB;
  }
  if (a.suggestion.score !== b.suggestion.score) {
    return a.suggestion.score - b.suggestion.score;
  }
  if (a.suggestion.distance !== b.suggestion.distance) {
    return a.suggestion.distance - b.suggestion.distance;
  }
  return b.suggestion.value - a.suggestion.value;
}

/**
 * Ranked suggestions for a family quantity (g / ml) of an ingredient.
 *
 * @param v0 the field's current target (`V0`, positive)
 * @param entry the ingredient's master-data entry, or undefined for a sub-recipe,
 *   a free amount or a yield (those offer metric chips only)
 * @param bu the base-unit family the target is expressed in
 * @param context the precision context (quantity override / ingredient level),
 *   optionally with a hard `allowedValues` cap (see QuantitySuggestionContext)
 * @returns the chips in ranking order (round 6 picks what fits); empty for an
 *   invalid value
 */
export function suggestQuantities(
  v0: number,
  entry: OptimizableEntry | undefined,
  bu: string,
  context: QuantitySuggestionContext = {},
): QuantitySuggestion[] {
  if (!(v0 > 0) || !Number.isFinite(v0)) {
    return [];
  }
  // The hard cap is checked against the tap state, not the candidate: a
  // candidate outside the cap may still settle on a value the field can hold.
  // `toFixed(6)` is the same identity the BQ dedupe uses, so 1/3-derived
  // values compare without binary floating-point noise.
  const allowed =
    context.allowedValues === undefined
      ? undefined
      : new Set(context.allowedValues.map((value) => value.toFixed(6)));
  const scored: ScoredSuggestion[] = [];
  for (const candidate of familyCandidates(v0, entry)) {
    const result = familyTapState(candidate, entry, bu, context);
    if (result === null || !withinCandidateBand(result.bq, v0)) {
      continue;
    }
    if (allowed !== undefined && !allowed.has(result.bq.toFixed(6))) {
      continue;
    }
    scored.push({
      suggestion: {
        value: result.bq,
        display: renderOptimizedChipDisplay(entry, result, bu),
        score: result.score,
        distance: logDistance(v0, result.bq),
      },
      aq:
        result.aq === undefined ? undefined : { value: result.aq.value, auName: result.aq.au.name },
    });
  }
  return dedupeFamily(scored)
    .sort(compareSuggestions)
    .map((item) => item.suggestion);
}

/**
 * Ranked suggestions for a unitless inline count (`{{…}}`).
 *
 * The count has no ingredient and no base unit, so the AQ table is its primary
 * number table (like `optimizeUnitless`). The same rounds apply: candidates are
 * the AQ counts in the band, each is normalized to its tap state, and the
 * count/penalty/distance ranking is unchanged. There is no AQ/AU round, since
 * the count itself is the display.
 *
 * @param v0 the current count (positive)
 * @param context the artifact-level precision context
 * @returns the chips in ranking order; empty for an invalid value
 */
export function suggestUnitlessQuantities(
  v0: number,
  context: PrecisionContext = {},
): QuantitySuggestion[] {
  if (!(v0 > 0) || !Number.isFinite(v0)) {
    return [];
  }
  const scored: ScoredSuggestion[] = [];
  for (const aq of AQ_VALUES) {
    if (!withinCandidateBand(aq.value, v0)) {
      continue;
    }
    const result = unitlessTapState(aq.value, context);
    if (result === null || !withinCandidateBand(result.value, v0)) {
      continue;
    }
    scored.push({
      suggestion: {
        value: result.value,
        display: plainDisplay(formatAQValue(result.value)),
        score: result.score,
        distance: logDistance(v0, result.value),
      },
    });
  }
  return dedupeUnitless(scored)
    .sort(compareSuggestions)
    .map((item) => item.suggestion);
}
