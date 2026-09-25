/**
 * Tests for meal-plan entry recognition (Google Keep "Essensplan").
 *
 * Both accepted shapes were agreed with the user:
 * - the link shape the app writes today — `Titel: <Export-URL>` with the chosen
 *   size in the URL's fragment (`#portionen=6`, `#menge=500g`);
 * - the short-link shape — `Titel (6 Portionen): tinyurl.com/…` — where the URL
 *   states no size, so the visible parenthetical carries it (baked into the
 *   short link's target before shortening). The line drops the scheme because
 *   Keep links the bare host too; the parser restores it on read;
 * - the linkless shape with a parenthetical size — `Titel (6 Portionen)`,
 *   `Titel (500 g)`, `Titel (1,5 l)` — with a space or a narrow no-break space
 *   between number and unit.
 *
 * A stated size must be a ladder value in the recipe's own form (and, for a
 * yield, inside the range the export bakes; see recipe/yieldViews.ts).
 */

import { describe, expect, it } from 'vitest';

import {
  existingPlanLink,
  formatPlannedAmount,
  mealPlanEntriesForTitle,
  mealPlanEntryLabel,
  mealPlanEntryText,
  mealPlanEntryTextWithShortLink,
  parseMealPlanText,
  plannedAmountFitsRecipe,
  type MealPlanRecipeInfo,
} from './mealPlan.js';
import type { PlannedAmount } from './planLink.js';
import { YIELD_VIEW_STEPS, yieldViewQuantities } from './recipe/yieldViews.js';

/** Narrow no-break space (U+202F) — the app's number/unit separator. */
const NNBSP = '\u202F';

/**
 * The Drive fallback URL as it looks without a size: the app appends
 * `#portionen=6` / `#menge=500g` to it.
 */
const DRIVE_URL = 'https://drive.google.com/file/d/FILE_ID/view';
/**
 * An export-host URL as the app builds it: it already carries the file as a
 * query parameter, so the size joins it as another parameter (`&portionen=6`).
 */
const HOST_URL = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec?f=FILE_ID';

const FINISHED_DISH: MealPlanRecipeInfo = { type: 'finished_dish' };
const G_RECIPE: MealPlanRecipeInfo = { type: 'ingredient_recipe', yieldUnit: 'g' };
const ML_RECIPE: MealPlanRecipeInfo = { type: 'ingredient_recipe', yieldUnit: 'ml' };
/** The same recipes as the app reads them: with their written yield. */
const G_RECIPE_500: MealPlanRecipeInfo = { ...G_RECIPE, yieldQuantity: 500 };
const ML_RECIPE_500: MealPlanRecipeInfo = { ...ML_RECIPE, yieldQuantity: 500 };

describe('parseMealPlanText — linkless shape', () => {
  it('keeps a title-only entry as the title candidate', () => {
    expect(parseMealPlanText('Kürbissuppe')).toEqual({
      text: 'Kürbissuppe',
      title: 'Kürbissuppe',
      planned: null,
      link: null,
    });
  });

  it('splits a serving suffix and trims the title', () => {
    expect(parseMealPlanText('  Kürbissuppe (6 Portionen) ')).toEqual({
      text: 'Kürbissuppe (6 Portionen)',
      title: 'Kürbissuppe',
      planned: { kind: 'servings', servings: 6 },
      link: null,
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
      link: null,
    });
  });

  it('does not split a parenthetical that is not a number plus known unit', () => {
    // An unknown unit word must not turn "Kürbissuppe" into a match — the whole
    // text stays the title candidate so the entry stays unrecognized.
    expect(parseMealPlanText('Kürbissuppe (6 Teller)')).toEqual({
      text: 'Kürbissuppe (6 Teller)',
      title: 'Kürbissuppe (6 Teller)',
      planned: null,
      link: null,
    });
  });

  it('does not split a bare number without a unit', () => {
    expect(parseMealPlanText('Kürbissuppe (6)').title).toBe('Kürbissuppe (6)');
  });

  it('requires a separator between number and unit', () => {
    expect(parseMealPlanText('Kürbissuppe (500g)').title).toBe('Kürbissuppe (500g)');
  });
});

