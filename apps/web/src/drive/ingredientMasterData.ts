/**
 * Drive persistence for the ingredient master data.
 *
 * The user's authoritative ingredient list lives in `zutaten-stammdaten.csv`
 * inside the Cookbook folder (same canonical format as
 * docs/ingredient_unit_mappings.csv). At startup the app loads it into the
 * core runtime registry (ingredientRegistry.ts) — the Drive file wins over
 * the built-in seed once it exists. The file is created on the first user
 * addition, seeded with the current built-in mappings, so the file is always
 * the complete, spreadsheet-editable master data.
 *
 * A missing file is not an error (the built-in seed keeps the app fully
 * functional); a corrupt file throws with a German message and the registry
 * keeps its previous state (the built-in seed).
 */

import {
  allIngredientMappings,
  parseIngredientMappingsCsv,
  serializeIngredientMappingsCsv,
  setIngredientMappings,
  type IngredientMappings,
} from '@cookbook/core';

import {
  createFileWithContent,
  getFileContent,
  listFilesInFolder,
  updateFileWithContent,
} from './driveClient';
import { ensureRecipeFolder } from './recipeStorage';

/** File name of the master data in the Cookbook folder (user-visible). */
const MASTER_DATA_FILE_NAME = 'zutaten-stammdaten.csv';
/** MIME type of the master data file. */
const MASTER_DATA_MIME_TYPE = 'text/csv';

/**
 * Set when a create-write lands after a load started. The load must then not
 * overwrite the newer registry state — otherwise the startup load finishing
 * after an in-editor create would revert the registry to the pre-create file
 * content (the Drive file itself stays correct).
 */
let writtenSinceLoad = false;

/**
 * Loads the user's ingredient master data from Drive into the core registry.
 * Missing file → the built-in seed stays active (no write). Corrupt file →
 * throws (the caller surfaces the German message); the registry is untouched.
 */
export async function loadIngredientMasterData(token: string): Promise<void> {
  writtenSinceLoad = false;
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const file = files.find((entry) => entry.name === MASTER_DATA_FILE_NAME);
  if (file === undefined) {
    return;
  }
  const content = await getFileContent(token, file.id);
  // A create-write landed while this load was in flight — keep its registry
  // state instead of reverting to the (older) file content read above.
  if (writtenSinceLoad) {
    return;
  }
  setIngredientMappings(parseIngredientMappingsCsv(content));
}

/**
 * Appends a new ingredient to the master data and writes it to Drive.
 *
 * When the file does not exist yet it is created with the current built-in
 * mappings plus the new rows, so the file always holds the complete master
 * data. The name must not exist yet — the caller checks this up front, but
 * the write guards again (defense in depth, German error).
 *
 * @param name the new ingredient name
 * @param bu the base unit family ("g" or "ml")
 * @param entries the additional units with their g/ml factors; priority 1, 2,
 *   … is assigned in the given order
 */
export async function appendIngredientMasterData(
  token: string,
  name: string,
  bu: string,
  entries: ReadonlyArray<{ au: string; factor: number }>,
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const file = files.find((entry) => entry.name === MASTER_DATA_FILE_NAME);

  // The current authoritative set: the Drive file if present, else the seed.
  const current: IngredientMappings =
    file === undefined
      ? allIngredientMappings()
      : parseIngredientMappingsCsv(await getFileContent(token, file.id));

  if (current[name] !== undefined) {
    throw new Error(`Die Zutat „${name}" existiert bereits in der Stammdatenliste.`);
  }

  const extended: IngredientMappings = {
    ...current,
    [name]: entries.map((entry, index) => ({
      bu,
      au: entry.au,
      factor: entry.factor,
      priority: index + 1,
    })),
  };
  const content = serializeIngredientMappingsCsv(extended);
  // Round-trip check, mirroring the recipe write path (canonicalText): a file
  // that the parser would reject must never reach Drive.
  parseIngredientMappingsCsv(content);

  if (file === undefined) {
    await createFileWithContent(token, {
      name: MASTER_DATA_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content,
      parents: [folderId],
    });
  } else {
    await updateFileWithContent(token, file.id, {
      name: MASTER_DATA_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content,
    });
  }
  // Mark the registry state as newer than any in-flight load (see the guard
  // in loadIngredientMasterData) before publishing it.
  writtenSinceLoad = true;
  setIngredientMappings(extended);
}
