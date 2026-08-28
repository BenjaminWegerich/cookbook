/**
 * HTML export generator — the cooking view (docs/user_stories.md, decision 7).
 *
 * Produces a self-contained HTML file for a recipe with *pre-computed* display
 * values: for every allowed serving option (integer ladder values 1–30, i.e. 18
 * options) each ingredient's final display line (scaled base quantity plus
 * additional-unit form, via ./additionalUnits) is baked into the file. No
 * master data and no scaling/display logic run at runtime; the embedded script
 * only toggles visibility for the serving picker and the step-by-step
 * navigation (decision 7 extension, ROADMAP Phase 1).
 *
 * The app stores the export as `<title>.html` next to the recipe file and
 * regenerates it in place on every save, so shared links never break
 * (docs/ARCHITECTURE.md, HTML share export).
 *
 * Ingredient recipes have no serving count; their export shows the ingredients
 * at the stored quantities (no picker). Step navigation works for both types.
 *
 * All recipe content is HTML-escaped: recipe data is user/AI-authored text and
 * must never be able to inject markup into the exported file.
 */

import { renderAQS } from '../additionalUnits.js';
import { renderMarkers } from './markers.js';
import { difference, integerLadderValues, scale } from '../ladder.js';
import type { Ingredient, Recipe } from './types.js';

/** Allowed serving options of the export: integer ladder values 1–30 (§D2). */
const SERVING_MIN = 1;
const SERVING_MAX = 30;

/** Escapes a text value for safe insertion into HTML content or attributes. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Returns the display line of an ingredient at the given base quantity —
 * base + additional-unit form via the deterministic selection logic (§4).
 */
function ingredientLine(ingredient: Ingredient, bq: number): string {
  return renderAQS(ingredient.name, bq, ingredient.unit);
}

/**
 * Computes the scaled ingredient lines and the "N Personen (…)" headline for
 * one serving option of a finished dish.
 */
function servingOption(recipe: Recipe, servings: number): { headline: string; lines: string[] } {
  const deltaX = difference(recipe.servings!, servings);
  const references = recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) => ingredientLine(ingredient, scale(ingredient.quantity, deltaX)));
  const headline =
    references.length > 0
      ? `${servings} Personen (${references.join(', ')})`
      : `${servings} Personen`;
  const lines = recipe.ingredients.map((ingredient) =>
    ingredientLine(ingredient, scale(ingredient.quantity, deltaX)),
  );
  return { headline, lines };
}

/**
 * Renders the finished-dish ingredients section: a serving picker plus one
 * pre-computed ingredient list per serving option (the base option visible).
 */
function renderDishIngredients(recipe: Recipe, baseServings: number): string {
  const options = integerLadderValues(SERVING_MIN, SERVING_MAX).map((servings) => {
    const { headline, lines } = servingOption(recipe, servings);
    const hidden = servings === baseServings ? '' : ' hidden';
    return (
      `<ul class="serving-option" data-servings="${servings}"${hidden}>\n` +
      `  <li class="serving-headline">${escapeHtml(headline)}</li>\n` +
      lines.map((line) => `  <li>${escapeHtml(line)}</li>`).join('\n') +
      '\n</ul>'
    );
  });
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
    options.join('\n') +
    `\n</section>`
  );
}

/** Renders the ingredient-recipe ingredients section (unscaled, no picker). */
function renderIngredientRecipeIngredients(recipe: Recipe): string {
  const yieldLine = `${recipe.yield} ${recipe.yield_unit}`;
  const lines = recipe.ingredients.map((ingredient) =>
    ingredientLine(ingredient, ingredient.quantity),
  );
  return (
    `<section aria-label="Zutaten">\n` +
    `  <p class="serving-headline">${escapeHtml(yieldLine)}</p>\n` +
    `  <ul class="ingredients">\n` +
    lines.map((line) => `    <li>${escapeHtml(line)}</li>`).join('\n') +
    `\n  </ul>\n</section>`
  );
}

