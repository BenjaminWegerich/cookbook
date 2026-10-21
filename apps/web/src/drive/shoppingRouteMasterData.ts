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
  updateFileWithContent,
  type DriveFile,
} from './driveClient';
import { listCookbookFolder, type CookbookFolder } from './cookbookFolder';

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
  const folder = await listCookbookFolder(token);
  const migrated = await migrateLegacyItemsFile(
    token,
    folder.id,
    findMasterDataFiles(folder.files),
  );
  if (migrated) {
    return;
  }
  const { route, items, synonyms } = findMasterDataFiles(folder.files);
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
 *
 * The three contents are fetched at once (the reads are independent; only the
 * parsing below is ordered, because items and synonyms are validated against the
 * route). All reads complete before the caller writes anything.
 *
 * A partial set keeps the ids of the files that do exist: the set is still
 * re-created from the registry, but a surviving file is overwritten in place
 * instead of a second file of the same name being created beside it. This is
 * the rule the write path depends on — a folder with `einkaufsweg.csv` but no
 * item table must end up with one route file, not two.
 */
async function readCurrentMasterData(
  token: string,
  folder: CookbookFolder,
): Promise<CurrentMasterData> {
  const files = findMasterDataFiles(folder.files);
  if (files.route === undefined || files.items === undefined) {
    return {
      route: allShoppingStops(),
      items: allShoppingItems(),
      synonyms: allShoppingSynonyms(),
      routeFileId: files.route?.id,
      itemsFileId: files.items?.id,
      synonymsFileId: files.synonyms?.id,
    };
  }
  const [routeText, itemsText, synonymsText] = await Promise.all([
    getFileContent(token, files.route.id),
    getFileContent(token, files.items.id),
    // A missing synonym file is the normal state before the first confirmed
    // suggestion: it reads as the empty table below, without a request.
    files.synonyms === undefined ? Promise.resolve('') : getFileContent(token, files.synonyms.id),
  ]);
  const route = parseShoppingRouteCsv(routeText);
  const items = parseShoppingItemsCsv(itemsText, route);
  const synonyms =
    files.synonyms === undefined ? {} : parseShoppingSynonymsCsv(synonymsText, items);
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
 * loader would reject can never reach Drive. The three files are independent, so
 * the uploads run together; every read finished before the first upload started,
 * which keeps the read-before-write guarantee. The registry is published only
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

  await Promise.all([
    writeMasterDataFile(token, folderId, ROUTE_FILE_NAME, current.routeFileId, routeContent),
    writeMasterDataFile(token, folderId, ITEMS_FILE_NAME, current.itemsFileId, itemsContent),
    writeMasterDataFile(
      token,
      folderId,
      SYNONYMS_FILE_NAME,
      current.synonymsFileId,
      synonymsContent,
    ),
  ]);
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
  /** Folder snapshot of the caller's save; resolved here when omitted. */
  folder?: CookbookFolder,
): Promise<void> {
  const resolved = folder ?? (await listCookbookFolder(token));
  const current = await readCurrentMasterData(token, resolved);

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
  await writeMasterData(token, resolved.id, current, mutable, current.synonyms);
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
 * @param folder the folder snapshot of the caller's save, or omitted to resolve
 *   the folder here (the new-ingredient flow passes the snapshot it shares with
 *   the ingredient write, so the folder is listed once per save)
 */
export async function appendShoppingItem(
  token: string,
  item: string,
  stop: ShoppingStop,
  folder?: CookbookFolder,
): Promise<void> {
  await appendShoppingItems(token, [{ item, stop }], folder);
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
 *
 * @param folder the folder snapshot of the caller's action, or omitted to resolve
 *   the folder here. The sort flow writes the item rows just before this call,
 *   so a snapshot taken before that write may still show a folder without the
 *   shopping set; such a snapshot is not used (see below), because the synonyms
 *   must be validated against the items that write has just created.
 */
export async function appendShoppingSynonyms(
  token: string,
  entries: ReadonlyArray<{ variant: string; item: string }>,
  folder?: CookbookFolder,
): Promise<void> {
  const files = folder === undefined ? undefined : findMasterDataFiles(folder.files);
  const snapshotComplete = files?.route !== undefined && files.items !== undefined;
  // A snapshot without the shopping set cannot be trusted here: the item write
  // that runs before this call may have created the files since the snapshot
  // (the first sort on an empty Drive). Re-listing then is the only way to
  // validate the variants against the rows that write has just stored.
  const resolved =
    folder !== undefined && snapshotComplete ? folder : await listCookbookFolder(token);
  const current = await readCurrentMasterData(token, resolved);

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
  await writeMasterData(token, resolved.id, current, current.items, mutable);
}

/**
 * The state of one item row as the shopping master-data screen edits it: the
 * stop the item is bought at and the variants that name it. It is also the undo
 * snapshot of a write, so a save and a delete return the same shape.
 */
export interface ShoppingItemState {
  /** The item's stop (store + section) as it was before the write. */
  readonly stop: ShoppingStop;
  /** The item's own variants, in the synonym file's order, before the write. */
  readonly variants: readonly string[];
}

/**
 * The variants that name one item. The synonym table is keyed by variant, so
 * this is a filter, not a second table: every variant carries its item as the
 * value (docs/storage_format.md §10).
 */
function variantsForItem(synonyms: ShoppingSynonyms, item: string): string[] {
  return Object.keys(synonyms).filter((variant) => synonyms[variant] === item);
}

/**
 * Replaces exactly one item's variants in the synonym table and keeps every
 * other row untouched. The item's previous rows leave first, so a variant the
 * form removed is really gone; the new rows are then written with the user's
 * spelling (the key is folded only for comparison, never for storage).
 *
 * The caller's list is the complete desired set for this item — the form owns
 * it, and a write is never a partial patch. A variant that belongs to another
 * item is not silently moved: the form's `validateShoppingVariant` rules that
 * out before the write, and the serializer's round-trip check rejects a shadowed
 * item name in any case.
 */
function replaceItemVariants(
  synonyms: ShoppingSynonyms,
  item: string,
  variants: readonly string[],
): ShoppingSynonyms {
  const next: Record<string, string> = {};
  for (const [variant, owner] of Object.entries(synonyms)) {
    if (owner !== item) {
      next[variant] = owner;
    }
  }
  for (const variant of variants) {
    next[variant] = item;
  }
  return next;
}

/**
 * The item's current state, or a loud German failure when the row is gone. The
 * screen edits existing rows only (decided with the user), so a missing row is
 * not a create request: it means the authoritative file changed under the form
 * (a spreadsheet edit, another tab) and the next save has nothing to build on.
 */
function requireItemState(current: CurrentMasterData, item: string): ShoppingItemState {
  const stop = current.items[item];
  if (stop === undefined) {
    throw new Error(`Einkaufsartikel: „${item}“ steht nicht in den Einkaufsdaten.`);
  }
  return { stop, variants: variantsForItem(current.synonyms, item) };
}

/**
 * Saves one item's stop and its complete synonym list, and writes the
 * master-data set to Drive in one read/write cycle — the write of the „Artikel“
 * sheet.
 *
 * `variants` is the complete desired set for this item: the sheet's list after
 * the user added and removed chips. Every other item's rows and synonyms stay
 * untouched. The route itself is not edited here, but it is written together
 * with the other two files because the three are one set: creating the set for
 * the first time must not leave an item table whose stops no route file
 * describes (the next load would then fall back to the seed and hide the
 * write).
 *
 * Returns the previous state for the snackbar's „Rückgängig“ (§6.5).
 *
 * @param token the Google Drive access token
 * @param item the canonical item name (the row's key, not editable)
 * @param stop the new stop; it must be one of the route's stops
 * @param variants the item's complete synonym list, in display order
 */
export async function saveShoppingItem(
  token: string,
  item: string,
  stop: ShoppingStop,
  variants: readonly string[],
): Promise<{ readonly previous: ShoppingItemState }> {
  const folder = await listCookbookFolder(token);
  const current = await readCurrentMasterData(token, folder);
  const previous = requireItemState(current, item);
  const items: Record<string, ShoppingStop> = { ...current.items, [item]: stop };
  const synonyms = replaceItemVariants(current.synonyms, item, variants);
  await writeMasterData(token, folder.id, current, items, synonyms);
  return { previous };
}

/**
 * Removes one item's row and every synonym that names it, and writes the
 * master-data set to Drive. Removing the item row means "this is not bought any
 * more" (docs/storage_format.md §10); the ingredient row, if the item is also
 * an ingredient, is a separate file and stays untouched. The synonyms have to
 * go with the row, because a variant naming an unknown item would make the next
 * load fail.
 *
 * This is reversible, so it needs no confirmation — the success notice's
 * „Rückgängig“ restores the row and its synonyms (DESIGN §6.4/§6.5).
 */
export async function deleteShoppingItem(
  token: string,
  item: string,
): Promise<{ readonly previous: ShoppingItemState }> {
  const folder = await listCookbookFolder(token);
  const current = await readCurrentMasterData(token, folder);
  const previous = requireItemState(current, item);
  const items: Record<string, ShoppingStop> = { ...current.items };
  delete items[item];
  const synonyms = replaceItemVariants(current.synonyms, item, []);
  await writeMasterData(token, folder.id, current, items, synonyms);
  return { previous };
}

/**
 * Puts one item row back — the inverse of `deleteShoppingItem` and of
 * `saveShoppingItem`, used by both notices' „Rückgängig“. It adds the row when
 * it is missing, which is the only place the app creates an item row for an
 * existing name; the screen itself edits existing rows only.
 *
 * @param state the row's stop and its complete variant list as the notice
 *   captured them when the changed write ran
 */
export async function restoreShoppingItem(
  token: string,
  item: string,
  state: ShoppingItemState,
): Promise<void> {
  const folder = await listCookbookFolder(token);
  const current = await readCurrentMasterData(token, folder);
  const items: Record<string, ShoppingStop> = { ...current.items, [item]: state.stop };
  const synonyms = replaceItemVariants(current.synonyms, item, state.variants);
  await writeMasterData(token, folder.id, current, items, synonyms);
}
