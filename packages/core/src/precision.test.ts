/**
 * Tests for the precision resolution and its weight interpolation
 * (docs/recipe_scaling_algorithm.md §4).
 */

import { describe, expect, it } from 'vitest';

import {
  EXACT_WEIGHTS,
  INTERNAL_PRECISION,
  PRACTICAL_WEIGHTS,
  PRECISION_LEVELS,
  isPrecisionLevel,
  parsePrecisionLevel,
  precisionValue,
  resolvePrecision,
  weightsFor,
} from './precision.js';

describe('resolvePrecision', () => {
  it('uses the most specific defined level', () => {
    expect(resolvePrecision({ quantity: 'very high', ingredient: 'low' })).toBe('very high');
    expect(resolvePrecision({ ingredient: 'low' })).toBe('low');
  });

  it('falls back to the internal neutral value only without any level', () => {
    expect(resolvePrecision({})).toBe(INTERNAL_PRECISION);
    expect(resolvePrecision({ quantity: undefined, ingredient: undefined })).toBe('medium');
  });
});

describe('precision levels', () => {
  it('lists the five canonical levels in order', () => {
    expect(PRECISION_LEVELS).toEqual(['very low', 'low', 'medium', 'high', 'very high']);
  });

  it('maps the levels to the practical → exact scale', () => {
    expect(PRECISION_LEVELS.map(precisionValue)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('parses case-insensitively and normalizes whitespace', () => {
    expect(parsePrecisionLevel('  Very   High ')).toBe('very high');
    expect(parsePrecisionLevel('medium')).toBe('medium');
    expect(parsePrecisionLevel('precise')).toBeUndefined();
    expect(isPrecisionLevel('very low')).toBe(true);
    expect(isPrecisionLevel('0.5')).toBe(false);
  });
});

describe('weightsFor', () => {
  it('returns the practical boundary at very low and the exact boundary at very high', () => {
    expect(weightsFor('very low')).toEqual(PRACTICAL_WEIGHTS);
    expect(weightsFor('very high')).toEqual(EXACT_WEIGHTS);
  });

  it('reverses the old scale: higher precision means more accuracy', () => {
    expect(weightsFor('high').accuracy).toBeGreaterThan(weightsFor('low').accuracy);
    expect(weightsFor('high').roundness).toBeLessThan(weightsFor('low').roundness);
  });

  it('interpolates linearly and keeps the sum at 1', () => {
    const weights = weightsFor('medium');
    expect(weights.accuracy).toBeCloseTo((0.2 + 0.7) / 2);
    expect(weights.conflict).toBeCloseTo((0.3 + 0.2) / 2);
    expect(weights.roundness).toBeCloseTo((0.35 + 0.05) / 2);
    expect(weights.missing).toBeCloseTo((0.15 + 0.05) / 2);
    expect(weights.accuracy + weights.conflict + weights.roundness + weights.missing).toBeCloseTo(
      1,
    );
  });
});
