/**
 * The precision setting (docs/recipe_scaling_algorithm.md §4).
 *
 * Precision describes how closely a displayed quantity should follow exact
 * metric amounts versus practical household/package measures. It is a
 * **preference for the selection**, not a scale factor: it never changes the
 * target `V0`, only which BQ/AQ candidate wins.
 *
 * The canonical stored form is one of five words — `very low`, `low`, `medium`,
 * `high`, `very high` — in recipe row/artifact tags and in the ingredient master
 * data (docs/storage_format.md). Ingredient-level precision is mandatory; a
 * quantity-level tag can override it. There is no recipe-level or global
 * default anymore. Only values without any applicable level (unitless inline
 * artifacts and unregistered sub-recipes) use the internal neutral value
 * {@link INTERNAL_PRECISION}; it is never written to a file.
 *
 * The five levels map to a numeric precision `p ∈ [0, 1]` for the weight
 * interpolation: `very low` = 0 (practical) … `very high` = 1 (exact). This is
 * the reverse of the old tolerance scale, where 0 meant exact.
 */

/**
 * The five stored precision levels, from practical to exact. The order is the
 * canonical order for UI chips, parsing and documentation.
 */
export type PrecisionLevel = 'very low' | 'low' | 'medium' | 'high' | 'very high';

/** All precision levels in canonical order (`very low` … `very high`). */
export const PRECISION_LEVELS: readonly PrecisionLevel[] = [
  'very low',
  'low',
  'medium',
  'high',
  'very high',
];

/**
 * The internal neutral precision, used only when neither a quantity-level nor an
 * ingredient-level value exists: unitless artifacts (no ingredient) and
 * unregistered sub-recipes (no master-data row). It is not a user setting, not a
 * fallback for a missing ingredient-level value in the master data, and never
 * written to a file.
 */
export const INTERNAL_PRECISION: PrecisionLevel = 'medium';

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

/** Boundary weights at `very low` precision (practical household measures). */
export const PRACTICAL_WEIGHTS: QuantityWeights = {
  accuracy: 0.2,
  conflict: 0.3,
  roundness: 0.35,
  missing: 0.15,
};

/** Boundary weights at `very high` precision (exact metric amounts). */
export const EXACT_WEIGHTS: QuantityWeights = {
  accuracy: 0.7,
  conflict: 0.2,
  roundness: 0.05,
  missing: 0.05,
};

/**
 * The precision levels that can be stored at the two remaining cascade
 * positions. `quantity` is the optional per-row/artifact override, `ingredient`
 * is the mandatory master-data level. A unitless artifact has no ingredient
 * level; an unregistered sub-recipe has no master-data entry.
 */
export interface PrecisionContext {
  /** The single quantity row / inline artifact (most specific). */
  readonly quantity?: PrecisionLevel | undefined;
  /** The ingredient master data entry. */
  readonly ingredient?: PrecisionLevel | undefined;
}

/** True when `value` is one of the five precision levels. */
export function isPrecisionLevel(value: unknown): value is PrecisionLevel {
  return typeof value === 'string' && (PRECISION_LEVELS as readonly string[]).includes(value);
}

/**
 * Parses a stored precision token (case-insensitive, surrounding whitespace and
 * repeated spaces tolerated). Returns undefined for an unknown token; callers
 * turn that into a precise validation error.
 */
export function parsePrecisionLevel(raw: string): PrecisionLevel | undefined {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return isPrecisionLevel(normalized) ? normalized : undefined;
}

/**
 * Resolves the effective precision: the quantity-level tag wins, then the
 * mandatory ingredient-level value. Only when neither exists does the internal
 * neutral value apply (unitless artifacts, unregistered sub-recipes).
 */
export function resolvePrecision(context: PrecisionContext): PrecisionLevel {
  return context.quantity ?? context.ingredient ?? INTERNAL_PRECISION;
}

/** The numeric position of a level on the practical → exact scale (`0 … 1`). */
export function precisionValue(level: PrecisionLevel): number {
  const index = PRECISION_LEVELS.indexOf(level);
  // isPrecisionLevel guards callers, but a hand-written value could still slip
  // through; throwing keeps it from silently selecting a different display.
  if (index < 0) {
    throw new Error(`precisionValue: ${JSON.stringify(level)} is not a precision level`);
  }
  return index / (PRECISION_LEVELS.length - 1);
}

/**
 * Interpolates the weight vector at `level`:
 * `W(p) = (1 − p)·W_practical + p·W_exact`, with p = 0 at `very low` and
 * p = 1 at `very high`.
 */
export function weightsFor(level: PrecisionLevel): QuantityWeights {
  const p = precisionValue(level);
  const practical = PRACTICAL_WEIGHTS;
  const exact = EXACT_WEIGHTS;
  return {
    accuracy: (1 - p) * practical.accuracy + p * exact.accuracy,
    conflict: (1 - p) * practical.conflict + p * exact.conflict,
    roundness: (1 - p) * practical.roundness + p * exact.roundness,
    missing: (1 - p) * practical.missing + p * exact.missing,
  };
}
