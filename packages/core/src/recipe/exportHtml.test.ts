/**
 * Tests for the HTML export — the cooking view (docs/user_stories.md, decision 7,
 * docs/DESIGN.md §5.11).
 *
 * The export bakes pre-computed, *scaled* display values per size: the master
 * list, the reference readout, each step's own rows and the step prose (inline
 * artifacts) all scale with the chosen size. The page is one document with three
 * screen states (Intro → Zutaten → Zubereitung), a fixed bottom bar and the
 * recipe's theme applied; sub-recipe uses (rows, master rows and artifacts)
 * carry the „Rezept" badge that opens the sub-recipe's export.
 */

import { describe, expect, it } from 'vitest';

import { formatBQ, renderAQSSlash } from '../additionalUnits.js';
import { difference, scale } from '../ladder.js';
import { parseRecipe } from './parse.js';
import { generateRecipeHtml } from './exportHtml.js';
import type { RecipePhoto } from './exportHtml.js';
import type { Recipe } from './types.js';

/** A finished dish with rows, a reference and inline artifacts. */
const WRAPS: Recipe = parseRecipe(`---
title: Shredded Tofu Wraps
type: finished_dish
servings: 6
prep_time: 20 min
total_time: 40 min
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

  it('renders one page with the three screen states and the bottom bar', () => {
    expect(html).toContain('data-screen="intro"');
    expect(html).toContain('data-screen="zutaten"');
    expect(html).toContain('data-screen="zubereitung"');
    expect(html).toContain('id="btn-back"');
    expect(html).toContain('id="btn-next"');
    // The forward/back buttons carry the directional arrows (DESIGN §4.5).
    expect(html).toContain('<span>Zurück</span>');
    expect(html).toContain('<span>Weiter</span>');
  });

  it('embeds one pre-computed view per serving option', () => {
    expect(html).toContain('data-servings="6"');
    expect(html).toContain('data-servings="9"');
    expect(html).toContain('data-servings="2"');
    expect(html.match(/class="check-list size-scoped/g)).toHaveLength(18);
  });

  it('scales the master list and the reference readout for an option', () => {
    const delta = difference(WRAPS.servings!, 9);
    expect(html).toContain(renderAQSSlash('Tortillas', scale(250, delta), 'g'));
    expect(html).toContain(renderAQSSlash('Joghurt', scale(400, delta), 'g'));
    // The written size's reference readout (amounts only, muted).
    expect(html).toContain(
      `<p class="reference size-scoped" data-servings="6">${renderAQSSlash('Tortillas', 250, 'g')}</p>`,
    );
  });

  it('renders each step with its own rows above the prose', () => {
    expect(html).toContain('<ul class="step-rows">');
    expect(html).toContain(
      `<span class="step-ingredient">${renderAQSSlash('Tortillas', 250, 'g')}</span>`,
    );
    expect(html).toContain(renderAQSSlash('Béchamelsauce', 500, 'ml'));
  });

  it('renders inline artifacts scaled inside the prose, in slash form', () => {
    const delta = difference(WRAPS.servings!, 6);
    // Option 6: the {{1500 ml Wasser}} artifact renders as its display form.
    expect(html).toContain(renderAQSSlash('Wasser', scale(1500, delta), 'ml'));
    // No raw artifact markers survive.
    expect(html).not.toContain('{{');
  });

  it('links sub-recipe uses (rows and artifacts) through the „Rezept" badge', () => {
    const url = 'https://drive.example/Béchamelsauce.html';
    expect(html).toContain('class="badge"');
    expect(html).toContain(`href="${url}"`);
    // Every size carries the three uses (master row + step row + artifact).
    expect(html.match(/class="badge"/g)).toHaveLength(54);
    expect(html).toContain('>Rezept</a>');
  });

  it('renders no sub-recipe badges when no URLs are passed', () => {
    const plain = generateRecipeHtml(WRAPS);
    expect(plain).not.toContain('class="badge"');
    expect(plain).not.toContain('{{');
  });

  it('selects a view on load instead of showing every serving option', () => {
    // Regression guard: the script must call the selection on load, fed by the
    // URL fragment, with the written size as the fallback.
    expect(html).toContain("!selectServing(params['portionen'])");
    expect(html).toContain('selectServing(activeChipValue())');
  });
});

describe('generateRecipeHtml — ingredient recipe yield views', () => {
  const sauce: Recipe = parseRecipe(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
reference:
  - Milch
prep_time: 15 min
---
## Zubereitung
1. - 25 g Butter
   - 300 ml Milch
   Butter schmelzen und mit Milch aufgießen.
2. In {{50 ml Milch}} auflösen und köcheln.
`);

  const html = generateRecipeHtml(sauce);

  it('bakes one view per yield rung, ±2 decades around the written yield', () => {
    expect(html.match(/class="check-list size-scoped/g) ?? []).toHaveLength(65);
    expect(html).toContain(`data-yield="500" data-yield-label="${formatBQ(500, 'ml')}"`);
    // The extremes of the range: 5 ml and 50 l.
    expect(html).toContain('data-yield="5"');
    expect(html).toContain(`data-yield="50000" data-yield-label="${formatBQ(50000, 'ml')}"`);
  });

  it('marks the written yield as the fallback view', () => {
    expect(html).toContain('class="check-list size-scoped is-written" data-yield="500"');
  });

  it('scales the master list and the reference per view', () => {
    const delta = difference(sauce.yield!, 5000); // 500 ml → 5 l
    expect(html).toContain(renderAQSSlash('Milch', scale(300, delta), 'ml'));
    expect(html).toContain(renderAQSSlash('Butter', scale(25, delta), 'g'));
  });

  it('offers the chips and the stepper, with the powers of ten plus the written size', () => {
    expect(html).toContain('class="chip yield-chip active" data-yield="500"');
    expect(html).toContain('class="chip yield-chip" data-yield="10000"');
    expect(html).toContain('class="yield-value"');
    expect(html).toContain('class="yield-step-button yield-step-down"');
    expect(html).toContain('class="yield-step-button yield-step-up"');
    // Out of the baked range, so never offered.
    expect(html).not.toContain('class="chip yield-chip" data-yield="100000"');
  });

  it('opens on the fragment yield and normalizes kg/l', () => {
    expect(html).toContain("params['menge']");
    expect(html).toContain('.check-list.is-written[data-yield]');
    // A hand-written kg/l link finds the same view as the g/ml one.
    expect(html).toContain('amount = amount * 1000');
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

  it('scales a unitless count along the AQ ladder and shows slash-form fractions', () => {
    // Option 6: 1/2 → 2/3, 100 → 150, 1/3 → 2/5, in the prose as plain text.
    expect(html).toContain('Mit 2/3 und 150 und 2/5 arbeiten.');
    // The stored option 4 shows the unscaled fractions.
    expect(html).toContain('Mit 1/2 und 100 und 1/3 arbeiten.');
    expect(html).not.toContain('{{');
  });
});

describe('generateRecipeHtml — ingredient recipe', () => {
  const sauce: Recipe = parseRecipe(`---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
reference:
  - Milch
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
    expect(html).not.toContain('class="serving-chip"');
    expect(html).toContain(formatBQ(500, 'ml'));
    expect(html).toContain(renderAQSSlash('Butter', 25, 'g'));
  });

  it('shows a reference ingredient as the intro readout', () => {
    // The written view: the reference keeps its stored quantity, e.g.
    // "300 ml Milch" under the size picker.
    expect(html).toContain(
      `<p class="reference size-scoped" data-yield="500">${renderAQSSlash('Milch', 300, 'ml')}</p>`,
    );
  });

  it('renders rows and unscaled artifacts in the steps', () => {
    expect(html).toContain('<ul class="step-rows">');
    expect(html).toContain(renderAQSSlash('Milch', 300, 'ml'));
    expect(html).toContain(renderAQSSlash('Milch', 50, 'ml'));
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

describe('generateRecipeHtml — meta line typography', () => {
  it('renders caption/value pairs with narrow no-break spaces', () => {
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
    expect(html).toContain('<span class="caption">Arbeitszeit</span>');
    expect(html).toContain('<span class="caption">Gesamtzeit</span>');
    // Display form: number and unit (and h–30 in compounds) are unbreakable.
    expect(html).toContain('25\u202fmin');
    expect(html).toContain('1\u202fh\u202f30\u202fmin');
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
    expect(html).toContain('<span class="meta-value">über Nacht</span>');
  });
});

describe('generateRecipeHtml — theme application (§4.8)', () => {
  const themed = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Fraunces
  accent: "#123456"
prep_time: 15 min
---
## Zubereitung
1. x
`);

  it('exposes the resolved theme tokens as CSS variables', () => {
    const html = generateRecipeHtml(themed);
    expect(html).toContain("--theme-font: 'Fraunces';");
    expect(html).toContain('--theme-accent: #123456;');
    // Missing tokens fall back to the default theme independently.
    expect(html).toContain('--theme-paper: #faf5ec;');
    expect(html).toContain('--theme-ink: #2b241d;');
    expect(html).toContain('--theme-line: #e6dbc8;');
  });

  it('uses the default theme for a recipe without theme data', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).toContain("--theme-font: 'Source Sans 3';");
    expect(html).toContain('--theme-accent: #b85c38;');
    expect(html).toContain('--theme-paper: #faf5ec;');
    expect(html).toContain('--theme-ink: #2b241d;');
    expect(html).toContain('--theme-line: #e6dbc8;');
  });

  it('computes the derived colours (muted and on-accent) as solid hex', () => {
    const html = generateRecipeHtml(WRAPS);
    // muted = ink #2b241d blended 40% toward paper #faf5ec → #7e7870.
    expect(html).toContain('--muted: #7e7870;');
    // The default clay accent takes the light paper as its on-accent.
    expect(html).toContain('--on-accent: #faf5ec;');
    // No runtime colour math (color-mix) is emitted into the file.
    expect(html).not.toContain('color-mix');
  });

  it('does not follow the OS dark preference (§4.1)', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).toContain('color-scheme: light');
    expect(html).not.toContain('prefers-color-scheme');
  });
});

