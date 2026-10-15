/**
 * CSV codecs for the shopping master data — the canonical format of the repo
 * seeds (docs/shopping_route.csv + docs/shopping_items.csv +
 * docs/shopping_synonyms.csv), used at runtime for the user's authoritative
 * master data in the Drive Cookbook folder (einkaufsweg.csv +
 * einkaufs-artikel.csv + einkaufs-synonyme.csv).
 *
 * This module owns the formats and the identity rules of the three tables and
 * nothing else: the data structures plus their parse/serialize pairs. It
 * deliberately does not sort a shopping list and does not touch a file system —
 * the derived order and the Drive files belong to the steps that use this
 * format (docs/storage_format.md §10, docs/shopping_item_identity.md).
 *
 * Three files, three responsibilities:
 * - the **route** (`Store;Section`, one row per stop): the row order IS the
 *   route — the order the shops are visited and the sections are walked. There
 *   is no separate store order and no global section vocabulary: a section
 *   belongs to exactly one store, and the same section name may exist in
 *   several stores (the pair is the key);
 * - the **items** (`Item;Store;Section`, one row per item): the identity of
 *   everything that can be bought, and the **single place a route is kept**.
 *   Its name set is a **superset of the ingredient list**: it carries recipe
 *   ingredients and items that are not ingredients at all („Klopapier“,
 *   „Seife“, „Blumen“), which have no base unit and no reorder point and
 *   therefore cannot live in the ingredient master data. An item without a row
 *   here is not an error — it is simply never bought. The row order of this
 *   file carries no meaning — a spreadsheet may sort it freely;
 * - the **synonyms** (`Variant;Item`, one row per variant): the meaning, not a
 *   route. „Möhren“ resolves to the item „Karotten“; the variant carries no
 *   stop of its own. Rows are data, not code — visible, editable and correctable
 *   in the spreadsheet.
 *
 * Identity rule of the two name tables (docs/shopping_item_identity.md §2/§5):
 * names are compared **case-folded** (see shoppingNameKey), so „möhren“ and
 * „Möhren“ are the same name. Two items that differ only in case would make a
 * line ambiguous, and a variant equal to an item name would shadow the canonical
 * name — both are rejected here, loudly, like every other master-data mistake.
 *
 * All three files follow the common CSV rules of csv.ts (one header row,
 * semicolons, CRLF and one trailing empty cell tolerated, leading BOM stripped).
 * Like the ingredient master data they are user data: the repo CSVs are the seed
 * used on first run, the Drive files are authoritative once they exist.
 *
 * What is deliberately NOT in this data: how a Keep line is matched to an item
 * name (that is read-time work, see shoppingSort.ts), where unassigned items are
 * placed (the fallback is the sort's decision), and Keep's sort ids.
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
 * The item table: the identity of everything buyable, keyed by item name, with
 * the route of each item. The name set is a superset of the ingredient list
 * (see the module comment); an item without an entry simply has no place in the
 * route. The record's key order carries no meaning.
 */
export type ShoppingItems = Readonly<Record<string, ShoppingStop>>;

/**
 * The synonym table: variant text → item name. A variant resolves to exactly
 * one item and carries no route of its own; the item's row in `ShoppingItems`
 * holds the stop. The record's key order carries no meaning.
 */
export type ShoppingSynonyms = Readonly<Record<string, string>>;

/** Exact header of the shopping-route CSV. */
const ROUTE_HEADER = 'Store;Section';

/** Exact header of the item CSV. */
const ITEMS_HEADER = 'Item;Store;Section';

/** Exact header of the synonym CSV. */
const SYNONYMS_HEADER = 'Variant;Item';

/**
 * Canonical key of a stop: store and section are one unit, so the same section
 * name in two stores stays two distinct stops (and a duplicate within one store
 * is detectable). The separator can never occur in a CSV cell.
 */
function stopKey(stop: ShoppingStop): string {
  return `${stop.store}\u0000${stop.section}`;
}

/**
 * The comparison key of a name (item name, variant or a line's name field):
 * Unicode NFC, case-folded, inner whitespace collapsed to single spaces, trimmed
 * (docs/shopping_item_identity.md §2/§3).
 *
 * Case folding is the silent, deterministic rule of §3: `toLowerCase` plus the
 * one German special case that `toLowerCase` misses — „ß“ folds to „ss“, so
 * „Weiße Bohnen“ and „WEISSE BOHNEN“ are the same name. The comparison never
 * changes what is stored: a variant keeps the spelling the user typed, only the
 * key is folded.
 */
export function shoppingNameKey(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/\u00DF/gu, 'ss')
    .replace(/\s+/gu, ' ')
    .trim();
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
 * Parses the item CSV (`Item;Store;Section`) into name → stop — the identity of
 * everything buyable. The `route` is the cross-file reference this validation is
 * about: every stop an item names must exist in the route — a typo fails loudly
 * at load, like a mapping for an unknown ingredient in the ingredient master
 * data. The item name itself is deliberately NOT checked against the ingredient
 * list: the name set is a superset of it (see the module comment), which is
 * exactly why an item row is the identity and an ingredient row is only a view
 * (docs/shopping_item_identity.md §1).
 *
 * Throws on malformed input (empty file, unexpected header, wrong column count,
 * an empty cell, a duplicated name — case-folded, an unknown stop); the returned
 * record preserves the file order, which carries no meaning.
 */
