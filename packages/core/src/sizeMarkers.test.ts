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
import { SIZE_MARKERS as SEED_MARKERS } from './sizeMarkersData.js';

const backring = SEED_MARKERS[0]!;

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
  it('always renders the count and selects the noun form', () => {
    expect(formatSizeMarker(backring, 1, 26)).toBe('1 26er Backring');
    expect(formatSizeMarker(backring, 2, 20)).toBe('2 20er Backringe');
    expect(formatSizeMarker(backring, 10, 18)).toBe('10 18er Backringe');
  });

  it('supports a pattern with an explicit unit', () => {
    expect(
      formatSizeMarker(
        {
          ...backring,
          unit: 'cm',
          pattern: '<N>× <SIZE> <UNIT> <INF>',
        },
        2,
        24,
      ),
    ).toBe('2× 24 cm Backringe');
  });
});

describe('sizeMarkerFallbackText', () => {
  it('renders the stored arrangement without consulting the registry', () => {
    expect(sizeMarkerFallbackText({ count: 1, size: 26, unit: 'cm', marker: 'Unbekannt' })).toBe(
      '1 26 cm Unbekannt',
    );
  });
});