describe('parseMealPlanText — link shape', () => {
  it('splits the title from a trailing export URL', () => {
    expect(parseMealPlanText(`Kürbissuppe: ${DRIVE_URL}#portionen=6`)).toEqual({
      text: `Kürbissuppe: ${DRIVE_URL}#portionen=6`,
      title: 'Kürbissuppe',
      planned: { kind: 'servings', servings: 6 },
      link: `${DRIVE_URL}#portionen=6`,
    });
  });

  it('reads the size out of an export-host URL as a query parameter', () => {
    // The host form the app writes: the file is already a query parameter, so
    // the size joins it.
    expect(parseMealPlanText(`Kürbissuppe: ${HOST_URL}&portionen=6`)).toEqual({
      text: `Kürbissuppe: ${HOST_URL}&portionen=6`,
      title: 'Kürbissuppe',
      planned: { kind: 'servings', servings: 6 },
      link: `${HOST_URL}&portionen=6`,
    });
    expect(parseMealPlanText(`Béchamelsauce: ${HOST_URL}&menge=500g`).planned).toEqual({
      kind: 'yield',
      quantity: 500,
      baseUnit: 'g',
    });
  });

  it('reads a yield out of the fragment and normalizes kg/l', () => {
    expect(parseMealPlanText(`Béchamelsauce: ${DRIVE_URL}#menge=500g`).planned).toEqual({
      kind: 'yield',
      quantity: 500,
      baseUnit: 'g',
    });
    expect(parseMealPlanText(`Béchamelsauce: ${DRIVE_URL}#menge=0,5kg`).planned).toEqual({
      kind: 'yield',
      quantity: 500,
      baseUnit: 'g',
    });
    expect(parseMealPlanText(`Gemüsebrühe: ${DRIVE_URL}#menge=1.5l`).planned).toEqual({
      kind: 'yield',
      quantity: 1500,
      baseUnit: 'ml',
    });
  });

  it('accepts a link without a size: the recipe keeps its written size', () => {
    const parsed = parseMealPlanText(`Kürbissuppe: ${DRIVE_URL}`);
    expect(parsed.title).toBe('Kürbissuppe');
    expect(parsed.planned).toBeNull();
    expect(parsed.link).toBe(DRIVE_URL);
  });

  it('accepts a link separated by whitespace only', () => {
    expect(parseMealPlanText(`Kürbissuppe ${DRIVE_URL}#portionen=4`).title).toBe('Kürbissuppe');
  });

  it('keeps a colon inside the title', () => {
    expect(parseMealPlanText(`Ragù: klassisch: ${DRIVE_URL}#portionen=4`).title).toBe(
      'Ragù: klassisch',
    );
  });

  it('leaves a line that is nothing but a URL unrecognized', () => {
    expect(parseMealPlanText(DRIVE_URL)).toEqual({
      text: DRIVE_URL,
      title: DRIVE_URL,
      planned: null,
      link: null,
    });
  });

  it('does not split a URL that is not the last token', () => {
    const text = `Kürbissuppe: ${DRIVE_URL} und mehr`;
    expect(parseMealPlanText(text)).toEqual({
      text,
      title: text,
      planned: null,
      link: null,
    });
  });

  it('still reads a parenthetical size in front of a hand-written link', () => {
    expect(parseMealPlanText(`Kürbissuppe (6 Portionen): ${DRIVE_URL}`).planned).toEqual({
      kind: 'servings',
      servings: 6,
    });
  });

  it('reads a bare short link as a link and restores its scheme', () => {
    // The shape the app writes into Keep (mealPlanEntryTextWithShortLink).
    const parsed = parseMealPlanText('Kürbissuppe (6 Portionen): tinyurl.com/k7f2qa');
    expect(parsed.title).toBe('Kürbissuppe');
    expect(parsed.planned).toEqual({ kind: 'servings', servings: 6 });
    expect(parsed.link).toBe('https://tinyurl.com/k7f2qa');
    expect(parseMealPlanText('Kürbissuppe (6 Portionen): www.tinyurl.com/k7f2qa').link).toBe(
      'https://www.tinyurl.com/k7f2qa',
    );
  });

  it('leaves a bare domain that is not the shortener host unrecognized', () => {
    // A scheme-less anything-else is not a Cookbook link line: the whole text
    // stays the title candidate, so a note that merely mentions a domain is
    // never mistaken for a planned dish.
    const text = 'Kürbissuppe: drive.google.com/file/d/FILE_ID/view';
    expect(parseMealPlanText(text)).toEqual({
      text,
      title: text,
      planned: null,
      link: null,
    });
  });
});

