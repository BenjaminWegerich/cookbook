/**
 * The deterministic quantity optimizer (docs/recipe_scaling_algorithm.md §5–§6).
 *
 * Given the unrounded target `V0` (always in the ingredient's metric base unit),
 * the ingredient's master data and the effective precision, this module decides
 * whether an additional quantity (AQ) is shown and which BQ/AQ pair and unit
 * represent the target best.
 *
 * The three branches of §5:
 * - **EXACT** (physical packaging): the AQ count fixes the BQ, `BQ = q·c`; the
 *   BQ table is not consulted and BQ roundness is ignored.
 * - **NON_EXACT** (spoons, pieces, …): BQ and AQ are chosen independently from
 *   the two tables, with a conflict penalty when they disagree.
 * - **Metric-only**: a BQ is chosen from the table and no AQ is shown.
 *
 * AQ values are filtered by the unit's number scheme *before* scoring; an exact
 * unit therefore cannot show a quarter of an “unteilbar” pack when its scheme
 * is `integers_up_to_30`. The clumsiness penalties of the surviving values still
 * score.
 *
 * Everything is pure: the optimizer never reads the ingredient registry, the
 * file system or React. Callers pass the ingredient entry and the precision
 * context.
 */

import {
  ADDITIONAL_UNITS,
  type AdditionalUnit,
  type IngredientMapping,
} from './additionalUnitsData.js';
import { AQ_SCHEMES, AQ_VALUES, type AQValue } from './quantityData.js';
import { allowedBQValuesInRange, aqValueFor } from './quantityValues.js';
import {
  PRECISION_LEVELS,
  resolvePrecision,
  weightsFor,
  type PrecisionContext,
  type PrecisionLevel,
  type QuantityWeights,
} from './precision.js';

/** Maximum relative error considered during candidate generation (precision-independent). */
export const EPSILON_MAX = 0.5;

/**
 * Estimated fraction of cooks who use the metric reading (BQ) rather than the
 * household reading (AQ). It weights the accuracy and roundness components of
 * the non-exact branch (docs/recipe_scaling_algorithm.md §4.3).
 */
export const USER_PROPORTION_P = 0.5;

/** Score epsilon for the tie-break hierarchy (§6.3). */
const TIE_EPSILON = 1e-5;

/** Additional units by canonical name (validated unique by the generator). */
const AU_BY_NAME: ReadonlyMap<string, AdditionalUnit> = new Map(
  ADDITIONAL_UNITS.map((unit) => [unit.name, unit]),
);

/** The branch that produced a candidate. */
export type OptimizerBranch = 'metric' | 'exact' | 'non-exact' | 'fallback';

/**
 * The parts of an ingredient entry the optimizer needs. The generated
 * `IngredientEntry` is assignable to it; the editor's draft entry (which has no
 * reorder point yet) is too.
 */
export interface OptimizableEntry {
  /** Fixed base unit family of the ingredient. */
  readonly bu: string;
  /** Mandatory ingredient-level precision from the master data. */
  readonly precision: PrecisionLevel;
  /** Compatible additional units and their conversion factors. */
  readonly entries: readonly IngredientMapping[];
}

/** One selected additional quantity. */
export interface OptimizedAQ {
  /** Numeric AQ value, e.g. 1.25. */
  readonly value: number;
  /** Canonical notation, e.g. "1+1/4". */
  readonly notation: string;
  /** The selected unit. */
  readonly au: AdditionalUnit;
  /** Base-unit amount per one AQ unit (the mapping's conversion factor). */
  readonly factor: number;
}

/** The optimizer's answer for one ingredient use. */
export interface OptimizedQuantity {
  /**
   * The BQ to display. For an exact unit this is `q·c`; for a non-exact or
   * metric-only candidate it is a value from the BQ table. In the fallback case
   * it is `V0` itself.
   */
  readonly bq: number;
  /** The selected AQ, or undefined for the metric-only / fallback branches. */
  readonly aq?: OptimizedAQ;
  /** The winning total penalty score (0 … 1). */
  readonly score: number;
  /** The branch that won; `fallback` means no candidate fitted. */
  readonly branch: OptimizerBranch;
  /** True when no candidate fitted and the plain base form must be shown. */
  readonly fallback: boolean;
}

