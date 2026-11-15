/**
 * The pantry page's filing order: the kitchen storage walk.
 *
 * "Vorräte auswählen — Teil 2: Zutaten" shows the bottom-level ingredients of
 * the selected dishes. Before this module existed the page filed them in one
 * list by the pre-filled stock ("still to buy" first, "covered" second). With
 * the per-ingredient `Storage Place` master data it files them by **where they
 * are kept**, so the list follows the user through the kitchen: fridge, freezer,
 * drawers, spice shelf, …
 *
 * The order is a three-level key (decided with the user):
 *
 * 1. **Storage place**, in the walking order of `STORAGE_PLACES`
 *    (docs/storage_places.csv). An ingredient without a place — or with a place
 *    the built-in list does not know, which only a hand-edited file can produce
 *    because the CSV parser rejects it — sorts behind every sorted ingredient.
 *    The page shows no group headings (decided with the user): the walk is
 *    implicit in the row order.
 * 2. **Purchase first**: within one place, a row whose pre-filled Vorrat does
 *    not cover the need stands before a covered one (the page's original filing,
 *    now applied per shelf). It is derived from `stockPrefill`, i.e. from the
 *    data, never from the stock the user is currently choosing — that keeps the
 *    order a stable snapshot for the page's lifetime (see PantrySelect).
 * 3. **German alphabetical** by ingredient name (then base unit) as the calm,
 *    predictable tie-break inside a group.
 *
 * Everything here is pure and framework-free; the caller resolves the needs
 * (core's `bottomLevelNeedsFor`) and files them with `sortPantryNeeds`. The
 * tests pin the comparator, because the page's calmness depends on it being
 * deterministic.
 */

import { mappingsFor } from './ingredientRegistry.js';
import { stockPrefill, type ShoppingNeed } from './shoppingList.js';
import { STORAGE_PLACES } from './storagePlacesData.js';

/**
 * The storage place of one ingredient name, or null when it is unsorted.
 *
 * The place is read from the runtime ingredient registry, so the user's
 * `zutaten.csv` is what decides. A place the built-in list does not know is
 * treated as unsorted (defensive: the parser and the generator already reject
 * it, so this only keeps a stale in-memory entry from breaking the page).
 */
export function storagePlaceOf(ingredient: string): string | null {
  const place = mappingsFor(ingredient)?.storagePlace;
  if (place === undefined || !STORAGE_PLACES.includes(place)) {
    return null;
  }
  return place;
}

/**
 * The place's rank in the walk; the unsorted rank sits behind every place.
 * Used by the comparator here and by the cooking step's stable row sort.
 */
export function storagePlaceRank(ingredient: string): number {
  const place = storagePlaceOf(ingredient);
  return place === null ? STORAGE_PLACES.length : STORAGE_PLACES.indexOf(place);
}

/**
 * The purchase tier of one need: 0 when the pre-filled Vorrat does not cover
 * the need (there is something to buy), 1 when it does. This is exactly the
 * page's original filing and is evaluated on `stockPrefill` — never on the
 * stock currently chosen — so changing a chip cannot reorder the list.
 */
function purchaseRank(need: ShoppingNeed): number {
  return stockPrefill(need) < need.needed ? 0 : 1;
}

/**
 * Compares two pantry needs in the page's order (see the module comment):
 * storage place, then purchase needed before covered, then the German name
 * (then the base unit, for a name that exists in both families).
 */
export function comparePantryNeeds(left: ShoppingNeed, right: ShoppingNeed): number {
  const place = storagePlaceRank(left.ingredient) - storagePlaceRank(right.ingredient);
  if (place !== 0) return place;
  const purchase = purchaseRank(left) - purchaseRank(right);
  if (purchase !== 0) return purchase;
  const name = left.ingredient.localeCompare(right.ingredient, 'de');
  if (name !== 0) return name;
  return left.baseUnit.localeCompare(right.baseUnit, 'de');
}

/**
 * The needs in the pantry order, as a new array (the caller's array is never
 * mutated: the needs come from a memoized derivation).
 */
export function sortPantryNeeds(needs: readonly ShoppingNeed[]): ShoppingNeed[] {
  return [...needs].sort(comparePantryNeeds);
}
