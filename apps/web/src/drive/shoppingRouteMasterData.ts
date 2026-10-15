/**
 * Drive persistence for the shopping master data (docs/storage_format.md §10,
 * docs/shopping_item_identity.md).
 *
 * The user's authoritative shopping master data lives in three CSV files inside
 * the Cookbook folder:
 * - `einkaufsweg.csv` — the route: one row per stop (`Store;Section`); the row
 *   order is the order the shops are visited and the sections are walked;
 * - `einkaufs-artikel.csv` — the item table: one row per item
 *   (`Item;Store;Section`), the identity of everything buyable and the only
 *   place a route is kept; the row order carries no meaning;
 * - `einkaufs-synonyme.csv` — the synonym table: one row per variant
 *   (`Variant;Item`), the meaning of a variant text; the row order carries no
 *   meaning.
 *
 * The formats mirror the repo seeds (docs/shopping_route.csv +
 * docs/shopping_items.csv + docs/shopping_synonyms.csv, see shoppingRouteCsv.ts).
 * At startup the app loads all three into the core runtime registry
 * (shoppingRouteRegistry.ts) — the Drive files win over the built-in seed once
 * they exist. The route and the item table are created together on the first
 * shopping assignment the user enters; the synonym file is created with them
 * (empty) and grows with every confirmed suggestion.
 *
 * A missing route or item file is not an error (the built-in seed keeps the app
 * fully functional); a missing synonym file is the normal state before the first
 * confirmed suggestion (an empty table). A corrupt or inconsistent file throws
 * with a German message and the registry keeps its previous state.
 *
 * Migration (docs/shopping_item_identity.md): the item table was called
 * `einkaufs-zuordnung.csv` before the item identity existed. That file is read
 * once, its rows are written unchanged into `einkaufs-artikel.csv`, the synonym
 * file is created next to it, and the old file is deleted afterwards — the new
 * files are written first, so the rows exist twice until the old file is gone
 * and never not at all.
 */

import {
  allShoppingItems,
  allShoppingStops,
  allShoppingSynonyms,
  parseShoppingItemsCsv,
  parseShoppingRouteCsv,
  parseShoppingSynonymsCsv,
  serializeShoppingItemsCsv,
  serializeShoppingRouteCsv,
  serializeShoppingSynonymsCsv,
  setShoppingItems,
  setShoppingRoute,
  setShoppingSynonyms,
  shoppingNameKey,
  type ShoppingItems,
  type ShoppingRoute,
  type ShoppingStop,
  type ShoppingSynonyms,
} from '@cookbook/core';

import {
  createFileWithContent,
  deleteFile,
  getFileContent,
  isDriveAuthError,
  listFilesInFolder,
  updateFileWithContent,
  type DriveFile,
} from './driveClient';
import { ensureRecipeFolder } from './cookbookFolder';

/** File name of the route in the Cookbook folder (user-visible). */
const ROUTE_FILE_NAME = 'einkaufsweg.csv';
/** File name of the item table in the Cookbook folder (user-visible). */
const ITEMS_FILE_NAME = 'einkaufs-artikel.csv';
/** File name of the synonym table in the Cookbook folder (user-visible). */
const SYNONYMS_FILE_NAME = 'einkaufs-synonyme.csv';
/**
 * The item table's pre-identity file name (user-visible). It is read once by
 * the migration above and then deleted; nothing writes it any more.
 */
const LEGACY_ITEMS_FILE_NAME = 'einkaufs-zuordnung.csv';
/** MIME type of the master data files. */
const MASTER_DATA_MIME_TYPE = 'text/csv';

/**
 * Set when a write lands after a load started. The load must then not overwrite
 * the newer registry state — otherwise the startup load finishing after an
 * in-editor write would revert the item table to the pre-write file content
 * (the Drive files themselves stay correct).
 */
let writtenSinceLoad = false;

/** The master-data files found in the Cookbook folder (each optional). */
interface MasterDataFiles {
  readonly route: DriveFile | undefined;
  readonly items: DriveFile | undefined;
  readonly synonyms: DriveFile | undefined;
  readonly legacyItems: DriveFile | undefined;
}

