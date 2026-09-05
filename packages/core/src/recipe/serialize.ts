/**
 * Serializer for the canonical Markdown + YAML recipe format
 * (docs/storage_format.md).
 *
 * Inverse of `parseRecipe()` (./parse.ts): writes a {@link Recipe} object back
 * to the canonical file text — YAML front matter via the `yaml` package with
 * the field order and 2-space indentation of §3 (including the `reference`
 * name list), plus the `## Zubereitung` step blocks of §4/§5.
 *
 * Canonical body shape (§5): every quantity is stored in the family unit
 * (g/ml, '.' decimals); rows read as `- 250 g Reis`, the prose as the final
 * line of each step block, inline artifacts in their canonical `{{…}}` text.
 *
 * Contract: the serializer is a faithful writer, not a validator. Validation
 * runs on read (`parseRecipe`, §7) — the app serializes, writes to Drive, and
 * the next read validates. The only things the serializer refuses are values
 * that *cannot* be represented in the canonical format at all (line breaks,
 * prose starting with "- ", edge whitespace, non-finite numbers); these would
 * silently corrupt the file and are therefore programming errors.
 */

import { stringify } from 'yaml';

import type { Recipe, Unit } from './types.js';

/** Returns the canonical text of a quantity row / artifact base ("250 g"). */
function quantityText(quantity: number, unit: Unit): string {
  return `${quantity} ${unit}`;
}

/** Returns the canonical text of one step row ("250 g Tortillas"). */
function rowToText(name: string, quantity: number, unit: Unit): string {
  return `${quantityText(quantity, unit)} ${name}`;
}

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
    if (recipe.reference !== undefined && recipe.reference.length > 0) {
      frontMatter.reference = recipe.reference;
    }
  } else {
    frontMatter.yield = recipe.yield;
    frontMatter.yield_unit = recipe.yield_unit;
  }
  frontMatter.prep_time = recipe.prep_time;
  if (recipe.total_time !== undefined) frontMatter.total_time = recipe.total_time;
  // The master ingredient list is derived from the step rows (§4) — it is
  // never written to the front matter (only the reference *names* are, and
  // only because the reference role is a property of the master list).
  return frontMatter;
}

/**
 * Serializes a recipe to the canonical Markdown + YAML text (§8).
 *
 * @param recipe the recipe to write (validated by the caller / on read)
 * @returns the canonical file text, ending with a single trailing newline
 * @throws {Error} when a value cannot be represented in the canonical format
 *   faithfully: line breaks or edge whitespace inside steps or names (the
 *   parser trims on read, §5, so these would silently corrupt the file), a
 *   step whose prose starts with "- " (reserved for ingredient rows, §5),
 *   non-finite numbers, or an empty step list / empty step text. Multi-line
 *   free-text fields (subtitle, description, times) are written as YAML block
 *   scalars and round-trip approximately (whitespace folding) — acceptable
 *   for display-only fields.
 */
export function serializeRecipe(recipe: Recipe): string {
  if (recipe.steps.length === 0) {
    throw new Error('serializeRecipe: a recipe must have at least one step');
  }
  for (const step of recipe.steps) {
    if (/[\r\n]/.test(step.text)) {
      throw new Error(
        `serializeRecipe: a step text must be a single line, got: ${JSON.stringify(step.text)}`,
      );
    }
    // The parser trims on read (§5), so edge whitespace would not round-trip —
    // refuse it instead of silently changing the step.
    if (step.text !== step.text.trim()) {
      throw new Error(
        `serializeRecipe: a step text must not start or end with whitespace, got: ${JSON.stringify(step.text)}`,
      );
    }
    if (step.text === '') {
      throw new Error('serializeRecipe: a step must have a text');
    }
    // "- " at the start of the prose would be read back as an ingredient row.
    if (step.text.startsWith('- ')) {
      throw new Error(
        `serializeRecipe: a step text must not start with "- ", got: ${JSON.stringify(step.text)}`,
      );
    }
    for (const ingredient of step.ingredients) {
      if (ingredient.name !== ingredient.name.trim() || ingredient.name === '') {
        throw new Error(
          `serializeRecipe: an ingredient name must be non-empty and trimmed, got: ${JSON.stringify(ingredient.name)}`,
        );
      }
      if (/[\r\n{}]/.test(ingredient.name)) {
        throw new Error(
          `serializeRecipe: an ingredient name must be a single line without braces, got: ${JSON.stringify(ingredient.name)}`,
        );
      }
      if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
        throw new Error(
          `serializeRecipe: ingredient quantity must be a positive finite number, got ${ingredient.quantity}`,
        );
      }
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
  const stepLines = recipe.steps.map((step, index) => {
    const number = index + 1;
    const rows = step.ingredients.map((ingredient) =>
      `   - ${rowToText(ingredient.name, ingredient.quantity, ingredient.unit)}`,
    );
    if (rows.length === 0) {
      return `${number}. ${step.text}`;
    }
    // The first row shares the number line; rows and prose are indented so the
    // block reads as one Markdown list item.
    const continuation = rows.slice(1).join('\n');
    return `${number}. - ${rowToText(
      step.ingredients[0]!.name,
      step.ingredients[0]!.quantity,
      step.ingredients[0]!.unit,
    )}\n${continuation.length > 0 ? `${continuation}\n` : ''}   ${step.text}`;
  });
  const body = `## Zubereitung\n${stepLines.join('\n')}\n`;
  return `---\n${frontMatter}---\n${body}`;
}
