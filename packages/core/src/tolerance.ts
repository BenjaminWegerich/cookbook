/**
 * The tolerance setting (docs/recipe_scaling_algorithm.md §4).
 *
 * A recipe can prefer exact metric amounts (λ = 0) or practical household
 * measures (λ = 1). The value is a **preference for the selection**, not a
 * scale factor: it never changes the target `V0`, only which BQ/AQ candidate
 * wins. The effective value is resolved through a cascade:
 *
 *   quantity (row / artifact) ?? ingredient ?? recipe ?? global default
 *
 * The global default is a code constant (decided with the user), not a user
 * setting. The other levels are stored in the recipe file and the ingredient
 * master data; see docs/storage_format.md.
 *
 * Between the two boundary weight vectors the weights are linearly
 * interpolated. Both boundary vectors sum to 1, so every interpolated vector
 * does too.
 */

/** The global default tolerance (λ = 0.5, "balanced"). */
export const DEFAULT_TOLERANCE = 0.5;

/** The five tolerance chips offered by the UI (0 = exact, 1 = practical). */
export const TOLERANCE_CHOICES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** One weight vector of the scoring function (docs/recipe_scaling_algorithm.md §4.2). */
export interface QuantityWeights {
  /** Importance of matching the target `V0`. */
  readonly accuracy: number;
  /** Penalty for a text contradiction between BQ and AQ. */
  readonly conflict: number;
  /** Importance of clean numbers (clumsiness penalty). */
  readonly roundness: number;
  /** Penalty for omitting an AQ. */
  readonly missing: number;
}

/** Boundary weights at λ = 0 ("prefer exact quantities"). */
export const EXACT_WEIGHTS: QuantityWeights = {
  accuracy: 0.7,
  conflict: 0.2,
  roundness: 0.05,
  missing: 0.05,
};

/** Boundary weights at λ = 1 ("prefer practical quantities"). */
export const PRACTICAL_WEIGHTS: QuantityWeights = {
  accuracy: 0.2,
  conflict: 0.3,
  roundness: 0.35,
  missing: 0.15,
};

/**
 * The tolerance levels that can be stored at the four cascade positions. A
 * missing level is `undefined`; the resolver falls through to the next one.
 * `ingredient` is not available for unitless artifacts (they have no
 * ingredient), which is why the optimizer receives a context without it for
 * that case.
 */
export interface ToleranceContext {
  /** The single quantity row / inline artifact (most specific). */
  readonly quantity?: number | undefined;
  /** The ingredient master data entry. */
  readonly ingredient?: number | undefined;
  /** The recipe's front matter. */
  readonly recipe?: number | undefined;
}

/** True when `value` is a valid tolerance in [0, 1]. */
export function isTolerance(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Resolves the effective tolerance through the cascade. A defined value wins
 * even when it is 0 (the `??` operator, not `||`). Values outside [0, 1] are a
 * data error: the parser / master-data validator rejects them before this
 * function runs, so throwing here keeps a bad value from silently selecting a
 * different recipe reading.
 */
export function resolveTolerance(context: ToleranceContext): number {
  for (const value of [context.quantity, context.ingredient, context.recipe]) {
    if (value !== undefined) {
      if (!isTolerance(value)) {
        throw new Error(`resolveTolerance: ${value} is not in [0, 1]`);
      }
      return value;
    }
  }
  return DEFAULT_TOLERANCE;
}

/**
 * Interpolates the weight vector at `lambda`:
 * `W(λ) = (1 − λ)·W_exact + λ·W_practical`.
 */
export function weightsFor(lambda: number): QuantityWeights {
  if (!isTolerance(lambda)) {
    throw new Error(`weightsFor: ${lambda} is not in [0, 1]`);
  }
  const exact = EXACT_WEIGHTS;
  const practical = PRACTICAL_WEIGHTS;
  return {
    accuracy: (1 - lambda) * exact.accuracy + lambda * practical.accuracy,
    conflict: (1 - lambda) * exact.conflict + lambda * practical.conflict,
    roundness: (1 - lambda) * exact.roundness + lambda * practical.roundness,
    missing: (1 - lambda) * exact.missing + lambda * practical.missing,
  };
}
