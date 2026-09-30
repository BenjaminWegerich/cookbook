/**
 * CSV codecs for the shopping-route master data — the canonical format of the
 * repo seeds (docs/shopping_route.csv + docs/shopping_items.csv), used at
 * runtime for the user's authoritative master data in the Drive Cookbook
 * folder (einkaufsweg.csv + einkaufs-zuordnung.csv).
 *
 * This module owns the format and nothing else: the data structure (where an
 * item is bought and in which order the stops are visited) plus its two codecs,
 * parse and serialize. It deliberately does not sort a shopping list and does
 * not touch a file system — the derived order and the Drive files belong to the
 * steps that use this format (docs/storage_format.md §10).
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
 * Serializes the route back to the canonical CSV (`Store;Section`), one row per
 * stop, in route order — the order IS the content, so the serializer never
 * sorts, groups or deduplicates. The output round-trips through
 * parseShoppingRouteCsv; it ends with a newline and uses LF line endings.
 *
 * Cells are written verbatim: this format has no quoting (csv.ts), so a cell
 * containing a semicolon or a line break could not be read back. The round-trip
 * check below turns such a cell into a loud failure here instead of into a
 * corrupt file later.
 */
export function serializeShoppingRouteCsv(route: ShoppingRoute): string {
  const lines = [ROUTE_HEADER];
  for (const stop of route) {
    lines.push(`${stop.store};${stop.section}`);
  }
  const text = `${lines.join('\n')}\n`;
  // Round trip through the parser: the serializer must never produce text that
  // the loader would reject (docs/storage_format.md §10).
  parseShoppingRouteCsv(text);
  return text;
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

/**
 * Serializes the item assignment back to the canonical CSV
 * (`Item;Store;Section`), one row per item, in the record's own key order —
 * the file's row order carries no meaning, so the serializer keeps whatever
 * order it is given (the parsed file order, plus appended items at the end)
 * instead of sorting, which leaves hand-sorted spreadsheets untouched. The
 * output round-trips through parseShoppingAssignmentsCsv; it ends with a
 * newline and uses LF line endings.
 *
 * The `route` argument is the cross-file reference the text is validated
 * against, exactly as on the parse side, so a serializer call can never emit a
 * row that the next load would reject. Cells are written verbatim (no quoting,
 * see csv.ts): a caller writing to Drive must parse the produced text first, as
 * the route serializer documents.
 */
export function serializeShoppingAssignmentsCsv(
  assignments: ShoppingAssignments,
  route: ShoppingRoute,
): string {
  const lines = [ASSIGNMENTS_HEADER];
  for (const [item, stop] of Object.entries(assignments)) {
    lines.push(`${item};${stop.store};${stop.section}`);
  }
  const text = `${lines.join('\n')}\n`;
  // Round trip through the parser: the serializer must never produce text that
  // the loader would reject (docs/storage_format.md §10).
  parseShoppingAssignmentsCsv(text, route);
  return text;
}