describe('plannedAmountFitsRecipe', () => {
  it('lets a size-less entry fit every recipe', () => {
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

  it('accepts a yield inside the baked range of the written yield', () => {
    // 500 g is written; ±2 decades reach 5 g … 50 kg (recipe/yieldViews.ts).
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 5, baseUnit: 'g' }, G_RECIPE_500),
    ).toBe(true);
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 50000, baseUnit: 'g' }, G_RECIPE_500),
    ).toBe(true);
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 50, baseUnit: 'g' }, G_RECIPE_500),
    ).toBe(true);
  });

  it('rejects a yield outside the baked range, even a ladder value', () => {
    // 2,5 g is one rung below the export's lowest baked view (5 g); 100 kg is
    // one decade above its highest (50 kg). The link could not open either.
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 2.5, baseUnit: 'g' }, G_RECIPE_500),
    ).toBe(false);
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 100000, baseUnit: 'g' }, G_RECIPE_500),
    ).toBe(false);
  });

  it('checks the range in the family unit of the written yield', () => {
    // Written at 500 ml: 5 ml … 50 l. A g value in an ml recipe is refused for
    // the unit alone.
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 50, baseUnit: 'ml' }, ML_RECIPE_500),
    ).toBe(true);
    expect(
      plannedAmountFitsRecipe({ kind: 'yield', quantity: 500, baseUnit: 'g' }, ML_RECIPE_500),
    ).toBe(false);
  });

  it('skips the range check when the caller does not know the written yield', () => {
    // A caller that cannot name the yield cannot rule a ladder value out; the
    // app always passes it (mealPlanCards.ts).
    expect(plannedAmountFitsRecipe({ kind: 'yield', quantity: 2.5, baseUnit: 'g' }, G_RECIPE)).toBe(
      true,
    );
  });

  it('refuses a size against a written yield that is not a ladder value', () => {
    // A hand-edited recipe file (docs/quantity_scaling.md §3): one malformed
    // recipe must not throw and take the whole meal-plan list down.
    expect(
      plannedAmountFitsRecipe(
        { kind: 'yield', quantity: 500, baseUnit: 'g' },
        { ...G_RECIPE, yieldQuantity: 499 },
      ),
    ).toBe(false);
  });
});

