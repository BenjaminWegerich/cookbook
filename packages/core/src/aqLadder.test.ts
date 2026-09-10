import { describe, expect, it } from 'vitest';

import {
  AQ_MAX,
  AQ_MIN,
  AQ_VALUES,
  aqIndex,
  aqNotation,
  aqToNumber,
  isAQValue,
  nearestAQValue,
  roundToAQValue,
  scaleAQ,
} from './aqLadder.js';

describe('the AQ ladder data', () => {
  it('is the distinct fraction set, ascending, bounded 0.1 … 1000', () => {
    // 65 rungs minus the two duplicate fractions (1/6 and 1/4 appear twice).
    expect(AQ_VALUES).toHaveLength(63);
    expect(AQ_VALUES[0]).toBe(AQ_MIN);
    expect(AQ_VALUES[AQ_VALUES.length - 1]).toBe(AQ_MAX);
    for (let i = 1; i < AQ_VALUES.length; i++) {
      expect(AQ_VALUES[i - 1]!).toBeLessThan(AQ_VALUES[i]!);
    }
    expect(new Set(AQ_VALUES).size).toBe(AQ_VALUES.length);
  });

  it('lists the documented fractions below 1', () => {
    expect(AQ_VALUES.slice(0, 14)).toEqual([
      0.1,
      1 / 9,
      1 / 8,
      1 / 6,
      0.2,
      0.25,
      1 / 3,
      3 / 8,
      0.4,
      0.5,
      0.6,
      2 / 3,
      0.75,
      0.875,
    ]);
  });

  it('parses canonical fractions, mixed numbers and integers', () => {
    expect(aqToNumber('1/3')).toBeCloseTo(1 / 3, 12);
    expect(aqToNumber('1+1/4')).toBe(1.25);
    expect(aqToNumber('2+1/2')).toBe(2.5);
    expect(aqToNumber('12')).toBe(12);
  });
});

describe('AQ value membership and notation', () => {
  it('accepts AQ values and rejects BQ-only or non-ladder numbers', () => {
    for (const value of [0.1, 0.25, 1 / 3, 0.5, 1.25, 2.5, 3, 12, 1000]) {
      expect(isAQValue(value)).toBe(true);
    }
    // BQ ladder values that are not AQ values (the unitless mode replaced them).
    for (const value of [0.3, 0.8, 1.2, 1.8, 2.2, 750, 450]) {
      expect(isAQValue(value)).toBe(false);
    }
  });

  it('maps a value to its canonical notation and back', () => {
    expect(aqNotation(0.1)).toBe('1/10');
    expect(aqNotation(0.25)).toBe('1/4');
    expect(aqNotation(aqToNumber('1/3'))).toBe('1/3');
    expect(aqNotation(1.25)).toBe('1+1/4');
    expect(aqNotation(12)).toBe('12');
  });

  it('returns the ladder position and throws off-ladder', () => {
    expect(aqIndex(AQ_MIN)).toBe(0);
    expect(aqIndex(AQ_MAX)).toBe(AQ_VALUES.length - 1);
    expect(aqIndex(1)).toBe(14);
    expect(() => aqIndex(0.3)).toThrow();
    expect(() => aqNotation(0.3)).toThrow();
  });
});

describe('roundToAQValue (§6.1)', () => {
  it('rounds to the nearest AQ value', () => {
    expect(roundToAQValue(1)).toBe(1);
    expect(roundToAQValue(1.25)).toBe(1.25);
    expect(roundToAQValue(20.8333)).toBe(20);
    expect(roundToAQValue(0.12)).toBe(0.125);
  });

  it('breaks exact ties toward the larger value', () => {
    // 1.375 lies exactly between 1+1/4 (1.25) and 1+1/2 (1.5).
    expect(roundToAQValue(1.375)).toBe(1.5);
  });

  it('returns null outside the AQ range', () => {
    expect(roundToAQValue(0.1)).toBe(0.1);
    expect(roundToAQValue(1000)).toBe(1000);
    expect(roundToAQValue(0.06)).toBeNull();
    expect(roundToAQValue(1500)).toBeNull();
  });

  it('rejects non-positive or non-finite raw values', () => {
    expect(() => roundToAQValue(0)).toThrow();
    expect(() => roundToAQValue(NaN)).toThrow();
  });
});

describe('nearestAQValue (normalizing onto the AQ ladder)', () => {
  it('rounds inside the range and clamps outside it', () => {
    expect(nearestAQValue(0.5)).toBe(0.5);
    expect(nearestAQValue(750)).toBe(800);
    expect(nearestAQValue(0.02)).toBe(AQ_MIN);
    expect(nearestAQValue(5000)).toBe(AQ_MAX);
  });

  it('rejects non-positive or non-finite input', () => {
    expect(() => nearestAQValue(0)).toThrow();
    expect(() => nearestAQValue(Infinity)).toThrow();
  });
});

describe('scaleAQ (unitless counts move along the AQ ladder)', () => {
  it('moves whole AQ steps', () => {
    expect(scaleAQ(0.5, 1)).toBe(0.6);
    expect(scaleAQ(0.5, 2)).toBe(2 / 3);
    expect(scaleAQ(0.5, -1)).toBe(0.4);
    expect(scaleAQ(1, 1)).toBe(1.25);
    expect(scaleAQ(1, 0)).toBe(1);
    expect(scaleAQ(0.1, 1)).toBe(aqToNumber('1/9'));
  });

  it('clamps at both ladder ends (the AQ ladder has no decade rule)', () => {
    expect(scaleAQ(AQ_MIN, -1)).toBe(AQ_MIN);
    expect(scaleAQ(AQ_MAX, 1)).toBe(AQ_MAX);
  });

  it('rejects off-ladder values and non-integer step counts', () => {
    expect(() => scaleAQ(0.3, 1)).toThrow();
    expect(() => scaleAQ(1, 0.5)).toThrow();
  });
});
