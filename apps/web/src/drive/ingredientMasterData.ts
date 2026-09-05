/**
 * Drive persistence for the ingredient master data.
 *
 * The user's authoritative ingredient master data lives in two CSV files
 * inside the Cookbook folder:
 * - `zutaten.csv` — the ingredient list: one row per ingredient
 *   (`Ingredient;Base Unit`); ingredient-level fields can be added as further
 *   columns later without touching the mapping file;
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
} from './driveClient';
import { ensureRecipeFolder } from './recipeStorage';

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
 * Appends a new ingredient to the master data and writes it to Drive.
 *
 * When the files do not exist yet they are created with the current built-in
 * data plus the new rows, so the files always hold the complete master data.
 * The name must not exist yet — the caller checks this up front, but the
 * write guards again (defense in depth, German error).
 *
 * @param name the new ingredient name
 * @param bu the base unit family ("g" or "ml")
 * @param entries the additional units with their g/ml factors and unique
 *   positive-integer priorities (may be empty — an ingredient without
 *   additional units is valid master data); the entries are stored sorted by
 *   ascending priority (registry invariant, see additionalUnitsData.ts)
 */
export async function appendIngredientMasterData(
  token: string,
  name: string,
  bu: string,
  entries: ReadonlyArray<{ au: string; factor: number; priority: number }>,
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const listFile = files.find((entry) => entry.name === LIST_FILE_NAME);
  const mappingsFile = files.find((entry) => entry.name === MAPPINGS_FILE_NAME);

  // The current authoritative set: both Drive files if present, else the seed.
  // A partial pair (only one file) is treated as not yet created: the append
  // re-creates both files from the seed below, intentionally superseding any
  // edits in the surviving file — the pair is the unit of master data.
  const current: IngredientMappings =
    listFile === undefined || mappingsFile === undefined
      ? allIngredientMappings()
      : mergeIngredientMasterData(
          parseIngredientListCsv(await getFileContent(token, listFile.id)),
          parseIngredientMappingsCsv(await getFileContent(token, mappingsFile.id)),
        );

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
      entries: sorted.map((entry) => ({
        au: entry.au,
        factor: entry.factor,
        priority: entry.priority,
      })),
    },
  };
  const { list, mappings } = splitIngredientMasterData(extended);
  const listContent = serializeIngredientListCsv(list);
  const mappingsContent = serializeIngredientMappingsCsv(mappings);
  // Round-trip checks, mirroring the recipe write path (canonicalText): files
  // that the parser would reject must never reach Drive.
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
  // Mark the registry state as newer than any in-flight load (see the guard
  // in loadIngredientMasterData) before publishing it.
  writtenSinceLoad = true;
  setIngredientMappings(extended);
}
