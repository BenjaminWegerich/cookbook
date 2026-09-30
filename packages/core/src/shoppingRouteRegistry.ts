/**
 * Runtime registry for the shopping-route master data — the single source of
 * truth for "which stop exists" and "where an item is bought" while the app
 * runs (docs/storage_format.md §10).
 *
 * The built-in route and assignment (SEED_SHOPPING_ROUTE /
 * SEED_SHOPPING_ASSIGNMENTS, generated from docs/shopping_route.csv +
 * docs/shopping_items.csv) are the default seed. The web app loads the user's
 * authoritative master data (einkaufsweg.csv + einkaufs-zuordnung.csv in the
 * Drive Cookbook folder) at startup and replaces both with
 * setShoppingRoute / setShoppingAssignments — the Drive files win once they
 * exist. Until then, and whenever the files are missing or unreadable, the seed
 * keeps the app fully functional (the pickers in the new-ingredient sheet, and
 * later the aisle sort).
 *
 * The registry is module-level state on purpose, like the ingredient registry:
 * every part of the page session reads through it, so a loaded route is visible
 * everywhere. Unit tests use resetShoppingRoute() to restore the seed.
 */

import { SEED_SHOPPING_ASSIGNMENTS, SEED_SHOPPING_ROUTE } from './shoppingRouteData.js';
import type { ShoppingAssignments, ShoppingRoute, ShoppingStop } from './shoppingRouteCsv.js';

/** The current route; starts as the built-in seed. */
let route: ShoppingRoute = SEED_SHOPPING_ROUTE;

/** The current item assignment; starts as the built-in seed. */
let assignments: ShoppingAssignments = SEED_SHOPPING_ASSIGNMENTS;

/**
 * Replaces the whole route (used by the web app when the user's Drive master
 * data is loaded — the Drive file is authoritative once it exists). The route
 * and its assignment are one pair in Drive, so a caller loading them replaces
 * both: an assignment can only be validated against the route it was read with.
 */
export function setShoppingRoute(next: ShoppingRoute): void {
  route = next;
}

/**
 * Replaces the whole item assignment (see setShoppingRoute).
 */
export function setShoppingAssignments(next: ShoppingAssignments): void {
  assignments = next;
}

/**
 * The current route in walking order. Read-only: callers must never mutate the
 * returned array (the registry treats it as immutable).
 */
export function allShoppingStops(): ShoppingRoute {
  return route;
}

/**
 * The current item assignment — the seed plus anything loaded from Drive.
 * Read-only: callers must never mutate the returned record (the registry
 * treats it as immutable).
 */
export function allShoppingAssignments(): ShoppingAssignments {
  return assignments;
}

/**
 * The stop one item is bought at, or undefined when the item has no place in
 * the route (not an error — where such an item ends up is the sort's decision,
 * docs/storage_format.md §10).
 */
export function shoppingStopFor(item: string): ShoppingStop | undefined {
  return assignments[item];
}

/**
 * The distinct stores of the route in walking order — level 1 of the shopping
 * route. This is the order the store chips are shown in (core derives, the UI
 * renders): the first stop of a store decides where the store appears, and a
 * store that is visited again later never shows up twice.
 */
export function shoppingStores(): readonly string[] {
  const stores: string[] = [];
  for (const stop of route) {
    if (!stores.includes(stop.store)) {
      stores.push(stop.store);
    }
  }
  return stores;
}

/**
 * The sections of one store in walking order — level 2 of the shopping route,
 * i.e. the options of the section picker once that store is chosen. Empty for
 * an unknown store (a section belongs to exactly one store, so there is no
 * global list to fall back to).
 */
export function shoppingSections(store: string): readonly string[] {
  const sections: string[] = [];
  for (const stop of route) {
    if (stop.store === store && !sections.includes(stop.section)) {
      sections.push(stop.section);
    }
  }
  return sections;
}

/** Restores the built-in seed (used by tests between cases). */
export function resetShoppingRoute(): void {
  route = SEED_SHOPPING_ROUTE;
  assignments = SEED_SHOPPING_ASSIGNMENTS;
}
