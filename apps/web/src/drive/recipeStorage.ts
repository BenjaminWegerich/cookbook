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

import { generateRecipeHtml, parseRecipe, serializeRecipe, type Recipe } from '@cookbook/core';
import {
  createFileWithContent,
  createFolder,
  deleteFile,
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
 * Derives the recipe title from its Drive file name ("<title>.md" → title).
 * Falls back to the file name without a trailing extension for robustness.
 */
function titleFromFileName(name: string): string {
  return name.endsWith(RECIPE_EXTENSION)
    ? name.slice(0, -RECIPE_EXTENSION.length)
    : name.replace(/\.[^.]*$/, '');
}

/**
 * Finds the photo sibling of a recipe title in a folder listing (§2: same
 * basename, `.jpg` preferred, first match wins — consistent with listRecipes).
 */
function findPhotoIn(files: DriveFile[], title: string): DriveFile | undefined {
  for (const extension of IMAGE_EXTENSIONS) {
    const fileName = `${title}.${extension}`;
    const match = files.find((file) => file.name.toLowerCase() === fileName.toLowerCase());
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

/**
 * Deletes one recipe as a unit (§2): the `.md` file, its photo sibling and its
 * HTML export. A missing photo or export is not an error — only the recipe
 * file itself must exist. The `.md` delete is the unit's success: siblings
 * are cleaned up best-effort afterwards, so a partial failure never leaves a
 * deleted recipe behind with an error that would block a retry.
 */
export async function deleteRecipe(token: string, fileId: string): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const file = await getFile(token, fileId);
  const title = titleFromFileName(file.name);
  const files = await listFilesInFolder(token, folderId);
  const photo = findPhotoIn(files, title);
  const exportFile = files.find((entry) => entry.name === `${title}${EXPORT_EXTENSION}`);

  // 1. The recipe file itself — this is what "deleted" means.
  await deleteFile(token, fileId);

  // 2. Best-effort cleanup of the photo and export siblings; a failure here
  //    must not surface as a failed delete (retrying would 404 on the .md).
  const siblings = [photo?.id, exportFile?.id].filter((id): id is string => id !== undefined);
  const results = await Promise.allSettled(siblings.map((id) => deleteFile(token, id)));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `Waisen-Datei "${siblings[index]}" konnte nicht gelöscht werden: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`,
      );
    }
  });
}

/**
 * Uploads a photo for a recipe (§2): stored as a sibling file with the same
 * basename as the recipe and a `.jpg` / `.png` extension. An existing photo
 * with the same basename is replaced — updated in place when the extension
 * matches, otherwise deleted and re-created — so a recipe never has two photo
 * siblings.
 */
export async function uploadRecipeImage(
  token: string,
  fileId: string,
  blob: Blob,
  extension: 'jpg' | 'png',
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const file = await getFile(token, fileId);
  const title = titleFromFileName(file.name);
  const fileName = `${title}.${extension}`;
  const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/png';

  const files = await listFilesInFolder(token, folderId);
  const existing = findPhotoIn(files, title);
  if (existing !== undefined && existing.name.toLowerCase() === fileName.toLowerCase()) {
    await updateFileWithContent(token, existing.id, { name: fileName, mimeType, content: blob });
    return;
  }
  // Different extension: create the new file first, then remove the old one —
  // a failure during creation must never leave the recipe without a photo.
  await createFileWithContent(token, {
    name: fileName,
    mimeType,
    content: blob,
    parents: [folderId],
  });
  if (existing !== undefined) {
    await deleteFile(token, existing.id);
  }
}

/**
 * Removes the recipe's photo sibling (§2), if one exists. A recipe without a
 * photo is a no-op.
 */
export async function removeRecipeImage(token: string, fileId: string): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const file = await getFile(token, fileId);
  const title = titleFromFileName(file.name);
  const files = await listFilesInFolder(token, folderId);
  const photo = findPhotoIn(files, title);
  if (photo !== undefined) {
    await deleteFile(token, photo.id);
  }
}

/**
 * Saves a recipe, handling a title change as one §6 operation: new title in
 * the file + new file name, renamed photo sibling, HTML export renamed and
 * regenerated in place (same Drive file id — shared links survive), and every
 * `recipe:` reference to the old title in the other recipe files updated. A
 * plain save (title unchanged) just writes the content and regenerates the
 * export (decision 7).
 *
 * The write steps are best-effort rolled back when one fails mid-flow (the
 * originals are held in memory): the collection is restored to its pre-save
 * state, or the error message says so if even the rollback failed.
 *
 * @param original the recipe as loaded in the editor, used as the rollback
 *   target for the edited file (what the user actually saw)
 */
