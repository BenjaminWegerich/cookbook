/**
 * The trip-market recommendation and allocation (docs/shopping_item_identity.md
 * §7). Pure functions: no registry access, no DOM, no Drive. The caller supplies
 * the distinct relevant items with their locations and the effective market
 * ranks; the module decides which markets the upcoming trip should target and
 * where every item is bought.
 *
 * The recommendation has three stages, in this order:
 *
 * 1. **Mandatory markets** — a market that is the only location of at least one
 *    relevant item. These are always preselected; without them such an item
 *    could not be bought at all.
 * 2. **Coverage** — add the smallest set of further markets so every relevant
 *    item has at least one selected market. Coverage is a hard constraint: a
 *    market needed only for one item is still selected. Among equally small
 *    sets, the one that puts more items at better-ranked markets wins (rank 1
 *    before rank 2, and so on), then the deterministic store order. For more
 *    than {@link MAX_EXACT_OPTIONAL_MARKETS} optional markets a greedy cover is
 *    used instead of the exhaustive search; the personal route has only a
 *    handful of stores.
 * 3. **Priority** — walk the remaining markets best rank first. A market is
 *    preselected when it would take over **more than**
 *    {@link SHOPPING_MARKET_PRIORITY_THRESHOLD} relevant items. Because coverage
 *    is already complete and later markets are worse-ranked, every preselected
 *    priority market keeps its items in the final selection; it can never take
 *    items away from a better-ranked selected market.
 *
 * Allocation is the other direction: for every item, the chosen stop is its
 * location at the best-ranked **selected** market. An item with no location at a
 * selected market is returned as uncovered; the sort places it at the end. The
 * chosen stop carries the section, so the route index of that stop can order the
 * final list without a second lookup.
 */

import type { ShoppingRoute, ShoppingStop } from './shoppingRouteCsv.js';
import type { ShoppingMarketRanks } from './shoppingMarketRanksCsv.js';
import { SHOPPING_MARKET_PRIORITY_THRESHOLD, shoppingStoreRanks } from './shoppingMarketRanks.js';

/** One distinct item that needs a market on this trip. */
export interface ShoppingItemDemand {
  /** The canonical item name (used only as the identity in the result). */
  readonly item: string;
  /** The item's known locations (one stop per market). */
  readonly locations: readonly ShoppingStop[];
}

/** One market of the recommendation screen, with its role and item counts. */
export interface ShoppingMarketOption {
  readonly store: string;
  /** Effective rank; lower is better. */
  readonly rank: number;
  /** True when the recommendation preselects this market. */
  readonly selected: boolean;
  /** The market is the only location of at least one relevant item. */
  readonly mandatory: boolean;
  /** The market belongs to the minimum coverage set (including mandatory). */
  readonly coverage: boolean;
  /** The market was added by the >10 priority rule. */
  readonly priority: boolean;
  /** Items for which this market is the only location. */
  readonly onlyHereCount: number;
  /** The names behind {@link onlyHereCount}, in demand order. */
  readonly onlyHereItems: readonly string[];
  /** Items bought here under the recommended selection. */
  readonly assignedCount: number;
  /** Items this market would take over if it were added to the recommendation. */
  readonly wouldTakeCount: number;
}

/** The recommendation for one upcoming trip. */
export interface ShoppingMarketRecommendation {
  /** Recommended stores, best rank first (the preselection). */
  readonly selected: readonly string[];
  /** Every market that supplies at least one relevant item, best rank first. */
  readonly options: readonly ShoppingMarketOption[];
}

/** The allocation of one demand list under one selection. */
export interface ShoppingMarketAssignment {
  /** Item name → the stop it is bought at (best-ranked selected market). */
  readonly chosen: ReadonlyMap<string, ShoppingStop>;
  /** Store → number of items bought there. */
  readonly marketCounts: ReadonlyMap<string, number>;
  /** Item names with no location at a selected market, in demand order. */
  readonly uncovered: readonly string[];
  /** Item names not bought at their best available market, in demand order. */
  readonly downgraded: readonly string[];
}

/**
 * Upper bound for the exhaustive coverage search. Above it the greedy cover is
 * used. The exact search is 2^n over the non-mandatory markets; a personal
 * shopping route has a handful of stores, so this is a safety valve rather than
 * a normal branch.
 */
