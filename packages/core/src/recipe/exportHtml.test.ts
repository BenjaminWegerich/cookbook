/**
 * Tests for the HTML export — the cooking view (docs/user_stories.md, decision 7).
 *
 * The export bakes pre-computed, *scaled* display values per serving option:
 * the master list, each step's own rows and the step prose (inline artifacts)
 * all scale with the chosen serving count; sub-recipe uses (rows, master rows
 * and artifacts) render as links when a URL for the title is provided.
 */

import { describe, expect, it } from 'vitest';

import { renderAQS } from '../additionalUnits.js';
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
    expect(html).toContain(
      `9 Personen (${renderAQS('Tortillas', scale(250, delta), 'g')})`,
    );
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
    expect(html).toContain('500 ml');
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
