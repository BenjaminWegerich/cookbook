import { describe, expect, it } from 'vitest';

import { ADDITIONAL_UNITS, INGREDIENT_MAPPINGS, NUMBER_SCHEMES } from './additionalUnitsData.js';
import {
  formatAQ,
  formatAQValue,
  formatBQ,
  formatDecimal,
  formatPantryAq,
  pantryReading,
  renderAQS,
  renderPantryAmount,
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

  it('defines the units of the master data with the shared arrangement', () => {
    expect(ADDITIONAL_UNITS.map((unit) => unit.name)).toEqual([
      'Becher',
      'EL',
      'TL',
      'Packung',
      'Stück',
    ]);
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
    // Counting units: half a pack or half a carrot is not a recipe quantity.
    expect(byName.get('Packung')).toBe('integers_up_to_10');
    expect(byName.get('Stück')).toBe('integers_up_to_10');
  });

  it('marks fixed measures as exact and average ones as approximate (Unit Exact)', () => {
    // Becher and Packung are fixed measures (a 400 g cup of yogurt, a 1000 g
    // pack of flour); a spoon is heaped or level and a carrot varies in weight,
    // so their factor is an average and the stored weight stays the
    // authoritative reading (§6.3).
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.exact]));
    expect(byName.get('Becher')).toBe(true);
    expect(byName.get('Packung')).toBe(true);
    expect(byName.get('EL')).toBe(false);
    expect(byName.get('TL')).toBe(false);
    expect(byName.get('Stück')).toBe(false);
  });

  it('marks the purchase units as shopping units and the spoons as recipe measures', () => {
    // Shopping Unit (docs/additional_quantity_specifications.md §3.1): true when
    // ingredients are bought in this unit. A Becher, a Packung and a Stück name
    // a purchase; a spoon is only a recipe measure.
    const byName = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit.shoppingUnit]));
    expect(byName.get('Becher')).toBe(true);
    expect(byName.get('Packung')).toBe(true);
    expect(byName.get('Stück')).toBe(true);
    expect(byName.get('EL')).toBe(false);
    expect(byName.get('TL')).toBe(false);
  });

  it('states the shopping-unit flag for every unit (the cell is mandatory)', () => {
    // The generator rejects an empty Shopping Unit cell, so every compiled unit
    // carries an explicit boolean — no unit silently defaults into or out of the
    // shopping list.
    for (const unit of ADDITIONAL_UNITS) {
      expect(typeof unit.shoppingUnit).toBe('boolean');
    }
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
    const entry = INGREDIENT_MAPPINGS.Joghurt!;
    expect(entry.bu).toBe('g');
    expect(entry.entries.map((mapping) => mapping.au)).toEqual(['Becher', 'EL', 'TL']);
    expect(entry.entries.map((mapping) => mapping.factor)).toEqual([400, 24, 7.5]);
    expect(entry.entries.map((mapping) => mapping.priority)).toEqual([1, 2, 3]);
  });

  it('includes a bare ingredient (Cashews) without additional units in the seed', () => {
    expect(INGREDIENT_MAPPINGS.Cashews).toEqual({ bu: 'g', reorderPoint: 0, entries: [] });
    expect(masterIngredientNames()).toContain('Cashews');
  });

  it('carries the generated reorder point for every ingredient', () => {
    // Spot-check the seed values from docs/ingredients.csv (0 = only bought for
    // a recipe, a number = a base-unit quantity on stock after a shopping trip).
    expect(INGREDIENT_MAPPINGS.Mehl?.reorderPoint).toBe(1000);
    expect(INGREDIENT_MAPPINGS.Zucker?.reorderPoint).toBe(1000);
    expect(INGREDIENT_MAPPINGS.Milch?.reorderPoint).toBe(0);
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
  // The seed marks only Becher as exact. For an exact unit the shown base
  // quantity follows the shown count, so the display can never contradict
  // itself: 1000 g Joghurt would otherwise read "2+1/2 Becher (1 kg)".
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

  it('exposes the mapping factor on the selection', () => {
    // renderAQS needs the factor to derive the shown amount for exact units;
    // the approximate branch (exact = false) simply keeps the stored amount.
    const selected = selectAQ('Joghurt', 1500, 'g');
    expect(selected?.au.name).toBe('Becher');
    expect(selected?.au.exact).toBe(true);
    expect(selected?.factor).toBe(400);
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
    expect(renderQuantityText('Karotten', 500, 'g')).toBe(`6${NNBSP}Stück Karotten (500${NNBSP}g)`);
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
    // EL is approximate (a heaped spoon), so the entered weight stays the
    // authoritative reading; only the count is rounded.
    const entry = draft('g', [{ au: 'EL', factor: 10, priority: 1 }]);
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
    expect(reading.au?.name).toBe('Packung');
    expect(reading.aq).toBe(0.2);
    expect(renderPantryAmount('Mehl', 200, 'g')).toBe(`⅕${NNBSP}Packung (200${NNBSP}g)`);
  });

  it('reads an empty amount as 0 in the unit', () => {
    expect(renderPantryAmount('Mehl', 0, 'g')).toBe(`0${NNBSP}Packung (0${NNBSP}g)`);
    expect(renderPantryAmount('Karotten', 0, 'g')).toBe(`0${NNBSP}Stück (0${NNBSP}g)`);
  });

  it('keeps the amount itself as the shown base quantity, even for an exact unit', () => {
    // 550 g of yoghurt rounds to 1½ Becher (600 g by the factor), but the base
    // reading stays 550 g — the sheet edits grams, so the count must not
    // overrule them.
    const reading = pantryReading('Joghurt', 550, 'g');
    expect(reading.aq).toBe(1.5);
    expect(renderPantryAmount('Joghurt', 550, 'g')).toBe(
      `1${NNBSP}½${NNBSP}Becher (550${NNBSP}g)`,
    );
  });

  it('counts whole pieces for an approximate shopping unit', () => {
    // 500 g of carrots at about 80 g a piece is 6¼ → 6 pieces.
    expect(renderPantryAmount('Karotten', 500, 'g')).toBe(`6${NNBSP}Stück (500${NNBSP}g)`);
  });

  it('counts beyond the ladder as a whole number', () => {
    // 20 kg of flour is 20 packs — above the ladder's top the count is whole.
    expect(renderPantryAmount('Mehl', 20000, 'g')).toBe(`20${NNBSP}Packung (20${NNBSP}kg)`);
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