const MAX_EXACT_OPTIONAL_MARKETS = 15;

/** The effective rank of one store, with a deterministic last-place fallback. */
function rankOf(store: string, ranks: ReadonlyMap<string, number>): number {
  return ranks.get(store) ?? Number.MAX_SAFE_INTEGER;
}

/** Deduplicates locations by store; a valid item table has one per store anyway. */
function locationsByStore(locations: readonly ShoppingStop[]): ShoppingStop[] {
  const byStore = new Map<string, ShoppingStop>();
  for (const stop of locations) {
    if (!byStore.has(stop.store)) byStore.set(stop.store, stop);
  }
  return [...byStore.values()];
}

/** The best available location of an item, independent of the selection. */
function bestAvailableStop(
  locations: readonly ShoppingStop[],
  ranks: ReadonlyMap<string, number>,
): ShoppingStop | null {
  let best: ShoppingStop | null = null;
  for (const stop of locationsByStore(locations)) {
    if (best === null) {
      best = stop;
      continue;
    }
    const stopRank = rankOf(stop.store, ranks);
    const bestRank = rankOf(best.store, ranks);
    if (stopRank < bestRank) best = stop;
  }
  return best;
}

/** The best location of an item among the selected markets, or null. */
function bestSelectedStop(
  locations: readonly ShoppingStop[],
  selected: ReadonlySet<string>,
  ranks: ReadonlyMap<string, number>,
): ShoppingStop | null {
  let best: ShoppingStop | null = null;
  for (const stop of locationsByStore(locations)) {
    if (!selected.has(stop.store)) continue;
    if (best === null) {
      best = stop;
      continue;
    }
    if (rankOf(stop.store, ranks) < rankOf(best.store, ranks)) best = stop;
  }
  return best;
}

/** True when the item has at least one location at a selected market. */
function isCovered(locations: readonly ShoppingStop[], selected: ReadonlySet<string>): boolean {
  return locations.some((stop) => selected.has(stop.store));
}

/**
 * The allocation of a demand list under a selected set. This is the single
 * implementation shared by the recommendation, the live summary and the final
 * sort (the sort calls {@link bestSelectedStop} through `shoppingSortOrder`).
 */
export function assignShoppingDemand(
  demand: readonly ShoppingItemDemand[],
  selected: ReadonlySet<string> | readonly string[],
  ranks: ReadonlyMap<string, number>,
): ShoppingMarketAssignment {
  const selectedSet = selected instanceof Set ? selected : new Set(selected);
  const chosen = new Map<string, ShoppingStop>();
  const marketCounts = new Map<string, number>();
  const uncovered: string[] = [];
  const downgraded: string[] = [];
  for (const entry of demand) {
    const stop = bestSelectedStop(entry.locations, selectedSet, ranks);
    if (stop === null) {
      uncovered.push(entry.item);
      continue;
    }
    chosen.set(entry.item, stop);
    marketCounts.set(stop.store, (marketCounts.get(stop.store) ?? 0) + 1);
    const best = bestAvailableStop(entry.locations, ranks);
    if (best !== null && rankOf(stop.store, ranks) > rankOf(best.store, ranks)) {
      downgraded.push(entry.item);
    }
  }
  return { chosen, marketCounts, uncovered, downgraded };
}

/**
 * How many items a market would take over if it were added to `selected`.
 * Zero for a market that is already selected and has no assigned items, and for
 * a market that supplies no relevant item.
 */
export function shoppingMarketWouldTake(
  demand: readonly ShoppingItemDemand[],
  selected: ReadonlySet<string>,
  store: string,
  ranks: ReadonlyMap<string, number>,
): number {
  if (selected.has(store)) {
    return assignShoppingDemand(demand, selected, ranks).marketCounts.get(store) ?? 0;
  }
  const next = new Set(selected);
  next.add(store);
  return assignShoppingDemand(demand, next, ranks).marketCounts.get(store) ?? 0;
}

/** True when every demand item has a location at a selected market. */
function coversAll(demand: readonly ShoppingItemDemand[], selected: ReadonlySet<string>): boolean {
  return demand.every((entry) => isCovered(entry.locations, selected));
}

