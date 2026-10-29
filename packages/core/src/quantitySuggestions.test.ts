/**
 * Tests for the adaptive quantity suggestions (quantitySuggestions.ts).
 *
 * The cases pin the agreed procedure: the factor-2 candidate band, the tap-state
 * normalization, the BQ/AQ dedupe, the 50/50 penalty + log-distance ranking, and
 * the unitless analogue. They also pin the deliberate outcome that a spoon
 * reading may outrank a package when it is closer (no package-vs-spoon rule).
 */

import { describe, expect, it } from 'vitest';

import { NNBSP, renderOptimizedChipDisplay } from './additionalUnits.js';
import { mappingsFor } from './ingredientRegistry.js';
import {
  CANDIDATE_BAND_FACTOR,
  optimizeQuantity,
  optimizeUnitless,
  type OptimizableEntry,
} from './quantityOptimizer.js';
import {
  SUGGESTION_DISTANCE_WEIGHT,
  SUGGESTION_PENALTY_WEIGHT,
  suggestQuantities,
  suggestUnitlessQuantities,
  type QuantitySuggestion,
} from './quantitySuggestions.js';

/** Joghurt from the seed master data: a 500 g Becher plus EL / TL. */
const joghurt = mappingsFor('Joghurt')!;
/** Zitronensaft from the seed master data: spoons and pieces, no package. */
const lemon = mappingsFor('Zitronensaft')!;

/**
 * A 125 g integer-only pack, for the candidate example in the specification:
 * at V0 = 94 the anchor 125 is in the band, 62.5 is rejected by the scheme and
 * 250 lies outside the band.
 */
const integerPack: OptimizableEntry = {
  bu: 'g',
  precision: 'medium',
  entries: [{ au: 'Packung (unteilbar)', factor: 125 }],
};

/** The ranking score of one suggestion, mirroring round 5. */
function rank(suggestion: QuantitySuggestion): number {
  return (
    SUGGESTION_PENALTY_WEIGHT * suggestion.score + SUGGESTION_DISTANCE_WEIGHT * suggestion.distance
  );
}

/** Asserts that the list is sorted by the round-5 score. */
function expectRanked(suggestions: readonly QuantitySuggestion[]): void {
  for (let index = 0; index + 1 < suggestions.length; index += 1) {
    expect(rank(suggestions[index]!)).toBeLessThanOrEqual(rank(suggestions[index + 1]!) + 1e-9);
  }
}

