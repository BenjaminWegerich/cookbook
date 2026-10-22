/**
 * Tests for the display layer after the switch to the optimizer: the recipe
 * line, the AQ typography and the generated master data.
 *
 * The old priority/scheme scan is gone; these cases assert the new contract:
 * the optimizer picks the BQ/AQ, the arrangement renders it, and the plain base
 * form is used when no candidate fits.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  formatAQ,
  formatAQValue,
  formatBQ,
  masterIngredientNames,
  NNBSP,
  renderAQS,
  renderAQSSlash,
  resolveReorderPoint,
  selectAQ,
} from './additionalUnits.js';
import { ADDITIONAL_UNITS, NUMBER_SCHEMES } from './additionalUnitsData.js';
import { resetIngredientMappings, setIngredientMappings, allIngredientMappings } from './ingredientRegistry.js';

/** The typographic space of every displayed quantity. */
const NB = NNBSP;

beforeEach(() => {
  resetIngredientMappings();
});

describe('generated master data', () => {
  it('exposes the mapped ingredient names for the editor autocomplete', () => {
    const names = masterIngredientNames();
    expect(names).toContain('Joghurt');
    expect(names).toContain('Mehl');
    expect(names.length).toBeGreaterThan(100);
  });

  it('defines every unit scheme in the AQ table', () => {
    for (const unit of ADDITIONAL_UNITS) {
      expect(NUMBER_SCHEMES[unit.numberScheme], unit.name).toBeDefined();
      expect((NUMBER_SCHEMES[unit.numberScheme] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('maps Joghurt to a 500 g Becher plus its spoons (the new seed)', () => {
    const entry = allIngredientMappings().Joghurt;
    expect(entry?.entries.map((mapping) => mapping.au)).toEqual([
      'Becher',
      'Esslöffel',
      'Teelöffel',
    ]);
    expect(entry?.entries[0]).toEqual({ au: 'Becher', factor: 500 });
  });

  it('maps Mehl to exactly one shopping unit (Packung unteilbar)', () => {
    const entry = allIngredientMappings().Mehl;
    expect(entry?.entries).toEqual([{ au: 'Packung (unteilbar)', factor: 1000 }]);
  });

  it('allows at most one shopping unit per ingredient', () => {
    for (const [name, entry] of Object.entries(allIngredientMappings())) {
      const shopping = entry.entries.filter((mapping) => {
        const unit = ADDITIONAL_UNITS.find((candidate) => candidate.name === mapping.au);
        return unit?.shoppingUnit === true;
      });
      expect(shopping.length, name).toBeLessThanOrEqual(1);
    }
  });
});

describe('renderAQS (optimizer-backed)', () => {
  it('renders a whole Becher Joghurt', () => {
    expect(renderAQS('Joghurt', 500, 'g')).toBe(`1${NB}Becher Joghurt (500${NB}g)`);
  });

  it('renders half a Becher with the fraction glyph', () => {
    expect(renderAQS('Joghurt', 250, 'g')).toBe(`½${NB}Becher Joghurt (250${NB}g)`);
  });

  it('rejects a quarter of an unteilbar pack and shows the metric BQ', () => {
    expect(renderAQS('Mehl', 250, 'g')).toBe(`250${NB}g Mehl`);
  });

  it('renders one whole unteilbar pack', () => {
    expect(renderAQS('Mehl', 1000, 'g')).toBe(`1${NB}Packung Mehl (1${NB}kg)`);
  });

  it('falls back to the plain base form when no candidate fits', () => {
    expect(renderAQS('Mehl', 0.5, 'g')).toBe(`0,5${NB}g Mehl`);
  });

  it('renders the slash form for the cooking view', () => {
    expect(renderAQSSlash('Joghurt', 250, 'g')).toBe(`1/2${NB}Becher Joghurt (250${NB}g)`);
  });

  it('selectAQ returns null when only a metric BQ fits', () => {
    expect(selectAQ('Mehl', 250, 'g')).toBeNull();
    expect(selectAQ('Joghurt', 500, 'g')?.aq).toBe('1');
  });

  it('passes a recipe tolerance through the context', () => {
    // The exact Becher is perfect at 500 g, so every tolerance keeps it; the
    // call must simply accept the context.
    expect(renderAQS('Joghurt', 500, 'g', { recipe: 1 })).toContain('1');
  });
});

describe('formatting', () => {
  it('formats the new AQ glyphs 5/8 and 5/6', () => {
    expect(formatAQ('5/8')).toBe('⅝');
    expect(formatAQ('5/6')).toBe('⅚');
  });

  it('formats a number with the German comma and at most two decimals', () => {
    expect(formatBQ(166.66666666666666, 'g')).toBe(`166,67${NB}g`);
  });

  it('formats a mixed AQ value with the narrow no-break space', () => {
    expect(formatAQValue(1.25)).toBe(`1${NB}¼`);
  });
});

describe('resolveReorderPoint', () => {
  it('snaps an exact unit to its amount and previews the optimizer line', () => {
    const result = resolveReorderPoint('Joghurt', allIngredientMappings().Joghurt, 250, 'g');
    expect(result.storedValue).toBe(250);
    expect(result.preview).toBe(`½${NB}Becher Joghurt (250${NB}g)`);
  });

  it('keeps the entered amount for a bare ingredient', () => {
    setIngredientMappings({
      Testzutat: { bu: 'g', reorderPoint: 0, entries: [] },
    });
    const result = resolveReorderPoint('Testzutat', allIngredientMappings().Testzutat, 123, 'g');
    expect(result.storedValue).toBe(123);
    expect(result.preview).toBe(`123${NB}g Testzutat`);
  });

  it('keeps the unbegrenzt form for infinite stock', () => {
    expect(resolveReorderPoint('Wasser', allIngredientMappings().Wasser, Infinity, 'ml')).toEqual({
      preview: 'unbegrenzt Wasser',
      storedValue: Infinity,
    });
  });
});