/** The optimizer's answer for a unitless inline count. */
export interface OptimizedUnitless {
  /** The displayed count (a value from the AQ table, or V0 on fallback). */
  readonly value: number;
  /** Canonical AQ notation, or undefined on fallback. */
  readonly notation?: string;
  /** The winning total penalty score. */
  readonly score: number;
  /** True when no AQ value fitted. */
  readonly fallback: boolean;
}

/** One scored candidate before the tie-break. */
interface Candidate {
  readonly branch: 'metric' | 'exact' | 'non-exact';
  /** The BQ value to display. */
  readonly bq: number;
  /** The BQ's clumsiness penalty (0 for the exact branch, by definition). */
  readonly bqPenalty: number;
  /** The AQ's numeric value; undefined for the metric-only branch. */
  readonly aq?: AQValue;
  /** The base-unit equivalent of the AQ (q·c); undefined without an AQ. */
  readonly aqBase?: number;
  /** The selected unit; undefined without an AQ. */
  readonly au?: AdditionalUnit;
  /** The mapping's conversion factor; undefined without an AQ. */
  readonly factor?: number;
  /** The total penalty score. */
  readonly score: number;
}

/** Applies the scoring formula of §5 to a candidate. */
function scoreCandidate(candidate: Candidate, v0: number, weights: QuantityWeights): number {
  const p = USER_PROPORTION_P;
  const bqError = Math.abs(candidate.bq - v0) / v0;
  if (candidate.branch === 'metric') {
    const accuracy = bqError;
    const roundness = candidate.bqPenalty;
    return weights.accuracy * accuracy + weights.roundness * roundness + weights.missing * 1;
  }
  const aqBase = candidate.aqBase!;
  const aqError = Math.abs(aqBase - v0) / v0;
  const aqPenaltyValue = candidate.aq!.penalty;
  if (candidate.branch === 'exact') {
    // The physical package dictates the BQ: P_conflict = 0, R_BQ = 0.
    return weights.accuracy * aqError + weights.roundness * (1 - p) * aqPenaltyValue;
  }
  const accuracy = p * bqError + (1 - p) * aqError;
  const conflict = Math.abs(candidate.bq - aqBase) / v0;
  const roundness = p * candidate.bqPenalty + (1 - p) * aqPenaltyValue;
  return weights.accuracy * accuracy + weights.conflict * conflict + weights.roundness * roundness;
}

/**
 * The tie-break hierarchy of §6.3: higher BQ, then higher AQ (None = −1), then
 * the alphabetically first unit name (None = ""). German collation keeps the
 * umlauts in the natural order.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.bq !== b.bq) return b.bq - a.bq;
  const aqA = a.aq?.value ?? -1;
  const aqB = b.aq?.value ?? -1;
  if (aqA !== aqB) return aqB - aqA;
  return (a.au?.name ?? '').localeCompare(b.au?.name ?? '', 'de');
}

/** True when the ingredient entry is usable for the given base unit. */
function entryMatches(entry: OptimizableEntry | undefined, bu: string): entry is OptimizableEntry {
  return entry !== undefined && entry.bu === bu;
}

/** The AQ values allowed by a unit's number scheme, as table rows. */
function schemeAqValues(au: AdditionalUnit): AQValue[] {
  const values = AQ_SCHEMES[au.numberScheme] ?? [];
  const result: AQValue[] = [];
  for (const value of values) {
    const entry = aqValueFor(value);
    // Unreachable with generator-validated data: the scheme is a subset of the
    // AQ table. Skipping keeps a hand-edited master file from crashing.
    if (entry !== undefined) result.push(entry);
  }
  return result;
}

/**
 * Builds every candidate that can represent `V0`, scores them and returns the
 * winner. If no candidate fits `ε_max`, the fallback is `{ bq: V0, aq: undefined }`
 * — the caller renders the plain base form without rounding or AQ
 * (decided with the user).
 */
