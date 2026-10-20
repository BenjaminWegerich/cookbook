import { describe, expect, it } from 'vitest';

import { ADDITIONAL_UNITS, INGREDIENT_MAPPINGS, NUMBER_SCHEMES } from './additionalUnitsData.js';
import {
  auDisplayForms,
  auDisplayName,
  formatAQ,
  formatAQSlash,
  formatAQValue,
  formatAQValueSlash,
  formatBQ,
  formatBQNumber,
  formatBU,
  formatDecimal,
  formatPantryAq,
  ingredientDisplayName,
  pantryReading,
  renderAQS,
  renderAQSSlash,
  renderArrangementTemplate,
  renderPantryAmount,
  renderPantryChip,
  renderPantryLine,
  renderQuantityText,
  resolveReorderPoint,
  roundToAQ,
  selectAQ,
  selectAQForEntry,
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

  it('defines the units of the master data in table order', () => {
    expect(ADDITIONAL_UNITS.map((unit) => unit.name)).toEqual([
      'Dose (Abtropfgewicht)',
      'Dose (Gesamtgewicht)',
      'Esslöffel',
      'Packung (teilbar)',
      'Packung (halbierbar)',
      'Packung (unteilbar)',
      'Stück (ZE zuerst)',
      'Teelöffel',
      'Zweig',
      'Topf',
      'Stück (BE zuerst)',
      'Stück (BE zuerst, exakt)',
      'Bund',
      'Tube',
      'Päckchen',
      'Würfel',
      'Blatt',
      'Flasche',
      'Becher',
      'Glas',
    ]);
  });

  it('keeps every arrangement a clean template (§4)', () => {
    // The generator validates the placeholders; rendering every arrangement
    // guards the other direction — a token the renderer does not substitute
    // (or a stray bracket in free text) cannot slip through unnoticed.
    for (const unit of ADDITIONAL_UNITS) {
      const line = renderArrangementTemplate(unit.arrangement, {
        aq: '2',
        au: auDisplayName(unit, 2),
        ingredient: 'Mehl',
        ingredientForm: 'Mehl',
        bq: 2000,
        bu: 'g',
      });
      expect(line, unit.name).not.toMatch(/[<>]/);
    }
  });

  it('assigns one of the defined number schemes to every unit', () => {
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.numberScheme]));
    // Whole counting units stay whole.
    expect(byName.get('Blatt')).toBe('integers_up_to_10');
    expect(byName.get('Esslöffel')).toBe('integers_up_to_10');
    expect(byName.get('Teelöffel')).toBe('integers_up_to_10');
    // Half-measure containers may show halves.
    for (const name of [
      'Dose (Abtropfgewicht)',
      'Dose (Gesamtgewicht)',
      'Packung (halbierbar)',
      'Tube',
      'Päckchen',
      'Würfel',
      'Flasche',
      'Becher',
      'Glas',
    ]) {
      expect(byName.get(name), name).toBe('halves_and_integers_up_to_30');
    }
    // The divisible pack carries every fraction; the indivisible one only wholes.
    expect(byName.get('Packung (teilbar)')).toBe('all_fractions_and_integers_up_to_30');
    expect(byName.get('Packung (unteilbar)')).toBe('integers_up_to_30');
    // Counting units accept quarters and halves.
    for (const name of [
      'Stück (ZE zuerst)',
      'Stück (BE zuerst)',
      'Stück (BE zuerst, exakt)',
      'Zweig',
      'Topf',
      'Bund',
    ]) {
      expect(byName.get(name), name).toBe('quarters_halves_and_integers_up_to_30');
    }
    // Every unit references a scheme the generator compiled.
    for (const unit of ADDITIONAL_UNITS) {
      expect(NUMBER_SCHEMES[unit.numberScheme], unit.name).toBeDefined();
    }
  });

  it('marks fixed measures as exact and average ones as approximate (Unit Exact)', () => {
    // A package or container fixes the amount per unit; a spoon is heaped or
    // level and a sprig or carrot varies in weight, so their factor is an
    // average and the stored weight stays the authoritative reading (§6.3).
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.exact]));
    expect(byName.get('Becher')).toBe(true);
    expect(byName.get('Glas')).toBe(true);
    expect(byName.get('Packung (unteilbar)')).toBe(true);
    expect(byName.get('Tube')).toBe(true);
    expect(byName.get('Stück (BE zuerst, exakt)')).toBe(true);
    expect(byName.get('Esslöffel')).toBe(false);
    expect(byName.get('Teelöffel')).toBe(false);
    expect(byName.get('Stück (ZE zuerst)')).toBe(false);
    expect(byName.get('Stück (BE zuerst)')).toBe(false);
    expect(byName.get('Zweig')).toBe(false);
  });

  it('marks the purchase units as shopping units and the recipe measures as not', () => {
    // Shopping Unit (docs/additional_quantity_specifications.md §3.1): true when
    // ingredients are bought in this unit. A Becher, a Packung, a Bund and a
    // Stück name a purchase; a spoon, a sprig and a Zweig do not.
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.shoppingUnit]));
    expect(byName.get('Becher')).toBe(true);
    expect(byName.get('Glas')).toBe(true);
    expect(byName.get('Packung (teilbar)')).toBe(true);
    expect(byName.get('Stück (ZE zuerst)')).toBe(true);
    expect(byName.get('Bund')).toBe(true);
    expect(byName.get('Topf')).toBe(true);
    expect(byName.get('Esslöffel')).toBe(false);
    expect(byName.get('Teelöffel')).toBe(false);
    expect(byName.get('Zweig')).toBe(false);
  });

  it('states the shopping-unit flag for every unit (the cell is mandatory)', () => {
    // The generator rejects an empty Shopping Unit cell, so every compiled unit
    // carries an explicit boolean — no unit silently defaults into or out of the
    // shopping list.
    for (const unit of ADDITIONAL_UNITS) {
      expect(typeof unit.shoppingUnit).toBe('boolean');
    }
  });

  it('carries the display forms of every unit (the pair is atomic)', () => {
    // Spot-check the Singular/Plural columns of docs/additional_units.csv. The
    // qualifier in a canonical name ("Dose (Abtropfgewicht)", "Stück (ZE
    // zuerst)") is a key, never the display — the display forms carry the word.
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit]));
    expect(byName.get('Dose (Abtropfgewicht)')?.singular).toBe('Dose');
    expect(byName.get('Packung (teilbar)')?.plural).toBe('Packungen');
    expect(byName.get('Stück (ZE zuerst)')?.singular).toBe('Stück');
    expect(byName.get('Glas')?.plural).toBe('Gläser');
    for (const unit of ADDITIONAL_UNITS) {
      // The pair is atomic, and every seed unit states one.
      expect(unit.singular === undefined).toBe(unit.plural === undefined);
      expect(typeof unit.singular).toBe('string');
      expect(typeof unit.plural).toBe('string');
    }
  });

  it('defines the number schemes as documented', () => {
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
    expect(NUMBER_SCHEMES.integers_up_to_30).toEqual([
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
      '12',
      '15',
      '18',
      '20',
      '22',
      '25',
      '28',
      '30',
    ]);
    expect(NUMBER_SCHEMES.quarters_halves_and_integers_up_to_30).toEqual([
      '1/4',
      '1/2',
      '3/4',
      '1',
      '1+1/4',
      '1+1/2',
      '1+3/4',
      '2',
      '2+1/4',
      '2+1/2',
      '2+3/4',
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
    expect(NUMBER_SCHEMES.all_fractions_and_integers_up_to_30).toEqual([
      '1/10',
      '1/9',
      '1/8',
      '1/6',
      '1/5',
      '1/4',
      '1/3',
      '3/8',
      '2/5',
      '1/2',
      '3/5',
      '2/3',
      '3/4',
      '7/8',
      '1',
      '1+1/4',
      '1+1/2',
      '1+3/4',
      '2',
      '2+1/4',
      '2+1/2',
      '2+3/4',
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
    // Fractions that are neither integer nor half are excluded from the halves
    // scheme (e.g. 1+1/4), and every scheme cuts off at 30 (e.g. 35).
    expect(NUMBER_SCHEMES.halves_and_integers_up_to_30).not.toContain('1+1/4');
    expect(NUMBER_SCHEMES.halves_and_integers_up_to_30).not.toContain('35');
    expect(NUMBER_SCHEMES.integers_up_to_30).not.toContain('1/2');
    expect(NUMBER_SCHEMES.integers_up_to_30).not.toContain('35');
    expect(NUMBER_SCHEMES.quarters_halves_and_integers_up_to_30).not.toContain('1/3');
    expect(NUMBER_SCHEMES.quarters_halves_and_integers_up_to_30).not.toContain('35');
    expect(NUMBER_SCHEMES.all_fractions_and_integers_up_to_30).not.toContain('35');
  });

  it('maps Joghurt with factors 400/24/7.5 and ascending priorities', () => {
    // The mapping list exists by construction (generator-validated master data).
    const entry = INGREDIENT_MAPPINGS.Joghurt!;
    expect(entry.bu).toBe('g');
    expect(entry.entries.map((mapping) => mapping.au)).toEqual([
      'Becher',
      'Esslöffel',
      'Teelöffel',
    ]);
    expect(entry.entries.map((mapping) => mapping.factor)).toEqual([400, 24, 7.5]);
    expect(entry.entries.map((mapping) => mapping.priority)).toEqual([1, 2, 3]);
  });

  it('includes a bare ingredient (Cashews) without additional units in the seed', () => {
    expect(INGREDIENT_MAPPINGS.Cashews).toEqual({
      bu: 'g',
      reorderPoint: 0,
      singular: 'Cashew',
      plural: 'Cashews',
      entries: [],
    });
    expect(masterIngredientNames()).toContain('Cashews');
  });

  it('maps Aquafaba to the exact BE-first unit and names one can in the line', () => {
    // One can of chickpeas yields 180 ml of aquafaba; the exact unit derives the
    // shown amount from that count, while the ingredient forms name the can.
    expect(INGREDIENT_MAPPINGS.Aquafaba).toEqual({
      bu: 'ml',
      reorderPoint: 0,
      singular: 'Dose Kichererbsen',
      plural: 'Dosen Kichererbsen',
      entries: [{ au: 'Stück (BE zuerst, exakt)', factor: 180, priority: 1 }],
    });
  });

  it('carries the display forms of the seed and leaves invariant names bare', () => {
    // Spot-check the Singular/Plural columns of docs/ingredients.csv: a name
    // with a count form states both, an invariant mass noun states neither.
    expect(INGREDIENT_MAPPINGS.Karotten?.singular).toBe('Karotte');
    expect(INGREDIENT_MAPPINGS.Karotten?.plural).toBe('Karotten');
    expect(INGREDIENT_MAPPINGS.Haferflocken?.singular).toBe('Haferflocke');
    expect(INGREDIENT_MAPPINGS.Zucker).not.toHaveProperty('singular');
    expect(INGREDIENT_MAPPINGS.Milch).not.toHaveProperty('plural');
    // The pair is atomic: no seed entry carries only one of the two forms.
    for (const entry of Object.values(INGREDIENT_MAPPINGS)) {
      expect(entry.singular === undefined).toBe(entry.plural === undefined);
    }
  });

  it('carries the generated reorder point for every ingredient', () => {
    // Spot-check the seed values from docs/ingredients.csv (0 = only bought for
    // a recipe, a number = a base-unit quantity on stock after a shopping trip).
    expect(INGREDIENT_MAPPINGS.Mehl?.reorderPoint).toBe(1000);
    expect(INGREDIENT_MAPPINGS.Zucker?.reorderPoint).toBe(1000);
    expect(INGREDIENT_MAPPINGS.Milch?.reorderPoint).toBe(100);
    // Every seed ingredient must state a reorder point (the field is mandatory).
    for (const entry of Object.values(INGREDIENT_MAPPINGS)) {
      expect(typeof entry.reorderPoint).toBe('number');
      expect(Number.isNaN(entry.reorderPoint)).toBe(false);
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
    // Becher: raw 0.0625 (< 1/10, no AQ) → Esslöffel: raw 1.04 → rounds to 1 → integers ✓.
    const selected = selectAQ('Joghurt', 25, 'g');
    expect(selected?.aq).toBe('1');
    expect(selected?.au.name).toBe('Esslöffel');
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
    expect(renderAQS('Joghurt', 600, 'g')).toBe(`1${NNBSP}½${NNBSP}Becher Joghurt (600${NNBSP}g)`);
  });

  it('renders AQ fractions in the documented glyph typography (§8)', () => {
    expect(renderAQS('Joghurt', 200, 'g')).toBe(`½${NNBSP}Becher Joghurt (200${NNBSP}g)`);
  });

  it('renders the base form when no AQS applies', () => {
    expect(renderAQS('Joghurt', 500, 'g')).toBe(`500${NNBSP}g Joghurt`);
    expect(renderAQS('Joghurt', 12, 'g')).toBe(`12${NNBSP}g Joghurt`);
    expect(renderAQS('Joghurt', 700, 'g')).toBe(`700${NNBSP}g Joghurt`);
  });

  it('renders the base form for unknown ingredients and foreign base units', () => {
    expect(renderAQS('Zucker', 400, 'g')).toBe(`400${NNBSP}g Zucker`);
    expect(renderAQS('Joghurt', 0.4, 'kg')).toBe(`0,4${NNBSP}kg Joghurt`);
  });

  it('shows the exact stored base quantity with the kg conversion at 1000', () => {
    // The AQS applies (2+1/2 Becher), and the base quantity is displayed in kg
    // from 1000 up (decided with the user: g/ml stored, kg/l for display).
    expect(renderAQS('Joghurt', 1000, 'g')).toBe(`2${NNBSP}½${NNBSP}Becher Joghurt (1${NNBSP}kg)`);
    expect(renderAQS('Joghurt', 1200, 'g')).toBe(`3${NNBSP}Becher Joghurt (1,2${NNBSP}kg)`);
  });

  it('rejects non-standard base quantities', () => {
    expect(() => renderAQS('Joghurt', 450, 'g')).toThrow();
  });
});

describe('renderAQS exact units (§6.3)', () => {
  // Becher is exact in the seed. For an exact unit the shown base quantity
  // follows the shown count, so the display can never contradict itself:
  // 1000 g Joghurt would otherwise read "2+1/2 Becher (1 kg)".
  it('derives the shown base quantity from the rounded AQ for exact units', () => {
    // A quantity whose AQ rounding moves the amount: 1500 g ÷ 400 g = 3.75
    // rounds to 4 Becher (scheme: halves and integers), and the shown amount is
    // 4 × 400 g = 1,6 kg — the displayed count and the displayed weight agree,
    // even though 1,6 kg is not the stored ladder value.
    expect(renderAQS('Joghurt', 1500, 'g')).toBe(`4${NNBSP}Becher Joghurt (1,6${NNBSP}kg)`);
  });

  it('leaves exact units unchanged when the stored amount already matches', () => {
    expect(renderAQS('Joghurt', 400, 'g')).toBe(`1${NNBSP}Becher Joghurt (400${NNBSP}g)`);
    expect(renderAQS('Joghurt', 1200, 'g')).toBe(`3${NNBSP}Becher Joghurt (1,2${NNBSP}kg)`);
  });

  it('keeps the stored amount for approximate units', () => {
    // EL and TL are approximate in the seed (a spoon is heaped or level), so
    // the stored/scaled weight stays the authoritative reading even though the
    // count is rounded: "2 EL Joghurt (50 g)", not 2 × 24 g.
    expect(renderAQS('Joghurt', 50, 'g')).toBe(`2${NNBSP}EL Joghurt (50${NNBSP}g)`);
    expect(renderAQS('Joghurt', 25, 'g')).toBe(`1${NNBSP}EL Joghurt (25${NNBSP}g)`);
    expect(renderAQS('Joghurt', 8, 'g')).toBe(`1${NNBSP}TL Joghurt (8${NNBSP}g)`);
  });

  it('renders the exact BE-first unit with the ingredient count forms', () => {
    // Aquafaba maps to "Stück (BE zuerst, exakt)": the base amount leads, the
    // can count follows in the ingredient's Singular/Plural pair. One can is
    // 180 ml, so the count and the shown amount agree.
    expect(renderAQS('Aquafaba', 180, 'ml')).toBe(
      `180${NNBSP}ml Aquafaba (1${NNBSP}Dose Kichererbsen)`,
    );
    // 90 ml is half a can (singular, a fraction below one); 280 ml stored
    // rounds to 1+1/2 cans, and the exact unit shows the 270 ml they bring
    // home (1+1/2 × 180 ml) in the plural.
    expect(renderAQS('Aquafaba', 90, 'ml')).toBe(
      `90${NNBSP}ml Aquafaba (½${NNBSP}Dose Kichererbsen)`,
    );
    expect(renderAQS('Aquafaba', 280, 'ml')).toBe(
      `270${NNBSP}ml Aquafaba (1${NNBSP}½${NNBSP}Dosen Kichererbsen)`,
    );
  });

  it('exposes the mapping factor on the selection', () => {
    // renderAQS needs the factor to derive the shown amount for exact units;
    // the approximate branch (exact = false) simply keeps the stored amount.
    const selected = selectAQ('Joghurt', 1500, 'g');
    expect(selected?.au.name).toBe('Becher');
    expect(selected?.au.exact).toBe(true);
    expect(selected?.factor).toBe(400);
  });
});

describe('unit display forms (§3 — singular and plural)', () => {
  const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit]));

  it('takes the plural form for a count above one and the singular otherwise', () => {
    const packung = byName.get('Packung (teilbar)')!;
    expect(auDisplayName(packung, 1)).toBe('Packung');
    expect(auDisplayName(packung, 2)).toBe('Packungen');
    expect(auDisplayName(packung, 1.5)).toBe('Packungen');
    // A fraction below one stays singular ("½ Packung"), and so does 0.
    expect(auDisplayName(packung, 0.5)).toBe('Packung');
    expect(auDisplayName(packung, 0)).toBe('Packung');
  });

  it('keeps a unit whose forms equal its name unchanged', () => {
    // Becher and Würfel state the same word for singular and plural; the
    // canonical name is never the display of a qualifier unit (see <INF>).
    expect(auDisplayName(byName.get('Becher')!, 2)).toBe('Becher');
    expect(auDisplayName(byName.get('Würfel')!, 5)).toBe('Würfel');
  });

  it('lists every form a unit can appear as, without duplicates', () => {
    expect(auDisplayForms(byName.get('Packung (teilbar)')!)).toEqual([
      'Packung (teilbar)',
      'Packung',
      'Packungen',
    ]);
    expect(auDisplayForms(byName.get('Becher')!)).toEqual(['Becher']);
  });

  it('renders the plural form in the arrangement for a count above one', () => {
    // 2000 g of flour is two 1000 g packs: "2 Packungen Mehl (2 kg)" (§4).
    expect(renderAQS('Mehl', 2000, 'g')).toBe(`2${NNBSP}Packungen Mehl (2${NNBSP}kg)`);
    expect(renderAQS('Mehl', 1000, 'g')).toBe(`1${NNBSP}Packung Mehl (1${NNBSP}kg)`);
    expect(renderAQSSlash('Mehl', 2000, 'g')).toBe(`2${NNBSP}Packungen Mehl (2${NNBSP}kg)`);
    expect(renderQuantityText('Mehl', 2000, 'g')).toBe(`2${NNBSP}Packungen Mehl (2${NNBSP}kg)`);
  });
});

