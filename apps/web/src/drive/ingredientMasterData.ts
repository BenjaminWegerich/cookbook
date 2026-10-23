/**
 * Drive persistence for the ingredient master data.
 *
 * The user's authoritative ingredient master data lives in two CSV files
 * inside the `Stammdaten` subfolder of the Cookbook folder:
 * - `zutaten.csv` — the ingredient list: one row per ingredient
 *   (`Ingredient;Singular;Plural;Base Unit;Precision;Reorder Point`), where the
 *   two cells after the name are the optional display forms for a count
 *   („1 Karotte“ / „2 Karotten“; empty for an invariant name) and the
 *   `Precision` cell is the mandatory ingredient-level value;
 * - `zutaten-umrechnungen.csv` — the AU mappings: one row per
 *   ingredient–additional-unit mapping (`Ingredient;Additional Unit;
 *   Conversion Factor`); an ingredient without additional units simply has no
 *   rows here. Per-ingredient priorities are gone; at most one mapping may
 *   reference a unit flagged as a shopping unit.
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
  isPrecisionLevel,
  mergeIngredientMasterData,
  parseIngredientListCsv,
  parseIngredientMappingsCsv,
  serializeIngredientListCsv,
  serializeIngredientMappingsCsv,
  setIngredientMappings,
  splitIngredientMasterData,
  type IngredientEntry,
  type IngredientMappings,
  type PrecisionLevel,
} from '@cookbook/core';

import {
  createFileWithContent,
  getFileContent,
  updateFileWithContent,
  type DriveFile,
} from './driveClient';
import { ensureCookbookArea, listCookbookFolder, type CookbookFolder } from './cookbookFolder';

/** File name of the ingredient list in the Stammdaten folder (user-visible). */
const LIST_FILE_NAME = 'zutaten.csv';
/** File name of the AU mappings in the Stammdaten folder (user-visible). */
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
  const folder = await listCookbookFolder(token);
  const listFile = folder.data.files.find((entry) => entry.name === LIST_FILE_NAME);
  const mappingsFile = folder.data.files.find((entry) => entry.name === MAPPINGS_FILE_NAME);
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
 * Finds the two master-data files in a folder listing. Either of them may be
 * absent, which the callers treat as "the pair is not created yet".
 */
function findMasterDataFiles(folder: CookbookFolder): {
  listFile: DriveFile | undefined;
  mappingsFile: DriveFile | undefined;
} {
  return {
    listFile: folder.data.files.find((entry) => entry.name === LIST_FILE_NAME),
    mappingsFile: folder.data.files.find((entry) => entry.name === MAPPINGS_FILE_NAME),
  };
}

/**
 * The current authoritative master data: both Drive files when the pair is
 * present, else the registry's state (the built-in seed). A partial pair counts
 * as not yet created — the pair is the unit of master data, so a write
 * re-creates both files and supersedes the surviving one.
 *
 * The two contents are fetched at once (the reads are independent; only the
 * merge below needs both). All reads complete before the caller writes anything.
 */
async function readAuthoritativeMasterData(
  token: string,
  listFile: DriveFile | undefined,
  mappingsFile: DriveFile | undefined,
): Promise<IngredientMappings> {
  if (listFile === undefined || mappingsFile === undefined) {
    return allIngredientMappings();
  }
  const [listText, mappingsText] = await Promise.all([
    getFileContent(token, listFile.id),
    getFileContent(token, mappingsFile.id),
  ]);
  return mergeIngredientMasterData(
    parseIngredientListCsv(listText),
    parseIngredientMappingsCsv(mappingsText),
  );
}

/**
 * Writes one file of the pair — creating it when the pair does not exist yet,
 * updating it otherwise.
 */
async function writeMasterDataFile(
  token: string,
  folderId: string,
  fileName: string,
  file: DriveFile | undefined,
  content: string,
): Promise<void> {
  if (file === undefined) {
    await createFileWithContent(token, {
      name: fileName,
      mimeType: MASTER_DATA_MIME_TYPE,
      content,
      parents: [folderId],
    });
    return;
  }
  await updateFileWithContent(token, file.id, {
    name: fileName,
    mimeType: MASTER_DATA_MIME_TYPE,
    content,
  });
}