export function optimizeQuantity(
  v0: number,
  entry: OptimizableEntry | undefined,
  bu: string,
  context: PrecisionContext = {},
): OptimizedQuantity {
  if (!(v0 > 0) || !Number.isFinite(v0)) {
    throw new Error(`optimizeQuantity: V0 must be a positive finite number, got ${v0}`);
  }
  const precision = resolvePrecision({
    quantity: context.quantity,
    ingredient: context.ingredient ?? entry?.precision,
  });
  const weights = weightsFor(precision);

  const lower = v0 * (1 - EPSILON_MAX);
  const upper = v0 * (1 + EPSILON_MAX);
  const bqValues = allowedBQValuesInRange(lower, upper);
  const candidates: Candidate[] = [];

  // Branch 3: metric-only. Every BQ in the window is a candidate; the missing
  // penalty is a constant for this branch, so it only matters when an AQ
  // candidate competes with it.
  for (const bq of bqValues) {
    const candidate: Candidate = {
      branch: 'metric',
      bq: bq.value,
      bqPenalty: bq.penalty,
      score: 0,
    };
    candidates.push({ ...candidate, score: scoreCandidate(candidate, v0, weights) });
  }

  // Branches 1 and 2: every compatible additional unit of the ingredient.
  const mappings: readonly IngredientMapping[] = entryMatches(entry, bu) ? entry.entries : [];
  for (const mapping of mappings) {
    const au = AU_BY_NAME.get(mapping.au);
    // Unknown unit: generator-validated data cannot produce it; skip instead of
    // failing the whole display.
    if (au === undefined) continue;
    const aqValues = schemeAqValues(au);
    for (const aq of aqValues) {
      const aqBase = aq.value * mapping.factor;
      if (Math.abs(aqBase - v0) / v0 > EPSILON_MAX) continue;
      if (au.exact) {
        // Branch 1: the package count fixes the base amount. When the count is
        // not an integer, the derived BQ is rounded to whole grams/millilitres
        // for display (decided with the user) — e.g. 1/3 of a 1000 g pack is
        // shown as 333 g, not 333.33 g. The unrounded `aqBase` stays the
        // accuracy reference for the score.
        const bq = Number.isInteger(aq.value) ? aqBase : Math.round(aqBase);
        const candidate: Candidate = {
          branch: 'exact',
          bq,
          bqPenalty: 0,
          aq,
          aqBase,
          au,
          factor: mapping.factor,
          score: 0,
        };
        candidates.push({ ...candidate, score: scoreCandidate(candidate, v0, weights) });
        continue;
      }
      // Branch 2: BQ and AQ are chosen independently; skip pairs whose text
      // contradiction would exceed the search window.
      for (const bq of bqValues) {
        if (Math.abs(bq.value - aqBase) / v0 > EPSILON_MAX) continue;
        const candidate: Candidate = {
          branch: 'non-exact',
          bq: bq.value,
          bqPenalty: bq.penalty,
          aq,
          aqBase,
          au,
          factor: mapping.factor,
          score: 0,
        };
        candidates.push({ ...candidate, score: scoreCandidate(candidate, v0, weights) });
      }
    }
  }

  if (candidates.length === 0) {
    return { bq: v0, score: 0, branch: 'fallback', fallback: true };
  }

  const bestScore = Math.min(...candidates.map((candidate) => candidate.score));
  const tied = candidates.filter((candidate) => candidate.score <= bestScore + TIE_EPSILON);
  tied.sort(compareCandidates);
  const winner = tied[0]!;

  return {
    bq: winner.bq,
    ...(winner.aq !== undefined
      ? {
          aq: {
            value: winner.aq.value,
            notation: winner.aq.notation,
            au: winner.au!,
            factor: winner.factor!,
          },
        }
      : {}),
    score: winner.score,
    branch: winner.branch,
    fallback: false,
  };
}

