import { describe, expect, it } from 'vitest';

import { ADDITIONAL_UNITS, INGREDIENT_MAPPINGS, NUMBER_SCHEMES } from './additionalUnitsData.js';
import {
  formatBQ,
  roundToAQ,
  selectAQ,
  renderAQS,
  masterIngredientNames,
} from './additionalUnits.js';
import { LADDER_RUNGS } from './ladderData.js';

/** Narrow no-break space (U+202F), compiled from <NNBSP> in the arrangements. */
const NNBSP = '\u202F';

describe('generated additional-unit master data', () => {
  it('exposes the mapped ingredient names for the editor autocomplete', () => {
    expect(masterIngredientNames()).toEqual(Object.keys(INGREDIENT_MAPPINGS).sort());
    expect(masterIngredientNames()).toContain('Joghurt');
  });

  it('defines the three units with the shared arrangement', () => {
    expect(ADDITIONAL_UNITS.map((unit) => unit.name)).toEqual(['Becher', 'EL', 'TL']);
    for (const unit of ADDITIONAL_UNITS) {
      // <NNBSP> stays a placeholder in the data; the renderer substitutes U+202F.
      expect(unit.arrangement).toBe('<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)');
    }
  });

  it('assigns the documented number schemes to the units', () => {
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.numberScheme]));
    expect(byName.get('Becher')).toBe('halves_and_integers_up_to_30');
    expect(byName.get('EL')).toBe('integers_up_to_10');
    expect(byName.get('TL')).toBe('integers_up_to_10');
  });

  it('defines the two schemes as documented', () => {
    expect(NUMBER_SCHEMES.integers_up_to_10).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(NUMBER_SCHEMES.halves_and_integers_up_to_30).toEqual([
      '1/2',
      '1',
      '1+1/2',
      '2',
      '2+1/2',
      '3',
      '3+1/2',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '12',
      '15',
      '18',
      '20',
      '22',
      '25',
      '28',
      '30',
    ]);
    // Fractions that are neither integer nor half are excluded (e.g. 1+1/4),
    // and the upper bound cuts off at 30 (e.g. 35).
    expect(NUMBER_SCHEMES.halves_and_integers_up_to_30).not.toContain('1+1/4');
    expect(NUMBER_SCHEMES.halves_and_integers_up_to_30).not.toContain('35');
  });

  it('maps Joghurt with factors 400/24/7.5 and ascending priorities', () => {
    // The mapping list exists by construction (generator-validated master data).
    const mappings = INGREDIENT_MAPPINGS.Joghurt!;
    expect(mappings.map((mapping) => mapping.au)).toEqual(['Becher', 'EL', 'TL']);
    expect(mappings.map((mapping) => mapping.factor)).toEqual([400, 24, 7.5]);
    expect(mappings.map((mapping) => mapping.priority)).toEqual([1, 2, 3]);
    for (const mapping of mappings) {
      expect(mapping.bu).toBe('g');
    }
  });

  it('only references AQ ladder values in the schemes (no drift)', () => {
    const ladderAq = new Set(LADDER_RUNGS.map((rung) => rung.aq));
    for (const values of Object.values(NUMBER_SCHEMES)) {
      for (const value of values) {
        expect(ladderAq).toContain(value);
      }
    }
  });
});

describe('roundToAQ (§6.1)', () => {
  it('rounds to the nearest AQ ladder value', () => {
    expect(roundToAQ(1)).toBe('1');
    expect(roundToAQ(1.25)).toBe('1+1/4');
    expect(roundToAQ(0.5)).toBe('1/2');
    expect(roundToAQ(20.8333)).toBe('20');
    expect(roundToAQ(66.6667)).toBe('70');
    expect(roundToAQ(0.12)).toBe('1/8');
  });

  it('breaks exact ties toward the larger value', () => {
    // 1.375 lies exactly between 1+1/4 (1.25) and 1+1/2 (1.5).
    expect(roundToAQ(1.375)).toBe('1+1/2');
  });

  it('returns null outside the AQ range (below 1/10 or above 1000)', () => {
    expect(roundToAQ(0.1)).toBe('1/10');
    expect(roundToAQ(1000)).toBe('1000');
    expect(roundToAQ(0.06)).toBeNull();
    expect(roundToAQ(1500)).toBeNull();
  });

  it('rejects non-positive or non-finite raw values', () => {
    expect(() => roundToAQ(0)).toThrow();
    expect(() => roundToAQ(NaN)).toThrow();
  });
});