describe('ingredient display forms (storage_format.md §9)', () => {
  it('takes the plural form for a count above one and the singular otherwise', () => {
    expect(ingredientDisplayName('Karotten', 1)).toBe('Karotte');
    expect(ingredientDisplayName('Karotten', 2)).toBe('Karotten');
    expect(ingredientDisplayName('Karotten', 1.5)).toBe('Karotten');
    // 0 and a fraction below one stay singular, like the unit forms.
    expect(ingredientDisplayName('Karotten', 0.5)).toBe('Karotte');
  });

  it('keeps the canonical name for an invariant or unknown ingredient', () => {
    expect(ingredientDisplayName('Zucker', 5)).toBe('Zucker');
    expect(ingredientDisplayName('Unbekannt', 5)).toBe('Unbekannt');
  });

  it('uses <INF> where the arrangement asks for the count form', () => {
    // Karotten maps to "Stück (ZE zuerst)", whose arrangement uses only <INF>
    // (no <AU>): one reads "Karotte", five read "Karotten". A unit whose
    // arrangement keeps <IN> shows the canonical name for every count instead.
    expect(renderAQS('Karotten', 80, 'g')).toBe(`1${NNBSP}Karotte (80${NNBSP}g)`);
    expect(renderAQS('Karotten', 400, 'g')).toBe(`5${NNBSP}Karotten (400${NNBSP}g)`);
  });
});