export async function saveRecipe(
  token: string,
  fileId: string,
  recipe: Recipe,
  original: Recipe,
): Promise<void> {
  const current = await readRecipe(token, fileId);
  if (current.title === recipe.title) {
    // Plain save: content update + export regeneration.
    await updateRecipe(token, fileId, recipe);
    return;
  }

  // The new title must be free: two files named `<title>.md` (and two exports)
  // would silently overwrite each other otherwise. `stored` contains the target
  // file with its old title, so this cannot false-positive on itself.
  const stored = await listRecipes(token);
  if (stored.some((entry) => entry.title === recipe.title)) {
    throw new Error(
      `Speichern nicht möglich: Es gibt bereits ein Rezept mit dem Titel "${recipe.title}".`,
    );
  }

  // Read the other recipes once (they may reference the old title), keeping
  // their original content for the rollback.
  const storedByTitle = new Map(stored.map((entry) => [entry.title, entry]));
  const originalByFileId = new Map<string, Recipe>([[fileId, original]]);
  const others: Recipe[] = [];
  for (const entry of stored) {
    if (entry.title === current.title) continue;
    const other = await readRecipe(token, entry.fileId);
    originalByFileId.set(entry.fileId, other);
    others.push(other);
  }
  const targetImage = storedByTitle.get(current.title)?.image;

  // Undo actions, newest first, for the rollback (each closes over the originals).
  const undoSteps: Array<() => Promise<unknown>> = [];
  try {
    // 1. New title in the file + new file name (same Drive file id). The
    //    export is handled separately in steps 3–4 (regenerateExport: false,
    //    so the hook does not create a second export file).
    await updateRecipe(token, fileId, recipe, { regenerateExport: false });
    undoSteps.push(() => updateRecipe(token, fileId, original, { regenerateExport: false }));

    // 2. Rename the photo sibling so it stays attached (§2).
    if (targetImage !== undefined) {
      await renameFile(token, targetImage.fileId, `${recipe.title}.${targetImage.extension}`);
      undoSteps.push(() =>
        renameFile(token, targetImage.fileId, `${current.title}.${targetImage.extension}`),
      );
    }

    // 3. Rename the HTML export in place (same Drive file id), so existing
    //    shared links keep working; the content is regenerated in step 4.
    const folderId = await ensureRecipeFolder(token);
    const files = await listFilesInFolder(token, folderId);
    const oldExport = files.find((entry) => entry.name === `${current.title}${EXPORT_EXTENSION}`);
    if (oldExport !== undefined) {
      const oldExportContent = await getFileContent(token, oldExport.id);
      await renameFile(token, oldExport.id, `${recipe.title}${EXPORT_EXTENSION}`);
      undoSteps.push(() =>
        updateFileWithContent(token, oldExport.id, {
          name: `${current.title}${EXPORT_EXTENSION}`,
          mimeType: EXPORT_MIME_TYPE,
          content: oldExportContent,
        }),
      );
    }

    // 4. Regenerate the export content with the new title (updates the file
    //    renamed in step 3 in place; creates it when there was none).
    await writeRecipeExportSafely(token, recipe);

    // 5. Update every other recipe that referenced the old title (their
    //    ingredient names are unchanged, so their exports stay valid).
    for (const other of others) {
      if (!other.ingredients.some((ingredient) => ingredient.recipe === current.title)) {
        continue;
      }
      const updated: Recipe = {
        ...other,
        ingredients: other.ingredients.map((ingredient) =>
          ingredient.recipe === current.title
            ? { ...ingredient, recipe: recipe.title }
            : ingredient,
        ),
      };
      const entry = storedByTitle.get(other.title);
      if (entry === undefined) {
        throw new Error(`saveRecipe: Datei für "${other.title}" nicht gefunden`);
      }
      await updateRecipe(token, entry.fileId, updated, { regenerateExport: false });
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
    throw new Error(`Speichern fehlgeschlagen: ${detail} (${suffix})`);
  }
}

/**
 * Renames a recipe as one operation (§6): new title inside the file, new file
 * name, renamed photo sibling, and every `recipe:` reference to the old title
 * in all other recipe files updated. The collection is left consistent — no
 * dangling references. The HTML export is renamed and regenerated in place
 * (same Drive file id), so existing shared links keep working.
 *
 * Delegates to `saveRecipe` with the current content and the new title.
 */
export async function renameRecipe(token: string, fileId: string, newTitle: string): Promise<void> {
  const current = await readRecipe(token, fileId);
  if (current.title === newTitle) {
    return;
  }
  await saveRecipe(token, fileId, { ...current, title: newTitle }, current);
}
