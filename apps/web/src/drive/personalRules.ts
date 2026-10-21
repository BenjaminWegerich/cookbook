/**
 * Personal recipe guidelines (`rezept-richtlinien.md`).
 *
 * The user's free-form German guidelines — ingredients, techniques, wording
 * conventions (e.g. "immer Vanilleextrakt, nie Vanillezucker") — live in one
 * Markdown file in the `Stammdaten` subfolder of the Cookbook folder, loaded at
 * startup together with the master data and embedded verbatim into every
 * AI-assisted prompt (see aiContext.buildGuidelinesText). Missing file is not an
 * error (no personal guidelines); the file is edited outside the app in Drive.
 */

import { listCookbookFolder } from './cookbookFolder';
import { getFileContent } from './driveClient';

/** File name of the personal recipe guidelines in the Stammdaten folder. */
export const RECIPE_GUIDELINES_FILE_NAME = 'rezept-richtlinien.md';

/**
 * Loads the user's personal recipe guidelines from Drive. Returns the raw text
 * ('' when the file does not exist yet).
 */
export async function loadRecipeGuidelines(token: string): Promise<string> {
  // Shared snapshot: the guidelines sit beside the master-data CSVs, so the
  // startup load usually reuses the listing the master data already fetched.
  const folder = await listCookbookFolder(token);
  const file = folder.data.files.find((entry) => entry.name === RECIPE_GUIDELINES_FILE_NAME);
  if (file === undefined) return '';
  return getFileContent(token, file.id);
}