describe('arrangement templates (§4)', () => {
  const values = {
    aq: '2',
    au: 'Packungen',
    ingredient: 'Mehl',
    ingredientForm: 'Mehl',
    bq: 2000,
    bu: 'g',
  };

  it('substitutes the combined number+unit run and the <NNBSP> space', () => {
    expect(renderArrangementTemplate('<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)', values)).toBe(
      `2${NNBSP}Packungen Mehl (2${NNBSP}kg)`,
    );
  });

  it('keeps <IN> canonical while <INF> takes the singular/plural form', () => {
    const karotte = {
      aq: '1',
      au: 'Stück',
      ingredient: 'Karotten',
      ingredientForm: 'Karotte',
      bq: 80,
      bu: 'g',
    };
    expect(renderArrangementTemplate('<AQ> <AU> <IN>', karotte)).toBe('1 Stück Karotten');
    expect(renderArrangementTemplate('<AQ> <AU> <INF>', karotte)).toBe('1 Stück Karotte');
  });

  it('keeps free text exactly as written', () => {
    expect(
      renderArrangementTemplate('ca. <AQ> <AU> <IN> (<BQ><NNBSP><BU>), gestrichen', values),
    ).toBe(`ca. 2 Packungen Mehl (2${NNBSP}kg), gestrichen`);
  });

  it('substitutes <BQ> and <BU> apart, with the kg / l display step', () => {
    expect(renderArrangementTemplate('<AQ> <AU> <IN>: <BQ> <BU>', values)).toBe(
      '2 Packungen Mehl: 2 kg',
    );
    expect(renderArrangementTemplate('<BQ> <BU> <IN>', values)).toBe('2 kg Mehl');
  });
});