/**
 * Writes the master-data pair, creating either file when it does not exist yet.
 * Both files are round-trip checked first, mirroring the recipe write path
 * (canonicalText): content the parser would reject must never reach Drive.
 *
 * The list and the mappings are separate files, so their uploads run together.
 * The caller read the pair before this write, which keeps the read-before-write
 * guarantee; the round-trip checks above run before the first upload.
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

  await Promise.all([
    writeMasterDataFile(token, folderId, LIST_FILE_NAME, listFile, listContent),
    writeMasterDataFile(token, folderId, MAPPINGS_FILE_NAME, mappingsFile, mappingsContent),
  ]);
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
 * @param entries the additional units with their g/ml factors (may be empty —
 *   an ingredient without additional units is valid master data)
 * @param precision the mandatory ingredient-level precision
 * @param folder the folder snapshot of the caller's save, or omitted to resolve
 *   the folder here (the new-ingredient flow passes the snapshot it shares with
 *   the shopping assignment, so the folder is listed once per save)
 */
export async function appendIngredientMasterData(
  token: string,
  name: string,
  bu: string,
  reorderPoint: number,
  entries: ReadonlyArray<{ au: string; factor: number }>,
  precision: PrecisionLevel,
  folder?: CookbookFolder,
): Promise<void> {
  const resolved = folder ?? (await listCookbookFolder(token));
  const { listFile, mappingsFile } = findMasterDataFiles(resolved);

  // The current authoritative set (see `readAuthoritativeMasterData`): a
  // partial pair counts as not yet created, so the append re-creates both
  // files from the seed below, intentionally superseding any edits in the
  // surviving file — the pair is the unit of master data.
  const current = await readAuthoritativeMasterData(token, listFile, mappingsFile);

  if (current[name] !== undefined) {
    throw new Error(`Die Zutat „${name}“ existiert bereits in der Stammdatenliste.`);
  }

  if (!isPrecisionLevel(precision)) {
    throw new Error('Zutaten-Stammdaten: Die Genauigkeit muss eine der fünf Stufen sein.');
  }
  const extended: IngredientMappings = {
    ...current,
    [name]: {
      bu,
      // Resolved by the create sheet: 0, a positive base quantity (snapped to
      // an exact unit's amount when one applies), or Infinity.
      reorderPoint,
      precision,
      entries: entries.map((entry) => ({ au: entry.au, factor: entry.factor })),
    },
  };
  // The pair lives in `Stammdaten`; the folder is created when the pair is
  // written for the first time (the read above already resolved the snapshot).
  const dataFolderId = await ensureCookbookArea(token, 'data', resolved);
  await writeMasterDataFiles(token, dataFolderId, listFile, mappingsFile, extended);
  // Mark the registry state as newer than any in-flight load (see the guard
  // in loadIngredientMasterData) before publishing it.
  writtenSinceLoad = true;
  setIngredientMappings(extended);
}

/**
 * One master-data entry as the edit sheet submits it. The name and the base
 * unit are deliberately absent: both are identities the collection is built on,
 * so an edit never changes them.
 */
export interface IngredientMasterEntryInput {
  /** Singular display form, or null for an invariant name (with plural null). */
  singular: string | null;
  /** Plural display form, or null for an invariant name (with singular null). */
  plural: string | null;
  /** Base-unit quantity on stock after a shopping trip: 0, a positive value, or Infinity. */
  reorderPoint: number;
  /** The AU mappings (no per-ingredient priority anymore). */
  entries: ReadonlyArray<{ au: string; factor: number }>;
  /** Mandatory ingredient-level precision. */
  precision: PrecisionLevel;
}

/** The state an edit replaced, so the caller can offer an undo. */
export interface IngredientMasterUpdateResult {
  /** The entry as it was stored before this write (from Drive, not the cache). */
  previous: IngredientEntry;
}

