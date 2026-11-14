/**
 * Serializer for the canonical Markdown + YAML recipe format
 * (docs/storage_format.md).
 *
 * Inverse of `parseRecipe()` (./parse.ts): writes a {@link Recipe} object back
 * to the canonical file text — YAML front matter via the `yaml` package with
 * the field order and 2-space indentation of §3 (including the `source` link,
 * the `tips` block and the `reference` name list), plus the `## Zubereitung`
 * step blocks of §4/§5.
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

import { formatStoredNumber } from '../quantityValues.js';
import { isPrecisionLevel, type PrecisionLevel } from '../precision.js';
import type { Recipe, RecipeTheme, Unit } from './types.js';

/**
 * Validates a tips value for the canonical round-trip: edge whitespace, CRLF
 * and trailing spaces on a line would be normalized away by the parser (§5), so
 * the serializer refuses them instead of silently changing the text. Empty
 * tips are never written (they mean "no tips").
 */
function assertTips(tips: string, where: string): void {
  if (tips.trim() === '' || tips !== tips.trim() || /\r/.test(tips)) {
    throw new Error(
      `serializeRecipe: ${where} must be a non-empty, edge-trimmed text without CR, got: ${JSON.stringify(tips)}`,
    );
  }
  if (tips.split('\n').some((line) => line !== line.trimEnd())) {
    throw new Error(
      `serializeRecipe: ${where} must not have trailing spaces on a line, got: ${JSON.stringify(tips)}`,
    );
  }
}

/** The canonical blockquote block of one step's tips (§5). */
function tipsBlock(tips: string): string {
  const lines = tips.split('\n').map((line) => (line === '' ? '   >' : `   > ${line}`));
  return `\n${lines.join('\n')}`;
}

/** Returns the canonical text of a quantity row / artifact base ("250 g"). */
function quantityText(quantity: number, unit: Unit): string {
  return `${formatStoredNumber(quantity)} ${unit}`;
}

/** Returns the canonical text of one step row ("250 g Tortillas"). */
function rowToText(name: string, quantity: number, unit: Unit, precision?: PrecisionLevel): string {
  const tag = precision === undefined ? '' : ` {precision: ${precision}}`;
  return `${quantityText(quantity, unit)} ${name}${tag}`;
}

/**
 * Returns the `theme` front-matter mapping (DESIGN §4.8, storage_format.md §3):
 * only the tokens that are set, in the canonical order font, accent, paper,
 * ink, line. Undefined when no token is set — an empty theme is equivalent to
 * no theme and is not written.
 */
function buildTheme(theme: RecipeTheme): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const key of ['font', 'accent', 'paper', 'ink', 'line'] as const) {
    const value = theme[key];
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Returns the front-matter mapping in the canonical field order of §3. */
function buildFrontMatter(recipe: Recipe): Record<string, unknown> {
  const frontMatter: Record<string, unknown> = {
    title: recipe.title,
    type: recipe.type,
  };
  if (recipe.description !== undefined) frontMatter.description = recipe.description;
  // The source link (original recipe / inspiration) sits with the descriptive
  // fields, directly after the description (§3).
  if (recipe.source !== undefined) frontMatter.source = recipe.source;
  if (recipe.type === 'finished_dish') {
    frontMatter.servings = recipe.servings;
  } else {
    frontMatter.yield = recipe.yield;
    frontMatter.yield_unit = recipe.yield_unit;
  }
  // The reference names anchor the recipe's size (portion for a finished dish,
  // yield for an ingredient recipe, §4) and are written for both types.
  if (recipe.reference !== undefined && recipe.reference.length > 0) {
    frontMatter.reference = recipe.reference;
  }
  frontMatter.prep_time = recipe.prep_time;
  if (recipe.total_time !== undefined) frontMatter.total_time = recipe.total_time;
  // Recipe-level tips sit after the times and before the theme, the last
  // content field of the front matter (§3).
  if (recipe.tips !== undefined) frontMatter.tips = recipe.tips;
  // The theme is the recipe's visual skin for the export (DESIGN §4.8); written
  // last, after total_time; only the tokens that are set are written.
  const theme = recipe.theme === undefined ? undefined : buildTheme(recipe.theme);
  if (theme !== undefined) {
    frontMatter.theme = theme;
  }
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
 *   free-text fields (description, times) are written as YAML block
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
    if (step.tips !== undefined) assertTips(step.tips, `step ${JSON.stringify(step.text)} tips`);
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
      if (ingredient.precision !== undefined && !isPrecisionLevel(ingredient.precision)) {
        throw new Error(
          `serializeRecipe: ingredient precision must be a precision level, got ${ingredient.precision}`,
        );
      }
    }
  }
  if (/[\r\n]/.test(recipe.title)) {
    throw new Error(
      `serializeRecipe: the title must be a single line, got: ${JSON.stringify(recipe.title)}`,
    );
  }
  // The parser trims the source and rejects whitespace inside it, so a value
  // that does not already round-trip is a programming error (§3).
  if (
    recipe.source !== undefined &&
    (recipe.source !== recipe.source.trim() || /\s/.test(recipe.source))
  ) {
    throw new Error(
      `serializeRecipe: the source must be a trimmed URL without whitespace, got: ${JSON.stringify(recipe.source)}`,
    );
  }
  if (recipe.tips !== undefined) assertTips(recipe.tips, 'recipe tips');
  if (recipe.servings !== undefined && !Number.isFinite(recipe.servings)) {
    throw new Error(`serializeRecipe: servings must be finite, got ${recipe.servings}`);
  }
  if (recipe.yield !== undefined && !Number.isFinite(recipe.yield)) {
    throw new Error(`serializeRecipe: yield must be finite, got ${recipe.yield}`);
  }

  const frontMatter = stringify(buildFrontMatter(recipe), { indent: 2 });
  const stepLines = recipe.steps.map((step, index) => {
    const number = index + 1;
    const rows = step.ingredients.map(
      (ingredient) =>
        `   - ${rowToText(
          ingredient.name,
          ingredient.quantity,
          ingredient.unit,
          ingredient.precision,
        )}`,
    );
    const tips = step.tips === undefined ? '' : tipsBlock(step.tips);
    if (rows.length === 0) {
      return `${number}. ${step.text}${tips}`;
    }
    // The first row shares the number line; rows and prose are indented so the
    // block reads as one Markdown list item.
    const continuation = rows.slice(1).join('\n');
    return `${number}. - ${rowToText(
      step.ingredients[0]!.name,
      step.ingredients[0]!.quantity,
      step.ingredients[0]!.unit,
      step.ingredients[0]!.precision,
    )}\n${continuation.length > 0 ? `${continuation}\n` : ''}   ${step.text}${tips}`;
  });
  const body = `## Zubereitung\n${stepLines.join('\n')}\n`;
  return `---\n${frontMatter}---\n${body}`;
}
