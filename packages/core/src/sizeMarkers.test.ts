/**
 * Tests for the size-marker resolver (docs/quantity_scaling.md, size markers).
 *
 * The examples use the Backring's even sizes 16 … 30 and the existing
 * 8-serving/26er strawberry cake as the reference recipe.
 */

import { describe, expect, it } from 'vitest';

import {
  formatSizeMarker,
  resetSizeMarkers,
  resolveSizeMarker,
  sizeMarkerFallbackText,
  sizeMarkerFor,
} from './sizeMarkers.js';
import { SIZE_MARKERS as SEED_MARKERS, type SizeMarkerDefinition } from './sizeMarkersData.js';

const backring = SEED_MARKERS[0]!;

/**
 * Feminine and neuter markers are synthetic: the seed table has only Backring,
 * but a later master-data row must work without a code change. The gender is
 * the only per-marker grammar input.
 */
const springform: SizeMarkerDefinition = {
  ...backring,
  marker: 'Springform',
  singular: 'Springform',
  plural: 'Springformen',
  gender: 'f',
};
const blech: SizeMarkerDefinition = {
  ...backring,
  marker: 'Blech',
  singular: 'Blech',
  plural: 'Bleche',
  gender: 'n',
};

describe('sizeMarkerFor', () => {
  it('finds the registered marker and rejects unknown keys', () => {
    expect(sizeMarkerFor('Backring')).toBe(backring);
    expect(sizeMarkerFor(' Backring ')).toBe(backring);
    expect(sizeMarkerFor('Springform')).toBeUndefined();
  });

  it('restores the seed registry', () => {
    resetSizeMarkers();
    expect(sizeMarkerFor('Backring')).toBe(backring);
  });
});

describe('resolveSizeMarker', () => {
  it('keeps the written arrangement at factor 1', () => {
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 1)).toEqual({
      count: 1,
      size: 26,
      idealSize: 26,
      text: '1 26er Backring',
    });
    // A written recipe that already uses two molds keeps that arrangement.
    expect(resolveSizeMarker({ marker: 'Backring', count: 2, size: 20 }, 1)).toEqual({
      count: 2,
      size: 20,
      idealSize: 20,
      text: '2 20er Backringe',
    });
  });

  it('scales the diameter by the square root of the quantity', () => {
    // 8 → 16 servings (factor 2): area doubles, diameter ×√2; 2 × 26er is exact.
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 2)).toEqual({
      count: 2,
      size: 26,
      idealSize: 26,
      text: '2 26er Backringe',
    });
    // 8 → 12 servings (factor 1.5): per-mold ideal 22.52 cm; nearest even 22.
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 1.5)).toEqual({
      count: 2,
      size: 22,
      idealSize: Math.sqrt(507),
      text: '2 22er Backringe',
    });
    // 8 → 10 servings (factor 1.25): 29.07 cm ideal; nearest even 30.
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 1.25)).toEqual({
      count: 1,
      size: 30,
      idealSize: Math.sqrt(845),
      text: '1 30er Backring',
    });
  });

  it('scales down and clamps below the smallest available mold', () => {
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 0.5)).toEqual({
      count: 1,
      size: 18,
      idealSize: Math.sqrt(338),
      text: '1 18er Backring',
    });
    // Below 16 no smaller mold exists: one 16er, batter shallower.
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 0.25)).toEqual({
      count: 1,
      size: 16,
      idealSize: 13,
      text: '1 16er Backring',
    });
  });

  it('splits a written multi-mold arrangement by the same area rule', () => {
    expect(resolveSizeMarker({ marker: 'Backring', count: 2, size: 20 }, 1.5)).toEqual({
      count: 2,
      size: 24,
      idealSize: Math.sqrt(600),
      text: '2 24er Backringe',
    });
    expect(resolveSizeMarker({ marker: 'Backring', count: 2, size: 20 }, 0.5)).toEqual({
      count: 1,
      size: 20,
      idealSize: 20,
      text: '1 20er Backring',
    });
  });

  it('inflects the prose phrase from the stored case', () => {
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26, grammaticalCase: 'akk' }, 1)
        ?.text,
    ).toBe('einen 26er Backring');
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26, grammaticalCase: 'dat' }, 1)
        ?.text,
    ).toBe('einem 26er Backring');
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26, grammaticalCase: 'nom' }, 1)
        ?.text,
    ).toBe('ein 26er Backring');
    // Scaling keeps the case; the derived count turns the article into a word.
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26, grammaticalCase: 'akk' }, 1.5)
        ?.text,
    ).toBe('zwei 22er Backringe');
    // The dative plural takes its -n.
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 2, size: 20, grammaticalCase: 'dat' }, 1)
        ?.text,
    ).toBe('zwei 20er Backringen');
  });

  it('renders the reference readout without a count of 1 and with numerals from 2', () => {
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26, grammaticalCase: 'akk' }, 1, {
        surface: 'readout',
      })?.text,
    ).toBe('26er Backring');
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 1.5, {
        surface: 'readout',
      })?.text,
    ).toBe('2 22er Backringe');
  });

  it('returns undefined for unknown markers or invalid inputs', () => {
    expect(resolveSizeMarker({ marker: 'Springform', count: 1, size: 26 }, 1)).toBeUndefined();
    expect(resolveSizeMarker({ marker: 'Backring', count: 0, size: 26 }, 1)).toBeUndefined();
    expect(resolveSizeMarker({ marker: 'Backring', count: 1.5, size: 26 }, 1)).toBeUndefined();
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 0 }, 1)).toBeUndefined();
    expect(resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, 0)).toBeUndefined();
    expect(
      resolveSizeMarker({ marker: 'Backring', count: 1, size: 26 }, Number.NaN),
    ).toBeUndefined();
  });
});

