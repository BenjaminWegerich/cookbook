/**
 * Tests for the ingredient markers (storage_format.md §4 — decided with the
 * user: the step text is the source of truth for the ingredient list).
 */

import { describe, expect, it } from 'vitest';

import {
  deriveIngredients,
  extractMarkers,
  insertMarkerIntoStep,
  markerToText,
  replaceMarkers,
  updateMarkersByName,
  type IngredientMarker,
} from './markers.js';

const JOGHURT: IngredientMarker = { name: 'Joghurt', quantity: 400, unit: 'g' };
const ZITRONENSAFT: IngredientMarker = { name: 'Zitronensaft', quantity: 15, unit: 'ml' };
const BECHAMEL: IngredientMarker = {
  name: 'Béchamelsauce',
  quantity: 500,
  unit: 'ml',
  recipe: 'Béchamelsauce',
};

describe('markerToText', () => {
  it('writes the canonical marker text', () => {
    expect(markerToText(JOGHURT)).toBe('{{ingredient|Joghurt|400|g}}');
    expect(markerToText({ ...JOGHURT, reference: true })).toBe('{{ingredient|Joghurt|400|g|ref}}');
    expect(markerToText(BECHAMEL)).toBe('{{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}}');
    expect(markerToText({ ...BECHAMEL, reference: true })).toBe(
      '{{ingredient|Béchamelsauce|500|ml|ref|recipe:Béchamelsauce}}',
    );
  });
});

describe('extractMarkers', () => {
  it('extracts markers from prose, preserving order and flags', () => {
    const step =
      '{{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren und mit {{ingredient|Joghurt|200|g|ref}} servieren.';
    expect(extractMarkers(step)).toEqual([
      JOGHURT,
      ZITRONENSAFT,
      { name: 'Joghurt', quantity: 200, unit: 'g', reference: true },
    ]);
  });

  it('returns an empty list for prose without markers', () => {
    expect(extractMarkers('Alles gut durchrühren.')).toEqual([]);
  });
});

describe('deriveIngredients', () => {
  it('orders by first appearance and merges duplicates with the total', () => {
    const steps = [
      '{{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren.',
      'Mit {{ingredient|Joghurt|400|g}} servieren.',
    ];
    expect(deriveIngredients(steps)).toEqual([
      { name: 'Joghurt', quantity: 800, unit: 'g' },
      ZITRONENSAFT,
    ]);
  });

  it('rounds a non-ladder sum to the nearest rung (400 + 750 = 1150 → 1200)', () => {
    const steps = ['{{ingredient|Joghurt|400|g}}', '{{ingredient|Joghurt|750|g}}'];
    expect(deriveIngredients(steps)).toEqual([{ name: 'Joghurt', quantity: 1200, unit: 'g' }]);
  });

  it('keeps the reference flag and the recipe link of merged markers', () => {
    const steps = [
      '{{ingredient|Joghurt|200|g}}',
      '{{ingredient|Joghurt|200|g|ref}}',
      '{{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}}',
    ];
    expect(deriveIngredients(steps)).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g', reference: true },
      BECHAMEL,
    ]);
  });
});

describe('replaceMarkers', () => {
  it('replaces marker values while keeping the surrounding text', () => {
    const step = '{{ingredient|Joghurt|400|g}} verrühren.';
    expect(replaceMarkers(step, (marker) => ({ ...marker, quantity: 600 }))).toBe(
      '{{ingredient|Joghurt|600|g}} verrühren.',
    );
  });

  it('deletes a marker when the updater returns null', () => {
    const step = '{{ingredient|Joghurt|400|g}} verrühren.';
    expect(replaceMarkers(step, () => null)).toBe(' verrühren.');
  });
});

describe('updateMarkersByName', () => {
  it('updates every marker of the name and leaves others untouched', () => {
    const steps = ['{{ingredient|Joghurt|400|g}} und {{ingredient|Zitronensaft|15|ml}}.'];
    const result = updateMarkersByName(steps, 'Joghurt', (marker) => ({
      ...marker,
      quantity: 600,
    }));
    expect(result).toEqual(['{{ingredient|Joghurt|600|g}} und {{ingredient|Zitronensaft|15|ml}}.']);
  });

  it('removes every marker of the name when the updater returns null', () => {
    const steps = ['{{ingredient|Joghurt|400|g}} und {{ingredient|Joghurt|200|g}}.'];
    expect(updateMarkersByName(steps, 'Joghurt', () => null)).toEqual([' und .']);
  });
});

describe('insertMarkerIntoStep', () => {
  it('inserts the marker text at the given offset', () => {
    expect(insertMarkerIntoStep('Mit  verrühren.', 4, JOGHURT)).toBe(
      'Mit {{ingredient|Joghurt|400|g}} verrühren.',
    );
  });

  it('clamps the offset into the step', () => {
    expect(insertMarkerIntoStep('Text', 99, JOGHURT)).toBe('Text{{ingredient|Joghurt|400|g}}');
  });
});
