/**
 * Validates the example recipes in the repository's `examples/` folder
 * (docs/storage_format.md §7). They double as manual test data (droppable
 * into the Google Drive "Cookbook" folder) and as acceptance fixtures:
 * - every file must parse on its own (schema validation §7.1) and — §2 —
 *   the file name must equal the recipe title plus ".md";
 * - the whole set must pass the cross-recipe checks (§7.2, including the
 *   acyclic link graph), because the examples include a `recipe:` link.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { validateCollection } from './validate.js';
import type { Recipe } from './types.js';

/** Repository root `examples/` folder, resolved from this file's location. */
const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples');

describe('example recipes (examples/)', () => {
  const files = readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();

  it('contains at least one recipe', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('parses each file and the file name equals the title + ".md" (§2, §7.1)', () => {
    for (const name of files) {
      // parseRecipe throws RecipeParseError with precise issues on invalid files.
      const recipe = parseRecipe(readFileSync(join(EXAMPLES_DIR, name), 'utf8'));
      expect(recipe.title).toBe(name.slice(0, -'.md'.length));
    }
  });

  it('passes the cross-recipe checks as one collection (§7.2)', () => {
    const recipes: Recipe[] = [];
    for (const name of files) {
      recipes.push(parseRecipe(readFileSync(join(EXAMPLES_DIR, name), 'utf8')));
    }
    expect(() => validateCollection(recipes)).not.toThrow();
  });
});