describe('generateRecipeHtml — font embedding (§4.8)', () => {
  const fraunces = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Fraunces
prep_time: 15 min
---
## Zubereitung
1. x
`);
  const mono = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: IBM Plex Mono
prep_time: 15 min
---
## Zubereitung
1. x
`);

  it('embeds the theme typeface as a self-hosted WOFF2 data URI', () => {
    const html = generateRecipeHtml(fraunces);
    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Fraunces';");
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain("format('woff2')");
    // Self-contained: no network font URL.
    expect(html).not.toContain('https://');
  });

  it('embeds the default typeface for a recipe without theme data', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).toContain("font-family: 'Source Sans 3';");
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('declares a variable face over the two required weights', () => {
    const html = generateRecipeHtml(fraunces);
    expect(html).toContain('font-weight: 400 600;');
    expect(html).toContain("font-family: 'Fraunces';");
  });

  it('embeds one face per static weight for a static family', () => {
    const html = generateRecipeHtml(mono);
    expect(html).toContain('font-weight: 400;');
    expect(html).toContain('font-weight: 600;');
    // Two @font-face rules — one per static weight — and no variable range.
    expect(html.match(/@font-face/g)).toHaveLength(2);
    expect(html).not.toContain('font-weight: 400 600;');
  });
});

