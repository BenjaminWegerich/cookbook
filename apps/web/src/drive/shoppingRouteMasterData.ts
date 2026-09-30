/**
 * Drive persistence for the shopping-route master data (docs/storage_format.md
 * §10).
 *
 * The user's authoritative shopping route lives in two CSV files inside the
 * Cookbook folder:
 * - `einkaufsweg.csv` — the route: one row per stop (`Store;Section`); the row
 *   order is the order the shops are visited and the sections are walked;
 * - `einkaufs-zuordnung.csv` — the item assignment: one row per item
 *   (`Item;Store;Section`); the row order carries no meaning.
 *
 * The formats mirror the repo seeds (docs/shopping_route.csv +
 * docs/shopping_items.csv, see shoppingRouteCsv.ts). At startup the app loads
 * both files into the core runtime registry (shoppingRouteRegistry.ts) — the
 * Drive files win over the built-in seed once they exist. They are created on
 * the first shopping assignment the user enters, seeded with the current
 * built-in data, so the files are always the complete, spreadsheet-editable
 * master data.
 *
 * A missing file pair is not an error (the built-in seed keeps the app fully
 * functional); a corrupt or inconsistent pair throws with a German message and
 * the registry keeps its previous state (the built-in seed).
 */

import {
  allShoppingAssignments,
  allShoppingStops,
  parseShoppingAssignmentsCsv,
  parseShoppingRouteCsv,
  serializeShoppingAssignmentsCsv,
  serializeShoppingRouteCsv,
  setShoppingAssignments,
  setShoppingRoute,
  type ShoppingAssignments,
  type ShoppingRoute,
  type ShoppingStop,
} from '@cookbook/core';

import {
  createFileWithContent,
  getFileContent,
  listFilesInFolder,
  updateFileWithContent,
} from './driveClient';
import { ensureRecipeFolder } from './recipeStorage';

/** File name of the route in the Cookbook folder (user-visible). */
const ROUTE_FILE_NAME = 'einkaufsweg.csv';
/** File name of the item assignment in the Cookbook folder (user-visible). */
const ASSIGNMENTS_FILE_NAME = 'einkaufs-zuordnung.csv';
/** MIME type of the master data files. */
const MASTER_DATA_MIME_TYPE = 'text/csv';

/**
 * Set when a write lands after a load started. The load must then not overwrite
 * the newer registry state — otherwise the startup load finishing after an
 * in-editor write would revert the assignment to the pre-write file content
 * (the Drive files themselves stay correct).
 */
let writtenSinceLoad = false;

/**
 * Loads the user's shopping-route master data from Drive into the core
 * registry. Missing file pair → the built-in seed stays active (no write).
 * Corrupt or inconsistent files → throws (the caller surfaces the German
 * message); the registry is untouched: both files are parsed before either is
 * published, so a broken assignment can never leave a freshly loaded route
 * paired with the seed assignment.
 */
export async function loadShoppingRouteMasterData(token: string): Promise<void> {
  writtenSinceLoad = false;
  const folderId = await ensureRecipeFolder(token);
  const files = await listFilesInFolder(token, folderId);
  const routeFile = files.find((entry) => entry.name === ROUTE_FILE_NAME);
  const assignmentsFile = files.find((entry) => entry.name === ASSIGNMENTS_FILE_NAME);
  // The Drive master data is authoritative as a pair: with only one of the two
  // files present, the files are treated as not yet created and the seed stays
  // active (the next assignment write re-creates both files).
  if (routeFile === undefined || assignmentsFile === undefined) {
    return;
  }
  const [routeText, assignmentsText] = await Promise.all([
    getFileContent(token, routeFile.id),
    getFileContent(token, assignmentsFile.id),
  ]);
  // A write landed while this load was in flight — keep its registry state
  // instead of reverting to the (older) file content read above.
  if (writtenSinceLoad) {
    return;
  }
  const route = parseShoppingRouteCsv(routeText);
  setShoppingRoute(route);
  setShoppingAssignments(parseShoppingAssignmentsCsv(assignmentsText, route));
}

/**
 * Reads the current authoritative master data pair: both Drive files if they
 * exist, else the built-in seed. A partial pair (only one file) is treated as
 * not yet created — the write below re-creates both files from the seed,
 * intentionally superseding any edits in the surviving file, because the pair
 * is the unit of master data.
 */
async function readCurrentMasterData(
  token: string,
  folderId: string,
): Promise<{
  route: ShoppingRoute;
  assignments: ShoppingAssignments;
  routeFileId: string | undefined;
  assignmentsFileId: string | undefined;
}> {
  const files = await listFilesInFolder(token, folderId);
  const routeFile = files.find((entry) => entry.name === ROUTE_FILE_NAME);
  const assignmentsFile = files.find((entry) => entry.name === ASSIGNMENTS_FILE_NAME);
  if (routeFile === undefined || assignmentsFile === undefined) {
    return {
      route: allShoppingStops(),
      assignments: allShoppingAssignments(),
      routeFileId: undefined,
      assignmentsFileId: undefined,
    };
  }
  const route = parseShoppingRouteCsv(await getFileContent(token, routeFile.id));
  const assignments = parseShoppingAssignmentsCsv(
    await getFileContent(token, assignmentsFile.id),
    route,
  );
  return { route, assignments, routeFileId: routeFile.id, assignmentsFileId: assignmentsFile.id };
}

/**
 * Writes one of the two master-data files — creating it when the pair does not
 * exist yet, updating it otherwise.
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
 * Records where a new item is bought and writes the master data pair to Drive.
 *
 * The stop must be one of the route's stops (a section belongs to exactly one
 * store) — the round-trip check below enforces it, so a stop the route does not
 * contain never reaches a file. An item that already has a row is overwritten:
 * the file holds exactly one stop per item, and the item's name is its key, so
 * the assignment of a name that the user had already prepared in the
 * spreadsheet is corrected rather than rejected (`zutaten.csv` rejects a
 * duplicate ingredient instead, where the name is the identity of a whole
 * master-data entry).
 *
 * @param token the Google Drive access token
 * @param item the item name (exact, case-sensitive — recipe ingredient or, like
 *   Klopapier or Blumen, an item that is no ingredient at all)
 * @param stop the store and section the item is bought at
 */
export async function appendShoppingAssignment(
  token: string,
  item: string,
  stop: ShoppingStop,
): Promise<void> {
  const folderId = await ensureRecipeFolder(token);
  const { route, assignments, routeFileId, assignmentsFileId } = await readCurrentMasterData(
    token,
    folderId,
  );

  const extended: ShoppingAssignments = { ...assignments, [item]: stop };
  // Both serializers round-trip their own output through the parsers before
  // returning it (shoppingRouteCsv.ts), so text the loader would reject can
  // never reach Drive — the same guard the ingredient write path applies.
  const routeContent = serializeShoppingRouteCsv(route);
  const assignmentsContent = serializeShoppingAssignmentsCsv(extended, route);

  await writeMasterDataFile(token, folderId, ROUTE_FILE_NAME, routeFileId, routeContent);
  await writeMasterDataFile(
    token,
    folderId,
    ASSIGNMENTS_FILE_NAME,
    assignmentsFileId,
    assignmentsContent,
  );
  // Mark the registry state as newer than any in-flight load (see the guard in
  // loadShoppingRouteMasterData) before publishing it.
  writtenSinceLoad = true;
  setShoppingAssignments(extended);
}
