/**
 * Serializer for the canonical Markdown + YAML recipe format
 * (docs/storage_format.md).
 *
 * Inverse of `parseRecipe()` (./parse.ts): writes a {@link Recipe} object back
 * to the canonical file text — YAML front matter via the `yaml` package with
 * the field order and 2-space indentation of §3, plus the `## Zubereitung`
 * ordered step list of §5.
 *
 * Contract: the serializer is a faithful writer, not a validator. Validation
 * runs on read (`parseRecipe`, §7) — the app serializes, writes to Drive, and
 * the next read validates. The only things the serializer refuses are values
 * that *cannot* be represented in the canonical format at all (line breaks
 * inside steps/titles, non-finite numbers); these would silently corrupt the
 * file and are therefore programming errors.
 */

import { stringify } from 'yaml';

import type { Recipe } from './types.js';

/** Returns the front-matter mapping in the canonical field order of §3. */
function buildFrontMatter(recipe: Recipe): Record<string, unknown> {
  const frontMatter: Record<string, unknown> = {
    title: recipe.title,
    type: recipe.type,
  };
  if (recipe.subtitle !== undefined) frontMatter.subtitle = recipe.subtitle;
  if (recipe.description !== undefined) frontMatter.description = recipe.description;
  if (recipe.type === 'finished_dish') {
    frontMatter.servings = recipe.servings;
  } else {
    frontMatter.yield = recipe.yield;
    frontMatter.yield_unit = recipe.yield_unit;
  }
  frontMatter.prep_time = recipe.prep_time;
  if (recipe.total_time !== undefined) frontMatter.total_time = recipe.total_time;
  // The ingredient list is derived from the body markers (§4) — it is never
  // written to the front matter.
  return frontMatter;
}

/**
 * Serializes a recipe to the canonical Markdown + YAML text (§8).
 *
 * @param recipe the recipe to write (validated by the caller / on read)
 * @returns the canonical file text, ending with a single trailing newline
 * @throws {Error} when a value cannot be represented in the canonical format
 *   faithfully: line breaks or edge whitespace inside steps (the parser trims
 *   steps on read, §5, so these would silently corrupt the file), line breaks
 *   inside titles or ingredient names, non-finite numbers, or an empty step
 *   list. Multi-line free-text fields (subtitle, description, times)
 *   are written as YAML block scalars and round-trip approximately (whitespace
 *   folding) — acceptable for display-only fields.
 */
export function serializeRecipe(recipe: Recipe): string {
  if (recipe.steps.length === 0) {
    throw new Error('serializeRecipe: a recipe must have at least one step');
  }
  for (const step of recipe.steps) {
    if (/[\r\n]/.test(step)) {
      throw new Error(
        `serializeRecipe: a step must be a single line, got: ${JSON.stringify(step)}`,
      );
    }
    // The parser trims steps on read (§5), so edge whitespace would not
    // round-trip — refuse it instead of silently changing the step.
    if (step !== step.trim()) {
      throw new Error(
        `serializeRecipe: a step must not start or end with whitespace, got: ${JSON.stringify(step)}`,
      );
    }
  }
  if (/[\r\n]/.test(recipe.title)) {
    throw new Error(
      `serializeRecipe: the title must be a single line, got: ${JSON.stringify(recipe.title)}`,
    );
  }
  if (recipe.servings !== undefined && !Number.isFinite(recipe.servings)) {
    throw new Error(`serializeRecipe: servings must be finite, got ${recipe.servings}`);
  }
  if (recipe.yield !== undefined && !Number.isFinite(recipe.yield)) {
    throw new Error(`serializeRecipe: yield must be finite, got ${recipe.yield}`);
  }

  const frontMatter = stringify(buildFrontMatter(recipe), { indent: 2 });
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  const body = `## Zubereitung\n${steps}\n`;
  return `---\n${frontMatter}---\n${body}`;
}
