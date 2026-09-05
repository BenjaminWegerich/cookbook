/**
 * HTML export generator — the cooking view (docs/user_stories.md, decision 7).
 *
 * Produces a self-contained HTML file for a recipe with *pre-computed* display
 * values: for every allowed serving option (integer ladder values 1–30, i.e. 18
 * options) the complete cooking view is baked into the file — the scaled
 * master ingredient list, the scaled per-step ingredient lists, and the step
 * prose with its scaled inline artifacts. No master data and no scaling/display
 * logic run at runtime; the embedded script only toggles visibility for the
 * serving picker and the step-by-step navigation (decision 7 extension, ROADMAP
 * Phase 1).
 *
 * The app stores the export as `<title>.html` next to the recipe file and
 * regenerates it in place on every save, so shared links never break
 * (docs/ARCHITECTURE.md, HTML share export).
 *
 * Ingredient recipes have no serving count; their export shows the ingredients
 * and steps at the stored quantities (no picker). Step navigation works for
 * both types.
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

import { formatBQ, renderAQS } from '../additionalUnits.js';
import { escapeHtml, renderArtifacts } from './artifacts.js';
import type { TextArtifact } from './artifacts.js';
import { difference, integerLadderValues, scale } from '../ladder.js';
import type { Ingredient, Recipe, Step, Unit } from './types.js';

/** Allowed serving options of the export: integer ladder values 1–30 (§D2). */
const SERVING_MIN = 1;
const SERVING_MAX = 30;

/**
 * Renders a quantity/ingredient display line (already HTML-escaped). A link is
 * added when the name is present in `links` (implicit sub-recipe, §4). A
 * quantity-only artifact may be unitless (`{{100}}`) and then renders as the
 * plain number.
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
        ? String(bq)
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
    const bq = scale(artifact.quantity, deltaX);
    // displayLine returns already-escaped HTML and wraps the line in a link
    // when the artifact names an ingredient recipe (links map, §4).
    return `<code class="step-artifact">${displayLine(artifact.name, bq, artifact.unit, links)}</code>`;
  });
  return `    <li class="step">\n${rows}      <p class="step-text">${text}</p>\n    </li>`;
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
  const references = recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) => ingredientLine(ingredient, scale(ingredient.quantity, deltaX), links));
  const headline =
    references.length > 0
      ? `${servings} Personen (${references.join(', ')})`
      : `${servings} Personen`;
  const lines = recipe.ingredients.map((ingredient) =>
    ingredientLine(ingredient, scale(ingredient.quantity, deltaX), links),
  );
  const steps = recipe.steps.map((step) => renderStep(step, deltaX, links)).join('\n');
  return (
    `<div class="serving-view" data-servings="${servings}">\n` +
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

/** The unscaled cooking view of an ingredient recipe (no serving picker). */
function renderIngredientRecipeView(
  recipe: Recipe,
  links: Readonly<Record<string, string>>,
): string {
  const yieldLine = `${recipe.yield} ${recipe.yield_unit}`;
  const lines = recipe.ingredients.map((ingredient) =>
    ingredientLine(ingredient, ingredient.quantity, links),
  );
  const steps = recipe.steps.map((step) => renderStep(step, 0, links)).join('\n');
  return (
    `<div class="serving-view">\n` +
    `  <section aria-label="Zutaten">\n` +
    `    <p class="serving-headline">${escapeHtml(yieldLine)}</p>\n` +
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

/** The embedded navigation script: only DOM toggling, no scaling logic. */
const NAVIGATION_SCRIPT = `
(function () {
  'use strict';
  // Serving picker: every option is pre-rendered; only visibility changes.
  var options = document.querySelectorAll('.serving-view');
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

  // Step-by-step navigation: one step visible at a time per serving view.
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
  .step-nav button:disabled { opacity: 0.4; }
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
    (recipe.subtitle !== undefined
      ? `  <p class="subtitle">${escapeHtml(recipe.subtitle)}</p>\n`
      : '') +
    (recipe.description !== undefined
      ? `  <p class="description">${escapeHtml(recipe.description)}</p>\n`
      : '') +
    `  <p class="meta">${escapeHtml(recipe.prep_time)}${recipe.total_time !== undefined ? ` · ${escapeHtml(recipe.total_time)}` : ''}</p>\n` +
    `</header>`;

  const body =
    recipe.type === 'finished_dish'
      ? renderServingButtons(recipe) +
        '\n' +
        integerLadderValues(SERVING_MIN, SERVING_MAX)
          .map((servings) => servingView(recipe, servings, links))
          .join('\n')
      : renderIngredientRecipeView(recipe, links);

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