export function parseShoppingItemsCsv(text: string, route: ShoppingRoute): ShoppingItems {
  const { rows } = parseCsvRows(text, [ITEMS_HEADER]);
  const knownStops = new Set(route.map(stopKey));
  const items: Record<string, ShoppingStop> = {};
  /** Folded name → the name that claimed it, to reject case-only duplicates. */
  const claimed = new Map<string, string>();
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
        `Einkaufsartikel: leerer Artikel, Store oder Section in Zeile "${row.join(';')}".`,
      );
    }
    if (items[item] !== undefined) {
      throw new Error(`Einkaufsartikel: doppelter Artikel "${item}".`);
    }
    // Case-folded uniqueness: two rows that fold to the same key would make
    // every line that names one of them ambiguous (see shoppingNameKey).
    const key = shoppingNameKey(item);
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(
        `Einkaufsartikel: "${item}" und "${clash}" unterscheiden sich nur in Groß-/Kleinschreibung.`,
      );
    }
    const stop: ShoppingStop = { store, section };
    if (!knownStops.has(stopKey(stop))) {
      throw new Error(
        `Einkaufsartikel: Einkaufsort "${store}; ${section}" für "${item}" steht nicht im Einkaufsweg.`,
      );
    }
    claimed.set(key, item);
    items[item] = stop;
  }
  return items;
}

/**
 * Serializes the item table back to the canonical CSV (`Item;Store;Section`),
 * one row per item, in the record's own key order — the file's row order carries
 * no meaning, so the serializer keeps whatever order it is given (the parsed
 * file order, plus appended items at the end) instead of sorting, which leaves
 * hand-sorted spreadsheets untouched. The output round-trips through
 * parseShoppingItemsCsv; it ends with a newline and uses LF line endings.
 *
 * The `route` argument is the cross-file reference the text is validated
 * against, exactly as on the parse side, so a serializer call can never emit a
 * row that the next load would reject. Cells are written verbatim (no quoting,
 * see csv.ts): a caller writing to Drive must parse the produced text first, as
 * the route serializer documents.
 */
export function serializeShoppingItemsCsv(
  items: ShoppingItems,
  route: ShoppingRoute,
): string {
  const lines = [ITEMS_HEADER];
  for (const [item, stop] of Object.entries(items)) {
    lines.push(`${item};${stop.store};${stop.section}`);
  }
  const text = `${lines.join('\n')}\n`;
  // Round trip through the parser: the serializer must never produce text that
  // the loader would reject (docs/storage_format.md §10).
  parseShoppingItemsCsv(text, route);
  return text;
}

/**
 * Parses the synonym CSV (`Variant;Item`) into variant → item name. The `items`
 * table is the cross-file reference: every item a variant names must exist, and
 * a variant equal to an item name is rejected — a canonical item name must never
 * be shadowed by a synonym (docs/shopping_item_identity.md §5). Comparison is
 * case-folded like the matching itself, so „möhren“ cannot shadow „Möhren“.
 *
 * Throws on malformed input (empty file, unexpected header, wrong column count,
 * an empty cell, an unknown item, a shadowed item name, a duplicated variant —
 * case-folded); the returned record preserves the file order, which carries no
 * meaning.
 */
export function parseShoppingSynonymsCsv(
  text: string,
  items: ShoppingItems,
): ShoppingSynonyms {
  const { rows } = parseCsvRows(text, [SYNONYMS_HEADER]);
  const itemKeys = new Set(Object.keys(items).map(shoppingNameKey));
  const synonyms: Record<string, string> = {};
  /** Folded variant → the variant that claimed it, to reject case-only duplicates. */
  const claimed = new Map<string, string>();
  for (const row of rows) {
    const [variant, item] = row;
    if (variant === undefined || variant === '' || item === undefined || item === '') {
      throw new Error(
        `Einkaufs-Synonyme: leerer Variant oder Item in Zeile "${row.join(';')}".`,
      );
    }
    if (items[item] === undefined) {
      throw new Error(
        `Einkaufs-Synonyme: Item "${item}" für Variant "${variant}" steht nicht in den Einkaufsartikeln.`,
      );
    }
    const key = shoppingNameKey(variant);
    if (itemKeys.has(key)) {
      throw new Error(
        `Einkaufs-Synonyme: Variant "${variant}" ist bereits ein Artikelname und darf ihn nicht verdecken.`,
      );
    }
    const clash = claimed.get(key);
    if (clash !== undefined) {
      throw new Error(
        `Einkaufs-Synonyme: "${variant}" und "${clash}" unterscheiden sich nur in Groß-/Kleinschreibung.`,
      );
    }
    claimed.set(key, variant);
    synonyms[variant] = item;
  }
  return synonyms;
}

/**
 * Serializes the synonym table back to the canonical CSV (`Variant;Item`), one
 * row per variant, in the record's own key order — the row order carries no
 * meaning, so a hand-sorted spreadsheet survives a write unchanged. The output
 * round-trips through parseShoppingSynonymsCsv (the `items` argument is the
 * same cross-file reference as on the parse side); it ends with a newline and
 * uses LF line endings.
 */
export function serializeShoppingSynonymsCsv(
  synonyms: ShoppingSynonyms,
  items: ShoppingItems,
): string {
  const lines = [SYNONYMS_HEADER];
  for (const [variant, item] of Object.entries(synonyms)) {
    lines.push(`${variant};${item}`);
  }
  const text = `${lines.join('\n')}\n`;
  // Round trip through the parser: the serializer must never produce text that
  // the loader would reject (docs/storage_format.md §10).
  parseShoppingSynonymsCsv(text, items);
  return text;
}