/** Finds the shopping master-data files of a folder listing by their names. */
function findMasterDataFiles(files: readonly DriveFile[]): MasterDataFiles {
  const byName = (name: string): DriveFile | undefined =>
    files.find((entry) => entry.name === name);
  return {
    route: byName(ROUTE_FILE_NAME),
    items: byName(ITEMS_FILE_NAME),
    synonyms: byName(SYNONYMS_FILE_NAME),
    legacyItems: byName(LEGACY_ITEMS_FILE_NAME),
  };
}

/**
 * Loads the user's shopping master data from Drive into the core registry.
 * Missing route or item file → the built-in seed stays active (no write). A
 * legacy item file is migrated first (see the file header). Corrupt or
 * inconsistent files → throws (the caller surfaces the German message); the
 * registry is untouched: all files are parsed before any of them is published,
 * so a broken item table can never leave a freshly loaded route paired with the
 * seed items.
 */
export async function loadShoppingRouteMasterData(token: string): Promise<void> {
  writtenSinceLoad = false;
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const migrated = await migrateLegacyItemsFile(token, folderId, findMasterDataFiles(files));
  if (migrated) {
    return;
  }
  const { route, items, synonyms } = findMasterDataFiles(files);
  // The route and the item table are the master data as a set: with only one of
  // the two present, they are treated as not yet created and the seed stays
  // active (the next write re-creates the set from the seed).
  if (route === undefined || items === undefined) {
    return;
  }
  const [routeText, itemsText, synonymsText] = await Promise.all([
    getFileContent(token, route.id),
    getFileContent(token, items.id),
    synonyms === undefined ? Promise.resolve('') : getFileContent(token, synonyms.id),
  ]);
  // A write landed while this load was in flight — keep its registry state
  // instead of reverting to the (older) file content read above.
  if (writtenSinceLoad) {
    return;
  }
  const parsedRoute = parseShoppingRouteCsv(routeText);
  const parsedItems = parseShoppingItemsCsv(itemsText, parsedRoute);
  // A missing synonym file is the normal state before the first confirmed
  // suggestion; it is an empty table, not an error.
  const parsedSynonyms =
    synonyms === undefined ? {} : parseShoppingSynonymsCsv(synonymsText, parsedItems);
  setShoppingRoute(parsedRoute);
  setShoppingItems(parsedItems);
  setShoppingSynonyms(parsedSynonyms);
}

/**
 * Removes one file, best-effort: a leftover legacy file is ignored by every
 * later load and deleted then, so a failed cleanup must not keep the app from
 * loading correct master data. An authentication failure is rethrown — the
 * caller has to reconnect, and swallowing it would hide that.
 */
async function deleteFileBestEffort(token: string, file: DriveFile): Promise<void> {
  try {
    await deleteFile(token, file.id);
  } catch (error) {
    if (isDriveAuthError(error)) {
      throw error;
    }
  }
}

/**
 * Migrates the pre-identity item file (`einkaufs-zuordnung.csv`) to the new
 * item table + synonym table. Returns true when it migrated (the caller then
 * stops: the registry is already published), false when there was nothing to do.
 *
 * A complete new set with a leftover legacy file only has the leftover deleted.
 * A legacy file without the route is left alone — its rows cannot be validated,
 * so the seed stays active, exactly as with a partial new set.
 */
