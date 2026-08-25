/**
 * Recipe storage layer over Google Drive.
 *
 * Implements the storage-format conventions (docs/storage_format.md):
 * - the collection is one folder containing one `.md` file per recipe, the file
 *   name equals the recipe title (§2);
 * - an optional real photo lives as a sibling with the same basename and a
 *   `.jpg` / `.png` extension (§2);
 * - the rename flow (§6) is one operation: new title in the file, new file
 *   name, renamed image, and updated `recipe:` references in all other recipes
 *   (pure transformation in @cookbook/core, ./rename).
 *
 * The folder is created on first use and its id is remembered in localStorage
 * (the "drive.file" scope only exposes files the app created itself, so a
 * name search alone cannot find folders from other apps).
 *
 * All writes go through a round-trip check (`serializeRecipe` + `parseRecipe`)
 * so a recipe that cannot be represented canonically never reaches Drive —
 * it is caught here instead of on the next read.
 */

import {
  generateRecipeHtml,
  parseRecipe,
  renameRecipeInCollection,
  serializeRecipe,
  type Recipe,
} from '@cookbook/core';
import {
  createFileWithContent,
  createFolder,
  findFoldersByName,
  getFile,
  getFileContent,
  listFilesInFolder,
  renameFile,
  updateFileWithContent,
  type DriveFile,
} from './driveClient';

/** Name of the folder that holds the collection (user-visible in Drive). */
const RECIPE_FOLDER_NAME = 'Cookbook';
/** MIME type of the recipe files. */
const RECIPE_MIME_TYPE = 'text/markdown';
/** File extension of a recipe file (§2: file name = title + ".md"). */
const RECIPE_EXTENSION = '.md';
/** MIME type of the generated HTML export files. */
const EXPORT_MIME_TYPE = 'text/html';
/** File extension of the HTML export (decision 7: <title>.html). */
const EXPORT_EXTENSION = '.html';
/** Allowed photo extensions (§2). */
const IMAGE_EXTENSIONS = ['jpg', 'png'] as const;
/** localStorage key that remembers the recipe folder id. */
const FOLDER_ID_KEY = 'cookbook.recipeFolderId';

/** The photo sibling of a recipe (§2), identified by its file. */
export interface RecipeImage {
  fileId: string;
  /** Extension without the dot, e.g. "jpg". */
  extension: 'jpg' | 'png';
}

/** A recipe in the collection: its Drive file plus optional photo. */
export interface StoredRecipe {
  fileId: string;
  /** Recipe title — equals the file name without the `.md` extension (§2). */
  title: string;
  /** The recipe's photo sibling, when one exists. */
  image?: RecipeImage;
}

/**
 * Returns the id of the recipe folder, creating it on first use.
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
  const existing = await findFoldersByName(token, RECIPE_FOLDER_NAME);
  const folder = existing[0] ?? (await createFolder(token, RECIPE_FOLDER_NAME));
  localStorage.setItem(FOLDER_ID_KEY, folder.id);
  return folder.id;
}

/**
 * Lists all recipes of the collection, sorted by title, with their optional
 * photo siblings detected (§2). Requires the Google Drive connection.
 */
export async function listRecipes(token: string): Promise<StoredRecipe[]> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);

  // Index photos by basename (first match wins; ".jpg" is preferred).
  const imagesByBase = new Map<string, RecipeImage>();
  for (const file of files) {
    for (const extension of IMAGE_EXTENSIONS) {
      const suffix = `.${extension}`;
      if (file.name.toLowerCase().endsWith(suffix)) {
        const base = file.name.slice(0, -suffix.length);
        if (!imagesByBase.has(base)) {
          imagesByBase.set(base, { fileId: file.id, extension });
        }
        break;
      }
    }
  }

  const recipes: StoredRecipe[] = [];
  for (const file of files) {
    if (!file.name.endsWith(RECIPE_EXTENSION)) continue;
    const title = file.name.slice(0, -RECIPE_EXTENSION.length);
    if (title === '') continue;
    recipes.push({
      fileId: file.id,
      title,
      ...(imagesByBase.has(title) ? { image: imagesByBase.get(title) } : {}),
    });
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return recipes;
}

