/**
 * CSV codecs for the shopping-route master data — the canonical format of the
 * repo seeds (docs/shopping_route.csv + docs/shopping_items.csv), used at
 * runtime for the user's authoritative master data in the Drive Cookbook
 * folder (einkaufsweg.csv + einkaufs-zuordnung.csv).
 *
 * This module builds the **data structure only**: where an item is bought and
 * in which order the stops are visited. It deliberately does not sort a list
 * and does not write files — the order a shopping list is derived from this
 * data, and the serializers, come with those steps
 * (docs/storage_format.md §10).
 *
 * Two files, one concept:
 * - the **route** (`Store;Section`, one row per stop): the row order IS the
 *   route — the order the shops are visited and the sections are walked. There
 *   is no separate store order and no global section vocabulary: a section
 *   belongs to exactly one store, and the same section name may exist in
 *   several stores (the pair is the key);
 * - the **assignment** (`Item;Store;Section`, one row per item): item name →
 *   exactly one stop. Its name set is a **superset of the ingredient list**:
 *   it carries recipe ingredients and items that are not ingredients at all
 *   („Klopapier“, „Seife“, „Blumen“), which have no base unit and no reorder
 *   point and therefore cannot live in the ingredient master data. The row
 *   order of this file carries no meaning — a spreadsheet may sort it freely.
 *
 * Both files follow the common CSV rules of csv.ts (one header row, semicolons,
 * CRLF and one trailing empty cell tolerated, leading BOM stripped). Like the
 * ingredient master data they are user data: the repo CSVs are the seed used on
 * first run, the Drive files are authoritative once they exist.
 *
 * What is deliberately NOT in this data: how a Keep line is matched to an item
 * name, where unassigned items are placed (the fallback is the sort's
 * decision), and Keep's sort ids.
 */

import { parseCsvRows } from './csv.js';

/**
 * One stop of the route: level 1 is the store, level 2 the section inside it.
 * A stop is the unit the route orders and the unit an item is assigned to.
 */
export interface ShoppingStop {
  /** Level 1 — the store the stop belongs to (e.g. "Lidl"). */
  readonly store: string;
  /** Level 2 — the section inside that store (e.g. "Obst und Gemüse"). */
  readonly section: string;
}

/**
 * The route: the stops in the order the shops are visited and their sections
 * are walked. It is an **array**, not a record — the order is the content, so
 * it must survive parsing exactly as written.
 */
export type ShoppingRoute = readonly ShoppingStop[];

/**
 * Where each item is bought, keyed by item name. The name set is a superset of
 * the ingredient list (see the module comment); an item without an entry simply
 * has no place in the route. The record's key order carries no meaning.
 */
export type ShoppingAssignments = Readonly<Record<string, ShoppingStop>>;

/** Exact header of the shopping-route CSV. */
const ROUTE_HEADER = 'Store;Section';

/** Exact header of the item-assignment CSV. */
const ASSIGNMENTS_HEADER = 'Item;Store;Section';

/**
 * Canonical key of a stop: store and section are one unit, so the same section
 * name in two stores stays two distinct stops (and a duplicate within one store
 * is detectable). The separator can never occur in a CSV cell.
 */
function stopKey(stop: ShoppingStop): string {
  return `${stop.store}\u0000${stop.section}`;
}

/**
 * Parses the shopping-route CSV (`Store;Section`) into the ordered route.
 * Throws on malformed input (empty file, unexpected header, wrong column
 * count, an empty cell, a duplicated stop); the returned array preserves the
 * file order, which is the route.
 */
export function parseShoppingRouteCsv(text: string): ShoppingRoute {
  const { rows } = parseCsvRows(text, [ROUTE_HEADER]);
  const route: ShoppingStop[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const [store, section] = row;
    if (store === undefined || store === '' || section === undefined || section === '') {
      throw new Error(`Einkaufsweg: leerer Store oder leere Section in Zeile "${row.join(';')}".`);
    }
    const stop: ShoppingStop = { store, section };
    const key = stopKey(stop);
    if (seen.has(key)) {
      throw new Error(`Einkaufsweg: doppelter Einkaufsort "${store}; ${section}".`);
    }
    seen.add(key);
    route.push(stop);
  }
  return route;
}

/**
 * Parses the item-assignment CSV (`Item;Store;Section`) into name → stop. The
 * `route` is the cross-file reference this validation is about: every stop an
 * assignment names must exist in the route — a typo fails loudly at load, like
 * a mapping for an unknown ingredient in the ingredient master data. The item
 * name itself is deliberately NOT checked against the ingredient list: the
 * assignment's name set is a superset of it (see the module comment).
 *
 * Throws on malformed input (empty file, unexpected header, wrong column count,
 * an empty cell, a duplicated item, an unknown stop); the returned record
 * preserves the file order, which carries no meaning.
 */
export function parseShoppingAssignmentsCsv(
  text: string,
  route: ShoppingRoute,
): ShoppingAssignments {
  const { rows } = parseCsvRows(text, [ASSIGNMENTS_HEADER]);
  const knownStops = new Set(route.map(stopKey));
  const assignments: Record<string, ShoppingStop> = {};
  for (const row of rows) {
    const [item, store, section] = row;
    if (
      item === undefined ||
      item === '' ||
      store === undefined ||
      store === '' ||
      section === undefined ||
      section === ''
    ) {
      throw new Error(
        `Einkaufs-Zuordnung: leerer Artikel, Store oder Section in Zeile "${row.join(';')}".`,
      );
    }
    if (assignments[item] !== undefined) {
      throw new Error(`Einkaufs-Zuordnung: doppelter Artikel "${item}".`);
    }
    const stop: ShoppingStop = { store, section };
    if (!knownStops.has(stopKey(stop))) {
      throw new Error(
        `Einkaufs-Zuordnung: Einkaufsort "${store}; ${section}" für "${item}" steht nicht im Einkaufsweg.`,
      );
    }
    assignments[item] = stop;
  }
  return assignments;
}
