/**
 * The item-independent market preference used by the trip-market recommendation
 * (docs/shopping_item_identity.md §7, docs/storage_format.md §10).
 *
 * A rank is a **preference**, not a walking order: `1` is the market the user
 * prefers for buying, and an item that is available at several selected markets
 * is bought at the best-ranked one. The route in `einkaufsweg.csv` remains the
 * walking order and decides the final list order; the two orders may disagree.
 *
 * The explicit ranks live in the Drive master-data file `einkaufs-maerkte.csv`
 * (`Store;Rank`), seeded by `docs/shopping_markets.csv` and loaded into the
 * runtime registry. There is no in-app editor. A store missing from the file
 * ranks after the explicit ones in the route's first-appearance order, so a
 * custom route still loads and sorts deterministically.
 */

import { SEED_SHOPPING_MARKET_RANKS } from './shoppingRouteData.js';
import type { ShoppingMarketRanks } from './shoppingMarketRanksCsv.js';

/**
 * How many items a non-coverage market must take over before the recommendation
 * adds it as a priority market. Strictly **more than** this number qualifies;
 * the threshold is a named constant so the screen and the tests cannot drift.
 */
export const SHOPPING_MARKET_PRIORITY_THRESHOLD = 10;

/**
 * The effective rank of every store in `stores`.
 *
 * Explicitly ranked stores keep their rank. Stores missing from the table get
 * the next free ranks in their route order (the order of `stores`, which callers
 * pass from `shoppingStores()`), so a new custom store is never unranked and
 * never displaces an existing preference. `explicitRanks` is the loaded Drive
 * table (or the seed when none is loaded). The returned map is read-only by
 * convention; callers must not mutate it.
 */
export function shoppingStoreRanks(
  stores: readonly string[],
  explicitRanks: ShoppingMarketRanks = SEED_SHOPPING_MARKET_RANKS,
): ReadonlyMap<string, number> {
  // Store names are user data and their spelling is the route's identity, but a
  // hand-edited route may write "REWE" while the rank table says "Rewe". The
  // preference is the same market, so the lookup folds case; the returned map
  // still uses the route's spelling.
  const byFoldedStore = new Map<string, number>();
  for (const [store, rank] of Object.entries(explicitRanks)) {
    byFoldedStore.set(store.toLocaleLowerCase('de'), rank);
  }
  const ranks = new Map<string, number>();
  const usedRanks = new Set<number>();
  let highest = 0;
  for (const store of stores) {
    const rank = byFoldedStore.get(store.toLocaleLowerCase('de'));
    if (rank === undefined || usedRanks.has(rank)) continue;
    ranks.set(store, rank);
    usedRanks.add(rank);
    if (rank > highest) highest = rank;
  }
  let next = highest + 1;
  for (const store of stores) {
    if (ranks.has(store)) continue;
    ranks.set(store, next);
    next += 1;
  }
  return ranks;
}