/**
 * Replaces one ingredient's editable master-data fields and writes the pair to
 * Drive.
 *
 * The write follows the same transaction shape as the append and rename paths:
 * read the authoritative pair first, replace exactly one entry in it, and only
 * then write both files. Reading first is what keeps a spreadsheet edit the
 * user made meanwhile from being overwritten — the write starts from the file
 * content, not from this session's cached registry.
 *
 * The name and base unit are not part of the edit: recipes, inline mentions and
 * the mappings file key on the name, and the base unit decides how every stored
 * quantity is read. Changing either is a collection-wide operation of its own,
 * not an edit of one row.
 *
 * A missing Drive pair is not an error: the write materializes both files from
 * the built-in seed plus this edit, exactly like the first append does.
 *
 * @param token the Drive access token
 * @param name the canonical ingredient name (the entry's key)
 * @param update the new display forms, reorder point and AU mappings
 * @returns the entry as it was before this write, for the undo notice
 * @throws {Error} when the validation fails, the entry is unknown, or Drive rejects the write
 */
export async function updateIngredientMasterData(
  token: string,
  name: string,
  update: IngredientMasterEntryInput,
): Promise<IngredientMasterUpdateResult> {
  // The stored format keeps the display forms atomic; a half-filled pair would
  // silently fall back to the canonical name on one side.
  if ((update.singular === null) !== (update.plural === null)) {
    throw new Error(
      'Zutaten-Stammdaten: Singular und Plural müssen gemeinsam gesetzt oder beide leer sein.',
    );
  }
  // The serializer writes plain semicolon cells (the protocol accepts quoted
  // cells, but only the parser handles them). Reject a delimiter or a line
  // break here so no caller can produce a file that fails its own round-trip.
  if (/[;"\r\n]/.test(update.singular ?? '') || /[;"\r\n]/.test(update.plural ?? '')) {
    throw new Error(
      'Zutaten-Stammdaten: Singular und Plural dürfen kein Semikolon, keine Anführungszeichen und keinen Zeilenumbruch enthalten.',
    );
  }
  // 0 and Infinity are the two special stock levels; everything between them is
  // a normal positive base quantity (docs/storage_format.md §9).
  if (Number.isNaN(update.reorderPoint) || update.reorderPoint < 0) {
    throw new Error('Zutaten-Stammdaten: Der Vorrat muss eine Zahl ≥ 0 oder unendlich sein.');
  }
  // Factors must be positive; the one-shopping-unit rule is checked by the
  // CSV parser when the pair is serialized (before anything reaches Drive).
  for (const entry of update.entries) {
    if (!Number.isFinite(entry.factor) || entry.factor <= 0) {
      throw new Error(`Zutaten-Stammdaten: ungültiger Faktor für „${name}“ → „${entry.au}“.`);
    }
  }
  if (!isPrecisionLevel(update.precision)) {
    throw new Error('Zutaten-Stammdaten: Die Genauigkeit muss eine der fünf Stufen sein.');
  }

  const folder = await listCookbookFolder(token);
  const { listFile, mappingsFile } = findMasterDataFiles(folder);
  const current = await readAuthoritativeMasterData(token, listFile, mappingsFile);
  const previous = current[name];
  if (previous === undefined) {
    throw new Error(`Die Zutat „${name}“ steht nicht in den Stammdaten.`);
  }

  const nextEntry: IngredientEntry = {
    bu: previous.bu,
    reorderPoint: update.reorderPoint,
    precision: update.precision,
    // Both forms or neither: an invariant name must not carry empty strings.
    ...(update.singular !== null && update.plural !== null
      ? { singular: update.singular, plural: update.plural }
      : {}),
    entries: update.entries,
  };
  const next: IngredientMappings = { ...current, [name]: nextEntry };
  const dataFolderId = await ensureCookbookArea(token, 'data', folder);
  await writeMasterDataFiles(token, dataFolderId, listFile, mappingsFile, next);
  // Publish after the files were written, so the UI never shows a state Drive
  // did not accept (the same order the append and rename paths use).
  writtenSinceLoad = true;
  setIngredientMappings(next);
  return { previous };
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
  const folder = await listCookbookFolder(token);
  const { listFile, mappingsFile } = findMasterDataFiles(folder);
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
  const dataFolderId = await ensureCookbookArea(token, 'data', folder);
  await writeMasterDataFiles(token, dataFolderId, listFile, mappingsFile, renamed);
  writtenSinceLoad = true;
  setIngredientMappings(renamed);
  return true;
}
