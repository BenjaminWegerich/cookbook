/**
 * Personal, format-agnostic AI rules (`zutaten-regeln.md`).
 *
 * The user's free-form German rules — e.g. "immer Vanilleextrakt, nie
 * Vanillezucker" — live in one Markdown file in the Cookbook folder, loaded at
 * startup together with the master data and embedded verbatim into every
 * AI-assisted prompt (see aiContext.ts). Missing file is not an error (no
 * personal rules); editing UI arrives in a later slice.
 */

import { createFileWithContent, getFileContent, listFilesInFolder, updateFileWithContent } from './driveClient';
import { ensureRecipeFolder } from './recipeStorage';

/** File name of the personal AI rules in the Cookbook folder (user-visible). */
export const PERSONAL_RULES_FILE_NAME = 'zutaten-regeln.md';
/** MIME type of the rules file. */
const RULES_MIME_TYPE = 'text/markdown';

/**
 * Loads the user's personal AI rules from Drive. Returns the raw text ('' when
 * the file does not exist yet).
 */
export async function loadPersonalRules(token: string): Promise<string> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const file = files.find((entry) => entry.name === PERSONAL_RULES_FILE_NAME);
  if (file === undefined) return '';
  return getFileContent(token, file.id);
}

/**
 * Writes the user's personal AI rules to Drive, creating the file on first
 * use. Used by the future editing UI; the file is created empty by this module
 * only when the user actually saves rules.
 */
export async function savePersonalRules(token: string, text: string): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const file = files.find((entry) => entry.name === PERSONAL_RULES_FILE_NAME);
  if (file === undefined) {
    await createFileWithContent(token, {
      name: PERSONAL_RULES_FILE_NAME,
      mimeType: RULES_MIME_TYPE,
      parents: [folderId],
      content: text,
    });
  } else {
    await updateFileWithContent(token, file.id, {
      name: PERSONAL_RULES_FILE_NAME,
      mimeType: RULES_MIME_TYPE,
      content: text,
    });
  }
}
