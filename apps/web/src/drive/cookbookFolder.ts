/**
 * The Cookbook folder in Google Drive — the one container the whole collection
 * lives in.
 *
 * Layout (decided with the user):
 *
 *     Cookbook/
 *       Rezepte/      one `<Titel>.md` per recipe
 *       Exporte/      the generated `<Titel>.html` cooking views
 *       Bilder/       the recipe photos (`<Titel>.jpg` / `.png`)
 *       Stammdaten/   the CSV master data and `rezept-richtlinien.md`
 *
 * The app addresses files through these four subfolders, one level below the
 * container. A file that still lies directly in the Cookbook root is therefore
 * invisible to every read path — which is why a listing reports such leftovers
 * as {@link CookbookFolder.strayFiles}, so the UI can ask the user to move them
 * instead of silently working with an empty collection.
 *
 * The container's id is remembered in localStorage so the app keeps resolving
 * to the same folder: a name search is ambiguous as soon as a second folder
 * called "Cookbook" exists (for example one shared from another account), and
 * the cached id also survives a rename. The subfolders are looked up by name
 * *inside* the container, so a same-named folder elsewhere in the account can
 * never be picked up.
 *
 * The helper lives here rather than in ./recipeStorage (where it started)
 * because the ingredient master data and the shopping route use it as well —
 * keeping it in the recipe layer would make those modules depend on recipe
 * storage, and recipe storage in turn depend on them (the rename flow rewrites
 * the ingredient master data, see ./ingredientMasterData).
 */

import {
  createFolder,
  findFoldersByName,
  FOLDER_MIME_TYPE,
  getFile,
  listFilesInFolder,
  type DriveFile,
} from './driveClient';

/** Name of the folder that holds the collection (user-visible in Drive). */
const COOKBOOK_FOLDER_NAME = 'Cookbook';

/** localStorage key that remembers the Cookbook folder id (unchanged since v1). */
const FOLDER_ID_KEY = 'cookbook.recipeFolderId';

/**
 * The four subfolders of the Cookbook folder, keyed by the role the code uses
 * and named as the user sees them in Drive (German, capitalized like every
 * other noun in the UI).
 */
export const COOKBOOK_SUBFOLDERS = {
  recipes: 'Rezepte',
  exports: 'Exporte',
  images: 'Bilder',
  data: 'Stammdaten',
} as const;

/** Which of the four subfolders a file belongs to. */
export type CookbookArea = keyof typeof COOKBOOK_SUBFOLDERS;

/**
 * File extensions the app itself stores. A file with one of these directly in
 * the Cookbook root is a leftover from the flat layout and worth a warning; an
 * unrelated file (a PDF, a note the user dropped there) is left alone.
 */
const COLLECTION_FILE_PATTERN = /\.(?:md|html|csv|jpe?g|png)$/i;

/**
 * Returns the id of the Cookbook folder, creating it on first use.
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
  const existing = await findFoldersByName(token, COOKBOOK_FOLDER_NAME);
  const folder = existing[0] ?? (await createFolder(token, COOKBOOK_FOLDER_NAME));
  localStorage.setItem(FOLDER_ID_KEY, folder.id);
  return folder.id;
}

/** One subfolder: its id and the files directly inside it at listing time. */
export interface CookbookSubfolder {
  /** The folder's id, or `undefined` when it does not exist yet (read paths). */
  readonly id: string | undefined;
  readonly files: readonly DriveFile[];
}

/**
 * One resolved Cookbook collection: the container id, its four subfolders with
 * their files, and any collection file still lying in the root.
 *
 * A save that has to write two master-data sets (the new-ingredient flow writes
 * the shopping assignment and then the ingredient list) works on the same
 * folder twice. Resolving and listing it once and handing the same snapshot to
 * both write paths removes the duplicate Drive round trips from that save.
 *
 * The snapshot only carries ids and names. Every write path still reads the
 * *content* of each file it is about to change, so the read-before-write
 * guarantee is unchanged: the snapshot can be slightly older than the write, the
 * content cannot.
 */
