/**
 * Runtime registry for the shopping master data — the single source of truth
 * for "which stop exists", "where an item is bought" and "what a variant means"
 * while the app runs (docs/storage_format.md §10, docs/shopping_item_identity.md).
 *
 * The built-in seed (SEED_SHOPPING_ROUTE / SEED_SHOPPING_ITEMS /
 * SEED_SHOPPING_SYNONYMS, generated from docs/shopping_route.csv +
 * docs/shopping_items.csv + docs/shopping_synonyms.csv) is the default. The web
 * app loads the user's authoritative master data (einkaufsweg.csv +
 * einkaufs-artikel.csv + einkaufs-synonyme.csv in the Drive Cookbook folder's
 * `Stammdaten` subfolder) at startup and replaces all three with
 * setShoppingRoute / setShoppingItems /
 * setShoppingSynonyms — the Drive files win once they exist. Until then, and
 * whenever the files are missing or unreadable, the seed keeps the app fully
 * functional (the pickers in the new-ingredient sheet, and the aisle sort).
 *
 * The registry is module-level state on purpose, like the ingredient registry:
 * every part of the page session reads through it, so a loaded route is visible
 * everywhere. Unit tests use resetShoppingRoute() to restore the seed.
 */

import {
  SEED_SHOPPING_ITEMS,
  SEED_SHOPPING_ROUTE,
  SEED_SHOPPING_SYNONYMS,
} from './shoppingRouteData.js';
import type {
  ShoppingItems,
  ShoppingRoute,
  ShoppingStop,
  ShoppingSynonyms,
} from './shoppingRouteCsv.js';

/** The current route; starts as the built-in seed. */
let route: ShoppingRoute = SEED_SHOPPING_ROUTE;

/** The current item table; starts as the built-in seed. */
let items: ShoppingItems = SEED_SHOPPING_ITEMS;

/** The current synonym table; starts as the built-in seed. */
let synonyms: ShoppingSynonyms = SEED_SHOPPING_SYNONYMS;

/**
 * Replaces the whole route (used by the web app when the user's Drive master
 * data is loaded — the Drive file is authoritative once it exists). The route
 * and the item table are one set in Drive, so a caller loading them replaces
 * both: an item can only be validated against the route it was read with.
 */
export function setShoppingRoute(next: ShoppingRoute): void {
  route = next;
}

/**
 * Replaces the whole item table (see setShoppingRoute).
 */
export function setShoppingItems(next: ShoppingItems): void {
  items = next;
}

/**
 * Replaces the whole synonym table (see setShoppingRoute). A synonym names an
 * item, so a caller loading it replaces it together with the item table it was
 * validated against.
 */
export function setShoppingSynonyms(next: ShoppingSynonyms): void {
  synonyms = next;
}

/**
 * The current route in walking order. Read-only: callers must never mutate the
 * returned array (the registry treats it as immutable).
 */
export function allShoppingStops(): ShoppingRoute {
  return route;
}

/**
 * The current item table — the seed plus anything loaded from Drive. Read-only:
 * callers must never mutate the returned record (the registry treats it as
 * immutable).
 */
export function allShoppingItems(): ShoppingItems {
  return items;
}

/**
 * The current synonym table — the seed plus anything loaded from Drive.
 * Read-only like `allShoppingItems`.
 */
export function allShoppingSynonyms(): ShoppingSynonyms {
  return synonyms;
}

/**
 * The stop one item is bought at, or undefined when the item has no place in
 * the route (not an error — where such an item ends up is the sort's decision,
 * docs/storage_format.md §10).
 */
export function shoppingStopFor(item: string): ShoppingStop | undefined {
  return items[item];
}

/**
 * The item names in the order the master-data screen lists them — alphabetical
 * by German collation, because the file's row order carries no meaning and a
 * reference list is looked up by name, not by position. Read-only like the
 * table itself.
 */
export function shoppingItemNames(): readonly string[] {
  return Object.keys(items).sort((left, right) => left.localeCompare(right, 'de'));
}

/**
 * The variants that name one item, in the synonym file's order (its row order
 * carries no meaning either). Used by the item sheet to show what the article
 * already answers to. Empty for an item without synonyms, which is the normal
 * state before the first confirmed suggestion.
 */
export function shoppingVariantsFor(item: string): readonly string[] {
  return Object.keys(synonyms).filter((variant) => synonyms[variant] === item);
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
  items = SEED_SHOPPING_ITEMS;
  synonyms = SEED_SHOPPING_SYNONYMS;
}
