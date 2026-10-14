/**
 * Drive persistence for the ingredient master data.
 *
 * The user's authoritative ingredient master data lives in two CSV files
 * inside the Cookbook folder:
 * - `zutaten.csv` — the ingredient list: one row per ingredient
 *   (`Ingredient;Base Unit;Reorder Point`); ingredient-level fields can be
 *   added as further columns later without touching the mapping file;
 * - `zutaten-umrechnungen.csv` — the AU mappings: one row per
 *   ingredient–additional-unit mapping (`Ingredient;Additional Unit;
 *   Conversion Factor;Priority`); an ingredient without additional units
 *   simply has no rows here.
 *
 * The formats mirror the repo seeds (docs/ingredients.csv +
 * docs/ingredient_unit_mappings.csv, see ingredientCsv.ts). At startup the app
 * loads both files and merges them into the core runtime registry
 * (ingredientRegistry.ts) — the Drive files win over the built-in seed once
 * they exist. They are created on the first user addition, seeded with the
 * current built-in data, so the files are always the complete, spreadsheet-
 * editable master data.
 *
 * A missing file pair is not an error (the built-in seed keeps the app fully
 * functional); a corrupt or inconsistent pair throws with a German message and
 * the registry keeps its previous state (the built-in seed).
 */

import {
  allIngredientMappings,
  mergeIngredientMasterData,
  parseIngredientListCsv,
  parseIngredientMappingsCsv,
  serializeIngredientListCsv,
  serializeIngredientMappingsCsv,
  setIngredientMappings,
  splitIngredientMasterData,
  type IngredientMappings,
} from '@cookbook/core';

import {
  createFileWithContent,
  getFileContent,
  listFilesInFolder,
  updateFileWithContent,
  type DriveFile,
} from './driveClient';
import { ensureRecipeFolder } from './cookbookFolder';

/** File name of the ingredient list in the Cookbook folder (user-visible). */
const LIST_FILE_NAME = 'zutaten.csv';
/** File name of the AU mappings in the Cookbook folder (user-visible). */
const MAPPINGS_FILE_NAME = 'zutaten-umrechnungen.csv';
/** MIME type of the master data files. */
const MASTER_DATA_MIME_TYPE = 'text/csv';

/**
 * Set when a create-write lands after a load started. The load must then not
 * overwrite the newer registry state — otherwise the startup load finishing
 * after an in-editor create would revert the registry to the pre-create file
 * content (the Drive files themselves stay correct).
 */
let writtenSinceLoad = false;

/**
 * Loads the user's ingredient master data from Drive into the core registry.
 * Missing file pair → the built-in seed stays active (no write). Corrupt or
 * inconsistent files → throws (the caller surfaces the German message); the
 * registry is untouched.
 */
export async function loadIngredientMasterData(token: string): Promise<void> {
  writtenSinceLoad = false;
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const listFile = files.find((entry) => entry.name === LIST_FILE_NAME);
  const mappingsFile = files.find((entry) => entry.name === MAPPINGS_FILE_NAME);
  // The Drive master data is authoritative as a pair: with only one of the
  // two files present, the files are treated as not yet created and the seed
  // stays active (the next addition re-creates both files).
  if (listFile === undefined || mappingsFile === undefined) {
    return;
  }
  const [listText, mappingsText] = await Promise.all([
    getFileContent(token, listFile.id),
    getFileContent(token, mappingsFile.id),
  ]);
  // A create-write landed while this load was in flight — keep its registry
  // state instead of reverting to the (older) file content read above.
  if (writtenSinceLoad) {
    return;
  }
  setIngredientMappings(
    mergeIngredientMasterData(
      parseIngredientListCsv(listText),
      parseIngredientMappingsCsv(mappingsText),
    ),
  );
}

/**
 * Finds the two master-data files in the Cookbook folder. Either of them may be
 * absent, which the callers treat as "the pair is not created yet".
 */
async function findMasterDataFiles(token: string): Promise<{
  folderId: string;
  listFile: DriveFile | undefined;
  mappingsFile: DriveFile | undefined;
}> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  return {
    folderId,
    listFile: files.find((entry) => entry.name === LIST_FILE_NAME),
    mappingsFile: files.find((entry) => entry.name === MAPPINGS_FILE_NAME),
  };
}

/**
 * The current authoritative master data: both Drive files when the pair is
 * present, else the registry's state (the built-in seed). A partial pair counts
 * as not yet created — the pair is the unit of master data, so a write
 * re-creates both files and supersedes the surviving one.
 */
async function readAuthoritativeMasterData(
  token: string,
  listFile: DriveFile | undefined,
  mappingsFile: DriveFile | undefined,
): Promise<IngredientMappings> {
  if (listFile === undefined || mappingsFile === undefined) {
    return allIngredientMappings();
  }
  return mergeIngredientMasterData(
    parseIngredientListCsv(await getFileContent(token, listFile.id)),
    parseIngredientMappingsCsv(await getFileContent(token, mappingsFile.id)),
  );
}

/**
 * Writes the master-data pair, creating either file when it does not exist yet.
 * Both files are round-trip checked first, mirroring the recipe write path
 * (canonicalText): content the parser would reject must never reach Drive.
 */