describe('formatSizeMarker', () => {
  it('keeps the legacy numeral form when no case is stored', () => {
    expect(formatSizeMarker(backring, 1, 26)).toBe('1 26er Backring');
    expect(formatSizeMarker(backring, 2, 20)).toBe('2 20er Backringe');
    expect(formatSizeMarker(backring, 10, 18)).toBe('10 18er Backringe');
  });

  it('writes counts 2–12 out and keeps 13+ as numerals', () => {
    const akk = { surface: 'prose', grammaticalCase: 'akk' } as const;
    expect(formatSizeMarker(backring, 2, 20, akk)).toBe('zwei 20er Backringe');
    expect(formatSizeMarker(backring, 12, 20, akk)).toBe('zwölf 20er Backringe');
    expect(formatSizeMarker(backring, 13, 20, akk)).toBe('13 20er Backringe');
  });

  it('inflects the article for the marker gender and the stored case', () => {
    const akk = { surface: 'prose', grammaticalCase: 'akk' } as const;
    const dat = { surface: 'prose', grammaticalCase: 'dat' } as const;
    expect(formatSizeMarker(backring, 1, 26, akk)).toBe('einen 26er Backring');
    expect(formatSizeMarker(backring, 1, 26, dat)).toBe('einem 26er Backring');
    expect(formatSizeMarker(springform, 1, 26, akk)).toBe('eine 26er Springform');
    expect(formatSizeMarker(springform, 1, 26, dat)).toBe('einer 26er Springform');
    expect(formatSizeMarker(blech, 1, 30, akk)).toBe('ein 30er Blech');
    expect(formatSizeMarker(blech, 1, 30, dat)).toBe('einem 30er Blech');
  });

  it('adds the dative plural -n unless the plural already ends in n or s', () => {
    const dat = { surface: 'prose', grammaticalCase: 'dat' } as const;
    expect(formatSizeMarker(backring, 2, 20, dat)).toBe('zwei 20er Backringen');
    expect(formatSizeMarker(springform, 2, 26, dat)).toBe('zwei 26er Springformen');
    expect(formatSizeMarker(blech, 2, 30, dat)).toBe('zwei 30er Blechen');
  });

  it('renders the readout without a count of 1 and with numerals from 2', () => {
    const readout = { surface: 'readout' } as const;
    expect(formatSizeMarker(backring, 1, 26, readout)).toBe('26er Backring');
    expect(formatSizeMarker(backring, 2, 20, readout)).toBe('2 20er Backringe');
    expect(formatSizeMarker(backring, 12, 20, readout)).toBe('12 20er Backringe');
  });

  it('supports a pattern with an explicit unit', () => {
    expect(
      formatSizeMarker(
        {
          ...backring,
          unit: 'cm',
          pattern: '<DET> <SIZE> <UNIT> <INF>',
        },
        2,
        24,
        { surface: 'prose', grammaticalCase: 'akk' },
      ),
    ).toBe('zwei 24 cm Backringe');
  });
});

describe('sizeMarkerFallbackText', () => {
  it('renders the stored arrangement without consulting the registry', () => {
    expect(sizeMarkerFallbackText({ count: 1, size: 26, unit: 'cm', marker: 'Unbekannt' })).toBe(
      '1 26 cm Unbekannt',
    );
  });
});
