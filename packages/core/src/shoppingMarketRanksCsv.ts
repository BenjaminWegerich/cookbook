/**
 * CSV codec for the market rank table — the fourth shopping master-data file
 * (docs/storage_format.md §10, docs/shopping_item_identity.md §7).
 *
 *     Store;Rank
 *     Lidl;1
 *     Rewe;2
 *     dm;3
 *
 * `1` is the preferred market. The row order carries no meaning; the rank is
 * explicit. The file is user data in the Drive `Stammdaten` subfolder
 * (`einkaufs-maerkte.csv`) and is seeded by `docs/shopping_markets.csv`.
 *
 * This module owns only the format and its validation. The effective rank of a
 * route store, including the fallback for a store the file does not mention, is
 * derived in `shoppingMarketRanks.ts`; the live table lives in the runtime
 * registry.
 */

import { parseCsvRows } from './csv.js';
import type { ShoppingRoute } from './shoppingRouteCsv.js';

/**
 * Store → rank. A rank is a positive integer, `1` = best. A missing store is not
 * an error: it ranks after the explicitly ranked stores, in route order
 * (`shoppingStoreRanks`), so a custom route never fails to load.
 */
export type ShoppingMarketRanks = Readonly<Record<string, number>>;

/** Exact header of the market-rank CSV. */
const RANKS_HEADER = 'Store;Rank';

/**
 * Parses `Store;Rank` into the explicit rank table. Throws on malformed input
 * (empty file, unexpected header, wrong column count, an empty cell, an unknown
 * store, a duplicated store, a non-integer or non-positive rank, a duplicated
 * rank). Every store must exist in the route — a typo fails loudly, like a stop
 * typo in the item table. A store missing from the file is allowed; it gets the
 * next rank after the explicit ones in route order.
 */
export function parseShoppingMarketRanksCsv(
  text: string,
  route: ShoppingRoute,
): ShoppingMarketRanks {
  const { rows } = parseCsvRows(text, [RANKS_HEADER]);
  const routeStores = new Set(route.map((stop) => stop.store));
  const ranks: Record<string, number> = {};
  /** Rank → the store that claimed it, to reject two stores of equal rank. */
  const claimedRanks = new Map<number, string>();
  for (const row of rows) {
    const [store, rankText] = row;
    if (store === undefined || store === '' || rankText === undefined || rankText === '') {
      throw new Error(`Einkaufsmärkte: leerer Store oder Rang in Zeile "${row.join(';')}".`);
    }
    if (ranks[store] !== undefined) {
      throw new Error(`Einkaufsmärkte: doppelter Markt "${store}".`);
    }
    if (!routeStores.has(store)) {
      throw new Error(
        `Einkaufsmärkte: Markt "${store}" steht nicht im Einkaufsweg — bitte den Store exakt wie dort schreiben.`,
      );
    }
    const rank = Number(rankText);
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error(
        `Einkaufsmärkte: Rang "${rankText}" für "${store}" ist keine positive ganze Zahl.`,
      );
    }
    const clash = claimedRanks.get(rank);
    if (clash !== undefined) {
      throw new Error(
        `Einkaufsmärkte: "${store}" und "${clash}" haben denselben Rang ${rank} — jeder Markt braucht einen eindeutigen Rang.`,
      );
    }
    claimedRanks.set(rank, store);
    ranks[store] = rank;
  }
  return ranks;
}

/**
 * Serializes the explicit rank table back to `Store;Rank`, one row per store,
 * sorted by rank and then by store name. The file's row order carries no
 * meaning, but a stable output keeps a write from creating diff noise. The
 * output round-trips through parseShoppingMarketRanksCsv; it ends with a newline
 * and uses LF line endings.
 *
 * `route` is the cross-file reference the text is validated against, exactly as
 * on the parse side, so a serializer call can never emit a store the next load
 * would reject.
 */
export function serializeShoppingMarketRanksCsv(
  ranks: ShoppingMarketRanks,
  route: ShoppingRoute,
): string {
  const lines = [RANKS_HEADER];
  const entries = Object.entries(ranks).sort(
    ([leftStore, leftRank], [rightStore, rightRank]) =>
      leftRank - rightRank || leftStore.localeCompare(rightStore, 'de'),
  );
  for (const [store, rank] of entries) {
    lines.push(`${store};${rank}`);
  }
  const text = `${lines.join('\n')}\n`;
  // Round trip through the parser: the serializer must never produce text that
  // the loader would reject.
  parseShoppingMarketRanksCsv(text, route);
  return text;
}
