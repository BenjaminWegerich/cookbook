/**
 * HTML export generator — the cooking view (docs/user_stories.md, decision 7).
 *
 * Produces a self-contained HTML file for a recipe with *pre-computed* display
 * values: for every allowed size the complete cooking view is baked into the
 * file — the scaled master ingredient list, the scaled per-step ingredient
 * lists, and the step prose with its scaled inline artifacts. No master data
 * and no scaling/display logic run at runtime; the embedded script only toggles
 * visibility for the size picker and the step-by-step navigation (decision 7
 * extension, ROADMAP Phase 1).
 *
 * The allowed sizes depend on the recipe type:
 *
 * - a **finished dish** has the integer ladder serving counts 1–30 (18 options),
 *   exactly what the meal plan accepts;
 * - an **ingredient recipe** has the ladder yields within ±2 decades of its
 *   written yield (`recipe/yieldViews.ts`), which is the same range the meal
 *   plan accepts — so the link in a Keep line can always open the exact amount.
 *
 * The page opens on the recipe's written size, or on the size the URL's
 * fragment asks for (`#portionen=6`, `#menge=500g` — the fragment keys live in
 * `planLink.ts`, where the meal-plan writer and reader use them too). Keep has
 * no hyperlink-with-text, so a meal-plan entry carries the raw export URL and
 * this fragment is how the chosen size travels with it.
 *
 * The app stores the export as `<title>.html` next to the recipe file and
 * regenerates it in place on every save, so shared links never break
 * (docs/ARCHITECTURE.md, HTML share export).
 *
 * Sub-recipe links: when the caller passes a `links` map (ingredient-recipe
 * title → URL, e.g. the Drive link of the sub-recipe's own `<title>.html`),
 * every ingredient use whose name is present in the map — a step row, a master
 * row, or an inline text artifact — is rendered as a link to that export
 * (recipe_structure.md "The link means … displayed as a link"; links are
 * implicit by name == recipe title, storage_format.md §4). Without a URL for a
 * title the display line stays plain text.
 *
 * All recipe content is HTML-escaped: recipe data is user/AI-authored text and
 * must never be able to inject markup into the exported file.
 */

import { formatAQValue, formatBQ, NNBSP, renderAQS } from '../additionalUnits.js';
import { scaleAQ } from '../aqLadder.js';
import { escapeHtml, renderArtifacts } from './artifacts.js';
import type { TextArtifact } from './artifacts.js';
import { difference, integerLadderValues, scale } from '../ladder.js';
import { PLAN_FRAGMENT_SERVINGS, PLAN_FRAGMENT_YIELD, formatLinkQuantity } from '../planLink.js';
import { displayTimeText } from './timeValues.js';
import { yieldViewQuantities } from './yieldViews.js';
import type { Ingredient, Recipe, Step, Unit } from './types.js';

/** Allowed serving options of the export: integer ladder values 1–30 (§D2). */
const SERVING_MIN = 1;
const SERVING_MAX = 30;

/**
 * Renders a quantity/ingredient display line (already HTML-escaped). A link is
 * added when the name is present in `links` (implicit sub-recipe, §4). A
 * quantity-only artifact may be unitless (`{{1/2}}`) and then renders as its AQ
 * standard number in the fraction typography.
 */
function displayLine(
  name: string | undefined,
  bq: number,
  bu: Unit | undefined,
  links: Readonly<Record<string, string>>,
): string {
  const line =
    name === undefined
      ? bu === undefined
        ? formatAQValue(bq)
        : formatBQ(bq, bu)
      : renderAQS(name, bq, bu ?? 'g');
  const url = name !== undefined ? links[name] : undefined;
  if (url === undefined) return escapeHtml(line);
  return (
    `<a href="${escapeHtml(url)}" class="sub-recipe-link" target="_blank" rel="noopener">` +
    `${escapeHtml(line)}</a>`
  );
}

