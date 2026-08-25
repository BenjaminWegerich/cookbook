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

/** Creates a new recipe file inside the recipe folder. */
export async function createRecipe(token: string, recipe: Recipe): Promise<DriveFile> {
  const folderId = await ensureRecipeFolder(token);
  return createFileWithContent(token, {
    name: `${recipe.title}${RECIPE_EXTENSION}`,
    mimeType: RECIPE_MIME_TYPE,
    content: canonicalText(recipe),
    parents: [folderId],
  });
}

/** Overwrites a recipe file (content and file name, in case the title changed). */
export async function updateRecipe(
  token: string,
  fileId: string,
  recipe: Recipe,
): Promise<DriveFile> {
  return updateFileWithContent(token, fileId, {
    name: `${recipe.title}${RECIPE_EXTENSION}`,
    mimeType: RECIPE_MIME_TYPE,
    content: canonicalText(recipe),
  });
}

/**
 * Renames a recipe as one operation (§6): new title inside the file, new file
 * name, renamed photo sibling, and every `recipe:` reference to the old title
 * in all other recipe files updated. The collection is left consistent — no
 * dangling references.
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

  // Undo actions, newest first, for the rollback (each closes over the originals).
  const undoSteps: Array<() => Promise<unknown>> = [];
  try {
    // 1. New title in the file + new file name (same Drive file id).
    await updateRecipe(token, fileId, renamed);
    undoSteps.push(() => updateRecipe(token, fileId, originalByFileId.get(fileId)!));

    // 2. Rename the photo sibling so it stays attached (§2).
    if (targetImage !== undefined) {
      await renameFile(token, targetImage.fileId, `${newTitle}.${targetImage.extension}`);
      undoSteps.push(() =>
        renameFile(token, targetImage.fileId, `${target.title}.${targetImage.extension}`),
      );
    }

    // 3. Update every recipe that referenced the old title.
    for (const recipe of updated) {
      const entry = storedByTitle.get(recipe.title);
      if (entry === undefined) {
        throw new Error(`renameRecipe: Datei für "${recipe.title}" nicht gefunden`);
      }
      await updateRecipe(token, entry.fileId, recipe);
      undoSteps.push(() => updateRecipe(token, entry.fileId, originalByFileId.get(entry.fileId)!));
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
    throw new Error(
      rollbackFailed
        ? `Umbenennen fehlgeschlagen: ${detail} (Hinweis: das Rückgängigmachen war unvollständig — die Sammlung muss manuell geprüft werden).`
        : `Umbenennen fehlgeschlagen: ${detail} (Änderungen wurden rückgängig gemacht).`,
    );
  }
}
