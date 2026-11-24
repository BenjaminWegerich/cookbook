/**
 * Runtime registry for the kitchen storage places — the single source of truth
 * for "which kitchen zones exist" and "in which order the pantry page walks
 * them" while the app runs.
 *
 * The built-in list (SEED_STORAGE_PLACES, generated from
 * docs/storage_places.csv) is the default. The web app loads the user's
 * authoritative list (`lagerorte.csv` in the Drive Cookbook folder's
 * `Stammdaten` subfolder) at startup and replaces the whole list with
 * setStoragePlaces — the Drive file wins once it exists. Until then, and
 * whenever the file is missing or unreadable, the seed keeps the app fully
 * functional.
 *
 * The list is module-level state on purpose, like the ingredient registry: the
 * ingredient parser (src/ingredientCsv.ts), the pantry sort
 * (src/pantrySort.ts) and the web app's chip rows all read through it, so a
 * loaded list is visible everywhere. Unit tests use resetStoragePlaces() to
 * restore the seed.
 */

import { SEED_STORAGE_PLACES } from './storagePlacesData.js';

/** The current places in walking order; starts as the built-in seed. */
let places: readonly string[] = SEED_STORAGE_PLACES;

/**
 * Replaces the whole list (used by the web app when the user's Drive list is
 * loaded — the Drive file is authoritative once it exists). The list is copied
 * so the caller cannot mutate the registry state later.
 */
export function setStoragePlaces(next: readonly string[]): void {
  places = [...next];
}

/**
 * The current places in walking order — the seed plus anything loaded from
 * Drive. Read-only: callers must never mutate the returned array (the registry
 * treats it as immutable).
 */
export function allStoragePlaces(): readonly string[] {
  return places;
}

/** True when the place is one of the current kitchen zones. */
export function isStoragePlace(place: string): boolean {
  return places.includes(place);
}

/** Restores the built-in seed (used by tests between cases). */
export function resetStoragePlaces(): void {
  places = SEED_STORAGE_PLACES;
}
