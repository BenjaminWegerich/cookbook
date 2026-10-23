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
  renderAQSDisplay,
  renderAQSSlash,
  renderMasterAQSDisplay,
  renderMasterAQSDisplaySlash,
  renderPantryChipDisplay,
  resolveReorderPoint,
  selectAQ,
  splitArrangementNotes,
} from './additionalUnits.js';
import { ADDITIONAL_UNITS, NUMBER_SCHEMES } from './additionalUnitsData.js';
import {
  resetIngredientMappings,
  setIngredientMappings,
  allIngredientMappings,
} from './ingredientRegistry.js';

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

  it('passes a per-quantity precision through the context', () => {
    // The exact Becher is perfect at 500 g, so every level keeps it; the call
    // must simply accept the context.
    expect(renderAQS('Joghurt', 500, 'g', { quantity: 'very high' })).toContain('1');
  });
});

describe('arrangement notes', () => {
  it('splits the note out for styled display and keeps the written line', () => {
    expect(renderAQSDisplay('Joghurt', 500, 'g')).toEqual({
      text: `1${NB}Becher Joghurt (500${NB}g)`,
      parts: [
        { kind: 'text', value: `1${NB}Becher Joghurt` },
        { kind: 'note', value: `500${NB}g` },
      ],
    });
  });

  it('keeps the base form as one text run', () => {
    expect(renderAQSDisplay('Mehl', 250, 'g')).toEqual({
      text: `250${NB}g Mehl`,
      parts: [{ kind: 'text', value: `250${NB}g Mehl` }],
    });
  });

  it('does not read parentheses in an ingredient name as a note', () => {
    // The template has no brackets, so the name stays part of the plain text.
    expect(renderAQSDisplay('Test (bio)', 250, 'g').parts).toEqual([
      { kind: 'text', value: `250${NB}g Test (bio)` },
    ]);
  });

  it('splits the note in the template, not in the rendered line', () => {
    expect(splitArrangementNotes('<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU> Abtropfgewicht)')).toEqual([
      { kind: 'text', template: '<AQ><NNBSP><AU> <IN> ' },
      { kind: 'note', template: '<BQ><NNBSP><BU> Abtropfgewicht' },
    ]);
  });

  it('splits the pantry chip’s note although the chip hides the name', () => {
    const display = renderPantryChipDisplay('Joghurt', 400, 'g');
    expect(display.text).toBe(`⅚${NB}Becher (400${NB}g)`);
    expect(display.parts).toEqual([
      { kind: 'text', value: `⅚${NB}Becher` },
      { kind: 'note', value: `400${NB}g` },
    ]);
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
    expect(result.previewDisplay.parts).toEqual([
      { kind: 'text', value: `½${NB}Becher Joghurt` },
      { kind: 'note', value: `250${NB}g` },
    ]);
  });

  it('keeps the entered amount for a bare ingredient', () => {
    setIngredientMappings({
      Testzutat: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
    });
    const result = resolveReorderPoint('Testzutat', allIngredientMappings().Testzutat, 123, 'g');
    expect(result.storedValue).toBe(123);
    expect(result.preview).toBe(`123${NB}g Testzutat`);
  });

  it('keeps the unbegrenzt form for infinite stock', () => {
    expect(resolveReorderPoint('Wasser', allIngredientMappings().Wasser, Infinity, 'ml')).toEqual({
      preview: 'unbegrenzt Wasser',
      previewDisplay: {
        text: 'unbegrenzt Wasser',
        parts: [{ kind: 'text', value: 'unbegrenzt Wasser' }],
      },
      storedValue: Infinity,
    });
  });
});

describe('renderMasterAQSDisplay (constrained master row)', () => {
  it('renders a single use exactly like the step row', () => {
    // 1/3 of a 200 g pack displays as 67 g on the step row; re-optimizing the
    // 67 g alone would lose the pack, so the master must copy the step result.
    expect(renderMasterAQSDisplay('Naturtofu', [{ quantity: 66.67 }], 'g')).toEqual(
      renderAQSDisplay('Naturtofu', 66.67, 'g'),
    );
  });

  it('sums the AQs when all steps use the same unit', () => {
    // 1 Becher (500 g) + 1/2 Becher (250 g) → 1 1/2 Becher (750 g).
    expect(
      renderMasterAQSDisplay('Joghurt', [{ quantity: 450 }, { quantity: 250 }], 'g').text,
    ).toBe(`1${NB}½${NB}Becher Joghurt (750${NB}g)`);
  });

  it('does not repeat a step pack in the master row', () => {
    // The user's example: step 1 "1 Packung Mehl (1 kg)", step 2 "20 g"; the
    // master must be the exact BQ sum "1,02 kg", not "1 Packung (1,02 kg)".
    expect(renderMasterAQSDisplay('Mehl', [{ quantity: 1000 }, { quantity: 20 }], 'g').text).toBe(
      `1,02${NB}kg Mehl`,
    );
  });

  it('writes a master fraction above one as a mixed fraction with NNBSP', () => {
    // The cooking view writes "1 1/2", never the improper "3/2".
    const line = renderMasterAQSDisplaySlash(
      'Joghurt',
      [{ quantity: 450 }, { quantity: 250 }],
      'g',
    ).text;
    expect(line).toBe(`1${NB}1/2${NB}Becher Joghurt (750${NB}g)`);
    expect(line).not.toContain('3/2');
  });
});