export interface CookbookFolder {
  readonly id: string;
  readonly recipes: CookbookSubfolder;
  readonly exports: CookbookSubfolder;
  readonly images: CookbookSubfolder;
  readonly data: CookbookSubfolder;
  /**
   * Names of collection files (`*.md`, `*.html`, `*.csv`, `*.jpg`, `*.png`)
   * that still lie directly in the Cookbook root, i.e. outside the four
   * subfolders. The app does not read them; the list exists so the UI can tell
   * the user to move them (see App.tsx).
   */
  readonly strayFiles: readonly string[];
}

/** Returns the subfolder with the exact area name, if it exists. */
function findAreaFolder(children: readonly DriveFile[], area: CookbookArea): DriveFile | undefined {
  const name = COOKBOOK_SUBFOLDERS[area];
  const exact = children.find(
    (child) => child.mimeType === FOLDER_MIME_TYPE && child.name === name,
  );
  if (exact !== undefined) {
    return exact;
  }
  // Forgiving fallback: a folder the user created by hand as "rezepte" is still
  // the recipes area. Without it the app would create a second folder beside it
  // and split the collection.
  return children.find(
    (child) =>
      child.mimeType === FOLDER_MIME_TYPE && child.name.toLowerCase() === name.toLowerCase(),
  );
}

/** Lists one area's files; a missing subfolder is an empty area, not an error. */
async function listArea(
  token: string,
  children: readonly DriveFile[],
  area: CookbookArea,
): Promise<CookbookSubfolder> {
  const folder = findAreaFolder(children, area);
  if (folder === undefined) {
    return { id: undefined, files: [] };
  }
  return { id: folder.id, files: await listFilesInFolder(token, folder.id) };
}

/** The collection files still sitting in the container root, sorted by name. */
function strayFileNames(children: readonly DriveFile[]): string[] {
  return children
    .filter((child) => child.mimeType !== FOLDER_MIME_TYPE)
    .filter((child) => COLLECTION_FILE_PATTERN.test(child.name))
    .map((child) => child.name)
    .sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * In-flight listing, shared by concurrent callers. The app starts several
 * independent loads at once (recipe list, both master-data pairs), and each of
 * them needs the same folder snapshot; without this they would list the
 * container and all subfolders four times over. The promise is dropped as soon
 * as it settles, so a later call always sees fresh metadata.
 */
let pendingListing: Promise<CookbookFolder> | null = null;
let pendingListingToken: string | null = null;

/** Resolves the container and lists all four subfolders in one snapshot. */
async function loadCookbookFolder(token: string): Promise<CookbookFolder> {
  const id = await ensureRecipeFolder(token);
  const children = await listFilesInFolder(token, id);
  const [recipes, exports, images, data] = await Promise.all([
    listArea(token, children, 'recipes'),
    listArea(token, children, 'exports'),
    listArea(token, children, 'images'),
    listArea(token, children, 'data'),
  ]);
  return { id, recipes, exports, images, data, strayFiles: strayFileNames(children) };
}

/**
 * Resolves the Cookbook collection and lists its subfolders. Callers that touch
 * several master-data sets in one action pass the result to both write paths
 * instead of resolving the folder themselves.
 *
 * Concurrent calls share one Drive listing (see `pendingListing`).
 */
export function listCookbookFolder(token: string): Promise<CookbookFolder> {
  if (pendingListing !== null && pendingListingToken === token) {
    return pendingListing;
  }
  const request = loadCookbookFolder(token).finally(() => {
    if (pendingListing === request) {
      pendingListing = null;
      pendingListingToken = null;
    }
  });
  pendingListing = request;
  pendingListingToken = token;
  return request;
}

/**
 * Resolves one subfolder for writing, creating it (and the container, on first
 * use) when it does not exist yet. Reads never create folders, so an untouched
 * collection does not sprout empty ones.
 *
 * A snapshot may already carry the subfolder id; when it does not, the
 * container is listed once more before creating — a snapshot taken before a
 * concurrent write must never lead to a second folder of the same name.
 */
export async function ensureCookbookArea(
  token: string,
  area: CookbookArea,
  folder?: CookbookFolder,
): Promise<string> {
  const known = folder?.[area].id;
  if (known !== undefined) {
    return known;
  }
  const rootId = folder?.id ?? (await ensureRecipeFolder(token));
  const children = await listFilesInFolder(token, rootId);
  const existing = findAreaFolder(children, area);
  if (existing !== undefined) {
    return existing.id;
  }
  const created = await createFolder(token, COOKBOOK_SUBFOLDERS[area], rootId);
  return created.id;
}
