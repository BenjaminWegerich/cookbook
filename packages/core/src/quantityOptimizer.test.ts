/**
 * Tests for the deterministic optimizer (quantityOptimizer.ts).
 *
 * The cases cover the three branches of docs/recipe_scaling_algorithm.md §5,
 * the scheme gate (an exact unit may not show a quarter of an unteilbar pack),
 * the decade-window candidate generation, the tie-break and the fallback.
 */

import { describe, expect, it } from 'vitest';

import type { OptimizableEntry, OptimizedQuantity } from './quantityOptimizer.js';
import { optimizeMasterQuantity, optimizeQuantity, optimizeUnitless } from './quantityOptimizer.js';

/** A bare ingredient (no additional units). */
const bare: OptimizableEntry = { bu: 'g', precision: 'medium', entries: [] };

/** Mehl: an unteilbar pack (integer counts only), 1000 g each. */
const mehl: OptimizableEntry = {
  bu: 'g',
  precision: 'medium',
  entries: [{ au: 'Packung (unteilbar)', factor: 1000 }],
};

/** Mehl with a divisible pack, for the exact-branch tests. */
const teilbar: OptimizableEntry = {
  bu: 'g',
  precision: 'medium',
  entries: [{ au: 'Packung (teilbar)', factor: 1000 }],
};

/** Joghurt: a 500 g Becher (exact, halves/integers scheme). */
const joghurt: OptimizableEntry = {
  bu: 'g',
  precision: 'medium',
  entries: [{ au: 'Becher', factor: 500 }],
};

/** An exact unit with a fractional factor (7.5 g per piece). */
const fractionalPiece: OptimizableEntry = {
  bu: 'g',
  precision: 'medium',
  entries: [{ au: 'Stück (BE zuerst, exakt)', factor: 7.5 }],
};

/** A factor list built from one unit name and factor. */
function entry(unit: string, factor: number): OptimizableEntry {
  return { bu: 'g', precision: 'medium', entries: [{ au: unit, factor }] };
}

describe('optimizeQuantity', () => {
  it('selects a perfect metric BQ when no AQ applies', () => {
    const result = optimizeQuantity(250, bare, 'g');
    expect(result.bq).toBe(250);
    expect(result.aq).toBeUndefined();
    expect(result.branch).toBe('metric');
  });

  it('selects the exact Becher for 500 g Joghurt', () => {
    const result = optimizeQuantity(500, joghurt, 'g');
    expect(result.branch).toBe('exact');
    expect(result.bq).toBe(500);
    expect(result.aq?.notation).toBe('1');
  });

  it('selects half a Becher for 250 g Joghurt', () => {
    const result = optimizeQuantity(250, joghurt, 'g');
    expect(result.branch).toBe('exact');
    expect(result.bq).toBe(250);
    expect(result.aq?.notation).toBe('1/2');
  });

  it('rejects a quarter of an unteilbar pack (scheme gate)', () => {
    // 250 g of a 1000 g unteilbar pack would be 1/4 pack; the scheme allows
    // integers only, so the metric BQ 250 wins instead.
    const result = optimizeQuantity(250, mehl, 'g');
    expect(result.aq).toBeUndefined();
    expect(result.bq).toBe(250);
  });

  it('allows a quarter of a divisible pack (scheme allows fractions)', () => {
    const result = optimizeQuantity(250, teilbar, 'g');
    expect(result.branch).toBe('exact');
    expect(result.aq?.notation).toBe('1/4');
    expect(result.bq).toBe(250);
  });

  it('rounds a non-integer exact AQ base quantity to whole grams', () => {
    // 1/3 of a 1000 g pack = 333.33 g; the exact branch does not consult the
    // BQ table, and the non-integer count rounds the displayed BQ to 333 g.
    const result = optimizeQuantity(333.33, teilbar, 'g');
    expect(result.branch).toBe('exact');
    expect(result.aq?.notation).toBe('1/3');
    expect(result.bq).toBe(333);
  });

  it('keeps the exact BQ of an integer AQ count even when the factor is fractional', () => {
    // The rule only rounds when the AQ itself is non-integer. 1 × 7.5 g stays
    // 7.5 g; 1.5 × 7.5 g = 11.25 g becomes 11 g.
    const exactFractional: OptimizableEntry = {
      bu: 'g',
      precision: 'medium',
      entries: [{ au: 'Stück (BE zuerst, exakt)', factor: 7.5 }],
    };
    expect(optimizeQuantity(7.5, exactFractional, 'g').bq).toBe(7.5);
    expect(optimizeQuantity(11.25, exactFractional, 'g').bq).toBe(11);
  });

  it('ties on equal accuracy/roundness toward the higher BQ', () => {
    // 1.5 g: BQ 1 and 2 are equally close; both penalties are 0.
    const result = optimizeQuantity(1.5, bare, 'g');
    expect(result.bq).toBe(2);
  });

  it('falls back to V0 when no BQ or AQ candidate fits', () => {
    const result: OptimizedQuantity = optimizeQuantity(0.5, bare, 'g');
    expect(result.fallback).toBe(true);
    expect(result.bq).toBe(0.5);
    expect(result.aq).toBeUndefined();
  });

  it('passes the ingredient precision through the cascade', () => {
    // The exact Becher is perfect at V0 = 500, so no precision can beat it;
    // just check the result stays valid and the entry precision is accepted.
    const result = optimizeQuantity(500, { ...joghurt, precision: 'very high' }, 'g');
    expect(result.aq?.notation).toBe('1');
  });

  it('returns a metric-only candidate for a bare ingredient without an AQ', () => {
    const result = optimizeQuantity(437, bare, 'g');
    expect(result.aq).toBeUndefined();
    expect(result.bq).toBe(400);
  });

  it('uses the EL unit when its integer count fits', () => {
    const result = optimizeQuantity(10, entry('Esslöffel', 10), 'g');
    expect(result.branch).toBe('non-exact');
    expect(result.aq?.notation).toBe('1');
  });
});

