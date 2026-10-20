/**
 * Regenerates the committed sample cooking-view exports in the repository root:
 * `sample-bechamel.html` and `sample-wraps.html`.
 *
 * The samples are the *current* output of `generateRecipeHtml` for two of the
 * recipes in `examples/`, so a design review can open a real cooking view in a
 * browser without building anything. They are generated from the examples
 * (rather than from hand-written fixtures) so there is one source of truth and
 * no second copy of a recipe to keep in sync.
 *
 * Run from the repository root:
 *   node packages/core/scripts/generate-sample-exports.mjs
 *
 * Two deliberate differences from the examples as stored:
 * - every ingredient name that is also the title of another example recipe
 *   becomes a sub-recipe link (`<title>.html`), mirroring what the web app does
 *   with the export files in a Drive folder (recipe_storage.ts), so the samples
 *   show the „Rezept" badge;
 * - the wraps sample carries the `Noto Serif` theme, so the pair shows both the
 *   default theme and a themed cooking view (DESIGN §4.8).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRecipeHtml } from '../dist/recipe/exportHtml.js';
import { parseRecipe } from '../dist/recipe/parse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');

/** The samples to write: source recipe file → output file, with its theme. */
const SAMPLES = [
  { source: 'Béchamelsauce.md', output: 'sample-bechamel.html' },
  {
    source: 'Shredded Tofu Wraps.md',
    output: 'sample-wraps.html',
    theme: { font: 'Noto Serif' },
  },
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
 * whose name is another recipe's title points at that recipe's sample file.
 */
function linksFor(recipe) {
  const links = Object.create(null);
  for (const ingredient of recipe.ingredients) {
    const target = sampleFile.get(ingredient.name);
    if (target !== undefined) links[ingredient.name] = `./${target}`;
  }
  return links;
}

for (const { source, output, theme, recipe: stored } of parsed) {
  // A theme is presentation only and never part of the stored recipe data.
  const recipe = theme === undefined ? stored : { ...stored, theme };
  const html = generateRecipeHtml(recipe, linksFor(recipe));
  writeFileSync(join(REPO_ROOT, output), html, 'utf8');
  console.log(`${output}  ←  examples/${source}  (${html.length} bytes)`);
}