describe('renderQuantityText (a quantity that is not a stored recipe value)', () => {
  it('names a quantity that is not a ladder value at all', () => {
    // A need is a sum over dishes: 1150 g of flour, and no whole pack (1000 g)
    // brings that amount home — so the amount itself stands, in kg from 1000 up.
    expect(renderQuantityText('Mehl', 1150, 'g')).toBe(`1,15${NNBSP}kg Mehl`);
    expect(renderQuantityText('Trockenhefe', 60, 'g')).toBe(`60${NNBSP}g Trockenhefe`);
  });

  it('uses an exact unit only when its count brings exactly that amount home', () => {
    // 600 g is 1 ½ Becher zu 400 g — the count restates the amount.
    expect(renderQuantityText('Joghurt', 600, 'g')).toBe(
      `1${NNBSP}½${NNBSP}Becher Joghurt (600${NNBSP}g)`,
    );
    // 350 g is not "1 Becher (400 g)": a named amount must not become another.
    expect(renderQuantityText('Joghurt', 350, 'g')).toBe(`350${NNBSP}g Joghurt`);
  });

  it('always uses an approximate unit, which keeps the queried amount', () => {
    // A piece of carrot is about 80 g, so 500 g is six pieces — the amount the
    // dishes need stays the authoritative reading (§6.3).
    expect(renderQuantityText('Karotten', 500, 'g')).toBe(`6${NNBSP}Karotten (500${NNBSP}g)`);
  });

  it('falls back to the base form for an unknown ingredient or another family unit', () => {
    expect(renderQuantityText('Zucchini', 300, 'g')).toBe(`300${NNBSP}g Zucchini`);
    expect(renderQuantityText('Mehl', 500, 'ml')).toBe(`500${NNBSP}ml Mehl`);
    expect(renderQuantityText('Joghurt', 0, 'g')).toBe(`0${NNBSP}g Joghurt`);
  });

  it('has no arrangement to look up without a name (the create form preview)', () => {
    // An empty name is not an ingredient of the master data, so only the base
    // amount is left — without the dangling space an empty <IN> would leave.
    expect(renderQuantityText('', 600, 'g')).toBe(`600${NNBSP}g`);
  });
});