describe('optimizeMasterQuantity', () => {
  it('is the step result itself when the ingredient appears only once', () => {
    // 1/3 of a 1000 g pack displays as 67 g; the master row must keep the same
    // "1/3 Packung (67 g)" arrangement instead of re-optimizing the 67 g.
    const step = optimizeQuantity(66.67, teilbar, 'g');
    const master = optimizeMasterQuantity([{ quantity: 66.67 }], teilbar, 'g');
    expect(master.bq).toBe(step.bq);
    expect(master.aq?.notation).toBe(step.aq?.notation);
    expect(master.aq?.au.name).toBe(step.aq?.au.name);
    expect(master.branch).toBe(step.branch);
    expect(master.precision).toBe('medium');
  });

  it('uses the exact sum of the step BQs, which need not be a BQ', () => {
    // 1 × 7.5 g and 1,5 × 7.5 g display as 7.5 g and 11 g; the master BQ is
    // 18.5 g (no BQ table value) and the AQs sum to 2,5 pieces.
    const result = optimizeMasterQuantity(
      [{ quantity: 7.5 }, { quantity: 11.25 }],
      fractionalPiece,
      'g',
    );
    expect(result.bq).toBe(18.5);
    expect(result.aq?.value).toBe(2.5);
    expect(result.aq?.notation).toBe('2+1/2');
    expect(result.branch).toBe('non-exact');
  });

  it('sums the AQs exactly when every step uses the same AU', () => {
    const result = optimizeMasterQuantity([{ quantity: 450 }, { quantity: 250 }], joghurt, 'g');
    expect(result.bq).toBe(750);
    expect(result.aq?.notation).toBe('1+1/2');
    expect(result.aq?.au.name).toBe('Becher');
  });

  it('formats an AQ sum the AQ table does not contain', () => {
    // 1/8 + 1/6 of a 1000 g pack is 7/24. The exact sum is kept and rendered
    // as a reduced fraction, not rounded to a table value.
    const result = optimizeMasterQuantity([{ quantity: 125 }, { quantity: 500 / 3 }], teilbar, 'g');
    expect(result.bq).toBe(292);
    expect(result.aq?.notation).toBe('7/24');
  });

  it('does not charge a summed AQ its clumsiness penalty', () => {
    // Each 1/6 pack has penalty 1; their 1/3 sum has table penalty 0.33. The
    // master ignores that penalty, so the score stays near the accuracy error.
    const result = optimizeMasterQuantity(
      [{ quantity: 500 / 3 }, { quantity: 500 / 3 }],
      teilbar,
      'g',
    );
    expect(result.aq?.notation).toBe('1/3');
    expect(result.bq).toBe(334);
    expect(result.score).toBeLessThan(0.01);
  });

  it('never repeats a step AQ: "1 Packung" over "1 Packung" is rejected', () => {
    // Step 1 shows 1 Packung (1 kg), step 2 20 g. A master "1 Packung" (AQ 1)
    // would not be strictly larger than the step AQ, so the master stays metric
    // at the exact BQ sum of 1020 g instead.
    const result = optimizeMasterQuantity([{ quantity: 1000 }, { quantity: 20 }], mehl, 'g');
    expect(result.bq).toBe(1020);
    expect(result.aq).toBeUndefined();
    expect(result.branch).toBe('metric');
  });

  it('does not pair an exact count with a different BQ sum', () => {
    // Step 1 is 1 Becher (500 g), step 2 is metric 400 g. "2 Becher" would
    // imply 1000 g, not the 900 g BQ sum, so the master stays metric.
    const result = optimizeMasterQuantity([{ quantity: 500 }, { quantity: 400 }], joghurt, 'g');
    expect(result.bq).toBe(900);
    expect(result.aq).toBeUndefined();
    expect(result.branch).toBe('metric');
  });

  it('applies the strict-larger rule to a table AQ', () => {
    // Step 1 shows 1 EL (10 g), step 2 is metric 1 g. A master "1 EL" would
    // repeat the step count; "2 EL" is outside the window, so metric 11 g.
    const result = optimizeMasterQuantity(
      [{ quantity: 10 }, { quantity: 1 }],
      entry('Esslöffel', 10),
      'g',
    );
    expect(result.bq).toBe(11);
    expect(result.aq).toBeUndefined();
  });

  it('inherits the highest effective precision of its step rows', () => {
    const result = optimizeMasterQuantity(
      [{ quantity: 450, precision: 'very high' }, { quantity: 450 }],
      joghurt,
      'g',
    );
    expect(result.precision).toBe('very high');
    expect(result.bq).toBe(950);
    expect(result.aq).toBeUndefined();

    const allMedium = optimizeMasterQuantity([{ quantity: 450 }, { quantity: 450 }], joghurt, 'g');
    expect(allMedium.precision).toBe('medium');
    expect(allMedium.aq?.value).toBe(2);
  });

  it('takes a row override over the ingredient level when picking the highest', () => {
    const lowIngredient: OptimizableEntry = { ...joghurt, precision: 'low' };
    const result = optimizeMasterQuantity(
      [{ quantity: 500, precision: 'high' }, { quantity: 500 }],
      lowIngredient,
      'g',
    );
    expect(result.precision).toBe('high');
  });

  it('rejects an empty or non-positive use list', () => {
    expect(() => optimizeMasterQuantity([], joghurt, 'g')).toThrow('at least one use');
    expect(() => optimizeMasterQuantity([{ quantity: 0 }], joghurt, 'g')).toThrow(
      'positive finite',
    );
  });
});

describe('optimizeUnitless', () => {
  it('selects a perfect AQ count for a unitless artifact', () => {
    const result = optimizeUnitless(0.5, {});
    expect(result.value).toBe(0.5);
    expect(result.notation).toBe('1/2');
  });

  it('falls back to the plain target when no AQ value fits', () => {
    const result = optimizeUnitless(0.01, {});
    expect(result.fallback).toBe(true);
    expect(result.value).toBe(0.01);
  });

  it('honours the per-artifact precision override', () => {
    // Low precision prefers the clean integer 2 over the perfect but clumsier
    // 1+1/2 (penalty 0.33); medium keeps the exact half.
    expect(optimizeUnitless(1.5, {}).notation).toBe('1+1/2');
    expect(optimizeUnitless(1.5, { quantity: 'very low' }).notation).toBe('2');
    expect(optimizeUnitless(1.5, { quantity: 'very high' }).notation).toBe('1+1/2');
  });
});