async function migrateLegacyItemsFile(
  token: string,
  folderId: string,
  files: MasterDataFiles,
): Promise<boolean> {
  if (files.legacyItems === undefined) {
    return false;
  }
  if (files.items !== undefined) {
    // Already migrated — remove the leftover and carry on with the new set.
    await deleteFileBestEffort(token, files.legacyItems);
    return false;
  }
  if (files.route === undefined) {
    return false;
  }
  const route = parseShoppingRouteCsv(await getFileContent(token, files.route.id));
  // The legacy rows are exactly the item table's rows: the same header, the
  // same cells, the same validation.
  const items = parseShoppingItemsCsv(await getFileContent(token, files.legacyItems.id), route);
  const synonyms =
    files.synonyms === undefined
      ? {}
      : parseShoppingSynonymsCsv(await getFileContent(token, files.synonyms.id), items);
  // Write the new files first, then delete the old one: until the item file
  // exists the legacy rows are the only copy of the data. The route is not
  // rewritten — it is already correct and untouched by the migration.
  await writeMasterDataFile(
    token,
    folderId,
    ITEMS_FILE_NAME,
    undefined,
    serializeShoppingItemsCsv(items, route),
  );
  await writeMasterDataFile(
    token,
    folderId,
    SYNONYMS_FILE_NAME,
    files.synonyms?.id,
    serializeShoppingSynonymsCsv(synonyms, items),
  );
  await deleteFileBestEffort(token, files.legacyItems);
  writtenSinceLoad = true;
  setShoppingRoute(route);
  setShoppingItems(items);
  setShoppingSynonyms(synonyms);
  return true;
}

/** The master data as the write paths build on it, plus the file ids to update. */
interface CurrentMasterData {
  readonly route: ShoppingRoute;
  readonly items: ShoppingItems;
  readonly synonyms: ShoppingSynonyms;
  readonly routeFileId: string | undefined;
  readonly itemsFileId: string | undefined;
  readonly synonymsFileId: string | undefined;
}

/**
 * Reads the current authoritative master data: the Drive files if the route and
 * item table exist, else the built-in seed. A partial set (no route or no item
 * table) is treated as not yet created — the write below re-creates the set from
 * the seed, intentionally superseding any edits in the surviving file, because
 * the set is the unit of master data.
 */
async function readCurrentMasterData(token: string, folderId: string): Promise<CurrentMasterData> {
  const files = findMasterDataFiles(await listFilesInFolder(token, folderId));
  if (files.route === undefined || files.items === undefined) {
    return {
      route: allShoppingStops(),
      items: allShoppingItems(),
      synonyms: allShoppingSynonyms(),
      routeFileId: undefined,
      itemsFileId: undefined,
      synonymsFileId: undefined,
    };
  }
  const route = parseShoppingRouteCsv(await getFileContent(token, files.route.id));
  const items = parseShoppingItemsCsv(await getFileContent(token, files.items.id), route);
  const synonyms =
    files.synonyms === undefined
      ? {}
      : parseShoppingSynonymsCsv(await getFileContent(token, files.synonyms.id), items);
  return {
    route,
    items,
    synonyms,
    routeFileId: files.route.id,
    itemsFileId: files.items.id,
    synonymsFileId: files.synonyms?.id,
  };
}

/**
 * Writes one of the master-data files — creating it when the set does not exist
 * yet, updating it otherwise.
 */
async function writeMasterDataFile(
  token: string,
  folderId: string,
  fileName: string,
  fileId: string | undefined,
  content: string,
): Promise<void> {
  if (fileId === undefined) {
    await createFileWithContent(token, {
      name: fileName,
      mimeType: MASTER_DATA_MIME_TYPE,
      content,
      parents: [folderId],
    });
    return;
  }
  await updateFileWithContent(token, fileId, {
    name: fileName,
    mimeType: MASTER_DATA_MIME_TYPE,
    content,
  });
}

/**
 * Writes the whole master-data set to Drive in one cycle: the route, the item
 * table and the synonym table. All three serializers round-trip their own output
 * through the parsers before returning it (shoppingRouteCsv.ts), so text the
 * loader would reject can never reach Drive. The registry is published only
 * after every write succeeded, and marked as newer than any in-flight load.
 */