/** Renders one (scaled) ingredient use as a list line. */
function ingredientLine(
  ingredient: Ingredient,
  bq: number,
  links: Readonly<Record<string, string>>,
): string {
  return displayLine(ingredient.name, bq, ingredient.unit, links);
}

/** Renders one step block of the cooking view at a given scale step Δx. */
function renderStep(step: Step, deltaX: number, links: Readonly<Record<string, string>>): string {
  const rows =
    step.ingredients.length === 0
      ? ''
      : `<ul class="step-ingredients">\n` +
        step.ingredients
          .map(
            (ingredient) =>
              `  <li>${ingredientLine(ingredient, scale(ingredient.quantity, deltaX), links)}</li>`,
          )
          .join('\n') +
        `\n</ul>\n`;
  // The prose artifacts are substituted with their scaled display form; the
  // surrounding text is HTML-escaped (renderArtifacts). Code-style artifacts:
  // <code class="step-artifact"> for the quantity, wrapped in a link when the
  // artifact names an ingredient recipe.
  const text = renderArtifacts(step.text, (artifact: TextArtifact) => {
    // A unitless count scales along the AQ ladder (its own standard numbers);
    // an artifact with a unit is a base quantity and scales along the BQ ladder.
    const bq =
      artifact.unit === undefined
        ? scaleAQ(artifact.quantity, deltaX)
        : scale(artifact.quantity, deltaX);
    // displayLine returns already-escaped HTML and wraps the line in a link
    // when the artifact names an ingredient recipe (links map, §4).
    return `<code class="step-artifact">${displayLine(artifact.name, bq, artifact.unit, links)}</code>`;
  });
  return `    <li class="step">\n${rows}      <p class="step-text">${text}</p>\n    </li>`;
}

/**
 * Renders one pre-computed cooking view: the scaled master ingredient list with
 * its headline and the steps. `extraClass` extends the wrapper's class and
 * `attributes` carry the size the embedded script toggles on
 * (`data-servings` / `data-yield`).
 */
function cookingView(
  recipe: Recipe,
  deltaX: number,
  headline: string,
  links: Readonly<Record<string, string>>,
  extraClass: string,
  attributes: string,
): string {
  const lines = recipe.ingredients.map((ingredient) =>
    ingredientLine(ingredient, scale(ingredient.quantity, deltaX), links),
  );
  const steps = recipe.steps.map((step) => renderStep(step, deltaX, links)).join('\n');
  return (
    `<div class="serving-view${extraClass}" ${attributes}>\n` +
    `  <section aria-label="Zutaten">\n` +
    `    <p class="serving-headline">${headline}</p>\n` +
    `    <ul class="ingredients">\n${lines.map((line) => `  <li>${line}</li>`).join('\n')}\n` +
    `    </ul>\n` +
    `  </section>\n` +
    `  <section aria-label="Zubereitung">\n` +
    `    <ol class="steps">\n${steps}\n    </ol>\n` +
    `    <div class="step-nav">\n` +
    `      <button type="button" class="step-prev">Vorheriger Schritt</button>\n` +
    `      <span class="step-counter" aria-live="polite">1 von ${recipe.steps.length}</span>\n` +
    `      <button type="button" class="step-next">Nächster Schritt</button>\n` +
    `    </div>\n` +
    `  </section>\n` +
    `</div>`
  );
}

/** The reference ingredients of one view, scaled by the view's Δx. */
function referenceLines(
  recipe: Recipe,
  deltaX: number,
  links: Readonly<Record<string, string>>,
): string[] {
  return recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) => ingredientLine(ingredient, scale(ingredient.quantity, deltaX), links));
}

/**
 * Renders the full cooking view for one serving option: the scaled master
 * ingredient list (with the "N Personen (…)" headline) and the steps.
 */