describe('suggestQuantities', () => {
  it('builds candidates from listed BQs plus exact anchors in the band', () => {
    const values = suggestQuantities(94, integerPack, 'g').map((suggestion) => suggestion.value);
    expect(values).toContain(125); // 1 Packung (125 g)
    expect(values).not.toContain(62.5); // the integer scheme rejects half a pack
    expect(values).not.toContain(250); // outside [94 / 2, 94 · 2]
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(94 / CANDIDATE_BAND_FACTOR - 1e-6);
      expect(value).toBeLessThanOrEqual(94 * CANDIDATE_BAND_FACTOR + 1e-6);
    }
  });

  it('normalizes to the state the field shows after the tap', () => {
    // The Zitronensaft BQ 110 optimizes to "3 Stück (100 ml)" but the field at
    // 100 ml reads "10 EL (100 ml)". The chip must be the latter.
    const suggestions = suggestQuantities(110, lemon, 'ml');
    const hundred = suggestions.find((suggestion) => suggestion.value === 100);
    expect(hundred).toBeDefined();
    expect(hundred?.display.text).toContain('EL');
    expect(suggestions.some((suggestion) => suggestion.value === 110)).toBe(false);

    // Every chip is a tap-state fixed point: tapping the displayed BQ leaves the
    // field showing exactly the chip's label.
    for (const suggestion of suggestions) {
      const tapped = optimizeQuantity(suggestion.value, lemon, 'ml');
      expect(tapped.fallback).toBe(false);
      expect(tapped.bq).toBeCloseTo(suggestion.value, 6);
      expect(renderOptimizedChipDisplay(lemon, tapped, 'ml').text).toBe(suggestion.display.text);
      expect(tapped.score).toBeCloseTo(suggestion.score, 9);
    }
  });

  it('keeps one chip per BQ and one per AQ/AU', () => {
    for (const value of [200, 250, 500, 1000]) {
      const suggestions = suggestQuantities(value, joghurt, 'g');
      const values = suggestions.map((suggestion) => suggestion.value);
      expect(new Set(values).size).toBe(values.length);
      // The 200 g spoon pair must collapse into one chip.
      const spoonsAt200 = suggestions.filter(
        (suggestion) => suggestion.display.text.includes('EL') && suggestion.value === 200,
      );
      expect(spoonsAt200.length).toBeLessThanOrEqual(1);
      expectRanked(suggestions);
    }
  });

  it('ranks 1 Becher over 400 g at 437 g (cleaner arrangement wins)', () => {
    const values = suggestQuantities(437, joghurt, 'g').map((suggestion) => suggestion.value);
    expect(values[0]).toBe(500); // 1 Becher (500 g)
    expect(values).toContain(400);
  });

  it('keeps a closer spoon at 250 g (no package-vs-spoon rule)', () => {
    const suggestions = suggestQuantities(250, joghurt, 'g');
    expect(suggestions[0]?.value).toBe(250); // ½ Becher (250 g)
    const values = suggestions.map((suggestion) => suggestion.value);
    const spoon = suggestions.find((suggestion) => suggestion.value === 200);
    expect(spoon?.display.text).toContain('EL');
    // The spoon is closer than the 350 g metric chip and stays in the row.
    expect(values.indexOf(200)).toBeLessThan(values.indexOf(350));
  });

  it('uses the 50/50 penalty + log-distance ranking', () => {
    for (const value of [94, 200, 250, 300, 437, 500, 1000]) {
      const suggestions = suggestQuantities(value, joghurt, 'g');
      expectRanked(suggestions);
      for (const suggestion of suggestions) {
        expect(suggestion.distance).toBeCloseTo(Math.abs(Math.log2(suggestion.value / value)), 9);
        expect(suggestion.distance).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('offers metric chips only when the ingredient has no additional units', () => {
    const suggestions = suggestQuantities(1000, undefined, 'g');
    expect(suggestions[0]?.value).toBe(1000);
    expect(suggestions[0]?.display.text).toBe(`1${NNBSP}kg`);
    for (const suggestion of suggestions) {
      expect(suggestion.display.text).toMatch(/(g|kg)$/);
    }
    expectRanked(suggestions);
  });

  it('caps the chips to the targets the caller can actually store', () => {
    // The meal plan passes the export's pre-baked yield views here: a chip
    // outside that list would set a size the link cannot open.
    const baked = [200, 250, 300, 400];
    const capped = suggestQuantities(437, joghurt, 'g', { allowedValues: baked });
    expect(capped.length).toBeGreaterThan(0);
    for (const suggestion of capped) {
      expect(baked).toContain(suggestion.value);
    }
    // The cap removes the unrestricted winner (500 g, "1 Becher") and keeps
    // the ranking of what remains untouched.
    expect(capped[0]?.value).toBe(400);
    const full = suggestQuantities(437, joghurt, 'g');
    expect(capped.map((suggestion) => suggestion.value)).toEqual(
      full
        .filter((suggestion) => baked.includes(suggestion.value))
        .map((suggestion) => suggestion.value),
    );
    // Labels come from the same optimizer result, so a surviving chip still
    // reads exactly what the field will show after the tap.
    for (const suggestion of capped) {
      const tapped = optimizeQuantity(suggestion.value, joghurt, 'g');
      expect(renderOptimizedChipDisplay(joghurt, tapped, 'g').text).toBe(suggestion.display.text);
    }
  });

  it('offers no chip when the cap excludes every candidate', () => {
    expect(
      suggestQuantities(437, joghurt, 'g', { allowedValues: [1, 2, 3] }),
    ).toEqual([]);
  });

  it('returns nothing for a value the field cannot hold', () => {
    expect(suggestQuantities(0, joghurt, 'g')).toEqual([]);
    expect(suggestQuantities(Number.NaN, joghurt, 'g')).toEqual([]);
  });
});

describe('suggestUnitlessQuantities', () => {
  it('offers the current count and its clean neighbours', () => {
    const suggestions = suggestUnitlessQuantities(2);
    expect(suggestions[0]?.value).toBe(2);
    expect(suggestions.map((suggestion) => suggestion.value)).toContain(1.5);
    expect(suggestions.map((suggestion) => suggestion.value)).toContain(1);
    expectRanked(suggestions);
    for (const suggestion of suggestions) {
      expect(suggestion.value).toBeGreaterThanOrEqual(2 / CANDIDATE_BAND_FACTOR - 1e-9);
      expect(suggestion.value).toBeLessThanOrEqual(2 * CANDIDATE_BAND_FACTOR + 1e-9);
      // A count is its own tap state.
      expect(optimizeUnitless(suggestion.value).value).toBeCloseTo(suggestion.value, 9);
    }
  });

  it('labels a chip with the canonical fraction notation', () => {
    const suggestions = suggestUnitlessQuantities(2);
    expect(suggestions.find((suggestion) => suggestion.value === 1.5)?.display.text).toBe(
      `1${NNBSP}½`,
    );
    expect(suggestions.find((suggestion) => suggestion.value === 2)?.display.text).toBe('2');
  });

  it('returns nothing for an invalid count', () => {
    expect(suggestUnitlessQuantities(0)).toEqual([]);
  });
});
