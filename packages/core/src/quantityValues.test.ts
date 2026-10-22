/**
 * Tests for the BQ/AQ value layer (quantityValues.ts).
 *
 * The decade rule is the one piece of the table that is computed rather than
 * read: 100 = 10·10, 110 = 11·10, 950 = 95·10, 1000 = 10·100. Values that are
 * not in the 10 … 95 block (96 … 99, 105, …) do not exist.
 */

import { describe, expect, it } from 'vitest';

import {
  AQ_TABLE_MAX,
  AQ_TABLE_MIN,
  allowedBQValuesInRange,
  aqNotation,
  aqToNumber,
  bqPenalty,
  isAQValue,
  isAllowedBQ,
  nearestAllowedBQ,
} from './quantityValues.js';

describe('BQ table and decade rule', () => {
  it('accepts the explicit 1 … 95 values', () => {
    expect(isAllowedBQ(1)).toBe(true);
    expect(isAllowedBQ(9)).toBe(true);
    expect(isAllowedBQ(95)).toBe(true);
  });

  it('generates 100, 110 … 950 from the 10 … 95 block', () => {
    expect(isAllowedBQ(100)).toBe(true);
    expect(bqPenalty(100)).toBe(0);
    expect(isAllowedBQ(110)).toBe(true);
    expect(bqPenalty(110)).toBe(0.66);
    expect(isAllowedBQ(950)).toBe(true);
    expect(bqPenalty(950)).toBe(1);
    expect(isAllowedBQ(1000)).toBe(true);
    expect(bqPenalty(1000)).toBe(0);
    expect(isAllowedBQ(1100)).toBe(true);
    expect(bqPenalty(1100)).toBe(0.66);
  });

  it('rejects values outside the block pattern', () => {
    expect(isAllowedBQ(0.5)).toBe(false);
    expect(isAllowedBQ(96)).toBe(false);
    expect(isAllowedBQ(99)).toBe(false);
    expect(isAllowedBQ(105)).toBe(false);
    expect(isAllowedBQ(111)).toBe(false);
  });

  it('lists the allowed values in a range, ascending and without duplicates', () => {
    const values = allowedBQValuesInRange(95, 1000).map((entry) => entry.value);
    expect(values[0]).toBe(95);
    expect(values).toContain(100);
    expect(values).toContain(110);
    expect(values).toContain(950);
    expect(values).toContain(1000);
    expect(values).not.toContain(99);
    expect(values).not.toContain(105);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it('finds the nearest allowed BQ for the rare yield fallback', () => {
    expect(nearestAllowedBQ(1.5)).toBe(2);
    expect(nearestAllowedBQ(0.01)).toBe(1);
    expect(nearestAllowedBQ(437)).toBe(450);
  });
});

describe('AQ table', () => {
  it('has the documented bounds and notations', () => {
    expect(AQ_TABLE_MIN).toBe(0.125);
    expect(AQ_TABLE_MAX).toBe(30);
    expect(isAQValue(0.125)).toBe(true);
    expect(isAQValue(0.2)).toBe(false);
    expect(aqNotation(1.25)).toBe('1+1/4');
    expect(aqToNumber('1+1/4')).toBe(1.25);
  });

  it('parses the 5/8 and 5/6 notations used by the new table', () => {
    expect(aqToNumber('5/8')).toBe(0.625);
    expect(aqToNumber('5/6')).toBeCloseTo(5 / 6);
  });
});