describe('resolveReorderPoint (create form)', () => {
  /** A draft entry as the create form builds it: valid rows, ascending priority. */
  const draft = (
    bu: string,
    entries: ReadonlyArray<{ au: string; factor: number; priority: number }>,
  ) => ({ bu, entries });

  it("snaps to the exact unit's amount (the Creme-Fraiche example)", () => {
    // Becher is exact (160 g per unit): 150 g ÷ 160 g = 0,9375 rounds to one
    // Becher (a tie resolves toward the larger AQ), so the preview and the
    // stored value are 160 g — a stock level is a whole number of packages.
    const entry = draft('g', [{ au: 'Becher', factor: 160, priority: 1 }]);
    const resolved = resolveReorderPoint('Creme Fraiche', entry, 150, 'g');
    expect(resolved.preview).toBe(`1${NNBSP}Becher Creme Fraiche (160${NNBSP}g)`);
    expect(resolved.storedValue).toBe(160);
  });

  it('applies the draft mappings even though the ingredient is not registered', () => {
    // The create form saves the mappings together with the ingredient; the
    // preview must already use them while they are still unsaved.
    expect(masterIngredientNames()).not.toContain('Creme Fraiche');
    const entry = draft('g', [{ au: 'Becher', factor: 160, priority: 1 }]);
    expect(resolveReorderPoint('Creme Fraiche', entry, 150, 'g').preview).toContain('Becher');
  });

  it('keeps the entered value for an approximate unit', () => {
    // Esslöffel is approximate (a heaped spoon), so the entered weight stays the
    // authoritative reading; only the count is rounded.
    const entry = draft('g', [{ au: 'Esslöffel', factor: 10, priority: 1 }]);
    const resolved = resolveReorderPoint('Creme Fraiche', entry, 50, 'g');
    expect(resolved.preview).toBe(`5${NNBSP}EL Creme Fraiche (50${NNBSP}g)`);
    expect(resolved.storedValue).toBe(50);
  });

  it('renders 0 as the base form and stores 0', () => {
    const entry = draft('g', [{ au: 'Becher', factor: 160, priority: 1 }]);
    const resolved = resolveReorderPoint('Creme Fraiche', entry, 0, 'g');
    expect(resolved.preview).toBe(`0${NNBSP}g Creme Fraiche`);
    expect(resolved.storedValue).toBe(0);
  });

  it('renders Infinity as "unbegrenzt" and stores Infinity', () => {
    const resolved = resolveReorderPoint('Wasser', undefined, Infinity, 'ml');
    expect(resolved.preview).toBe('unbegrenzt Wasser');
    expect(resolved.storedValue).toBe(Infinity);
  });

  it('falls back to the entered value without mappings', () => {
    const resolved = resolveReorderPoint('Cashews', draft('g', []), 150, 'g');
    expect(resolved.preview).toBe(`150${NNBSP}g Cashews`);
    expect(resolved.storedValue).toBe(150);
  });

  it('omits the name while the create form has none yet', () => {
    // A blank create flow previews the level before a name is typed; the
    // arrangement must not leave a dangling double space.
    const entry = draft('g', [{ au: 'Becher', factor: 160, priority: 1 }]);
    expect(resolveReorderPoint('', entry, 150, 'g').preview).toBe(`1${NNBSP}Becher (160${NNBSP}g)`);
    expect(resolveReorderPoint('', entry, 0, 'g').preview).toBe(`0${NNBSP}g`);
  });
});

