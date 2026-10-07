/**
 * Personal recipe guidelines (`rezept-richtlinien.md`).
 *
 * The user's free-form German guidelines — ingredients, techniques, wording
 * conventions (e.g. "immer Vanilleextrakt, nie Vanillezucker") — live in one
 * Markdown file in the Cookbook folder, loaded at startup together with the
 * master data and embedded verbatim into every AI-assisted prompt (see
 * aiContext.buildGuidelinesText). Missing file is not an error (no personal
 * guidelines); the file is edited outside the app in Drive.
 */

import { getFileContent, listFilesInFolder } from './driveClient';
import { ensureRecipeFolder } from './recipeStorage';

/** File name of the personal recipe guidelines in the Cookbook folder. */
export const RECIPE_GUIDELINES_FILE_NAME = 'rezept-richtlinien.md';

/**
 * Loads the user's personal recipe guidelines from Drive. Returns the raw text
 * ('' when the file does not exist yet).
 */
export async function loadRecipeGuidelines(token: string): Promise<string> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const file = files.find((entry) => entry.name === RECIPE_GUIDELINES_FILE_NAME);
  if (file === undefined) return '';
  return getFileContent(token, file.id);
}