function servingView(
  recipe: Recipe,
  servings: number,
  links: Readonly<Record<string, string>>,
): string {
  const deltaX = difference(recipe.servings!, servings);
  const references = referenceLines(recipe, deltaX, links);
  const headline =
    references.length > 0
      ? `${servings} Personen (${references.join(', ')})`
      : `${servings} Personen`;
  return cookingView(recipe, deltaX, headline, links, '', `data-servings="${servings}"`);
}

/**
 * Renders the full cooking view for one yield option of an ingredient recipe:
 * the scaled master ingredient list (with the "500 g (…)"/"1,5 l" headline and
 * its scaled reference check) and the steps. The written view is marked
 * `is-written`, which is the script's fallback when the URL names no size.
 */
function yieldView(
  recipe: Recipe,
  quantity: number,
  links: Readonly<Record<string, string>>,
): string {
  const unit = recipe.yield_unit!;
  const deltaX = difference(recipe.yield!, quantity);
  const references = referenceLines(recipe, deltaX, links);
  const yieldLine = formatBQ(quantity, unit);
  const headline =
    references.length > 0
      ? `${escapeHtml(yieldLine)} (${references.join(', ')})`
      : escapeHtml(yieldLine);
  const written = quantity === recipe.yield ? ' is-written' : '';
  return cookingView(
    recipe,
    deltaX,
    headline,
    links,
    written,
    `data-yield="${formatLinkQuantity(quantity)}" data-yield-label="${escapeHtml(yieldLine)}"`,
  );
}

/** The serving picker for finished dishes. */
function renderServingButtons(recipe: Recipe): string {
  const baseServings = recipe.servings!;
  const buttons = integerLadderValues(SERVING_MIN, SERVING_MAX)
    .map((servings) => {
      const active = servings === baseServings ? ' active' : '';
      return `<button type="button" class="serving-button${active}" data-servings="${servings}">${servings}</button>`;
    })
    .join('\n      ');
  return (
    `<section aria-label="Portionen">\n` +
    `  <div class="servings" role="group" aria-label="Portionen wählen">\n` +
    `    ${buttons}\n` +
    `  </div>\n` +
    `</section>`
  );
}

/**
 * True for a power of ten (`0.1`, `1`, `10`, `100`, …). The yield picker's
 * chips are those values inside the baked range — the same "suggested" idea as
 * the editor's QuantityPicker (apps/web/src/components/quantityChips.ts), whose
 * row is exactly the powers of ten.
 */
function isPowerOfTen(value: number): boolean {
  if (!(value > 0)) return false;
  const exponent = Math.log10(value);
  return Math.abs(exponent - Math.round(exponent)) < 1e-9;
}

/**
 * The yield picker of an ingredient recipe: the editor's own control language —
 * a row of suggested chips for one tap, and a −/+ stepper that moves exactly
 * one ladder rung per press (the same step the app's QuantityPicker takes).
 * Every value belongs to a baked view, so a tap only toggles visibility; no
 * scaling runs at runtime.
 *
 * The chips are the powers of ten inside the baked range plus the recipe's
 * written size, which is the sane default and is always present.
 */
function renderYieldPicker(recipe: Recipe, quantities: readonly number[]): string {
  const unit = recipe.yield_unit!;
  const written = recipe.yield!;
  // The powers of ten inside the baked range, plus the written size: the same
  // "suggested" idea as the editor's chip row (quantityChips.ts).
  const chipValues = quantities.filter((quantity) => isPowerOfTen(quantity));
  if (!chipValues.includes(written)) chipValues.push(written);
  chipValues.sort((a, b) => a - b);
  const chips = chipValues
    .map((quantity) => {
      const active = quantity === written ? ' active' : '';
      return (
        `<button type="button" class="yield-chip${active}" data-yield="${formatLinkQuantity(quantity)}">` +
        `${escapeHtml(formatBQ(quantity, unit))}</button>`
      );
    })
    .join('\n      ');
  return (
    `<section aria-label="Ergiebigkeit">\n` +
    `  <div class="yield-chips" role="group" aria-label="Ergiebigkeit wählen">\n` +
    `    ${chips}\n` +
    `  </div>\n` +
    `  <div class="yield-row">\n` +
    `    <button type="button" class="yield-step-button yield-step-down" aria-label="Menge um eine Stufe verringern">−</button>\n` +
    `    <span class="yield-value">${escapeHtml(formatBQ(written, unit))}</span>\n` +
    `    <button type="button" class="yield-step-button yield-step-up" aria-label="Menge um eine Stufe erhöhen">+</button>\n` +
    `  </div>\n` +
    `</section>`
  );
}