describe('formatAQ / formatAQValue (§8 — fraction glyph typography)', () => {
  it('renders proper fractions as a single Unicode glyph', () => {
    expect(formatAQ('1/10')).toBe('⅒');
    expect(formatAQ('1/8')).toBe('⅛');
    expect(formatAQ('1/3')).toBe('⅓');
    expect(formatAQ('1/2')).toBe('½');
    expect(formatAQ('2/3')).toBe('⅔');
    expect(formatAQ('3/4')).toBe('¾');
    expect(formatAQ('7/8')).toBe('⅞');
  });

  it('renders a mixed number as integer + NNBSP + glyph', () => {
    expect(formatAQ('1+1/4')).toBe(`1${NNBSP}¼`);
    expect(formatAQ('2+1/2')).toBe(`2${NNBSP}½`);
  });

  it('keeps whole AQ values unchanged', () => {
    expect(formatAQ('1')).toBe('1');
    expect(formatAQ('12')).toBe('12');
    expect(formatAQ('1000')).toBe('1000');
  });

  it('formats numeric AQ values (unitless inline counts)', () => {
    expect(formatAQValue(0.1)).toBe('⅒');
    expect(formatAQValue(0.5)).toBe('½');
    expect(formatAQValue(1.25)).toBe(`1${NNBSP}¼`);
    expect(formatAQValue(3)).toBe('3');
  });

  it('rejects a value that is not an AQ ladder number', () => {
    expect(() => formatAQValue(0.3)).toThrow();
  });
});

