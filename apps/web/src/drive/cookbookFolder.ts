/**
 * The Cookbook folder in Google Drive — the one container every master data
 * file and every recipe lives in.
 *
 * It is created on first use, and its id is remembered in localStorage so the
 * app keeps resolving to the same folder: a name search is ambiguous as soon
 * as a second folder called "Cookbook" exists (for example one shared from
 * another account), and the cached id also survives a rename.
 *
 * The helper lives here rather than in ./recipeStorage (where it started)
 * because the ingredient master data and the shopping route use it as well —
 * keeping it in the recipe layer would make those modules depend on recipe
 * storage, and recipe storage in turn depend on them (the rename flow rewrites
 * the ingredient master data, see ./ingredientMasterData).
 */

import { createFolder, findFoldersByName, getFile } from './driveClient';

/** Name of the folder that holds the collection (user-visible in Drive). */
const COOKBOOK_FOLDER_NAME = 'Cookbook';

/** localStorage key that remembers the Cookbook folder id (unchanged since v1). */
const FOLDER_ID_KEY = 'cookbook.recipeFolderId';

/**
 * Returns the id of the Cookbook folder, creating it on first use.
 * The id is remembered in localStorage; a stale id (deleted folder) is
 * detected and the folder recreated.
 */
export async function ensureRecipeFolder(token: string): Promise<string> {
  const stored = localStorage.getItem(FOLDER_ID_KEY);
  if (stored !== null) {
    try {
      await getFile(token, stored);
      return stored;
    } catch {
      // Folder was deleted or access was lost — fall through to recreation.
    }
  }
  const existing = await findFoldersByName(token, COOKBOOK_FOLDER_NAME);
  const folder = existing[0] ?? (await createFolder(token, COOKBOOK_FOLDER_NAME));
  localStorage.setItem(FOLDER_ID_KEY, folder.id);
  return folder.id;
}