/**
 * The priority profile of one candidate selection: how many items are bought at
 * rank 1, rank 2, and so on. Compared lexicographically, a larger count at the
 * best rank wins. This is the coverage tie-break, not the priority threshold.
 */
function priorityProfile(
  demand: readonly ShoppingItemDemand[],
  selected: ReadonlySet<string>,
  ranks: ReadonlyMap<string, number>,
): readonly number[] {
  let maxRank = 1;
  for (const rank of ranks.values()) {
    if (rank > maxRank) maxRank = rank;
  }
  const counts = new Array<number>(maxRank + 1).fill(0);
  for (const entry of demand) {
    const stop = bestSelectedStop(entry.locations, selected, ranks);
    if (stop === null) continue;
    const rank = rankOf(stop.store, ranks);
    if (rank <= maxRank) counts[rank] = (counts[rank] ?? 0) + 1;
  }
  return counts;
}

/** Positive when `a` puts more items at a better rank than `b`. */
function compareProfiles(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let rank = 1; rank < length; rank += 1) {
    const diff = (a[rank] ?? 0) - (b[rank] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Deterministic fallback between two equally good coverage sets. */
function compareStoreSets(a: readonly string[], b: readonly string[]): number {
  const left = [...a].sort((x, y) => x.localeCompare(y, 'de'));
  const right = [...b].sort((x, y) => x.localeCompare(y, 'de'));
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    return l.localeCompare(r, 'de');
  }
  return 0;
}

/**
 * The minimum coverage set: mandatory plus the smallest number of further
 * markets that covers every demand item. Exact up to the safety bound; a greedy
 * cover above it. The returned set always covers all demand (all available
 * markets is a valid cover).
 */
function coverageSelection(
  demand: readonly ShoppingItemDemand[],
  mandatory: ReadonlySet<string>,
  optionalStores: readonly string[],
  ranks: ReadonlyMap<string, number>,
): Set<string> {
  const selected = new Set(mandatory);
  if (coversAll(demand, selected) || optionalStores.length === 0) {
    return selected;
  }
  if (optionalStores.length > MAX_EXACT_OPTIONAL_MARKETS) {
    // Greedy cover: repeatedly take the market that covers the most still
    // uncovered items; ties go to the better rank, then the store name.
    while (!coversAll(demand, selected)) {
      let bestStore: string | null = null;
      let bestNew = -1;
      for (const store of optionalStores) {
        if (selected.has(store)) continue;
        let covered = 0;
        for (const entry of demand) {
          if (isCovered(entry.locations, selected)) continue;
          if (entry.locations.some((stop) => stop.store === store)) covered += 1;
        }
        if (covered === 0) continue;
        if (
          covered > bestNew ||
          (covered === bestNew &&
            bestStore !== null &&
            rankOf(store, ranks) < rankOf(bestStore, ranks))
        ) {
          bestNew = covered;
          bestStore = store;
        }
      }
      if (bestStore === null) break;
      selected.add(bestStore);
    }
    return selected;
  }
  let best: Set<string> | null = null;
  let bestProfile: readonly number[] = [];
  const subset: string[] = [];
  const total = 1 << optionalStores.length;
  for (let mask = 0; mask < total; mask += 1) {
    subset.length = 0;
    for (let index = 0; index < optionalStores.length; index += 1) {
      if ((mask & (1 << index)) !== 0) subset.push(optionalStores[index]!);
    }
    const candidate = new Set(mandatory);
    for (const store of subset) candidate.add(store);
    if (!coversAll(demand, candidate)) continue;
    if (best !== null && subset.length > best.size - mandatory.size) continue;
    const profile = priorityProfile(demand, candidate, ranks);
    if (best === null) {
      best = candidate;
      bestProfile = profile;
      continue;
    }
    const sizeDiff = subset.length - (best.size - mandatory.size);
    if (sizeDiff < 0) {
      best = candidate;
      bestProfile = profile;
      continue;
    }
    if (sizeDiff > 0) continue;
    const profileDiff = compareProfiles(profile, bestProfile);
    if (profileDiff > 0) {
      best = candidate;
      bestProfile = profile;
      continue;
    }
    if (profileDiff === 0) {
      const setDiff = compareStoreSets([...candidate], [...best]);
      if (setDiff < 0) {
        best = candidate;
        bestProfile = profile;
      }
    }
  }
  if (best === null) {
    // Defensive fallback: all relevant markets is a cover by construction. This
    // should be unreachable, but coverage is a guarantee, not a heuristic.
    for (const store of optionalStores) selected.add(store);
    return selected;
  }
  return best;
}

/**
 * Builds the recommendation for one trip. `demand` must contain distinct item
 * names; the caller derives it from the unchecked, non-ignored lines. `ranks` is
 * the effective map from `shoppingStoreRanks` (or a test fixture).
 */
export function recommendShoppingMarkets(
  demand: readonly ShoppingItemDemand[],
  ranks: ReadonlyMap<string, number>,
): ShoppingMarketRecommendation {
  if (demand.length === 0) {
    return { selected: [], options: [] };
  }

  /** All stores that supply at least one relevant item. */
  const relevantStores = new Set<string>();
  const onlyHere = new Map<string, string[]>();
  for (const entry of demand) {
    const stores = locationsByStore(entry.locations);
    for (const stop of stores) relevantStores.add(stop.store);
    if (stores.length === 1) {
      const store = stores[0]!.store;
      const names = onlyHere.get(store) ?? [];
      names.push(entry.item);
      onlyHere.set(store, names);
    }
  }

  const stores = [...relevantStores].sort((a, b) => {
    const diff = rankOf(a, ranks) - rankOf(b, ranks);
    return diff !== 0 ? diff : a.localeCompare(b, 'de');
  });
  const mandatory = new Set(onlyHere.keys());
  const optionalStores = stores.filter((store) => !mandatory.has(store));
  const coverage = coverageSelection(demand, mandatory, optionalStores, ranks);

  // Priority: add remaining markets in rank order when they take over more than
  // the threshold. Coverage is complete here, so every added market only
  // improves the allocation; later markets are worse-ranked and cannot take the
  // items back.
  const selected = new Set(coverage);
  const priority = new Set<string>();
  for (const store of stores) {
    if (selected.has(store)) continue;
    const wouldTake = shoppingMarketWouldTake(demand, selected, store, ranks);
    if (wouldTake > SHOPPING_MARKET_PRIORITY_THRESHOLD) {
      selected.add(store);
      priority.add(store);
    }
  }

  // A selected market that ends up with no item at all is redundant: every item
  // it could cover is already bought at a better-ranked selected market. Removing
  // it keeps the screen honest and cannot uncover an item (an item that only it
  // could cover would be assigned to it).
  let assignment = assignShoppingDemand(demand, selected, ranks);
  for (const store of [...selected]) {
    if (mandatory.has(store)) continue;
    if ((assignment.marketCounts.get(store) ?? 0) > 0) continue;
    selected.delete(store);
    coverage.delete(store);
    priority.delete(store);
  }
  assignment = assignShoppingDemand(demand, selected, ranks);

  const options: ShoppingMarketOption[] = stores.map((store) => {
    const assignedCount = assignment.marketCounts.get(store) ?? 0;
    const wouldTakeCount = selected.has(store)
      ? assignedCount
      : shoppingMarketWouldTake(demand, selected, store, ranks);
    return {
      store,
      rank: rankOf(store, ranks),
      selected: selected.has(store),
      mandatory: mandatory.has(store),
      coverage: coverage.has(store),
      priority: priority.has(store),
      onlyHereCount: onlyHere.get(store)?.length ?? 0,
      onlyHereItems: onlyHere.get(store) ?? [],
      assignedCount,
      wouldTakeCount,
    };
  });

  return {
    selected: stores.filter((store) => selected.has(store)),
    options,
  };
}

/**
 * The effective market ranks for a route — the convenience wrapper the web app
 * uses. The route's stores are deduplicated in walking order; the static table
 * supplies known ranks and the rest fall after them.
 */
export function shoppingMarketRanksForRoute(
  route: ShoppingRoute,
  explicitRanks: ShoppingMarketRanks,
): ReadonlyMap<string, number> {
  const stores: string[] = [];
  for (const stop of route) {
    if (!stores.includes(stop.store)) stores.push(stop.store);
  }
  return shoppingStoreRanks(stores, explicitRanks);
}