/**
 * The unscaled single view of an ingredient recipe that carries no yield or no
 * family unit. `parseRecipe` does not enforce those fields (validation does),
 * so a malformed file still exports a usable cooking view instead of none.
 */
function renderMalformedIngredientView(
  recipe: Recipe,
  links: Readonly<Record<string, string>>,
): string {
  const yieldLine = `${recipe.yield ?? ''}${NNBSP}${recipe.yield_unit ?? ''}`;
  const references = referenceLines(recipe, 0, links);
  const headline =
    references.length > 0
      ? `${escapeHtml(yieldLine)} (${references.join(', ')})`
      : escapeHtml(yieldLine);
  return cookingView(recipe, 0, headline, links, '', 'data-yield=""');
}

/** The body of an ingredient recipe: the yield picker plus one view per yield. */
function ingredientRecipeBody(recipe: Recipe, links: Readonly<Record<string, string>>): string {
  if (recipe.yield === undefined || recipe.yield_unit === undefined) {
    return renderMalformedIngredientView(recipe, links);
  }
  const quantities = yieldViewQuantities(recipe.yield);
  return (
    renderYieldPicker(recipe, quantities) +
    '\n' +
    quantities.map((quantity) => yieldView(recipe, quantity, links)).join('\n')
  );
}

/**
 * The embedded navigation script: only DOM toggling, no scaling logic. It also
 * reads the size the URL's fragment asks for — the meal-plan link's promise —
 * and falls back to the recipe's written size when there is none (or when the
 * requested size has no baked view).
 */
