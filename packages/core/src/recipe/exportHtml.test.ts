/**
 * Tests for the HTML export — the cooking view (docs/user_stories.md, decision 7).
 *
 * The export bakes pre-computed, *scaled* display values per serving option:
 * the master list, each step's own rows and the step prose (inline artifacts)
 * all scale with the chosen serving count; sub-recipe uses (rows, master rows
 * and artifacts) render as links when a URL for the title is provided.
 */

import { describe, expect, it } from 'vitest';

import { NNBSP, renderAQS } from '../additionalUnits.js';
import { scaleAQ } from '../aqLadder.js';
import { difference, scale } from '../ladder.js';
import { parseRecipe } from './parse.js';
import { generateRecipeHtml } from './exportHtml.js';
import type { Recipe } from './types.js';

/** A finished dish with rows, a reference and inline artifacts. */
const WRAPS: Recipe = parseRecipe(`---
title: Shredded Tofu Wraps
type: finished_dish
servings: 6
prep_time: 20 min
reference:
  - Tortillas
---
## Zubereitung
1. - 250 g Tortillas
   Tortillas in {{1500 ml Wasser}} dämpfen.
2. - 400 g Joghurt
   Joghurt verrühren.
3. - 500 ml Béchamelsauce
   Wraps füllen und {{200 ml Béchamelsauce}} dazureichen.
`);

/** The linked ingredient recipe (its export URL is passed via `links`). */
const LINKS: Readonly<Record<string, string>> = {
  Béchamelsauce: 'https://drive.example/Béchamelsauce.html',
};

describe('generateRecipeHtml — finished dish', () => {
  const html = generateRecipeHtml(WRAPS, LINKS);

  it('embeds one pre-computed view per serving option', () => {
    expect(html).toContain('data-servings="6"');
    expect(html).toContain('data-servings="9"');
    expect(html).toContain('data-servings="2"');
  });

  it('scales the master list and the headline for an option', () => {
    const delta = difference(WRAPS.servings!, 9);
    expect(html).toContain(`9 Personen (${renderAQS('Tortillas', scale(250, delta), 'g')})`);
    // Master row of the scaled Joghurt.
    expect(html).toContain(renderAQS('Joghurt', scale(400, delta), 'g'));
  });

  it('renders each step with its own rows above the prose', () => {
    expect(html).toContain('<ul class="step-ingredients">');
    expect(html).toContain(renderAQS('Tortillas', 250, 'g'));
    expect(html).toContain(renderAQS('Béchamelsauce', 500, 'ml'));
  });

  it('renders inline artifacts code-styled and scaled inside the prose', () => {
    const delta = difference(WRAPS.servings!, 6);
    // Option 6: the {{1500 ml Wasser}} artifact renders as its display form.
    expect(html).toContain(
      `<code class="step-artifact">${renderAQS('Wasser', scale(1500, delta), 'ml')}</code>`,
    );
    // No raw artifact markers survive.
    expect(html).not.toContain('{{');
  });

  it('links sub-recipe uses (rows and artifacts) when a URL is provided', () => {
    const url = 'https://drive.example/Béchamelsauce.html';
    // Every serving option contains master row + step row + artifact mention.
    // Check one full serving-view block: exactly 3 links.
    const marker = '<div class="serving-view" data-servings="6">';
    const start = html.indexOf(marker);
    const end = html.indexOf('<div class="serving-view"', start + 1);
    const option6 = html.slice(start, end);
    const occurrences = option6.split('class="sub-recipe-link"').length - 1;
    expect(occurrences).toBe(3);
    expect(option6).toContain(`href="${url}"`);
  });

  it('renders no sub-recipe links when no URLs are passed', () => {
    const plain = generateRecipeHtml(WRAPS);
    expect(plain).not.toContain('class="sub-recipe-link"');
    expect(plain).not.toContain('{{');
  });
});

