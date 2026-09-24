/**
 * Tests for meal-plan entry recognition (Google Keep "Essensplan").
 *
 * The accepted forms and the fit rule were agreed with the user:
 * `Titel`, `Titel (6 Portionen)`, `Titel (500 g)`, `Titel (1,5 l)` — with a
 * space or a narrow no-break space between number and unit, and a suffix that
 * must be a ladder value in the recipe's own form.
 */

import { describe, expect, it } from 'vitest';

import {
  formatPlannedAmount,
  mealPlanEntriesForTitle,
  mealPlanEntryText,
  parseMealPlanText,
  plannedAmountFitsRecipe,
  type MealPlanRecipeInfo,
} from './mealPlan.js';

/** Narrow no-break space (U+202F) — the app's number/unit separator. */
const NNBSP = '\u202F';

const FINISHED_DISH: MealPlanRecipeInfo = { type: 'finished_dish' };
const G_RECIPE: MealPlanRecipeInfo = { type: 'ingredient_recipe', yieldUnit: 'g' };
const ML_RECIPE: MealPlanRecipeInfo = { type: 'ingredient_recipe', yieldUnit: 'ml' };

describe('parseMealPlanText', () => {
  it('keeps a title-only entry as the title candidate', () => {
    expect(parseMealPlanText('Kürbissuppe')).toEqual({
      text: 'Kürbissuppe',
      title: 'Kürbissuppe',
      planned: null,
    });
  });

  it('splits a serving suffix and trims the title', () => {
    expect(parseMealPlanText('  Kürbissuppe (6 Portionen) ')).toEqual({
      text: 'Kürbissuppe (6 Portionen)',
      title: 'Kürbissuppe',
      planned: { kind: 'servings', servings: 6 },
    });
  });

  it('accepts the narrow no-break space as the number/unit separator', () => {
    expect(parseMealPlanText(`Kürbissuppe (6${NNBSP}Portionen)`).planned).toEqual({
      kind: 'servings',
      servings: 6,
    });
  });

  it('accepts singulare Personen/Portion wording', () => {
    expect(parseMealPlanText('Soljanka (1 Portion)').planned).toEqual({
      kind: 'servings',
      servings: 1,
    });
    expect(parseMealPlanText('Soljanka (2 Personen)').planned).toEqual({
      kind: 'servings',
      servings: 2,
    });
  });

  it('normalizes a g/kg yield to the family base unit', () => {
    expect(parseMealPlanText('Béchamelsauce (500 g)').planned).toEqual({
      kind: 'yield',
      quantity: 500,
      baseUnit: 'g',
    });
    expect(parseMealPlanText('Béchamelsauce (0,5 kg)').planned).toEqual({
      kind: 'yield',
      quantity: 500,
      baseUnit: 'g',
    });
  });

  it('normalizes an ml/l yield to the family base unit', () => {
    expect(parseMealPlanText('Gemüsebrühe (250 ml)').planned).toEqual({
      kind: 'yield',
      quantity: 250,
      baseUnit: 'ml',
    });
    expect(parseMealPlanText('Gemüsebrühe (1,5 l)').planned).toEqual({
      kind: 'yield',
      quantity: 1500,
      baseUnit: 'ml',
    });
  });

  it('keeps a title that itself ends in parentheses intact', () => {
    expect(parseMealPlanText('Tiramisu (klassisch) (6 Portionen)')).toEqual({
      text: 'Tiramisu (klassisch) (6 Portionen)',
      title: 'Tiramisu (klassisch)',
      planned: { kind: 'servings', servings: 6 },
    });
  });

  it('does not split a parenthetical that is not a number plus known unit', () => {
    // An unknown unit word must not turn "Kürbissuppe" into a match — the whole
    // text stays the title candidate so the entry stays unrecognized.
    expect(parseMealPlanText('Kürbissuppe (6 Teller)')).toEqual({
      text: 'Kürbissuppe (6 Teller)',
      title: 'Kürbissuppe (6 Teller)',
      planned: null,
    });
  });

  it('does not split a bare number without a unit', () => {
    expect(parseMealPlanText('Kürbissuppe (6)').title).toBe('Kürbissuppe (6)');
  });

  it('requires a separator between number and unit', () => {
    expect(parseMealPlanText('Kürbissuppe (500g)').title).toBe('Kürbissuppe (500g)');
  });
});

