/**
 * Regenerates the committed sample cooking-view exports in the repository root:
 * `sample-penne.html`, `sample-pitas.html` and `sample-cajun-spice.html`.
 *
 * The samples are the *current* output of `generateRecipeHtml` for three of the
 * recipes in `examples/`, so a design review can open a real cooking view in a
 * browser without building anything. They are generated from the examples
 * (rather than from hand-written fixtures) so there is one source of truth and
 * no second copy of a recipe to keep in sync.
 *
 * Run from the repository root:
 *   node packages/core/scripts/generate-sample-exports.mjs
 *
 * The trio covers the design surfaces a review needs: a dish with the serif
 * theme (`Penne all’arrabbiata`), a dish with a custom palette (`Pitas mit Tofu
 * und Spitzkohl`) and the ingredient recipe that dish uses (`Cajun Spice`) — the
 * last also demonstrates the „Rezept" badge on a sub-recipe link.
 *
 * The only deliberate difference from the stored recipes is that sub-recipe
 * link map: an ingredient use whose name is another sampled recipe's title
 * becomes a link (`<title>.html`), mirroring what the web app does with the
 * export files in a Drive folder (recipe_storage.ts).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRecipeHtml } from '../dist/recipe/exportHtml.js';
import { parseRecipe } from '../dist/recipe/parse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');

/** The samples to write: source recipe file → output file. */
const SAMPLES = [
  { source: 'Penne all’arrabbiata.md', output: 'sample-penne.html' },
  { source: 'Pitas mit Tofu und Spitzkohl.md', output: 'sample-pitas.html' },
  { source: 'Cajun Spice.md', output: 'sample-cajun-spice.html' },
];

/** The example recipes the samples are made from, parsed once. */
const parsed = SAMPLES.map((sample) => ({
  ...sample,
  recipe: parseRecipe(readFileSync(join(EXAMPLES_DIR, sample.source), 'utf8')),
}));

/** The committed sample file of every sampled recipe, keyed by its title. */
const sampleFile = new Map(parsed.map(({ recipe, output }) => [recipe.title, output]));

/**
 * The sub-recipe link map of one export, mirroring what the web app builds from
 * the export files in a Drive folder (recipe_storage.ts): an ingredient use
 * whose name is another sampled recipe's title points at that recipe's sample
 * file.
 */
function linksFor(recipe) {
  const links = Object.create(null);
  for (const ingredient of recipe.ingredients) {
    const target = sampleFile.get(ingredient.name);
    if (target !== undefined) links[ingredient.name] = `./${target}`;
  }
  return links;
}

for (const { source, output, recipe } of parsed) {
  const html = generateRecipeHtml(recipe, linksFor(recipe));
  writeFileSync(join(REPO_ROOT, output), html, 'utf8');
  console.log(`${output}  ←  examples/${source}  (${html.length} bytes)`);
}
