/**
 * Tests for the HTML export generator (docs/user_stories.md decision 7).
 */

import { describe, expect, it } from 'vitest';

import { renderAQS } from '../additionalUnits.js';
import { difference, scale } from '../ladder.js';
import type { Recipe } from './types.js';
import { generateRecipeHtml } from './exportHtml.js';

const WRAPS: Recipe = {
  title: 'Shredded Tofu Wraps',
  type: 'finished_dish',
  subtitle: 'Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip',
  description: 'Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.',
  servings: 6,
  prep_time: '25 min',
  total_time: '40 min',
  ingredients: [
    { name: 'Joghurt', quantity: 400, unit: 'g' },
    { name: 'Tortillas', quantity: 250, unit: 'g', reference: true },
    { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
  ],
  steps: [
    'Tortillas im Ofen erwärmen.',
    'Tofu marinieren und scharf anbraten.',
    'Wraps füllen und servieren.',
  ],
};

const BECHAMEL: Recipe = {
  title: 'Béchamelsauce',
  type: 'ingredient_recipe',
  yield: 500,
  yield_unit: 'ml',
  prep_time: '15 min',
  ingredients: [
    { name: 'Milch', quantity: 300, unit: 'ml' },
    { name: 'Butter', quantity: 25, unit: 'g' },
  ],
  steps: ['Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.', 'Unter Rühren köcheln.'],
};

describe('generateRecipeHtml — finished dish', () => {
  const html = generateRecipeHtml(WRAPS);

  it('is a complete German HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<title>Shredded Tofu Wraps</title>');
    expect(html).toContain('Erstellt mit Cookbook');
  });

  it('pre-computes all 18 serving options (integer ladder values 1–30)', () => {
    expect(html.match(/class="serving-option"/g)).toHaveLength(18);
    expect(html.match(/class="serving-button/g)).toHaveLength(18);
    for (const servings of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30]) {
      expect(html).toContain(`data-servings="${servings}"`);
    }
  });

  it('shows the base serving option initially, hides the others', () => {
    expect(html).toContain('<ul class="serving-option" data-servings="6">');
    expect(html).toContain('<ul class="serving-option" data-servings="1" hidden>');
    expect(html).toContain('<ul class="serving-option" data-servings="30" hidden>');
  });

  it('marks the base option button as active', () => {
    expect(html).toContain('class="serving-button active" data-servings="6"');
    expect(html).toContain('class="serving-button" data-servings="1"');
  });

  it('pre-computes the scaled display lines per option (ladder + additional units)', () => {
    // 6 → 9 Personen: 3 rungs up. Joghurt 400 g → scale(400, 3), displayed via
    // the additional-unit logic — exactly what the export bakes in.
    const deltaX = difference(6, 9);
    expect(html).toContain(renderAQS('Joghurt', scale(400, deltaX), 'g'));
    expect(html).toContain(renderAQS('Tortillas', scale(250, deltaX), 'g'));
  });

  it('includes the scaled reference headline per option', () => {
    const deltaX = difference(6, 9);
    const expectedHeadline = `9 Personen (${renderAQS('Tortillas', scale(250, deltaX), 'g')})`;
    expect(html).toContain(expectedHeadline);
  });

  it('substitutes ingredient markers with their display arrangement in steps', () => {
    const marked: Recipe = {
      ...WRAPS,
      ingredients: [
        { name: 'Joghurt', quantity: 400, unit: 'g' },
        { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
      ],
      steps: [
        '{{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren.',
        'Ohne Marker servieren.',
      ],
    };
    const html = generateRecipeHtml(marked);
    const arrangement = renderAQS('Joghurt', 400, 'g');
    expect(html).toContain(`${arrangement} mit ${renderAQS('Zitronensaft', 15, 'ml')} verrühren.`);
    expect(html).not.toContain('{{ingredient|');
  });

  it('renders all steps with step-by-step navigation controls', () => {
    expect(html.match(/class="step" data-step="/g)).toHaveLength(3);
    expect(html).toContain('data-step="1"');
    expect(html).toContain('id="step-prev"');
    expect(html).toContain('id="step-next"');
    expect(html).toContain('id="step-counter"');
    expect(html).toContain('1 von 3');
  });
});

describe('generateRecipeHtml — ingredient recipe', () => {
  const html = generateRecipeHtml(BECHAMEL);

  it('shows the unscaled ingredients and the yield, without a serving picker', () => {
    // No serving-option elements or picker buttons in the DOM (the embedded
    // script mentions the selectors, so check for the rendered markup).
    expect(html).not.toContain('class="serving-option"');
    expect(html).not.toContain('class="serving-button"');
    expect(html).toContain(renderAQS('Milch', 300, 'ml'));
    expect(html).toContain(renderAQS('Butter', 25, 'g'));
  });

  it('still offers step-by-step navigation', () => {
    expect(html.match(/class="step" data-step="/g)).toHaveLength(2);
    expect(html).toContain('id="step-next"');
  });
});

describe('generateRecipeHtml — sub-recipe links', () => {
  /** A recipe whose Béchamelsauce is a linked ingredient recipe. */
  const withSubRecipe: Recipe = {
    ...WRAPS,
    ingredients: [
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce' },
    ],
    steps: [
      'Tortillas erwärmen.',
      'Mit {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} servieren.',
    ],
  };
  const LINKS = { Béchamelsauce: 'https://drive.google.com/file/d/abc123/view' };

  it('links sub-recipe ingredients and step markers when a URL is known', () => {
    const html = generateRecipeHtml(withSubRecipe, LINKS);
    // The ingredient list row of the sub-recipe is a link to its own export.
    const display = renderAQS('Béchamelsauce', 500, 'ml');
    expect(html).toContain(
      `<a href="https://drive.google.com/file/d/abc123/view" class="sub-recipe-link" target="_blank" rel="noopener">${display}</a>`,
    );
    // The step marker is a link too, inside the surrounding step text.
    expect(html).toContain(
      `Mit <a href="https://drive.google.com/file/d/abc123/view" class="sub-recipe-link" target="_blank" rel="noopener">${display}</a> servieren.`,
    );
    // Plain ingredients stay plain text.
    expect(html).toContain(renderAQS('Joghurt', 400, 'g'));
  });

  it('falls back to plain text when no URL is known for the title', () => {
    const html = generateRecipeHtml(withSubRecipe);
    expect(html).not.toContain('class="sub-recipe-link"');
    expect(html).toContain(renderAQS('Béchamelsauce', 500, 'ml'));
  });

  it('renders a linked reference sub-recipe inside the serving headline', () => {
    // A sub-recipe may be a reference ingredient (§4) — its headline entry
    // ("N Personen (…)") must contain the link markup, not escaped text.
    const referenceSubRecipe: Recipe = {
      ...withSubRecipe,
      ingredients: [
        { name: 'Béchamelsauce', quantity: 500, unit: 'ml', recipe: 'Béchamelsauce', reference: true },
      ],
    };
    const html = generateRecipeHtml(referenceSubRecipe, LINKS);
    const display = renderAQS('Béchamelsauce', 500, 'ml');
    expect(html).toContain(
      `6 Personen (<a href="https://drive.google.com/file/d/abc123/view" class="sub-recipe-link" target="_blank" rel="noopener">${display}</a>)`,
    );
    expect(html).not.toContain('&lt;a href=');
  });
});

describe('generateRecipeHtml — safety', () => {
  it('escapes all recipe content (no markup injection from data)', () => {
    const evil: Recipe = {
      ...WRAPS,
      title: 'Wraps <script>alert(1)</script>',
      steps: ['Schritt mit <b>HTML</b> und "Anführungszeichen".'],
      ingredients: [{ name: 'Mehl & Gewürz', quantity: 250, unit: 'g' }],
    };
    const html = generateRecipeHtml(evil);
    expect(html).toContain('Wraps &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Schritt mit &lt;b&gt;HTML&lt;/b&gt;');
    expect(html).toContain('Mehl &amp; Gewürz');
  });

  it('embeds no master data or display logic (only pre-computed values)', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).not.toContain('numberScheme');
    expect(html).not.toContain('standard_numbers');
    expect(html).not.toContain('LADDER');
  });
});