describe('formatAQSlash / formatAQValueSlash (DESIGN §7 — cooking view slash form)', () => {
  it('keeps proper fractions in full-size slash digits, no glyph', () => {
    expect(formatAQSlash('1/10')).toBe('1/10');
    expect(formatAQSlash('1/8')).toBe('1/8');
    expect(formatAQSlash('1/3')).toBe('1/3');
    expect(formatAQSlash('1/2')).toBe('1/2');
    expect(formatAQSlash('2/5')).toBe('2/5');
    expect(formatAQSlash('2/3')).toBe('2/3');
    expect(formatAQSlash('3/4')).toBe('3/4');
    expect(formatAQSlash('7/8')).toBe('7/8');
  });

  it('joins a mixed number with the narrow no-break space', () => {
    expect(formatAQSlash('1+1/4')).toBe(`1${NNBSP}1/4`);
    expect(formatAQSlash('2+1/2')).toBe(`2${NNBSP}1/2`);
  });

  it('keeps whole AQ values unchanged', () => {
    expect(formatAQSlash('1')).toBe('1');
    expect(formatAQSlash('12')).toBe('12');
    expect(formatAQSlash('1000')).toBe('1000');
  });

  it('formats numeric AQ values in the slash form', () => {
    expect(formatAQValueSlash(0.1)).toBe('1/10');
    expect(formatAQValueSlash(0.5)).toBe('1/2');
    expect(formatAQValueSlash(1.25)).toBe(`1${NNBSP}1/4`);
    expect(formatAQValueSlash(3)).toBe('3');
  });

  it('rejects a value that is not an AQ ladder number', () => {
    expect(() => formatAQValueSlash(0.3)).toThrow();
  });
});

describe('renderAQSSlash (DESIGN §7 — cooking view)', () => {
  it('renders AQ fractions in the slash form instead of glyphs', () => {
    expect(renderAQSSlash('Joghurt', 200, 'g')).toBe(`1/2${NNBSP}Becher Joghurt (200${NNBSP}g)`);
    expect(renderAQSSlash('Joghurt', 600, 'g')).toBe(
      `1${NNBSP}1/2${NNBSP}Becher Joghurt (600${NNBSP}g)`,
    );
  });

  it('matches renderAQS wherever no fraction is shown', () => {
    expect(renderAQSSlash('Joghurt', 400, 'g')).toBe(renderAQS('Joghurt', 400, 'g'));
    expect(renderAQSSlash('Joghurt', 500, 'g')).toBe(`500${NNBSP}g Joghurt`);
    expect(renderAQSSlash('Zucker', 400, 'g')).toBe(`400${NNBSP}g Zucker`);
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
    expect(formatBQ(1200, 'g')).toBe(`1,2${NNBSP}kg`);
    expect(formatBQ(1000, 'ml')).toBe(`1${NNBSP}l`);
    expect(formatBQ(2500, 'ml')).toBe(`2,5${NNBSP}l`);
  });

  it('shows stored kg/l unchanged (legacy files)', () => {
    expect(formatBQ(1.5, 'kg')).toBe(`1,5${NNBSP}kg`);
    expect(formatBQ(2, 'l')).toBe(`2${NNBSP}l`);
  });

  it('exposes the displayed unit on its own (formatBU)', () => {
    expect(formatBU(400, 'g')).toBe('g');
    expect(formatBU(750, 'ml')).toBe('ml');
    expect(formatBU(1600, 'g')).toBe('kg');
    expect(formatBU(2500, 'ml')).toBe('l');
    // A stored legacy unit has no step of its own and stays as it is.
    expect(formatBU(1.5, 'kg')).toBe('kg');
  });
});

describe('formatDecimal (§8 — German decimal comma on the display layer)', () => {
  it('keeps whole numbers as-is', () => {
    expect(formatDecimal(400)).toBe('400');
    expect(formatDecimal(0)).toBe('0');
  });

  it('uses the comma for fractional values', () => {
    expect(formatDecimal(1.5)).toBe('1,5');
    expect(formatDecimal(0.25)).toBe('0,25');
    expect(formatDecimal(2)).toBe('2');
  });
});

describe('pantryReading (the pantry sheet’s nearest-ladder reading)', () => {
  it('rounds the count to the nearest AQ value, ignoring the number scheme', () => {
    // 500 g of yoghurt in a 400 g Becher: raw 1.25 → the scheme would reject
    // 1¼ (halves only), but the amount is still named in the unit.
    const reading = pantryReading('Joghurt', 500, 'g');
    expect(reading.au?.name).toBe('Becher');
    expect(reading.factor).toBe(400);
    expect(reading.aq).toBe(1.25);
    expect(reading.bq).toBe(500);
  });

  it('names a fraction of an exact shopping unit instead of dropping it', () => {
    // 200 g of flour in a 1000 g Packung is ⅕ of a pack — the base form would
    // hide the unit, and a recipe line may not restate the amount, but the pantry
    // reading keeps the unit ("⅕ Packung (200 g)").
    const reading = pantryReading('Mehl', 200, 'g');
    expect(reading.au?.name).toBe('Packung (unteilbar)');
    expect(reading.aq).toBe(0.2);
    expect(renderPantryAmount('Mehl', 200, 'g')).toBe(`⅕${NNBSP}Packung (200${NNBSP}g)`);
  });

  it('reads an empty amount as 0 in the unit', () => {
    expect(renderPantryAmount('Mehl', 0, 'g')).toBe(`0${NNBSP}Packung (0${NNBSP}g)`);
    expect(renderPantryAmount('Karotten', 0, 'g')).toBe(`0${NNBSP}Karotte (0${NNBSP}g)`);
  });

  it('keeps the amount itself as the shown base quantity, even for an exact unit', () => {
    // 550 g of yoghurt rounds to 1½ Becher (600 g by the factor), but the base
    // reading stays 550 g — the sheet edits grams, so the count must not
    // overrule them.
    const reading = pantryReading('Joghurt', 550, 'g');
    expect(reading.aq).toBe(1.5);
    expect(renderPantryAmount('Joghurt', 550, 'g')).toBe(`1${NNBSP}½${NNBSP}Becher (550${NNBSP}g)`);
  });

  it('counts whole pieces for an approximate shopping unit', () => {
    // 500 g of carrots at about 80 g a piece is 6¼ → 6 pieces.
    expect(renderPantryAmount('Karotten', 500, 'g')).toBe(`6${NNBSP}Karotten (500${NNBSP}g)`);
  });

  it('keeps the ingredient count form while the name is hidden', () => {
    // The pantry amount omits <IN>, but the can still appears through <INF>.
    expect(renderPantryAmount('Aquafaba', 180, 'ml')).toBe(
      `180${NNBSP}ml (1${NNBSP}Dose Kichererbsen)`,
    );
  });

  it('counts beyond the ladder as a whole number', () => {
    // 20 kg of flour is 20 packs — above the ladder's top the count is whole,
    // and a count above one takes the unit's plural form (§3).
    expect(renderPantryAmount('Mehl', 20000, 'g')).toBe(`20${NNBSP}Packungen (20${NNBSP}kg)`);
  });

  it('falls back to the base form without a shopping unit', () => {
    // Butter has only spoons (recipe measures, not shopping units).
    const reading = pantryReading('Butter', 500, 'g');
    expect(reading.au).toBeNull();
    expect(reading.aq).toBeNull();
    expect(renderPantryAmount('Butter', 500, 'g')).toBe(`500${NNBSP}g`);
  });

  it('keeps the family unit of an ml ingredient', () => {
    expect(renderPantryAmount('Milch', 500, 'ml')).toBe(`2${NNBSP}Becher (500${NNBSP}ml)`);
  });
});

