/**
 * Tests for the tolerance cascade and its weight interpolation
 * (docs/recipe_scaling_algorithm.md §4).
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOLERANCE,
  EXACT_WEIGHTS,
  PRACTICAL_WEIGHTS,
  resolveTolerance,
  weightsFor,
} from './tolerance.js';

describe('resolveTolerance', () => {
  it('falls back to the global default when no level is set', () => {
    expect(resolveTolerance({})).toBe(DEFAULT_TOLERANCE);
  });

  it('uses the most specific defined level (even 0)', () => {
    expect(resolveTolerance({ quantity: 0, ingredient: 0.25, recipe: 0.75 })).toBe(0);
    expect(resolveTolerance({ ingredient: 0.25, recipe: 0.75 })).toBe(0.25);
    expect(resolveTolerance({ recipe: 0.75 })).toBe(0.75);
  });

  it('rejects values outside [0, 1]', () => {
    expect(() => resolveTolerance({ recipe: 1.5 })).toThrow(/not in \[0, 1\]/);
  });
});

describe('weightsFor', () => {
  it('returns the exact boundary at 0 and the practical boundary at 1', () => {
    expect(weightsFor(0)).toEqual(EXACT_WEIGHTS);
    expect(weightsFor(1)).toEqual(PRACTICAL_WEIGHTS);
  });

  it('interpolates linearly and keeps the sum at 1', () => {
    const weights = weightsFor(0.5);
    expect(weights.accuracy).toBeCloseTo((0.7 + 0.2) / 2);
    expect(weights.conflict).toBeCloseTo((0.2 + 0.3) / 2);
    expect(weights.roundness).toBeCloseTo((0.05 + 0.35) / 2);
    expect(weights.missing).toBeCloseTo((0.05 + 0.15) / 2);
    expect(
      weights.accuracy + weights.conflict + weights.roundness + weights.missing,
    ).toBeCloseTo(1);
  });
});