/** Renders the preparation steps and the step-by-step navigation controls. */
function renderSteps(recipe: Recipe): string {
  const items = recipe.steps
    .map((step, index) => {
      const hidden = index === 0 ? '' : ' hidden';
      // The ingredient markers are substituted with their display arrangement
      // (the cooking view shows "1 Becher Joghurt (400 g)", never the marker).
      const rendered = renderMarkers(step, (marker) =>
        renderAQS(marker.name, marker.quantity, marker.unit),
      );
      return `    <li class="step" data-step="${index + 1}"${hidden}>${escapeHtml(rendered)}</li>`;
    })
    .join('\n');
  return (
    `<section aria-label="Zubereitung">\n` +
    `  <ol class="steps">\n${items}\n  </ol>\n` +
    `  <div class="step-nav">\n` +
    `    <button type="button" id="step-prev">Vorheriger Schritt</button>\n` +
    `    <span id="step-counter" aria-live="polite">1 von ${recipe.steps.length}</span>\n` +
    `    <button type="button" id="step-next">Nächster Schritt</button>\n` +
    `  </div>\n</section>`
  );
}

/** The embedded navigation script: only DOM toggling, no scaling logic. */
const NAVIGATION_SCRIPT = `
(function () {
  'use strict';
  // Serving picker: every option is pre-rendered; only visibility changes.
  var options = document.querySelectorAll('.serving-option');
  var buttons = document.querySelectorAll('.serving-button');
  function selectServing(n) {
    options.forEach(function (el) { el.hidden = el.getAttribute('data-servings') !== n; });
    buttons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-servings') === n);
    });
  }
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () { selectServing(btn.getAttribute('data-servings')); });
  });

  // Step-by-step navigation: one step visible at a time.
  var steps = document.querySelectorAll('.step');
  var prev = document.getElementById('step-prev');
  var next = document.getElementById('step-next');
  var counter = document.getElementById('step-counter');
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
})();
`;

/** Inline styles: readable at arm's length on phone and smart display. */
const STYLES = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         line-height: 1.5; max-width: 40rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 0.2rem; }
  .subtitle { font-size: 1.1rem; margin: 0 0 0.8rem; }
  .description { margin: 0.6rem 0; }
  .meta { color: #666; margin: 0.4rem 0 1.2rem; }
  .servings { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .serving-button { font: inherit; padding: 0.4rem 0.7rem; border-radius: 0.4rem;
                    border: 1px solid #888; background: transparent; }
  .serving-button.active { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .serving-headline { font-weight: 600; margin: 0.6rem 0; }
  .ingredients, .steps { padding-left: 1.3rem; }
  .ingredients li { margin: 0.35rem 0; }
  .step { font-size: 1.35rem; line-height: 1.45; margin: 0.6rem 0; }
  .step-nav { display: flex; align-items: center; gap: 0.8rem; margin-top: 1rem; }
  .step-nav button { font: inherit; padding: 0.6rem 1rem; border-radius: 0.4rem;
                     border: 1px solid #888; background: transparent; }
  .step-nav button:disabled { opacity: 0.4; }
  footer { margin-top: 2rem; color: #888; font-size: 0.85rem; }
  [hidden] { display: none !important; }
`;

/**
 * Generates the self-contained HTML export of a recipe (decision 7).
 *
 * @param recipe a parsed recipe (validated by the caller)
 * @returns the complete HTML document as a string
 */
export function generateRecipeHtml(recipe: Recipe): string {
  const header =
    `<header>\n` +
    `  <h1>${escapeHtml(recipe.title)}</h1>\n` +
    (recipe.subtitle !== undefined
      ? `  <p class="subtitle">${escapeHtml(recipe.subtitle)}</p>\n`
      : '') +
    (recipe.description !== undefined
      ? `  <p class="description">${escapeHtml(recipe.description)}</p>\n`
      : '') +
    `  <p class="meta">${escapeHtml(recipe.prep_time)}${recipe.total_time !== undefined ? ` · ${escapeHtml(recipe.total_time)}` : ''}</p>\n` +
    `</header>`;

  const ingredientsSection =
    recipe.type === 'finished_dish'
      ? renderDishIngredients(recipe, recipe.servings!)
      : renderIngredientRecipeIngredients(recipe);

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
    `${ingredientsSection}\n` +
    `${renderSteps(recipe)}\n` +
    `  <footer>Erstellt mit Cookbook</footer>\n` +
    `  <script>${NAVIGATION_SCRIPT}\n  </script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