async function writeMasterDataFiles(
  token: string,
  folderId: string,
  listFile: DriveFile | undefined,
  mappingsFile: DriveFile | undefined,
  data: IngredientMappings,
): Promise<void> {
  const { list, mappings } = splitIngredientMasterData(data);
  const listContent = serializeIngredientListCsv(list);
  const mappingsContent = serializeIngredientMappingsCsv(mappings);
  parseIngredientListCsv(listContent);
  parseIngredientMappingsCsv(mappingsContent);

  if (listFile === undefined) {
    await createFileWithContent(token, {
      name: LIST_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content: listContent,
      parents: [folderId],
    });
  } else {
    await updateFileWithContent(token, listFile.id, {
      name: LIST_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content: listContent,
    });
  }
  if (mappingsFile === undefined) {
    await createFileWithContent(token, {
      name: MAPPINGS_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content: mappingsContent,
      parents: [folderId],
    });
  } else {
    await updateFileWithContent(token, mappingsFile.id, {
      name: MAPPINGS_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content: mappingsContent,
    });
  }
}

/**
 * Appends a new ingredient to the master data and writes it to Drive.
 *
 * When the files do not exist yet they are created with the current built-in
 * data plus the new rows, so the files always hold the complete master data.
 * The name must not exist yet — the caller checks this up front, but the
 * write guards again (defense in depth, German error).
 *
 * @param name the new ingredient name
 * @param bu the base unit family ("g" or "ml")
 * @param reorderPoint the base-unit quantity that is definitely on stock after
 *   a shopping trip: 0 (only ever bought for a recipe), a positive value (an
 *   exact unit's amount when one applies — the create sheet resolves it, see
 *   core resolveReorderPoint), or Infinity (always in stock)
 * @param entries the additional units with their g/ml factors and unique
 *   positive-integer priorities (may be empty — an ingredient without
 *   additional units is valid master data); the entries are stored sorted by
 *   ascending priority (registry invariant, see additionalUnitsData.ts)
 */
export async function appendIngredientMasterData(
  token: string,
  name: string,
  bu: string,
  reorderPoint: number,
  entries: ReadonlyArray<{ au: string; factor: number; priority: number }>,
): Promise<void> {
  const { folderId, listFile, mappingsFile } = await findMasterDataFiles(token);

  // The current authoritative set (see `readAuthoritativeMasterData`): a
  // partial pair counts as not yet created, so the append re-creates both
  // files from the seed below, intentionally superseding any edits in the
  // surviving file — the pair is the unit of master data.
  const current = await readAuthoritativeMasterData(token, listFile, mappingsFile);

  if (current[name] !== undefined) {
    throw new Error(`Die Zutat „${name}“ existiert bereits in der Stammdatenliste.`);
  }

  // Sorted ascending by priority so the registry shape keeps its invariant
  // (the entries are tried in this order, §7 of the AQS spec).
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  const extended: IngredientMappings = {
    ...current,
    [name]: {
      bu,
      // Resolved by the create sheet: 0, a positive base quantity (snapped to
      // an exact unit's amount when one applies), or Infinity.
      reorderPoint,
      entries: sorted.map((entry) => ({
        au: entry.au,
        factor: entry.factor,
        priority: entry.priority,
      })),
    },
  };
  await writeMasterDataFiles(token, folderId, listFile, mappingsFile, extended);
  // Mark the registry state as newer than any in-flight load (see the guard
  // in loadIngredientMasterData) before publishing it.
  writtenSinceLoad = true;
  setIngredientMappings(extended);
}

/**
 * Renames one ingredient in the master data and writes the pair to Drive.
 *
 * A recipe rename is one operation (docs/storage_format.md §6): the collection
 * updates every implicit sub-recipe use of the old title, and a sub-recipe's
 * reorder point belongs to its ingredient entry — under the old name it would
 * silently stop applying, because nothing looks a master-data entry up by a
 * title that no longer exists. The recipe write therefore calls this as the
 * last step of its transaction, with the rename back as its rollback.
 *
 * Nothing is written when the entry is not persisted at all: with the built-in
 * seed in place (the Drive pair does not exist yet) there is no file to carry
 * the new name, and the seed is not the user's to rewrite.
 *
 * @param oldName the title the recipe was renamed from
 * @param newName the title it was renamed to
 * @returns true when a master-data entry was renamed and written
 * @throws {Error} when the new name is already an ingredient — the two entries
 *   would collide, and overwriting one of them would lose its settings
 */
export async function renameIngredientMasterData(
  token: string,
  oldName: string,
  newName: string,
): Promise<boolean> {
  const { folderId, listFile, mappingsFile } = await findMasterDataFiles(token);
  if (listFile === undefined || mappingsFile === undefined) {
    return false;
  }
  const current = await readAuthoritativeMasterData(token, listFile, mappingsFile);
  if (current[oldName] === undefined) {
    return false;
  }
  if (current[newName] !== undefined) {
    throw new Error(
      `Die Umbenennung würde mit der Zutat „${newName}“ in den Stammdaten zusammenstoßen.`,
    );
  }

  // Rebuilt through `Object.entries`, so the renamed row keeps its place in the
  // file instead of moving to the end (the CSV stays spreadsheet-readable in
  // the order the user knows).
  const renamed: IngredientMappings = Object.fromEntries(
    Object.entries(current).map(([name, entry]) => [name === oldName ? newName : name, entry]),
  );
  await writeMasterDataFiles(token, folderId, listFile, mappingsFile, renamed);
  writtenSinceLoad = true;
  setIngredientMappings(renamed);
  return true;
}
