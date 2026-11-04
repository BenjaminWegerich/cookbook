/**
 * Tests for the HTML export — the cooking view (docs/ARCHITECTURE.md, "HTML share export",
 * docs/DESIGN.md §5.11).
 *
 * The export bakes pre-computed, *scaled* display values per size: the master
 * list, the reference readout, each step's own rows and the step prose (inline
 * artifacts) all scale with the chosen size. The page is one document with three
 * screen states (Intro → Zutaten → Zubereitung), a fixed bottom bar and the
 * recipe's theme applied; sub-recipe uses (rows, master rows and artifacts)
 * make the ingredient name the link that opens the sub-recipe's export.
 */

import { describe, expect, it } from 'vitest';

import { EN_SPACE, NNBSP, formatBQ, renderAQSDisplay } from '../additionalUnits.js';
import { escapeHtml } from './artifacts.js';
import { parseRecipe } from './parse.js';
import { yieldViewQuantities } from './yieldViews.js';
import { generateRecipeHtml } from './exportHtml.js';
import type { RecipePhoto } from './exportHtml.js';
import type { Recipe } from './types.js';

/**
 * The export's HTML for one *inline* amount line: the note leaves its brackets
 * and follows an en space in `.arrangement-note` (the reference readout), or
 * keeps the brackets and a regular space in step prose. Ingredient rows use
 * `rowAmountHtml` below, where the note becomes the quiet `.tail` column.
 */
function amountHtml(
  name: string,
  value: number,
  bu: string,
  noteForm: 'bare' | 'parenthesised' = 'bare',
): string {
  return renderAQSDisplay(name, value, bu)
    .parts.map((part) => {
      if (part.kind === 'text') {
        return escapeHtml(part.value);
      }
      const note = escapeHtml(part.value);
      if (noteForm === 'bare') {
        return `${EN_SPACE}<span class="arrangement-note">${note}</span>`;
      }
      return ` <span class="arrangement-note">(${note})</span>`;
    })
    .join('');
}

/**
 * The HTML of one amount line in the new row: the arrangement's text without
 * its final note, then that note in the quiet `.tail` column. The name is not
 * linked here; the link tests below cover that markup.
 */