describe('selectAQ (§6)', () => {
  it('selects Becher when the whole number fits the scheme', () => {
    const selected = selectAQ('Joghurt', 400, 'g');
    expect(selected?.aq).toBe('1');
    expect(selected?.au.name).toBe('Becher');
  });

  it('selects Becher for halves (400 g → 200 g is half a Becher)', () => {
    const selected = selectAQ('Joghurt', 200, 'g');
    expect(selected?.aq).toBe('1/2');
    expect(selected?.au.name).toBe('Becher');
  });

  it('falls through to the next priority when the AQ fails the scheme', () => {
    // Becher: raw 0.0625 (< 1/10, no AQ) → EL: raw 1.04 → rounds to 1 → integers ✓.
    const selected = selectAQ('Joghurt', 25, 'g');
    expect(selected?.aq).toBe('1');
    expect(selected?.au.name).toBe('EL');
  });

  it('returns null when no mapping passes (500 g Joghurt)', () => {
    // Becher 1+1/4 ✗, EL 20 ✗ (> 10), TL 70 ✗ (> 10).
    expect(selectAQ('Joghurt', 500, 'g')).toBeNull();
  });

  it('ignores mappings whose base unit does not match', () => {
    // Joghurt is stored in g; a kg quantity has no applicable mapping.
    expect(selectAQ('Joghurt', 0.4, 'kg')).toBeNull();
  });

  it('returns null for unknown ingredients', () => {
    expect(selectAQ('Zucker', 400, 'g')).toBeNull();
  });

  it('rejects non-standard base quantities', () => {
    expect(() => selectAQ('Joghurt', 450, 'g')).toThrow();
  });
});

describe('renderAQS (§4)', () => {
  it('renders the arrangement template with NNBSP between number and unit', () => {
    expect(renderAQS('Joghurt', 400, 'g')).toBe(`1${NNBSP}Becher Joghurt (400${NNBSP}g)`);
    expect(renderAQS('Joghurt', 600, 'g')).toBe(`1+1/2${NNBSP}Becher Joghurt (600${NNBSP}g)`);
  });

  it('renders fraction forms canonically (the "+" marks a mixed number)', () => {
    expect(renderAQS('Joghurt', 200, 'g')).toBe(`1/2${NNBSP}Becher Joghurt (200${NNBSP}g)`);
  });

  it('renders the base form when no AQS applies', () => {
    expect(renderAQS('Joghurt', 500, 'g')).toBe(`500${NNBSP}g Joghurt`);
    expect(renderAQS('Joghurt', 12, 'g')).toBe(`12${NNBSP}g Joghurt`);
    expect(renderAQS('Joghurt', 700, 'g')).toBe(`700${NNBSP}g Joghurt`);
  });

  it('renders the base form for unknown ingredients and foreign base units', () => {
    expect(renderAQS('Zucker', 400, 'g')).toBe(`400${NNBSP}g Zucker`);
    expect(renderAQS('Joghurt', 0.4, 'kg')).toBe(`0.4${NNBSP}kg Joghurt`);
  });

  it('shows the exact stored base quantity with the kg conversion at 1000', () => {
    // The AQS applies (2+1/2 Becher), and the base quantity is displayed in kg
    // from 1000 up (decided with the user: g/ml stored, kg/l for display).
    expect(renderAQS('Joghurt', 1000, 'g')).toBe(`2+1/2${NNBSP}Becher Joghurt (1${NNBSP}kg)`);
    expect(renderAQS('Joghurt', 1200, 'g')).toBe(`3${NNBSP}Becher Joghurt (1.2${NNBSP}kg)`);
  });

  it('rejects non-standard base quantities', () => {
    expect(() => renderAQS('Joghurt', 450, 'g')).toThrow();
  });
});

describe('formatBQ (§2 — g/ml stored, kg/l displayed from 1000)', () => {
  it('keeps g and ml below 1000', () => {
    expect(formatBQ(400, 'g')).toBe(`400${NNBSP}g`);
    expect(formatBQ(750, 'ml')).toBe(`750${NNBSP}ml`);
    expect(formatBQ(5, 'g')).toBe(`5${NNBSP}g`);
  });

  it('converts g to kg and ml to l from 1000 up', () => {
    expect(formatBQ(1000, 'g')).toBe(`1${NNBSP}kg`);
    expect(formatBQ(1200, 'g')).toBe(`1.2${NNBSP}kg`);
    expect(formatBQ(1000, 'ml')).toBe(`1${NNBSP}l`);
    expect(formatBQ(2500, 'ml')).toBe(`2.5${NNBSP}l`);
  });

  it('shows stored kg/l unchanged (legacy files)', () => {
    expect(formatBQ(1.5, 'kg')).toBe(`1.5${NNBSP}kg`);
    expect(formatBQ(2, 'l')).toBe(`2${NNBSP}l`);
  });
});