describe('generateRecipeHtml — photo embedding (§5.8)', () => {
  const photo: RecipePhoto = { mimeType: 'image/jpeg', base64: 'aGVsbG8=' };

  it('embeds the photo as a data URI at the top of the intro', () => {
    const html = generateRecipeHtml(WRAPS, {}, photo);
    expect(html).toContain('<img class="media" src="data:image/jpeg;base64,aGVsbG8=" alt="">');
    // The media area precedes the title inside the intro screen.
    expect(html.indexOf('<img class="media"')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('embeds a PNG photo with its own mime type', () => {
    const html = generateRecipeHtml(WRAPS, {}, { mimeType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(html).toContain('<img class="media" src="data:image/png;base64,iVBORw0KGgo=" alt="">');
  });

  it('omits the media area when no photo is passed', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('class="media"');
  });

  it('omits the media area for an empty payload instead of a broken image', () => {
    const html = generateRecipeHtml(WRAPS, {}, { mimeType: 'image/jpeg', base64: '' });
    expect(html).not.toContain('<img');
  });

  it('styles the media area as a 4:3 landscape cover (§5.8)', () => {
    const html = generateRecipeHtml(WRAPS, {}, photo);
    expect(html).toContain('aspect-ratio: 4 / 3');
    expect(html).toContain('object-fit: cover');
    expect(html).toContain('border-radius: var(--radius-md)');
  });
});