const NAVIGATION_SCRIPT = `
(function () {
  'use strict';

  // The fragment carries the size the meal-plan line promised
  // (#${PLAN_FRAGMENT_SERVINGS}=6, #${PLAN_FRAGMENT_YIELD}=500g). Keep's link
  // handling may swallow it, so every selection below falls back to the
  // recipe's written size instead of showing nothing.
  var params = {};
  window.location.hash.replace(/^#/, '').split('&').forEach(function (part) {
    var eq = part.indexOf('=');
    if (eq > 0) { params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1)); }
  });

  // Serving picker (finished dishes): every option is pre-rendered; only
  // visibility changes. Returns whether the requested option exists.
  var options = document.querySelectorAll('.serving-view[data-servings]');
  var buttons = document.querySelectorAll('.serving-button');
  function selectServing(n) {
    var found = false;
    options.forEach(function (el) {
      var match = el.getAttribute('data-servings') === n;
      el.hidden = !match;
      if (match) { found = true; }
    });
    if (!found) { return false; }
    buttons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-servings') === n);
    });
    return true;
  }
  function activeServing() {
    var active = document.querySelector('.serving-button.active');
    return active === null ? '' : active.getAttribute('data-servings');
  }
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () { selectServing(btn.getAttribute('data-servings')); });
  });

  // Yield picker (ingredient recipes): the chips and the −/+ stepper walk the
  // pre-rendered views, one ladder rung per step.
  var yieldOptions = document.querySelectorAll('.serving-view[data-yield]');
  var yieldChips = document.querySelectorAll('.yield-chip');
  var yieldValue = document.querySelector('.yield-value');
  var stepDown = document.querySelector('.yield-step-down');
  var stepUp = document.querySelector('.yield-step-up');
  var yieldValues = [];
  var yieldLabels = {};
  yieldOptions.forEach(function (el) {
    var value = el.getAttribute('data-yield');
    yieldValues.push(value);
    yieldLabels[value] = el.getAttribute('data-yield-label');
  });
  var yieldIndex = 0;
  function selectYieldAt(index) {
    if (index < 0 || index >= yieldValues.length) { return; }
    yieldIndex = index;
    var value = yieldValues[index];
    yieldOptions.forEach(function (el) { el.hidden = el.getAttribute('data-yield') !== value; });
    yieldChips.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-yield') === value);
    });
    if (yieldValue) { yieldValue.textContent = yieldLabels[value]; }
    if (stepDown) { stepDown.disabled = index === 0; }
    if (stepUp) { stepUp.disabled = index === yieldValues.length - 1; }
  }
  function selectYield(value) {
    var index = yieldValues.indexOf(value);
    if (index < 0) { return false; }
    selectYieldAt(index);
    return true;
  }
  yieldChips.forEach(function (btn) {
    btn.addEventListener('click', function () { selectYield(btn.getAttribute('data-yield')); });
  });
  if (stepDown) { stepDown.addEventListener('click', function () { selectYieldAt(yieldIndex - 1); }); }
  if (stepUp) { stepUp.addEventListener('click', function () { selectYieldAt(yieldIndex + 1); }); }

  // Step-by-step navigation: one step visible at a time per size view.
  function bindSteps(container) {
    var steps = container.querySelectorAll('.step');
    var prev = container.querySelector('.step-prev');
    var next = container.querySelector('.step-next');
    var counter = container.querySelector('.step-counter');
    var current = 0;
    function showStep(i) {
      if (i < 0 || i >= steps.length) { return; }
      current = i;
      steps.forEach(function (el, idx) { el.hidden = idx !== current; });
      counter.textContent = (current + 1) + ' von ' + steps.length;
      prev.disabled = current === 0;
      next.disabled = current === steps.length - 1;
    }
    if (prev) { prev.addEventListener('click', function () { showStep(current - 1); }); }
    if (next) { next.addEventListener('click', function () { showStep(current + 1); }); }
    if (steps.length > 0) { showStep(0); }
  }
  options.forEach(bindSteps);
  yieldOptions.forEach(bindSteps);

  // A fragment yield is normalized to the family base unit, so a hand-written
  // kg/l link finds the same view as the g/ml one the app writes.
  function normalizeYield(text) {
    var match = /^(\\d+(?:[.,]\\d+)?)(kg|l|g|ml)$/.exec(text);
    if (!match) { return null; }
    var amount = Number(match[1].replace(',', '.'));
    var unit = match[2];
    if (unit === 'kg' || unit === 'l') { amount = amount * 1000; }
    return String(amount);
  }

  // The initial view: the fragment's size when it has one, otherwise the
  // recipe's written size (the active button / the is-written yield view).
  if (options.length > 0) {
    if (!selectServing(params['${PLAN_FRAGMENT_SERVINGS}']) && !selectServing(activeServing())) {
      selectServing(options[0].getAttribute('data-servings'));
    }
  } else if (yieldOptions.length > 0) {
    var wanted = params['${PLAN_FRAGMENT_YIELD}'] ? normalizeYield(params['${PLAN_FRAGMENT_YIELD}']) : null;
    if (wanted === null || !selectYield(wanted)) {
      var writtenView = document.querySelector('.serving-view.is-written');
      if (!writtenView || !selectYield(writtenView.getAttribute('data-yield'))) {
        selectYieldAt(0);
      }
    }
  }
})();
`;