function rowAmountHtml(name: string, value: number, bu: string): string {
  const display = renderAQSDisplay(name, value, bu);
  const last = display.parts[display.parts.length - 1];
  const tail = last?.kind === 'note' ? escapeHtml(last.value) : undefined;
  const body = (tail === undefined ? display.parts : display.parts.slice(0, -1))
    .map((part) => {
      if (part.kind === 'text') return escapeHtml(part.value);
      return `${EN_SPACE}<span class="arrangement-note">${escapeHtml(part.value)}</span>`;
    })
    .join('');
  return `${body}${tail === undefined ? '' : `<span class="tail">${tail}</span>`}`;
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
    expect(html.match(/class="ingredient-list check-list size-scoped/g)).toHaveLength(18);
  });

  it('scales the master list and the reference readout for an option', () => {
    // 6 → 9 servings is an exact factor of 1.5.
    expect(html).toContain(rowAmountHtml('Tortillas', 375, 'g'));
    expect(html).toContain(rowAmountHtml('Joghurt', 600, 'g'));
    // The written size's reference readout: one muted line per amount.
    expect(html).toContain(
      `<ul class="reference size-scoped" data-servings="6">\n` +
        `    <li>${amountHtml('Tortillas', 250, 'g')}</li>`,
    );
  });

  it('renders a repeated ingredient through the constrained master row', () => {
    const repeated = generateRecipeHtml(
      parseRecipe(`---
title: Doppelter Joghurt
type: finished_dish
servings: 4
prep_time: 5 min
---
## Zubereitung
1. - 450 g Joghurt
   Joghurt anrühren.
2. - 250 g Joghurt
   Joghurt unterheben.
`),
    );
    // Step rows show 1 Becher (500 g) and ½ Becher (250 g); the master sums
    // both the BQs (750 g) and the AQs (1 ½ Becher).
    expect(repeated).toContain(
      `1${NNBSP}½${NNBSP}Becher Joghurt<span class="tail">750${NNBSP}g</span>`,
    );
  });

  it('hangs the note as a right float and keeps the checkbox out of a label', () => {
    // The left text is the row's flex child; the note is a right float after
    // it, so it uses the last line when it fits and drops below otherwise.
    expect(html).toContain(
      '.ingredient-text { flex: 1; min-width: 0; display: flow-root; overflow-wrap: anywhere; }',
    );
    expect(html).toContain('.tail { float: right; margin-inline-start: 0.5em;');
    // The name is a link, not a pill: accent underline, accent on hover.
    expect(html).toContain('.name-link { position: relative; color: inherit;');
    expect(html).toContain('text-decoration-color: var(--accent);');
    expect(html).toContain('.name-link:hover { color: var(--accent); }');
    // No badge survives in the export.
    expect(html).not.toContain('.badge {');
    // The checkbox gets its accessible name from the text span; there is no
    // <label>, which would swallow the link's click.
    expect(html).toContain('aria-labelledby="t-c-s0-0"');
    expect(html).not.toContain('<label class="ingredient-text"');
  });

  it('links the name form the arrangement actually shows', () => {
    const singular = generateRecipeHtml(
      parseRecipe(`---
title: Zwiebeln
type: finished_dish
servings: 3
prep_time: 5 min
---
## Zubereitung
1. - 80 g Zwiebeln
   Zwiebeln schneiden.
`),
      { Zwiebeln: 'https://drive.example/Zwiebeln.html' },
    );
    // The `Stück (ZE zuerst)` arrangement shows the singular `<INF>` form;
    // the link has to wrap that word, not fail on the canonical plural.
    expect(singular).toContain('>Zwiebel</a>');
    // The singular must be a whole word, not a prefix of "Zwiebeln" with a
    // stray "n" left outside the anchor.
    expect(singular).not.toContain('>Zwiebel</a>n');
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
    // Joghurt drops its brackets like every other row and readout.
    const readout =
      /<ul class="reference size-scoped" data-servings="2">([\s\S]*?)<\/ul>/.exec(stacked)?.[1] ??
      '';
    expect(readout.match(/<li>/g)).toHaveLength(2);
    expect(readout).not.toContain(', ');
    expect(readout).toContain(amountHtml('Joghurt', 200, 'g'));
  });

  it('renders each step with its own rows above the prose', () => {
    expect(html).toContain('<ul class="ingredient-list step-rows">');
    expect(html).toContain(
      `<span class="ingredient-text">${rowAmountHtml('Tortillas', 250, 'g')}</span>`,
    );
    expect(html).toContain('class="name-link"');
    expect(html).toContain('>Béchamelsauce</a>');
  });

  it('renders inline artifacts scaled inside the prose', () => {
    // Option 6 is the written size, so the {{1500 ml Wasser}} artifact is unscaled.
    expect(html).toContain(amountHtml('Wasser', 1500, 'ml', 'parenthesised'));
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
    expect(butterHtml).toContain(rowAmountHtml('Butter', 250, 'g'));
    // Step prose: a regular space, brackets kept, both inside the styled run.
    expect(butterHtml).toContain(amountHtml('Butter', 250, 'g', 'parenthesised'));
  });

  it('links sub-recipe uses (rows and artifacts) through the ingredient name', () => {
    const url = 'https://drive.example/Béchamelsauce.html';
    expect(html).toContain('class="name-link"');
    expect(html).not.toContain('class="badge"');
    // Each link also promises the amount its use needs at that view, so the
    // sub-recipe opens scaled to the parent instead of at its own written
    // yield. The written 6-serving view uses 500 ml in the row and 200 ml in
    // the prose artifact.
    expect(html).toContain(`href="${url}#menge=500ml"`);
    expect(html).toContain(`href="${url}#menge=200ml"`);
    // Every size carries the three uses (master row + step row + artifact).
    expect(html.match(/class="name-link"/g)).toHaveLength(54);
    // The visible name is the anchor text in the rows and in running prose;
    // no separate badge follows it.
    expect(html).toContain('>Béchamelsauce</a>');
    expect(html).not.toContain('>Rezept</a>');
  });

  it('bakes each sub-recipe link with that view’s amount, snapped to a BQ', () => {
    const url = 'https://drive.example/Béchamelsauce.html';
    // 9 servings scale the 500 ml row to 750 ml and the 200 ml artifact to
    // 300 ml; both are allowed BQ values.
    expect(html).toContain(`href="${url}#menge=750ml"`);
    expect(html).toContain(`href="${url}#menge=300ml"`);
    // 7 servings scale the row to 583.33 ml, which has no baked view; the
    // nearest allowed BQ (600 ml) is what the link promises.
    expect(html).toContain(`href="${url}#menge=600ml"`);
  });

  it('adds the amount as a query parameter on an export-host link', () => {
    const hosted = generateRecipeHtml(WRAPS, {
      Béchamelsauce: 'https://host.example/exec?f=file-id',
    });
    expect(hosted).toContain('href="https://host.example/exec?f=file-id&amp;menge=500ml"');
  });

  it('renders no sub-recipe links when no URLs are passed', () => {
    const plain = generateRecipeHtml(WRAPS);
    expect(plain).not.toContain('class="name-link"');
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
    expect(html.match(/class="ingredient-list check-list size-scoped/g) ?? []).toHaveLength(65);
    expect(html).toContain(`data-yield="500" data-yield-label="${formatBQ(500, 'ml')}"`);
    // The extremes of the range: 50 ml and 5 l.
    expect(html).toContain('data-yield="50"');
    expect(html).toContain(`data-yield="5000" data-yield-label="${formatBQ(5000, 'ml')}"`);
  });

  it('marks the written yield as the fallback view', () => {
    expect(html).toContain(
      'class="ingredient-list check-list size-scoped is-written" data-yield="500"',
    );
  });

  it('scales the master list and the reference per view', () => {
    // 500 ml → 5 l is an exact factor of 10.
    expect(html).toContain(rowAmountHtml('Milch', 3000, 'ml'));
    expect(html).toContain(rowAmountHtml('Butter', 250, 'g'));
  });

  it('offers one adaptive chip row per baked view, recentred on that view', () => {
    expect(html.match(/class="chips yield-chips size-scoped/g) ?? []).toHaveLength(65);
    // The row for the written view is the only one visible before the script
    // runs, and it carries the checked radio.
    expect(html).toContain('class="chip yield-chip active" data-yield="500"');
    expect(html).toMatch(/class="chips yield-chips size-scoped" data-yield="500"[^>]*>/);
    expect(html).toMatch(/class="chips yield-chips size-scoped" data-yield="50"[^>]* hidden>/);
    // The row is adaptive, not the old powers of ten: 450/600 are BQ
    // neighbours whose rank rides in data-rank while the row reads ascending.
    const row =
      /<div class="chips yield-chips size-scoped" data-yield="500"[^>]*>([\s\S]*?)<\/div>/.exec(
        html,
      )?.[1] ?? '';
    expect(row).toContain('data-yield="450"');
    expect(row).toContain('data-yield="600"');
    expect(row).toContain('data-rank=');
    // Every offered chip is a baked view (the hard cap).
    const allowed = new Set(yieldViewQuantities(500));
    const chipValues = [...html.matchAll(/class="chip yield-chip[^"]*" data-yield="([^"]+)"/g)].map(
      (match) => Number(match[1]),
    );
    expect(chipValues.length).toBeGreaterThan(0);
    for (const value of chipValues) {
      expect(allowed.has(value)).toBe(true);
    }
    expect(html).toContain('class="yield-step-button yield-step-down"');
    expect(html).toContain('class="yield-step-button yield-step-up"');
  });

  it('uses the ingredient recipe master data (AU links) for the chip arrangements', () => {
    const joghurt: Recipe = parseRecipe(`---
title: Joghurt
type: ingredient_recipe
yield: 500
yield_unit: g
prep_time: 5 min
---
## Zubereitung
1. - 300 ml Milch
   Verrühren.
`);
    const joghurtHtml = generateRecipeHtml(joghurt);
    // The seed master data maps Joghurt to a 500 g Becher, so the active chip
    // for the written view reads as an arrangement, not as a plain 500 g.
    expect(joghurtHtml).toContain('class="chip yield-chip active" data-yield="500"');
    expect(joghurtHtml).toContain('Becher');
    expect(joghurtHtml).toContain('arrangement-note');
  });

  it('draws the stepper as the app\u2019s circular 42 px buttons with centred symbols', () => {
    expect(html).toContain('width: var(--space-9); height: var(--space-9); padding: 0;');
    expect(html).toContain('display: inline-grid; place-items: center; border-radius: 50%;');
    // The inline SVG must not sit on the text baseline, or it reads high.
    expect(html).toContain('.yield-step-button svg { display: block;');
    // Press-and-hold guards for touch.
    expect(html).toContain('touch-action: manipulation;');
  });

  it('copies the app\u2019s stepper row: 18 px gap, measured right-aligned value', () => {
    // The app's .quantity-row gap is --space-6, not the card gap.
    expect(html).toContain('gap: var(--space-6); margin: var(--space-3) 0 0;');
    // QuantityValue's hidden probe fixes the slot; the visible value is
    // right-aligned over it, so the buttons never move while stepping.
    expect(html).toContain('class="yield-value-slot"');
    expect(html).toContain('class="yield-value-measure" aria-hidden="true"');
    expect(html).toContain('.yield-value { position: absolute; inset: 0;');
    expect(html).toContain('text-align: right;');
    // The slot reserves BQ widths ("950 ml"), not the free input's decimals.
    expect(html).toContain(escapeHtml(formatBQ(950, 'ml')));
    expect(html).not.toContain(escapeHtml(formatBQ(1000 - 0.01, 'ml')));
    // The pressed state is the app's wash, as a solid theme colour.
    expect(html).toContain(
      '.yield-step-button:active:not(:disabled) { background: var(--press); }',
    );
    // The adaptive rows are one measured line, like SuggestionChips.
    expect(html).toContain('.yield-chips { flex-wrap: nowrap; overflow: hidden; }');
    expect(html).toContain('function fitYieldChips()');
    expect(html).toContain("e.currentTarget.parentNode.querySelectorAll('.chip')");
  });

  it('repeats a held stepper button at the app\u2019s cadence', () => {
    // A hold steps once after 450 ms, then every 100 ms, and swallows the
    // closing click; a plain tap still steps exactly once.
    expect(html).toContain('var HOLD_FIRST_REPEAT_MS = 450;');
    expect(html).toContain('var HOLD_REPEAT_INTERVAL_MS = 100;');
    expect(html).toContain("button.addEventListener('pointerdown'");
    expect(html).toContain("button.addEventListener('pointerup', stopHold)");
    expect(html).toContain("button.addEventListener('pointercancel', stopHold)");
    expect(html).toContain('if (repeated) { repeated = false; return; }');
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

  it('scales a unitless count by the exact factor and shows fraction glyphs', () => {
    // Option 6 (factor 1.5): 1/2 → 3/4, 100 → 150 (outside the AQ table, so a
    // plain number), 1/3 → 1/2.
    expect(html).toContain('Mit ¾ und 150 und ½ arbeiten.');
    // The written option 4 shows the unscaled counts.
    expect(html).toContain('Mit ½ und 100 und ⅓ arbeiten.');
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
    expect(html).toContain(rowAmountHtml('Butter', 25, 'g'));
  });

  it('shows a reference ingredient as the intro readout', () => {
    // The written view: the reference keeps its stored quantity, e.g.
    // "300 ml Milch" under the size picker.
    expect(html).toContain(
      `<ul class="reference size-scoped" data-yield="500">\n` +
        `    <li>${amountHtml('Milch', 300, 'ml')}</li>`,
    );
  });

  it('renders rows and unscaled artifacts in the steps', () => {
    expect(html).toContain('<ul class="ingredient-list step-rows">');
    expect(html).toContain(rowAmountHtml('Milch', 300, 'ml'));
    expect(html).toContain(amountHtml('Milch', 50, 'ml', 'parenthesised'));
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
    // The heading face falls back to the body serif for glyphs it lacks.
    expect(html).toContain(
      "--font-heading: 'Noto Serif Display', 'Noto Serif', system-ui, sans-serif;",
    );
  });

  it('computes the derived colours (muted, on-accent and press) as solid hex', () => {
    const html = generateRecipeHtml(WRAPS);
    // muted = ink #2b241d blended 40% toward paper #faf5ec → #7e7870.
    expect(html).toContain('--muted: #7e7870;');
    // The default clay accent takes the light paper as its on-accent.
    expect(html).toContain('--on-accent: #faf5ec;');
    // press = ink blended 12% onto paper → #e1dcd3.
    expect(html).toContain('--press: #e1dcd3;');
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
  const mono = parseRecipe(`---
title: X
type: finished_dish
servings: 2
theme:
  font: Noto Sans Mono
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

  it('still parses a retired face a stored recipe carries, and exports it in the fallback', () => {
    // Condensed and mono are no longer selectable and no longer embedded; a
    // recipe saved before that decision must keep loading, and its cooking view
    // renders in the fallback stack instead of an embedded face.
    for (const [recipe, family] of [
      [condensed, 'Noto Sans Condensed'],
      [mono, 'Noto Sans Mono'],
    ] as const) {
      const html = generateRecipeHtml(recipe);
      expect(html).toContain(`--font: '${family}', system-ui, sans-serif;`);
      expect(html).not.toContain(`font-family: '${family}';`);
      expect(html).not.toContain('@font-face');
    }
  });

  it('embeds the drawn italic beside the upright face of the theme family', () => {
    // DESIGN §4.2/§5.4 sets arrangement notes, the `optional` marker and the
    // passive annotations in italic. The family must carry a real italic face,
    // otherwise the browser synthesizes an oblique from the upright file.
    const html = generateRecipeHtml(serif);
    expect(html).toContain('font-style: italic;');
    expect(html).toContain("font-family: 'Noto Serif';");
    // Both @font-face rules of the italic style declare it the same way (each
    // is followed by its `font-display` line): the latin face and its companion.
    expect(html.match(/font-style: italic;\n  font-display/g)).toHaveLength(2);
    expect(html.match(/font-style: normal;\n  font-display/g)).toHaveLength(2);
  });

  it('embeds the matching fraction/space companion beside every face and style', () => {
    const html = generateRecipeHtml(serif);
    // Each face excludes U+202F and the Number Forms; its companion owns both,
    // so the fractions keep the serif design — italic ones included.
    expect(html.match(/unicode-range: U\+202F, U\+2150-215E, U\+2189;/g)).toHaveLength(2);
    expect(html.match(/@font-face/g)).toHaveLength(4);
  });

  it('embeds both faces of a display-serif theme, with companions for the body only', () => {
    const html = generateRecipeHtml(display);
    expect(html).toContain("font-family: 'Noto Serif Display';");
    expect(html).toContain("font-family: 'Noto Serif';");
    // Heading face (no fractions, no italic) + body upright and italic, each
    // with its companion.
    expect(html.match(/@font-face/g)).toHaveLength(5);
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