async function writeMasterData(
  token: string,
  folderId: string,
  current: CurrentMasterData,
  items: ShoppingItems,
  synonyms: ShoppingSynonyms,
): Promise<void> {
  const routeContent = serializeShoppingRouteCsv(current.route);
  const itemsContent = serializeShoppingItemsCsv(items, current.route);
  const synonymsContent = serializeShoppingSynonymsCsv(synonyms, items);

  await writeMasterDataFile(token, folderId, ROUTE_FILE_NAME, current.routeFileId, routeContent);
  await writeMasterDataFile(token, folderId, ITEMS_FILE_NAME, current.itemsFileId, itemsContent);
  await writeMasterDataFile(
    token,
    folderId,
    SYNONYMS_FILE_NAME,
    current.synonymsFileId,
    synonymsContent,
  );
  writtenSinceLoad = true;
  setShoppingItems(items);
  setShoppingSynonyms(synonyms);
}

/**
 * Records where new items are bought and writes the master-data set to Drive in
 * one read/write cycle — the batch form of `appendShoppingItem`, used by the
 * shopping-list sort when it assigns several items at once.
 *
 * The stop must be one of the route's stops (a section belongs to exactly one
 * store) — the round-trip check in the writer enforces it, so a stop the route
 * does not contain never reaches a file. An item that already has a row is
 * overwritten: the file holds exactly one stop per item, and the item's name is
 * its key, so the stop of a name that the user had already prepared in the
 * spreadsheet is corrected rather than rejected (`zutaten.csv` rejects a
 * duplicate ingredient instead, where the name is the identity of a whole
 * master-data entry). The key is case-folded, like the matching: a name that
 * differs from an existing item only in letter case updates that row instead of
 * adding a second one, which the loader would reject as ambiguous.
 */
export async function appendShoppingItems(
  token: string,
  entries: ReadonlyArray<{ item: string; stop: ShoppingStop }>,
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const current = await readCurrentMasterData(token, folderId);

  // Build on a mutable record, then freeze into the registry's read-only shape
  // (the item table's `Readonly<Record<...>>` only permits reading).
  const mutable: Record<string, ShoppingStop> = { ...current.items };
  /** The existing spelling of each folded key, so a case-variant corrects it. */
  const existingByKey = new Map(Object.keys(mutable).map((name) => [shoppingNameKey(name), name]));
  for (const { item, stop } of entries) {
    const key = shoppingNameKey(item);
    const existing = existingByKey.get(key);
    if (existing === undefined) {
      existingByKey.set(key, item);
    }
    mutable[existing ?? item] = stop;
  }
  await writeMasterData(token, folderId, current, mutable, current.synonyms);
}

/**
 * Records where a new item is bought and writes the master-data set to Drive —
 * the single-entry form of `appendShoppingItems` (the new-ingredient sheet's
 * „Einkauf“ field).
 *
 * @param token the Google Drive access token
 * @param item the item name (exact — recipe ingredient or, like Klopapier or
 *   Blumen, an item that is no ingredient at all)
 * @param stop the store and section the item is bought at
 */
export async function appendShoppingItem(
  token: string,
  item: string,
  stop: ShoppingStop,
): Promise<void> {
  await appendShoppingItems(token, [{ item, stop }]);
}

/**
 * Appends confirmed variants to the synonym table and writes the master-data set
 * to Drive — the one write the sort flow performs (docs/shopping_item_identity.md
 * §4). Each entry means "this variant text names that item", so the same line is
 * never asked again.
 *
 * The comparison key is case-folded: an entry whose variant already exists under
 * another spelling replaces that row instead of adding a second one, because the
 * loader rejects two variants that differ only in case (they would make the
 * variant ambiguous). The item must exist — the serializer's round-trip check
 * turns a variant that names an unknown item, or one that would shadow an item
 * name, into a loud failure before anything is written.
 */
export async function appendShoppingSynonyms(
  token: string,
  entries: ReadonlyArray<{ variant: string; item: string }>,
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const current = await readCurrentMasterData(token, folderId);

  const mutable: Record<string, string> = { ...current.synonyms };
  for (const { variant, item } of entries) {
    const key = shoppingNameKey(variant);
    for (const existing of Object.keys(mutable)) {
      if (shoppingNameKey(existing) === key) {
        delete mutable[existing];
      }
    }
    mutable[variant] = item;
  }
  await writeMasterData(token, folderId, current, current.items, mutable);
}