describe('plannedAmountFitsRecipe', () => {
  it('lets a title-only entry fit every recipe', () => {
    expect(plannedAmountFitsRecipe(null, FINISHED_DISH)).toBe(true);
    expect(plannedAmountFitsRecipe(null, G_RECIPE)).toBe(true);
  });

  it('accepts integer ladder servings on a finished dish', () => {
    expect(plannedAmountFitsRecipe({ kind: 'servings', servings: 6 }, FINISHED_DISH)).toBe(true);
    expect(plannedAmountFitsRecipe({ kind: 'servings', servings: 7 }, FINISHED_DISH)).toBe(true);
  });

  it('rejects non-ladder servings (11) and fractional servings (1,5)', () => {
    expect(plannedAmountFitsRecipe({ kind: 'servings', servings: 11 }, FINISHED_DISH)).toBe(false);
    expect(plannedAmountFitsRecipe({ kind: 'servings', servings: 1.5 }, FINISHED_DISH)).toBe(false);
  });

  it('rejects a serving suffix on an ingredient recipe', () => {
    expect(plannedAmountFitsRecipe({ kind: 'servings', servings: 6 }, G_RECIPE)).toBe(false);
  });

  it('accepts a yield in the recipe own family unit', () => {
    expect(plannedAmountFitsRecipe({ kind: 'yield', quantity: 500, baseUnit: 'g' }, G_RECIPE)).toBe(
      true,
    );
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 1500, baseUnit: 'ml' }, ML_RECIPE),
    ).toBe(true);
  });

  it('rejects a yield in the wrong family unit or on a finished dish', () => {
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 500, baseUnit: 'ml' }, G_RECIPE),
    ).toBe(false);
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 500, baseUnit: 'g' }, FINISHED_DISH),
    ).toBe(false);
  });

  it('rejects a yield that is not a ladder value', () => {
    expect(plannedAmountFitsRecipe({ kind: 'yield', quantity: 499, baseUnit: 'g' }, G_RECIPE)).toBe(
      false,
    );
  });

  it('rejects a yield on an ingredient recipe without a family unit', () => {
    expect(
      plannedAmountFitsRecipe(
        { kind: 'yield', quantity: 500, baseUnit: 'g' },
        { type: 'ingredient_recipe' },
      ),
    ).toBe(false);
  });
});

describe('formatPlannedAmount', () => {
  it('formats a serving count with the singular/plural wording', () => {
    expect(formatPlannedAmount({ kind: 'servings', servings: 6 })).toBe(`6${NNBSP}Portionen`);
    expect(formatPlannedAmount({ kind: 'servings', servings: 1 })).toBe(`1${NNBSP}Portion`);
  });

  it('formats a yield through formatBQ: kg/l step and German comma', () => {
    expect(formatPlannedAmount({ kind: 'yield', quantity: 500, baseUnit: 'g' })).toBe(
      `500${NNBSP}g`,
    );
    expect(formatPlannedAmount({ kind: 'yield', quantity: 1500, baseUnit: 'ml' })).toBe(
      `1,5${NNBSP}l`,
    );
  });
});

describe('mealPlanEntryText', () => {
  it('writes the entry in the shape the parser reads back', () => {
    // Number and unit are joined with the narrow no-break space, exactly like
    // every other quantity display (docs/CODING_CONVENTIONS.md).
    expect(mealPlanEntryText('Kürbissuppe', { kind: 'servings', servings: 6 })).toBe(
      `Kürbissuppe (6${NNBSP}Portionen)`,
    );
    expect(
      mealPlanEntryText('Béchamelsauce', { kind: 'yield', quantity: 500, baseUnit: 'g' }),
    ).toBe(`Béchamelsauce (500${NNBSP}g)`);
    expect(
      mealPlanEntryText('Gemüsebrühe', { kind: 'yield', quantity: 1500, baseUnit: 'ml' }),
    ).toBe(`Gemüsebrühe (1,5${NNBSP}l)`);
  });

  it('round-trips through the parser to the same title and size', () => {
    const servings = { kind: 'servings', servings: 4 } as const;
    expect(parseMealPlanText(mealPlanEntryText('Soljanka', servings))).toEqual({
      text: `Soljanka (4${NNBSP}Portionen)`,
      title: 'Soljanka',
      planned: servings,
    });

    // A written 1,5 l must come back as the normalized base quantity (ml).
    const yieldAmount = { kind: 'yield', quantity: 1500, baseUnit: 'ml' } as const;
    expect(parseMealPlanText(mealPlanEntryText('Gemüsebrühe', yieldAmount)).planned).toEqual(
      yieldAmount,
    );
  });
});

describe('mealPlanEntriesForTitle', () => {
  it('collects the plain title and every size of the recipe', () => {
    expect(
      mealPlanEntriesForTitle(
        [
          'Kürbissuppe',
          'Kürbissuppe (4 Portionen)',
          'Kürbissuppe (1,5 l)',
          'Kürbissuppe (500 g)',
          'Brot',
        ],
        'Kürbissuppe',
      ),
    ).toEqual([
      'Kürbissuppe',
      'Kürbissuppe (4 Portionen)',
      'Kürbissuppe (1,5 l)',
      'Kürbissuppe (500 g)',
    ]);
  });

  it('does not filter by the fit check: any stated size counts as an instance', () => {
    // The fit rule decides what can be scaled, not what is a duplicate; a
    // finished dish's stray yield line is still the same recipe.
    expect(mealPlanEntriesForTitle(['Kürbissuppe (500 g)'], 'Kürbissuppe')).toEqual([
      'Kürbissuppe (500 g)',
    ]);
  });

  it('leaves another recipe and a non-size parenthetical alone', () => {
    expect(
      mealPlanEntriesForTitle(
        ['Kürbissuppe (6 Teller)', 'Kürbiscremesuppe', 'Kürbissuppe (6)'],
        'Kürbissuppe',
      ),
    ).toEqual([]);
  });

  it('trims the texts and drops empty lines', () => {
    expect(mealPlanEntriesForTitle(['  Kürbissuppe (4 Portionen) ', '   '], 'Kürbissuppe')).toEqual(
      ['Kürbissuppe (4 Portionen)'],
    );
  });
});
