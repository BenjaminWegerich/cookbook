/**
 * Tests for the HTML export — the cooking view (docs/ARCHITECTURE.md, "HTML share export",
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

import { EN_SPACE, formatBQ, renderAQSSlash, renderAQSDisplaySlash } from '../additionalUnits.js';
import { escapeHtml } from './artifacts.js';
import { parseRecipe } from './parse.js';
import { generateRecipeHtml } from './exportHtml.js';
import type { RecipePhoto } from './exportHtml.js';
import type { Recipe } from './types.js';

/**
 * The export's HTML for one amount line: the note leaves its brackets and
 * follows an en space in `.arrangement-note`, except in step prose, which keeps
 * the brackets and a regular space, and in the reference readout, which keeps
 * the brackets after an en space.
 */
function amountHtml(
  name: string,
  value: number,
  bu: string,
  noteForm: 'bare' | 'parenthesised' | 'reference' = 'bare',
): string {
  return renderAQSDisplaySlash(name, value, bu)
    .parts.map((part) => {
      if (part.kind === 'text') {
        return escapeHtml(part.value);
      }
      const note = escapeHtml(part.value);
      if (noteForm === 'bare') {
        return `${EN_SPACE}<span class="arrangement-note">${note}</span>`;
      }
      const space = noteForm === 'reference' ? EN_SPACE : ' ';
      return `${space}<span class="arrangement-note">(${note})</span>`;
    })
    .join('');
}

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
    // 6 → 9 servings is an exact factor of 1.5.
    expect(html).toContain(amountHtml('Tortillas', 375, 'g'));
    expect(html).toContain(amountHtml('Joghurt', 600, 'g'));
    // The written size's reference readout: one muted line per amount.
    expect(html).toContain(
      `<ul class="reference size-scoped" data-servings="6">\n` +
        `    <li>${amountHtml('Tortillas', 250, 'g', 'reference')}</li>`,
    );
  });

  it('stacks the reference readout without commas between the amounts', () => {
    const stacked = generateRecipeHtml(
      parseRecipe(`---
title: Zwei Referenzen
type: finished_dish
servings: 2
prep_time: 5 min
reference:
  - Tortillas
  - Joghurt
---
## Zubereitung
1. - 250 g Tortillas
   - 200 g Joghurt
   Tortillas und Joghurt verrühren.
`),
      {},
    );
    // The written size's readout: two lines, no comma joining them, and the
    // Joghurt keeps its bracketed note after an en space.
    const readout =
      /<ul class="reference size-scoped" data-servings="2">([\s\S]*?)<\/ul>/.exec(stacked)?.[1] ??
      '';
    expect(readout.match(/<li>/g)).toHaveLength(2);
    expect(readout).not.toContain(', ');
    expect(readout).toContain(amountHtml('Joghurt', 200, 'g', 'reference'));
  });

  it('renders each step with its own rows above the prose', () => {
    expect(html).toContain('<ul class="step-rows">');
    expect(html).toContain(
      `<span class="step-ingredient">${amountHtml('Tortillas', 250, 'g')}</span>`,
    );
    expect(html).toContain(amountHtml('Béchamelsauce', 500, 'ml'));
  });

  it('renders inline artifacts scaled inside the prose, in slash form', () => {
    // Option 6 is the written size, so the {{1500 ml Wasser}} artifact is unscaled.
    expect(html).toContain(amountHtml('Wasser', 1500, 'ml'));
    // No raw artifact markers survive.
    expect(html).not.toContain('{{');
  });

  it('styles an arrangement note and keeps the brackets in step prose', () => {
    const recipe = parseRecipe(`---
title: Butter
type: finished_dish
servings: 2
prep_time: 5 min
---
## Zubereitung
1. - 250 g Butter
   Butter mit {{250 g Butter}} verrühren.
`);
    const butterHtml = generateRecipeHtml(recipe, {});
    // Master/step rows: no brackets, an en space and the muted note run.
    expect(butterHtml).toContain(amountHtml('Butter', 250, 'g'));
    // Step prose: a regular space, brackets kept, both inside the styled run.
    expect(butterHtml).toContain(amountHtml('Butter', 250, 'g', 'parenthesised'));
  });

  it('links sub-recipe uses (rows and artifacts) through the „Rezept" badge', () => {
    const url = 'https://drive.example/Béchamelsauce.html';
    expect(html).toContain('class="badge"');
    expect(html).toContain(`href="${url}"`);
    // Every size carries the three uses (master row + step row + artifact).
    expect(html.match(/class="badge"/g)).toHaveLength(54);
    expect(html).toContain('>Rezept</a>');
    // The badge in running prose keeps a narrow no-break space from the word
    // before it, so a screen reader never reads them as one word (§7).
    expect(html).toContain('Béchamelsauce <a class="badge"');
    // The step row separates the two with a margin instead, so it takes no space.
    expect(html).toContain('Béchamelsauce</span><a class="badge"');
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

  it('bakes the allowed BQ views within ±1 decade around the written yield', () => {
    expect(html.match(/class="check-list size-scoped/g) ?? []).toHaveLength(65);
    expect(html).toContain(`data-yield="500" data-yield-label="${formatBQ(500, 'ml')}"`);
    // The extremes of the range: 50 ml and 5 l.
    expect(html).toContain('data-yield="50"');
    expect(html).toContain(`data-yield="5000" data-yield-label="${formatBQ(5000, 'ml')}"`);
  });

  it('marks the written yield as the fallback view', () => {
    expect(html).toContain('class="check-list size-scoped is-written" data-yield="500"');
  });

  it('scales the master list and the reference per view', () => {
    // 500 ml → 5 l is an exact factor of 10.
    expect(html).toContain(amountHtml('Milch', 3000, 'ml'));
    expect(html).toContain(amountHtml('Butter', 250, 'g'));
  });

  it('offers the chips and the stepper, with the powers of ten plus the written size', () => {
    expect(html).toContain('class="chip yield-chip active" data-yield="500"');
    expect(html).toContain('class="chip yield-chip" data-yield="1000"');
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

  it('scales a unitless count by the exact factor and shows slash-form fractions', () => {
    // Option 6 (factor 1.5): 1/2 → 3/4, 100 → 150 (outside the AQ table, so a
    // plain number), 1/3 → 1/2.
    expect(html).toContain('Mit 3/4 und 150 und 1/2 arbeiten.');
    // The written option 4 shows the unscaled counts.
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
    expect(html).toContain(amountHtml('Butter', 25, 'g'));
  });

  it('shows a reference ingredient as the intro readout', () => {
    // The written view: the reference keeps its stored quantity, e.g.
    // "300 ml Milch" under the size picker.
    expect(html).toContain(
      `<ul class="reference size-scoped" data-yield="500">\n` +
        `    <li>${amountHtml('Milch', 300, 'ml', 'reference')}</li>`,
    );
  });

  it('renders rows and unscaled artifacts in the steps', () => {
    expect(html).toContain('<ul class="step-rows">');
    expect(html).toContain(amountHtml('Milch', 300, 'ml'));
    expect(html).toContain(amountHtml('Milch', 50, 'ml'));
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
  font: Noto Serif
  accent: "#123456"
prep_time: 15 min
---
## Zubereitung
1. x
`);

  it('exposes the resolved theme tokens as CSS variables', () => {
    const html = generateRecipeHtml(themed);
    expect(html).toContain("--theme-font: 'Noto Serif';");
    expect(html).toContain('--theme-accent: #123456;');
    // Missing tokens fall back to the default theme independently.
    expect(html).toContain('--theme-paper: #faf5ec;');
    expect(html).toContain('--theme-ink: #2b241d;');
    expect(html).toContain('--theme-line: #e6dbc8;');
  });

  it('uses the default theme for a recipe without theme data', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).toContain("--theme-font: 'Noto Sans';");
    expect(html).toContain('--theme-accent: #ad5632;');
    expect(html).toContain('--theme-paper: #faf5ec;');
    expect(html).toContain('--theme-ink: #2b241d;');
    expect(html).toContain('--theme-line: #e6dbc8;');
  });

  it('pairs the display serif with Noto Serif for the body', () => {
    const displayThemed = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Noto Serif Display
prep_time: 15 min
---
## Zubereitung
1. x
`);
    const html = generateRecipeHtml(displayThemed);
    expect(html).toContain("--theme-font: 'Noto Serif Display';");
    expect(html).toContain("--font: 'Noto Serif', system-ui, sans-serif;");
    expect(html).toContain("--font-heading: 'Noto Serif Display', system-ui, sans-serif;");
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
  const serif = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Noto Serif
prep_time: 15 min
---
## Zubereitung
1. x
`);
  const condensed = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Noto Sans Condensed
prep_time: 15 min
---
## Zubereitung
1. x
`);
  const display = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Noto Serif Display
prep_time: 15 min
---
## Zubereitung
1. x
`);

  it('embeds the theme typeface as a self-hosted WOFF2 data URI', () => {
    const html = generateRecipeHtml(serif);
    expect(html).toContain('@font-face');
    expect(html).toContain("font-family: 'Noto Serif';");
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain("format('woff2')");
    // Self-contained: no network font URL.
    expect(html).not.toContain('https://');
  });

  it('embeds the default typeface for a recipe without theme data', () => {
    const html = generateRecipeHtml(WRAPS);
    expect(html).toContain("font-family: 'Noto Sans';");
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('declares a variable face over the two required weights', () => {
    const html = generateRecipeHtml(serif);
    expect(html).toContain('font-weight: 400 600;');
    expect(html).toContain("font-family: 'Noto Serif';");
  });

  it('embeds the generated condensed width instance as one variable face', () => {
    const html = generateRecipeHtml(condensed);
    expect(html).toContain("font-family: 'Noto Sans Condensed';");
    expect(html).toContain('font-weight: 400 600;');
    // The theme face plus the shared companion, both under the theme family.
    expect(html.match(/@font-face/g)).toHaveLength(2);
  });

  it('embeds the fraction/space companion beside the theme face', () => {
    const html = generateRecipeHtml(serif);
    // The theme face excludes U+202F; the companion owns it and the Number Forms.
    expect(html).toContain('unicode-range: U+202F, U+2150-215E, U+2189;');
    expect(html.match(/@font-face/g)).toHaveLength(2);
  });

  it('embeds both faces of a display-serif theme, each with its companion', () => {
    const html = generateRecipeHtml(display);
    expect(html).toContain("font-family: 'Noto Serif Display';");
    expect(html).toContain("font-family: 'Noto Serif';");
    // Latin face + companion for the heading and for the body family.
    expect(html.match(/@font-face/g)).toHaveLength(4);
  });

  it('sets only the page headings in the heading face', () => {
    const html = generateRecipeHtml(display);
    expect(html).toContain('h1, .screen-title, .step-title { font-family: var(--font-heading); }');
    expect(html).toContain('font-family: var(--font);');
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