describe('generateRecipeHtml — unitless inline counts (AQ ladder)', () => {
  const counts: Recipe = parseRecipe(`---
title: Zählen
type: finished_dish
servings: 4
prep_time: 5 min
---
## Zubereitung
1. Mit {{1/2}} und {{100}} und {{1/3}} arbeiten.
`);

  const html = generateRecipeHtml(counts);

  it('scales a unitless count along the AQ ladder and shows fraction glyphs', () => {
    const delta = difference(counts.servings!, 6); // +2
    // Inspect the option-6 view: 1/2 → 2/3, 100 → 120, 1/3 → 2/5.
    const marker = '<div class="serving-view" data-servings="6">';
    const start = html.indexOf(marker);
    const end = html.indexOf('<div class="serving-view"', start + 1);
    const option6 = html.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(option6).toContain('<code class="step-artifact">⅔</code>');
    expect(option6).toContain(`<code class="step-artifact">${scaleAQ(100, delta)}</code>`);
    expect(option6).toContain('<code class="step-artifact">⅖</code>');
    // The stored option 4 shows the unscaled fractions.
    const option4Start = html.indexOf('<div class="serving-view" data-servings="4">');
    const option4 = html.slice(
      option4Start,
      html.indexOf('<div class="serving-view"', option4Start + 1),
    );
    expect(option4).toContain('<code class="step-artifact">½</code>');
    expect(option4).toContain('<code class="step-artifact">⅓</code>');
    expect(html).not.toContain('{{');
  });
});

describe('generateRecipeHtml — ingredient recipe', () => {
  const sauce: Recipe = parseRecipe(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. - 25 g Butter
   - 300 ml Milch
   Butter schmelzen und mit Milch aufgießen.
2. In {{50 ml Milch}} auflösen und köcheln.
`);

  const html = generateRecipeHtml(sauce);

  it('has no serving picker and keeps stored quantities', () => {
    expect(html).not.toContain('class="serving-button"');
    expect(html).toContain(`500${NNBSP}ml`);
    expect(html).toContain(renderAQS('Butter', 25, 'g'));
  });

  it('renders rows and unscaled artifacts in the steps', () => {
    expect(html).toContain('<ul class="step-ingredients">');
    expect(html).toContain(renderAQS('Milch', 300, 'ml'));
    expect(html).toContain(`<code class="step-artifact">${renderAQS('Milch', 50, 'ml')}</code>`);
  });

  it('escapes user content', () => {
    const escaped = generateRecipeHtml(
      parseRecipe(`---
title: Test
type: finished_dish
servings: 2
prep_time: 5 min
---
## Zubereitung
1. Salz & Pfeffer <script> x
`),
    );
    expect(escaped).not.toContain('Pfeffer <script>');
    expect(escaped).toContain('Salz &amp; Pfeffer &lt;script&gt; x');
  });
});

describe('generateRecipeHtml — duration typography', () => {
  it('renders meta durations with narrow no-break spaces', () => {
    const html = generateRecipeHtml(
      parseRecipe(`---
title: Eintopf
type: finished_dish
servings: 4
prep_time: 25 min
total_time: 1 h 30 min
---
## Zubereitung
1. Alles köcheln lassen.
`),
    );
    // Display form: number and unit (and h–30 in compounds) are unbreakable.
    expect(html).toContain(`<p class="meta">25${NNBSP}min · 1${NNBSP}h${NNBSP}30${NNBSP}min</p>`);
    // The plain ASCII storage form is never emitted into the file.
    expect(html).not.toContain('1 h 30 min');
  });

  it('shows unparseable free-text durations verbatim', () => {
    const html = generateRecipeHtml(
      parseRecipe(`---
title: Sauerteig
type: finished_dish
servings: 1
prep_time: über Nacht
---
## Zubereitung
1. Gehen lassen.
`),
    );
    expect(html).toContain('<p class="meta">über Nacht</p>');
  });
});
