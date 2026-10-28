/**
 * Re-bakes the HTML exports after an ingredient master-data change.
 *
 * The exports are snapshots: `generateRecipeHtml` bakes the display values
 * (BQ/AQ, unit and ingredient display forms, precision) from the runtime
 * ingredient registry. A recipe save re-bakes its own export, but a change to
 * the master data — AU mappings, conversion factors, precision, Singular/Plural
 * forms — leaves every existing export that uses the ingredient at the old
 * values. This module is the missing second trigger.
 *
 * The affected recipes are those whose *saved* text uses the changed name: a
 * counted step row (which also backs the derived master list) or an inline
 * `{{… Name}}` artifact (see core's `recipeUsesIngredient`). Only exports that
 * already exist are rewritten: a master-data change does not make an unshared
 * recipe shareable, and the normal recipe save creates the first export. Every
 * write keeps the existing Drive file id, so links in Keep, the meal plan and
 * other recipe exports stay valid.
 *
 * This module is framework-free; the caller owns the notice and serializes
 * calls (see `scheduleExportRefresh` in ../components/ingredientMasterUpdate).
 */

import {
  mappingsFor,
  recipeUsesIngredient,
  type IngredientEntry,
  type Recipe,
} from '@cookbook/core';

import { listCookbookFolder } from './cookbookFolder';
import { peekRecipeContent, readRecipe, writeRecipeExport } from './recipeStorage';

/** One export that could not be rewritten, with the German-able reason. */
export interface ExportRefreshFailure {
  readonly title: string;
  readonly reason: string;
}

/** What one refresh pass changed. */
export interface ExportRefreshResult {
  /** Titles whose export was rewritten in place. */
  readonly updated: readonly string[];
  /** Exports that failed; the master-data write itself already succeeded. */
  readonly failed: readonly ExportRefreshFailure[];
}

/**
 * Whether a master-data edit can change what an export displays.
 *
 * The reorder point is deliberately excluded: it drives pantry and shopping
 * copy in the app, not the cooking view. Everything else in the entry is baked
 * into at least one export surface — base unit, ingredient-level precision, the
 * Singular/Plural forms of `<INF>`, and the AU mappings (unit, order, factor).
 * A create (no previous entry) or a removal counts as a change.
 *
 * @param before the entry as stored before the write, or undefined on create
 * @param after the entry as the registry holds it now, or undefined on removal
 */
export function isExportRelevantChange(
  before: IngredientEntry | undefined,
  after: IngredientEntry | undefined,
): boolean {
  if (before === undefined || after === undefined) {
    return before !== after;
  }
  if (
    before.bu !== after.bu ||
    before.precision !== after.precision ||
    before.singular !== after.singular ||
    before.plural !== after.plural
  ) {
    return true;
  }
  if (before.entries.length !== after.entries.length) {
    return true;
  }
  // Mapping order can decide the optimizer's tie-break, so it is part of the
  // comparison rather than an unordered set.
  return before.entries.some((mapping, index) => {
    const next = after.entries[index];
    return next === undefined || mapping.au !== next.au || mapping.factor !== next.factor;
  });
}

/**
 * Rewrites the existing exports of every saved recipe that uses `name`.
 *
 * One folder snapshot serves the whole pass: the target files already exist, so
 * the export file set does not change and the snapshot's sub-recipe link map
 * stays complete. The recipe texts come from recipeStorage's session cache in
 * the common case (the startup listing reads them all).
 *
 * A recipe file that cannot be read or parsed is skipped: it has no export that
 * this pass could safely re-bake, and the listing already reports the problem.
 * A failed export write is collected and the pass continues, so one bad photo
 * download cannot leave the other exports stale.
 *
 * @param token the Drive access token
 * @param name the canonical ingredient name whose entry changed
 * @param before the entry as stored before the write (undefined on create)
 */
export async function refreshExportsForIngredient(
  token: string,
  name: string,
  before: IngredientEntry | undefined,
): Promise<ExportRefreshResult> {
  if (!isExportRelevantChange(before, mappingsFor(name))) {
    return { updated: [], failed: [] };
  }

  const folder = await listCookbookFolder(token);
  const exportNames = new Set(
    folder.exports.files.filter((file) => file.name.endsWith('.html')).map((file) => file.name),
  );
  const recipes: Array<{ fileId: string; recipe: Recipe; content: string }> = [];
  for (const file of folder.recipes.files) {
    if (!file.name.endsWith('.md')) continue;
    // Only recipes that already have an export are in scope; the file name
    // equals the title (storage_format.md §2), so the cheap check comes first.
    const fileTitle = file.name.slice(0, -'.md'.length);
    if (!exportNames.has(`${fileTitle}.html`)) continue;
    let recipe: Recipe;
    let content: string | undefined;
    try {
      recipe = await readRecipe(token, file.id);
      // The raw text the parse came from, for the concurrency check below.
      content = peekRecipeContent(file.id);
    } catch {
      // Unreadable or unparseable: no safe re-bake. The recipe list reports it.
      continue;
    }
    // The parsed title is the authority for the export file name; a broken
    // name/title invariant must not create a second export.
    if (!exportNames.has(`${recipe.title}.html`)) continue;
    if (!recipeUsesIngredient(recipe, name)) continue;
    if (content === undefined) continue;
    recipes.push({ fileId: file.id, recipe, content });
  }

  const updated: string[] = [];
  const failed: ExportRefreshFailure[] = [];
  for (const { fileId, recipe, content } of recipes) {
    // A recipe save may have landed while this pass collected its candidates.
    // Writing the stale parse would overwrite the export the save just made, so
    // that recipe is left alone — its own save owns the export write. The cache
    // holds the raw file text and every recipe write updates it synchronously
    // (./recipeStorage), so comparing it detects the save without a Drive read.
    if (peekRecipeContent(fileId) !== content) continue;
    try {
      await writeRecipeExport(token, recipe, folder);
      updated.push(recipe.title);
    } catch (error) {
      failed.push({
        title: recipe.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { updated, failed };
}