describe('yieldViewQuantities', () => {
  it('bakes the written yield and ±2 decades around it', () => {
    const quantities = yieldViewQuantities(500);
    expect(quantities).toHaveLength(2 * YIELD_VIEW_STEPS + 1);
    expect(quantities[0]).toBe(5);
    expect(quantities[quantities.length - 1]).toBe(50000);
    expect(quantities).toContain(500);
  });

  it('returns the ladder values ascending and without duplicates', () => {
    const quantities = yieldViewQuantities(250);
    for (let index = 1; index < quantities.length; index++) {
      expect(quantities[index]!).toBeGreaterThan(quantities[index - 1]!);
    }
    expect(new Set(quantities).size).toBe(quantities.length);
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
  it('writes the linkless entry in the shape the parser reads back', () => {
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

  it('writes the link entry with the size in the URL fragment', () => {
    expect(mealPlanEntryText('Kürbissuppe', { kind: 'servings', servings: 6 }, DRIVE_URL)).toBe(
      `Kürbissuppe: ${DRIVE_URL}#portionen=6`,
    );
    expect(
      mealPlanEntryText(
        'Béchamelsauce',
        { kind: 'yield', quantity: 500, baseUnit: 'g' },
        DRIVE_URL,
      ),
    ).toBe(`Béchamelsauce: ${DRIVE_URL}#menge=500g`);
    expect(
      mealPlanEntryText(
        'Gemüsebrühe',
        { kind: 'yield', quantity: 1500, baseUnit: 'ml' },
        DRIVE_URL,
      ),
    ).toBe(`Gemüsebrühe: ${DRIVE_URL}#menge=1500ml`);
  });

  it('writes the size as a query parameter on an export-host URL', () => {
    expect(mealPlanEntryText('Kürbissuppe', { kind: 'servings', servings: 6 }, HOST_URL)).toBe(
      `Kürbissuppe: ${HOST_URL}&portionen=6`,
    );
    expect(
      mealPlanEntryText('Béchamelsauce', { kind: 'yield', quantity: 500, baseUnit: 'g' }, HOST_URL),
    ).toBe(`Béchamelsauce: ${HOST_URL}&menge=500g`);
  });

  it('drops a fragment the URL already carries', () => {
    expect(
      mealPlanEntryText(
        'Kürbissuppe',
        { kind: 'servings', servings: 4 },
        `${DRIVE_URL}#portionen=9`,
      ),
    ).toBe(`Kürbissuppe: ${DRIVE_URL}#portionen=4`);
  });

  it('drops a size the host URL already carries', () => {
    expect(
      mealPlanEntryText(
        'Kürbissuppe',
        { kind: 'servings', servings: 4 },
        `${HOST_URL}&portionen=9`,
      ),
    ).toBe(`Kürbissuppe: ${HOST_URL}&portionen=4`);
  });

  it('falls back to the parenthetical shape for an empty URL', () => {
    expect(mealPlanEntryText('Kürbissuppe', { kind: 'servings', servings: 4 }, '   ')).toBe(
      `Kürbissuppe (4${NNBSP}Portionen)`,
    );
  });

  it('round-trips through the parser to the same title and size', () => {
    const sizes: PlannedAmount[] = [
      { kind: 'servings', servings: 4 },
      { kind: 'yield', quantity: 1500, baseUnit: 'ml' },
    ];
    for (const size of sizes) {
      const linkless = parseMealPlanText(mealPlanEntryText('Soljanka', size));
      expect(linkless.title).toBe('Soljanka');
      expect(linkless.planned).toEqual(size);
      expect(linkless.link).toBeNull();

      for (const url of [DRIVE_URL, HOST_URL]) {
        const linked = parseMealPlanText(mealPlanEntryText('Soljanka', size, url));
        expect(linked.title).toBe('Soljanka');
        expect(linked.planned).toEqual(size);
      }
    }
  });
});

describe('mealPlanEntryLabel', () => {
  it('names the entry in the human form without the URL', () => {
    expect(mealPlanEntryLabel('Kürbissuppe', { kind: 'servings', servings: 6 })).toBe(
      `Kürbissuppe (6${NNBSP}Portionen)`,
    );
    expect(mealPlanEntryLabel('Kürbissuppe', null)).toBe('Kürbissuppe');
  });
});

describe('mealPlanEntryTextWithShortLink', () => {
  /** The shortener's own answer: the scheme-carrying URL. */
  const SHORT_URL = 'https://tinyurl.com/k7f2qa';
  /** The same link as the Keep line carries it: without the scheme. */
  const BARE_SHORT_URL = 'tinyurl.com/k7f2qa';

  it('writes the size as the visible label, because the short link hides it', () => {
    expect(
      mealPlanEntryTextWithShortLink('Kürbissuppe', { kind: 'servings', servings: 6 }, SHORT_URL),
    ).toBe(`Kürbissuppe (6${NNBSP}Portionen): ${BARE_SHORT_URL}`);
    expect(
      mealPlanEntryTextWithShortLink(
        'Béchamelsauce',
        { kind: 'yield', quantity: 1500, baseUnit: 'ml' },
        SHORT_URL,
      ),
    ).toBe(`Béchamelsauce (1,5${NNBSP}l): ${BARE_SHORT_URL}`);
  });

  it('writes the link without its scheme, and reads the shortener URL back', () => {
    // Keep links a bare `tinyurl.com/…` too, so the scheme is dead weight in the
    // line. The parser restores it, so the value the app trades in stays the
    // shortener's own URL.
    const text = mealPlanEntryTextWithShortLink(
      'Soljanka',
      { kind: 'servings', servings: 4 },
      SHORT_URL,
    );
    expect(text).toBe(`Soljanka (4${NNBSP}Portionen): ${BARE_SHORT_URL}`);
    expect(parseMealPlanText(text).link).toBe(SHORT_URL);
  });

  it('keeps a link that carries no scheme of its own bare', () => {
    expect(
      mealPlanEntryTextWithShortLink('Soljanka', { kind: 'servings', servings: 4 }, BARE_SHORT_URL),
    ).toBe(`Soljanka (4${NNBSP}Portionen): ${BARE_SHORT_URL}`);
  });

  it('round-trips through the parser to the same title, size and link', () => {
    // The size is read out of the parenthetical here, not out of the URL: the
    // fallback branch of parseMealPlanText is what makes the shape work.
    const parsed = parseMealPlanText(
      mealPlanEntryTextWithShortLink('Soljanka', { kind: 'servings', servings: 4 }, SHORT_URL),
    );
    expect(parsed.title).toBe('Soljanka');
    expect(parsed.planned).toEqual({ kind: 'servings', servings: 4 });
    expect(parsed.link).toBe(SHORT_URL);
  });

  it('trims the URL it is handed', () => {
    expect(
      mealPlanEntryTextWithShortLink(
        'Soljanka',
        { kind: 'servings', servings: 4 },
        ` ${SHORT_URL} `,
      ),
    ).toBe(`Soljanka (4${NNBSP}Portionen): ${BARE_SHORT_URL}`);
  });

  it('is still collected as an instance of its recipe by the removal rule', () => {
    const text = mealPlanEntryTextWithShortLink(
      'Kürbissuppe',
      { kind: 'servings', servings: 6 },
      SHORT_URL,
    );
    expect(mealPlanEntriesForTitle([text, 'Kürbiscremesuppe'], 'Kürbissuppe')).toEqual([text]);
  });
});

describe('existingPlanLink', () => {
  const SHORT_URL = 'https://tinyurl.com/k7f2qa';
  const SERVINGS_6: PlannedAmount = { kind: 'servings', servings: 6 };
  const YIELD_500: PlannedAmount = { kind: 'yield', quantity: 500, baseUnit: 'g' };

  it('returns the short link an entry already carries for the same size', () => {
    const text = mealPlanEntryTextWithShortLink('Kürbissuppe', SERVINGS_6, SHORT_URL);
    expect(existingPlanLink([text], 'Kürbissuppe', SERVINGS_6)).toBe(SHORT_URL);
    expect(
      existingPlanLink(
        [mealPlanEntryTextWithShortLink('Béchamelsauce', YIELD_500, SHORT_URL)],
        'Béchamelsauce',
        YIELD_500,
      ),
    ).toBe(SHORT_URL);
  });

  it('does not reuse a long export link: it states its size in the URL', () => {
    // Reusing the long link would defeat the shortening, and the app must
    // rebuild (and shorten) its target instead.
    const long = mealPlanEntryText('Kürbissuppe', SERVINGS_6, HOST_URL);
    expect(existingPlanLink([long], 'Kürbissuppe', SERVINGS_6)).toBeNull();
    const drive = mealPlanEntryText('Kürbissuppe', SERVINGS_6, DRIVE_URL);
    expect(existingPlanLink([drive], 'Kürbissuppe', SERVINGS_6)).toBeNull();
  });

  it('ignores another size, another unit and another recipe', () => {
    const other = mealPlanEntryTextWithShortLink(
      'Kürbissuppe',
      { kind: 'servings', servings: 4 },
      SHORT_URL,
    );
    expect(existingPlanLink([other], 'Kürbissuppe', SERVINGS_6)).toBeNull();
    expect(
      existingPlanLink(
        [mealPlanEntryTextWithShortLink('Béchamelsauce', YIELD_500, SHORT_URL)],
        'Béchamelsauce',
        { kind: 'yield', quantity: 500, baseUnit: 'ml' },
      ),
    ).toBeNull();
    expect(
      existingPlanLink(
        [mealPlanEntryTextWithShortLink('Kürbiscremesuppe', SERVINGS_6, SHORT_URL)],
        'Kürbissuppe',
        SERVINGS_6,
      ),
    ).toBeNull();
  });

  it('ignores a linkless entry and a hand-written long link without a size', () => {
    expect(existingPlanLink(['Kürbissuppe (6 Portionen)'], 'Kürbissuppe', SERVINGS_6)).toBeNull();
    expect(existingPlanLink([`Kürbissuppe: ${HOST_URL}`], 'Kürbissuppe', SERVINGS_6)).toBeNull();
  });

  it('keeps a hand-written link whose size sits in the label', () => {
    // The user wrote the link, so their choice is reused rather than replaced —
    // the same rule that reuses the app's own short link.
    const handWritten = `Kürbissuppe (6${NNBSP}Portionen): ${DRIVE_URL}`;
    expect(existingPlanLink([handWritten], 'Kürbissuppe', SERVINGS_6)).toBe(DRIVE_URL);
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

  it('collects the link shape too, so a re-plan replaces the linked entry', () => {
    expect(
      mealPlanEntriesForTitle(
        [`Kürbissuppe: ${DRIVE_URL}#portionen=6`, 'Kürbiscremesuppe'],
        'Kürbissuppe',
      ),
    ).toEqual([`Kürbissuppe: ${DRIVE_URL}#portionen=6`]);
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