describe('renderPantryLine (the named form the Keep write carries)', () => {
  it('adds the ingredient name to the same arrangement', () => {
    expect(renderPantryLine('Joghurt', 600, 'g')).toBe(
      `1${NNBSP}½${NNBSP}Becher Joghurt (600${NNBSP}g)`,
    );
  });

  it('keeps the base form with the name without a shopping unit', () => {
    expect(renderPantryLine('Butter', 850, 'g')).toBe(`850${NNBSP}g Butter`);
  });

  it('names a typed amount exactly, without rounding it up', () => {
    // 600 g typed for a 400 g Becher is 1½ Becher — not rounded to 2 Becher.
    expect(renderPantryLine('Joghurt', 600, 'g')).toBe(
      `1${NNBSP}½${NNBSP}Becher Joghurt (600${NNBSP}g)`,
    );
  });
});

describe('formatPantryAq', () => {
  it('uses the §8 glyph typography for ladder counts', () => {
    expect(formatPantryAq(1.25)).toBe(`1${NNBSP}¼`);
    expect(formatPantryAq(0.5)).toBe('½');
  });

  it('keeps 0 and whole counts beyond the ladder as plain decimals', () => {
    expect(formatPantryAq(0)).toBe('0');
    expect(formatPantryAq(20)).toBe('20');
  });
});

describe('formatBQNumber (the unit-less number of formatBQ)', () => {
  it('keeps the family unit below 1000', () => {
    expect(formatBQNumber(400, 'g')).toBe('400');
    expect(formatBQNumber(0, 'g')).toBe('0');
    expect(formatBQNumber(750, 'ml')).toBe('750');
  });

  it('switches to kg / l at 1000, with the German comma', () => {
    expect(formatBQNumber(1000, 'g')).toBe('1');
    expect(formatBQNumber(1600, 'g')).toBe('1,6');
    expect(formatBQNumber(1250, 'ml')).toBe('1,25');
  });

  it('matches the numeric part of formatBQ', () => {
    expect(formatBQ(400, 'g')).toBe(`400${NNBSP}g`);
    expect(formatBQ(1600, 'g')).toBe(`1,6${NNBSP}kg`);
    expect(formatBQNumber(400, 'g')).toBe('400');
    expect(formatBQNumber(1600, 'g')).toBe('1,6');
  });
});

describe('renderPantryChip (the unit-full stock chip label)', () => {
  it('names both units of a shopping-unit arrangement', () => {
    expect(renderPantryChip('Joghurt', 400, 'g')).toBe(`1${NNBSP}Becher (400${NNBSP}g)`);
    expect(renderPantryChip('Joghurt', 600, 'g')).toBe(`1${NNBSP}½${NNBSP}Becher (600${NNBSP}g)`);
  });

  it('keeps the base form with its unit without a shopping unit', () => {
    expect(renderPantryChip('Butter', 500, 'g')).toBe(`500${NNBSP}g`);
  });

  it('keeps the kg / l switch of the base amount', () => {
    // 1½ packs is a count above one, so the unit takes its plural form (§3).
    expect(renderPantryChip('Mehl', 1600, 'g')).toBe(`1${NNBSP}½${NNBSP}Packungen (1,6${NNBSP}kg)`);
  });

  it('reads an empty stock as plain 0, never "0 Becher (0 g)"', () => {
    expect(renderPantryChip('Joghurt', 0, 'g')).toBe('0');
  });
});