/** Reads and parses one recipe file; parse errors carry precise issues (§7). */
export async function readRecipe(token: string, fileId: string): Promise<Recipe> {
  const content = await getFileContent(token, fileId);
  return parseRecipe(content);
}

/**
 * Serializes a recipe and verifies it round-trips through the parser, so an
 * unrepresentable recipe is rejected before it is written to Drive.
 */
function canonicalText(recipe: Recipe): string {
  const text = serializeRecipe(recipe);
  parseRecipe(text);
  return text;
}

/** Options for the recipe write operations. */
export interface RecipeWriteOptions {
  /**
   * Whether to regenerate the HTML export after the write (default true). The
   * rename flow passes false — it renames the existing export in place itself.
   */
  regenerateExport?: boolean;
}

/**
 * Regenerates the export after a recipe write, degrading instead of failing:
 * the recipe file is the source of truth and the export is rewritten in place
 * on the next save, so a failed export must never surface as a failed save
 * (which would tempt the caller into a duplicate-creating retry).
 */
async function writeRecipeExportSafely(token: string, recipe: Recipe): Promise<void> {
  try {
    await writeRecipeExport(token, recipe);
  } catch (error) {
    console.error(
      `HTML-Export für "${recipe.title}" konnte nicht geschrieben werden (wird beim nächsten Speichern erneut versucht): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Creates a new recipe file inside the recipe folder. */
export async function createRecipe(
  token: string,
  recipe: Recipe,
  options?: RecipeWriteOptions,
): Promise<DriveFile> {
  const folderId = await ensureRecipeFolder(token);
  const file = await createFileWithContent(token, {
    name: `${recipe.title}${RECIPE_EXTENSION}`,
    mimeType: RECIPE_MIME_TYPE,
    content: canonicalText(recipe),
    parents: [folderId],
  });
  if (options?.regenerateExport !== false) {
    await writeRecipeExportSafely(token, recipe);
  }
  return file;
}

/**
 * Overwrites a recipe file (content and file name, in case the title changed)
 * and regenerates its HTML export in place (decision 7: on every save).
 */
export async function updateRecipe(
  token: string,
  fileId: string,
  recipe: Recipe,
  options?: RecipeWriteOptions,
): Promise<DriveFile> {
  const file = await updateFileWithContent(token, fileId, {
    name: `${recipe.title}${RECIPE_EXTENSION}`,
    mimeType: RECIPE_MIME_TYPE,
    content: canonicalText(recipe),
  });
  if (options?.regenerateExport !== false) {
    await writeRecipeExportSafely(token, recipe);
  }
  return file;
}

/**
 * Regenerates the HTML export of a recipe (decision 7) in the recipe folder,
 * updating the existing `<title>.html` in place (same Drive file id, so shared
 * links keep working) or creating it on first save. Called automatically by
 * createRecipe/updateRecipe and internally by the rename flow — the recipe
 * file itself stays the single source of truth.
 */
export async function writeRecipeExport(token: string, recipe: Recipe): Promise<DriveFile> {
  const folderId = await ensureRecipeFolder(token);
  const fileName = `${recipe.title}${EXPORT_EXTENSION}`;
  const files = await listFilesInFolder(token, folderId);
  const existing = files.find((file) => file.name === fileName);
  const content = generateRecipeHtml(recipe);
  if (existing !== undefined) {
    return updateFileWithContent(token, existing.id, {
      name: fileName,
      mimeType: EXPORT_MIME_TYPE,
      content,
    });
  }
  return createFileWithContent(token, {
    name: fileName,
    mimeType: EXPORT_MIME_TYPE,
    content,
    parents: [folderId],
  });
}

/**
 * Renames a recipe as one operation (§6): new title inside the file, new file
 * name, renamed photo sibling, and every `recipe:` reference to the old title
 * in all other recipe files updated. The collection is left consistent — no
 * dangling references. The HTML export is renamed and regenerated in place
 * (same Drive file id), so existing shared links keep working.
 *
 * Drive has no transactions, so the writes are best-effort rolled back when a
 * step fails mid-flow (the originals are held in memory): the collection is
 * restored to its pre-rename state, or the error message says so if even the
 * rollback failed.
 */
export async function renameRecipe(token: string, fileId: string, newTitle: string): Promise<void> {
  const target = await readRecipe(token, fileId);
  if (target.title === newTitle) {
    return;
  }

  // Read the whole collection once (title → file + optional image), keeping
  // the original content of every file for the rollback.
  const stored = await listRecipes(token);
  const storedByTitle = new Map(stored.map((entry) => [entry.title, entry]));
  const originalByFileId = new Map<string, Recipe>();
  const allRecipes: Recipe[] = [];
  for (const entry of stored) {
    const recipe = await readRecipe(token, entry.fileId);
    originalByFileId.set(entry.fileId, recipe);
    allRecipes.push(recipe);
  }

  const { renamed, updated } = renameRecipeInCollection(allRecipes, target.title, newTitle);
  const targetImage = storedByTitle.get(target.title)?.image;

  // The new title must be free: two files named `<title>.md` (and two exports)
  // would silently overwrite each other otherwise.
  if (stored.some((entry) => entry.title === newTitle)) {
    throw new Error(
      `Umbenennen nicht möglich: Es gibt bereits ein Rezept mit dem Titel "${newTitle}".`,
    );
  }

  // Undo actions, newest first, for the rollback (each closes over the originals).
  const undoSteps: Array<() => Promise<unknown>> = [];
  try {
    // 1. New title in the file + new file name (same Drive file id). The
    //    export is regenerated separately in step 3 (regenerateExport: false,
    //    so the hook does not create a second export file).
    await updateRecipe(token, fileId, renamed, { regenerateExport: false });
    undoSteps.push(() =>
      updateRecipe(token, fileId, originalByFileId.get(fileId)!, { regenerateExport: false }),
    );

    // 2. Rename the photo sibling so it stays attached (§2).
    if (targetImage !== undefined) {
      await renameFile(token, targetImage.fileId, `${newTitle}.${targetImage.extension}`);
      undoSteps.push(() =>
        renameFile(token, targetImage.fileId, `${target.title}.${targetImage.extension}`),
      );
    }

    // 3. The HTML export is renamed and regenerated in place (same Drive file
    //    id), so shared links survive the rename.
    const oldExportName = `${target.title}${EXPORT_EXTENSION}`;
    const folderId = await ensureRecipeFolder(token);
    const oldExport = (await listFilesInFolder(token, folderId)).find(
      (file) => file.name === oldExportName,
    );
    if (oldExport !== undefined) {
      const oldExportContent = await getFileContent(token, oldExport.id);
      await updateFileWithContent(token, oldExport.id, {
        name: `${newTitle}${EXPORT_EXTENSION}`,
        mimeType: EXPORT_MIME_TYPE,
        content: generateRecipeHtml(renamed),
      });
      undoSteps.push(() =>
        updateFileWithContent(token, oldExport.id, {
          name: oldExportName,
          mimeType: EXPORT_MIME_TYPE,
          content: oldExportContent,
        }),
      );
    }

    // 4. Update every recipe that referenced the old title (their ingredient
    //    names are unchanged, so their exports stay valid — no regeneration).
    for (const recipe of updated) {
      const entry = storedByTitle.get(recipe.title);
      if (entry === undefined) {
        throw new Error(`renameRecipe: Datei für "${recipe.title}" nicht gefunden`);
      }
      await updateRecipe(token, entry.fileId, recipe, { regenerateExport: false });
      undoSteps.push(() =>
        updateRecipe(token, entry.fileId, originalByFileId.get(entry.fileId)!, {
          regenerateExport: false,
        }),
      );
    }
  } catch (error) {
    // Best-effort rollback: revert every step that already succeeded.
    let rollbackFailed = false;
    for (const undo of undoSteps.reverse()) {
      try {
        await undo();
      } catch {
        rollbackFailed = true;
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    const suffix =
      undoSteps.length === 0
        ? 'Es wurden keine Änderungen geschrieben.'
        : rollbackFailed
          ? 'Hinweis: das Rückgängigmachen war unvollständig — die Sammlung muss manuell geprüft werden.'
          : 'Änderungen wurden rückgängig gemacht.';
    throw new Error(`Umbenennen fehlgeschlagen: ${detail} (${suffix})`);
  }
}