/** One ingredient use that contributes to a master-list quantity. */
export interface MasterQuantityUse {
  /** The use's unrounded target `V0` in the ingredient's base unit. */
  readonly quantity: number;
  /** Optional per-row precision override (the ingredient level applies otherwise). */
  readonly precision?: PrecisionLevel;
}

/** The master-row answer: the optimizer result plus the effective precision. */
export interface OptimizedMasterQuantity extends OptimizedQuantity {
  /**
   * The precision the master row was optimized with: the highest effective
   * precision among its step rows (docs/recipe_scaling_algorithm.md §6.4).
   */
  readonly precision: PrecisionLevel;
}

/** Rounds a derived sum to millionths, removing binary floating-point noise. */
function roundSum(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Greatest common divisor, for reducing an AQ sum to a canonical fraction. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The canonical notation of an exact sum of AQ values. Every AQ table value is
 * a multiple of 1/24 (1/8, 1/6, 1/4, 1/3, …), so a sum of them is one too. The
 * sum is reduced to a mixed fraction, which keeps the familiar "1+1/2" form for
 * table values and still renders a value the AQ table does not contain (e.g.
 * "7/24"). The decimal fallback is unreachable for real AQ values and only
 * guards a hand-edited table.
 */
function aqSumNotation(value: number): string {
  const units = Math.round(value * 24);
  if (units > 0 && Math.abs(value - units / 24) <= 1e-9) {
    const whole = Math.floor(units / 24);
    let numerator = units - whole * 24;
    let denominator = 24;
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    if (numerator === 0) return String(whole);
    const fraction = `${numerator}/${denominator}`;
    return whole === 0 ? fraction : `${whole}+${fraction}`;
  }
  return String(roundSum(value));
}

/** The effective precision of one use, resolved through the normal cascade. */
function usePrecision(use: MasterQuantityUse, entry: OptimizableEntry | undefined): PrecisionLevel {
  return resolvePrecision({ quantity: use.precision, ingredient: entry?.precision });
}

/** The highest effective precision among the uses (the master row's level). */
function highestUsePrecision(
  uses: readonly MasterQuantityUse[],
  entry: OptimizableEntry | undefined,
): PrecisionLevel {
  let highest: PrecisionLevel = PRECISION_LEVELS[0]!;
  for (const use of uses) {
    const level = usePrecision(use, entry);
    if (PRECISION_LEVELS.indexOf(level) > PRECISION_LEVELS.indexOf(highest)) {
      highest = level;
    }
  }
  return highest;
}

/**
 * Scores one master-row AQ candidate.
 *
 * The master row's BQ is the **exact sum of the step BQs**, so its accuracy
 * error and its clumsiness are both zero. Only the AQ side is scored: its
 * distance from the shown BQ (accuracy, weighted by the share of cooks reading
 * the AQ) and the text contradiction between count and amount (conflict). An
 * AQ candidate that was built by summing the step AQs carries penalty 0, so
 * summing arrangements is never punished for clumsiness.
 */
function scoreMasterCandidate(
  candidate: Candidate,
  masterBq: number,
  weights: QuantityWeights,
): number {
  if (candidate.branch === 'metric') return weights.missing;
  const aqError = Math.abs(candidate.aqBase! - masterBq) / masterBq;
  const roundness = (1 - USER_PROPORTION_P) * candidate.aq!.penalty;
  return (
    weights.accuracy * (1 - USER_PROPORTION_P) * aqError +
    weights.conflict * aqError +
    weights.roundness * roundness
  );
}

/**
 * Optimizes the **master-list quantity** of one ingredient from its step uses
 * (decided with the user). The constraints tie the master row to the rows the
 * cook reads above it:
 *
 * - **One use:** the result is that step's result unchanged, so step and master
 *   arrangement are identical.
 * - **Several uses:** the master BQ is the exact sum of the step BQs. It need
 *   not be a BQ table value and is never charged BQ clumsiness.
 * - **Same AU everywhere:** if every step uses the same additional unit and the
 *   master uses it too, the master AQ is the exact sum of the step AQs and is
 *   never charged AQ clumsiness.
 * - **Shared AU:** any master AQ that uses an AU some step also uses must be
 *   strictly larger than that step's AQ (no master "1 Packung" above a step
 *   that already reads "1 Packung").
 * - **Exact units:** outside the shared-AU sum, an exact unit is only a
 *   candidate when its count brings exactly the master BQ home, so a count can
 *   never contradict the amount it is shown with ("2 Becher (900 g)" is
 *   rejected).
 * - **Precision:** the master row inherits the highest effective precision of
 *   its step rows.
 *
 * The master row treats an AQ count as independent from its BQ: the BQ is fixed
 * by the sum, not derived from the count. That is why its candidates score
 * through the non-exact formula (with the conflict penalty) rather than the
 * exact branch of `optimizeQuantity`.
 *
 * @param uses the ingredient's step uses, in recipe order
 * @param entry the ingredient master data, or undefined for an unregistered name
 * @param bu the base unit family the uses are expressed in (g / ml)
 */
export function optimizeMasterQuantity(
  uses: readonly MasterQuantityUse[],
  entry: OptimizableEntry | undefined,
  bu: string,
): OptimizedMasterQuantity {
  if (uses.length === 0) {
    throw new Error('optimizeMasterQuantity: at least one use is required');
  }
  for (const use of uses) {
    if (!(use.quantity > 0) || !Number.isFinite(use.quantity)) {
      throw new Error(
        `optimizeMasterQuantity: every use needs a positive finite quantity, got ${use.quantity}`,
      );
    }
  }

  const precision = highestUsePrecision(uses, entry);
  const stepResults = uses.map((use) =>
    optimizeQuantity(
      use.quantity,
      entry,
      bu,
      use.precision !== undefined ? { quantity: use.precision } : {},
    ),
  );

  // One use: the master row *is* the step row, arrangement and all.
  if (stepResults.length === 1) {
    return { ...stepResults[0]!, precision };
  }

  const weights = weightsFor(precision);
  // The BQ the master row shows: the exact sum of the step rows' displayed BQs.
  const masterBq = roundSum(stepResults.reduce((sum, result) => sum + result.bq, 0));

  // What the step rows contribute to the AQ constraints: the largest AQ per AU
  // and, for the "all steps share one AU" case, the exact AQ sum per AU.
  const aqMax = new Map<string, number>();
  const aqSum = new Map<string, number>();
  let firstAu: string | undefined;
  let sharedByAll = true;
  for (const result of stepResults) {
    if (result.aq === undefined) {
      sharedByAll = false;
      continue;
    }
    const name = result.aq.au.name;
    aqMax.set(name, Math.max(aqMax.get(name) ?? 0, result.aq.value));
    // Keep the raw sum: the notation helper reduces it to its canonical
    // fraction (rounding it to millionths first would destroy the 1/24 grid).
    aqSum.set(name, (aqSum.get(name) ?? 0) + result.aq.value);
    if (firstAu === undefined) firstAu = name;
    else if (firstAu !== name) sharedByAll = false;
  }
  const sharedAu = sharedByAll ? firstAu : undefined;

  const candidates: Candidate[] = [];
  const addCandidate = (candidate: Candidate): void => {
    candidates.push({ ...candidate, score: scoreMasterCandidate(candidate, masterBq, weights) });
  };

  // The metric-only candidate always exists: the BQ sum is the fallback.
  addCandidate({ branch: 'metric', bq: masterBq, bqPenalty: 0, score: 0 });

  const mappings: readonly IngredientMapping[] = entryMatches(entry, bu) ? entry.entries : [];
  for (const mapping of mappings) {
    const au = AU_BY_NAME.get(mapping.au);
    // Unreachable with generator-validated data; skip instead of failing.
    if (au === undefined) continue;

    if (sharedAu === au.name) {
      // Every step uses this unit: the master AQ is their exact sum, outside the
      // AQ table if need be, and carries no clumsiness penalty.
      const sum = aqSum.get(au.name)!;
      const aqBase = sum * mapping.factor;
      if (Math.abs(aqBase - masterBq) / masterBq > EPSILON_MAX) continue;
      addCandidate({
        branch: 'non-exact',
        bq: masterBq,
        bqPenalty: 0,
        aq: { value: sum, notation: aqSumNotation(sum), penalty: 0 },
        aqBase,
        au,
        factor: mapping.factor,
        score: 0,
      });
      continue;
    }

    // Any other AU: a table count that is strictly larger than every step AQ of
    // the same unit (a master must not repeat a step's count) and fits the
    // usual search window around the BQ sum.
    const stepMax = aqMax.get(au.name);
    for (const aq of schemeAqValues(au)) {
      if (stepMax !== undefined && aq.value <= stepMax + 1e-9) continue;
      const aqBase = aq.value * mapping.factor;
      if (Math.abs(aqBase - masterBq) / masterBq > EPSILON_MAX) continue;
      // An exact unit promises that its count restates the amount. A count that
      // does not bring exactly the BQ sum home would contradict the master line
      // ("2 Becher (900 g)"), so it is no candidate. The shared-AU sum above is
      // exempt: there the rounding of the step BQs is already in the rows.
      if (au.exact && Math.abs(aqBase - masterBq) > 1e-6) continue;
      addCandidate({
        branch: 'non-exact',
        bq: masterBq,
        bqPenalty: 0,
        aq,
        aqBase,
        au,
        factor: mapping.factor,
        score: 0,
      });
    }
  }

  const bestScore = Math.min(...candidates.map((candidate) => candidate.score));
  const tied = candidates.filter((candidate) => candidate.score <= bestScore + TIE_EPSILON);
  tied.sort(compareCandidates);
  const winner = tied[0]!;

  return {
    bq: winner.bq,
    ...(winner.aq !== undefined
      ? {
          aq: {
            value: winner.aq.value,
            notation: winner.aq.notation,
            au: winner.au!,
            factor: winner.factor!,
          },
        }
      : {}),
    score: winner.score,
    branch: winner.branch,
    fallback: false,
    precision,
  };
}

/**
 * Optimizes a unitless inline count. A count has no ingredient and no base
 * unit, so only the “BQ only” branch applies: the count is chosen from the AQ
 * table (the standard numbers for counts) with the accuracy and roundness
 * weights, and no additional unit is ever shown. A count has no ingredient-level
 * precision, so only the optional per-artifact override applies; without one,
 * the internal neutral level is used.
 *
 * If no count fits `ε_max`, the artifact keeps its unrounded target (fallback).
 */
export function optimizeUnitless(v0: number, context: PrecisionContext = {}): OptimizedUnitless {
  if (!(v0 > 0) || !Number.isFinite(v0)) {
    throw new Error(`optimizeUnitless: V0 must be a positive finite number, got ${v0}`);
  }
  const precision = resolvePrecision({ quantity: context.quantity });
  const weights = weightsFor(precision);
  const lower = v0 * (1 - EPSILON_MAX);
  const upper = v0 * (1 + EPSILON_MAX);
  const candidates: { entry: AQValue; score: number }[] = [];
  for (const entry of AQ_VALUES) {
    if (entry.value < lower || entry.value > upper) continue;
    // Branch 3 scoring with the AQ table as the primary number table. The
    // missing penalty is a constant for a count (there is no additional unit to
    // omit), so it does not affect the ranking.
    const accuracy = Math.abs(entry.value - v0) / v0;
    const roundness = entry.penalty;
    const score = weights.accuracy * accuracy + weights.roundness * roundness;
    candidates.push({ entry, score });
  }
  if (candidates.length === 0) {
    return { value: v0, score: 0, fallback: true };
  }
  const bestScore = Math.min(...candidates.map((candidate) => candidate.score));
  const tied = candidates.filter((candidate) => candidate.score <= bestScore + TIE_EPSILON);
  // Higher count wins on an exact score tie (the same rule as §6.3).
  tied.sort((a, b) => b.entry.value - a.entry.value);
  const winner = tied[0]!;
  return {
    value: winner.entry.value,
    notation: winner.entry.notation,
    score: winner.score,
    fallback: false,
  };
}