/** Inline styles: readable at arm's length on phone and smart display. */
const STYLES = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         line-height: 1.5; max-width: 40rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 0.2rem; }
  .description { margin: 0.6rem 0; }
  .meta { color: #666; margin: 0.4rem 0 1.2rem; }
  .servings { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .serving-button { font: inherit; padding: 0.4rem 0.7rem; border-radius: 0.4rem;
                    border: 1px solid #888; background: transparent; }
  .serving-button.active { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .yield-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.6rem; }
  .yield-chip { font: inherit; padding: 0.4rem 0.7rem; border-radius: 0.4rem;
                border: 1px solid #888; background: transparent; }
  .yield-chip.active { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .yield-row { display: flex; align-items: center; gap: 0.8rem; }
  .yield-step-button { font: inherit; font-size: 1.2rem; line-height: 1; min-width: 2.6rem;
                       padding: 0.4rem 0.6rem; border-radius: 0.4rem;
                       border: 1px solid #888; background: transparent; }
  .yield-step-button:disabled { opacity: 0.5; cursor: default; }
  .yield-value { font-weight: 600; min-width: 5rem; text-align: center; }
  .serving-headline { font-weight: 600; margin: 0.6rem 0; }
  .sub-recipe-link { color: #1a73e8; text-decoration: underline; }
  .ingredients, .steps { padding-left: 1.3rem; }
  .ingredients li, .step-ingredients li { margin: 0.35rem 0; }
  .step-ingredients { list-style: none; padding: 0; margin: 0 0 0.4rem; }
  .step-ingredients li::before { content: "– "; }
  .step { font-size: 1.35rem; line-height: 1.45; margin: 0.6rem 0; }
  .step-text { margin: 0; }
  .step-artifact { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                   font-size: 0.92em; background: #0000001a; border-radius: 0.25rem;
                   padding: 0.05rem 0.3rem; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { .step-artifact { background: #ffffff1f; } }
  .step-nav { display: flex; align-items: center; gap: 0.8rem; margin-top: 1rem; }
  .step-nav button { font: inherit; padding: 0.6rem 1rem; border-radius: 0.4rem;
                     border: 1px solid #888; background: transparent; }
  /* Same unavailable look as the app (--opacity-disabled is a web-app token;
     the self-contained export copies the value). */
  .step-nav button:disabled { opacity: 0.5; cursor: default; }
  footer { margin-top: 2rem; color: #888; font-size: 0.85rem; }
  [hidden] { display: none !important; }
`;

/**
 * Generates the self-contained HTML export of a recipe (decision 7).
 *
 * @param recipe a parsed recipe (validated by the caller)
 * @param links optional map of ingredient-recipe title → URL (e.g. the Drive
 *   link of the recipe's own `<title>.html` export). Whenever an ingredient
 *   use — master row, step row or text artifact — names a title present in
 *   this map, its display line is rendered as a link to that export
 *   (recipe_structure.md "The link means", storage_format.md §4).
 * @returns the complete HTML document as a string
 */
export function generateRecipeHtml(
  recipe: Recipe,
  links: Readonly<Record<string, string>> = {},
): string {
  const header =
    `<header>\n` +
    `  <h1>${escapeHtml(recipe.title)}</h1>\n` +
    (recipe.description !== undefined
      ? `  <p class="description">${escapeHtml(recipe.description)}</p>\n`
      : '') +
    `  <p class="meta">${escapeHtml(displayTimeText(recipe.prep_time))}${recipe.total_time !== undefined ? ` · ${escapeHtml(displayTimeText(recipe.total_time))}` : ''}</p>\n` +
    `</header>`;

  const body =
    recipe.type === 'finished_dish'
      ? renderServingButtons(recipe) +
        '\n' +
        integerLadderValues(SERVING_MIN, SERVING_MAX)
          .map((servings) => servingView(recipe, servings, links))
          .join('\n')
      : ingredientRecipeBody(recipe, links);

  return (
    `<!doctype html>\n` +
    `<html lang="de">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `  <title>${escapeHtml(recipe.title)}</title>\n` +
    `  <style>${STYLES}\n  </style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${header}\n` +
    `${body}\n` +
    `  <footer>Erstellt mit Cookbook</footer>\n` +
    `  <script>${NAVIGATION_SCRIPT}\n  </script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
