/**
 * Drive persistence for the kitchen storage-place list.
 *
 * The user's authoritative list lives in `lagerorte.csv` inside the `Stammdaten`
 * subfolder of the Cookbook folder: one `Place` per row, and the row order is
 * the kitchen walk the pantry page files its ingredient rows in. The format
 * mirrors the repo seed (docs/storage_places.csv, see storagePlacesCsv.ts).
 *
 * The list has no editor in the web app (decided with the user): it is edited
 * in the spreadsheet, like the other master data. Because nothing in the app
 * would ever write the file on its own, it is created here on the first load,
 * seeded with the built-in list — otherwise the user would have to create it by
 * hand before the list could be changed. A missing file is therefore only the
 * state before that first creation; afterwards the Drive file is authoritative
 * and re-read on every startup / when „Zutaten“ opens.
 *
 * A corrupt file throws with a German message and the registry keeps its
 * previous state (the built-in seed), exactly like the other master data.
 */

import {
  parseStoragePlacesCsv,
  SEED_STORAGE_PLACES,
  serializeStoragePlacesCsv,
  setStoragePlaces,
} from '@cookbook/core';

import { createFileWithContent, getFileContent } from './driveClient';
import { ensureCookbookArea, listCookbookFolder } from './cookbookFolder';

/** File name of the storage-place list in the Stammdaten folder (user-visible). */
const PLACES_FILE_NAME = 'lagerorte.csv';
/** MIME type of the master data files. */
const MASTER_DATA_MIME_TYPE = 'text/csv';

/**
 * In-flight load, shared by concurrent callers. The app can start two loads at
 * once (the startup load and the „Zutaten“ screen), and both would see the same
 * folder snapshot with no `lagerorte.csv` and create one — two files of the
 * same name in Drive. Sharing the promise makes the second caller wait for the
 * first instead. The promise is dropped as soon as it settles, so a later call
 * reads the file again.
 */
let pendingLoad: Promise<void> | null = null;
let pendingLoadToken: string | null = null;

/**
 * Loads the user's storage-place list from Drive into the core registry.
 *
 * The list is loaded before the ingredient master data, because `zutaten.csv`
 * validates every `Storage Place` cell against it: a zone added in the
 * spreadsheet must be known before the ingredient file is parsed. When the file
 * does not exist yet, it is created from the built-in list (see the module
 * comment) and that list stays active.
 *
 * @throws {Error} when the file is corrupt, the folder cannot be resolved, or
 *   the seed file cannot be created
 */
export function loadStoragePlacesMasterData(token: string): Promise<void> {
  if (pendingLoad !== null && pendingLoadToken === token) {
    return pendingLoad;
  }
  const request = loadFromDrive(token).finally(() => {
    if (pendingLoad === request) {
      pendingLoad = null;
      pendingLoadToken = null;
    }
  });
  pendingLoad = request;
  pendingLoadToken = token;
  return request;
}

/** The actual read-or-create; see {@link loadStoragePlacesMasterData}. */
async function loadFromDrive(token: string): Promise<void> {
  const folder = await listCookbookFolder(token);
  const file = folder.data.files.find((entry) => entry.name === PLACES_FILE_NAME);
  if (file === undefined) {
    const dataFolderId = await ensureCookbookArea(token, 'data', folder);
    await createFileWithContent(token, {
      name: PLACES_FILE_NAME,
      mimeType: MASTER_DATA_MIME_TYPE,
      content: serializeStoragePlacesCsv(SEED_STORAGE_PLACES),
      parents: [dataFolderId],
    });
    setStoragePlaces(SEED_STORAGE_PLACES);
    return;
  }
  setStoragePlaces(parseStoragePlacesCsv(await getFileContent(token, file.id)));
}
