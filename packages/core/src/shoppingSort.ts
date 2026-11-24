/**
 * The shopping list's identity work at read time: turning a Keep line into a
 * **name field**, resolving that field to an item of the master data, and
 * deriving the target order from the route (docs/shopping_item_identity.md,
 * docs/storage_format.md §10).
 *
 * The identity of an item is its row in the item table (einkaufs-artikel.csv),
 * not the text of a line, so resolving a line happens here and only here — no
 * master-data file is rewritten by a sort run (the one exception is a confirmed
 * suggestion, which appends a synonym row, docs/shopping_item_identity.md §4).
 *
 * 1. **Derive the name field** (`shoppingNameField`): Unicode NFC, case-folded
 *    for comparison only, whitespace collapsed, and the decoration of the app's
 *    own line shapes undone — a trailing parenthetical and a leading quantity
 *    together with one unit token. The unit vocabulary is derived (the units
 *    that some mapping flags as a shopping unit + `BASE_UNIT_TOKENS`, never a
 *    hand-kept copy), and the undoing is all-or-nothing: a line the app did not
 *    write keeps its text ("1 Bund Petersilie" stays unresolved rather than
 *    losing its "1").
 * 2. **Match the whole name field** (`matchShoppingItem`): the field must be
 *    *exactly* an item name — not merely contain it or start with it — so
 *    "Muffins mit Blaubeeren" never resolves to the item "Blaubeeren". Names are
 *    compared case-folded (`shoppingNameKey`). Items win over variants.
 * 3. **Nothing matched** → the line is unknown; `shoppingItemSuggestions` offers
 *    similar item names, and the sort page asks the user (confirming a candidate
 *    appends a synonym, so the same variant is never asked twice).
 *
 * `shoppingSortOrder` then places the lines: the chosen stops are ordered by the
 * route's walking order (stable within one stop), the lines without a selected
 * market or ignored follow in Keep's order, and the checked-off ones come last.
 * The market **rank** decides where an item is bought; the **route** decides
 * where it appears in the list.
 *
 * Everything here is pure and framework-free; it reads the runtime registries
 * (item/route/synonym) so the user's own Drive master data decides both the
 * matching and the order.
 */

import { allIngredientMappings } from './ingredientRegistry.js';
import { ADDITIONAL_UNITS, type AdditionalUnit } from './additionalUnitsData.js';
import { BASE_UNIT_TOKENS, auDisplayForms } from './additionalUnits.js';
import {
  allShoppingItems,
  allShoppingStops,
  allShoppingSynonyms,
  shoppingStopsFor,
} from './shoppingRouteRegistry.js';
import { shoppingNameKey } from './shoppingRouteCsv.js';
import type { ShoppingStop } from './shoppingRouteCsv.js';

/** One shopping-list entry as the sort flow sees it (the gateway's KeepItem shape). */
export interface ShoppingListLine {
  /** The line's text, exactly as in Keep (trimmed by the caller or here). */
  readonly text: string;
  /** True when the user ticked the item off in Keep (already bought). */
  readonly checked: boolean;
}

/** A line plus the item it names (its identity), or null when it names none. */
export interface ShoppingSortLine {
  readonly text: string;
  readonly checked: boolean;
  /** The item name the line resolved to, or null when it resolved to none. */
  readonly item: string | null;
  /**
   * Locations decided for a **new** item on the sort page (no registry row yet).
   * Absent for a known item, whose locations are read from the registry. The
   * final order derivation runs before the new rows are persisted, so the
   * decision has to travel with the line.
   */
  readonly locations?: readonly ShoppingStop[];
  /**
   * True when the user ignored the line for this run. Ignored lines are not
   * allocated to a market; they go to the end group and are asked about again
   * next time.
   */
  readonly ignored?: boolean;
}

/**
 * The quantity part of a line the app writes: digits, the German decimal comma,
 * the fraction glyphs and the mixed-number notation, joined by narrow no-break
 * spaces ("850 ", "1,15 ", "1 ¼ ", "1+1/2 "). It is deliberately generous — the
 * unit token behind it is what makes the shape the app's own.
 */
const QUANTITY_SOURCE = '[\\d.,\\u202F\\u00A0\\u00BC\\u00BD\\u00BE\\u2044\\u2150-\\u215E/+ ]+';

/** Escapes a literal for use inside a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Additional units by canonical name, for turning a mapping's unit name back
 * into its display forms.
 */
const AU_BY_NAME = new Map(ADDITIONAL_UNITS.map((unit) => [unit.name, unit]));

/**
 * The unit tokens a shopping line may carry: the additional units that at least
 * one ingredient–unit mapping flags as its **shopping unit** (a Becher, a
 * Packung, a Stück) in every display form — the canonical name plus the singular
 * and plural forms, because the app writes „2 Packungen Mehl“ — plus the
 * base-unit tokens the app writes (`BASE_UNIT_TOKENS`). Derived from the runtime
 * master data and the formatter, so the flag moving on a mapping (or a new unit
 * becoming a purchase unit) reaches the line vocabulary automatically. A unit
 * that is only ever a recipe measure is not in the vocabulary: the app never
 * writes it onto a shopping line.
 */
function shoppingLineUnits(): readonly string[] {
  const units = new Map<string, AdditionalUnit>();
  for (const entry of Object.values(allIngredientMappings())) {
    for (const mapping of entry.entries) {
      if (!mapping.shoppingUnit) continue;
      const unit = AU_BY_NAME.get(mapping.au);
      if (unit !== undefined) {
        units.set(unit.name, unit);
      }
    }
  }
  const tokens = [...units.values()].flatMap(auDisplayForms);
  // Longest first: "kg" must be tried before... its own prefix does not exist,
  // but "Stück" and a hypothetical "St" would otherwise depend on table order.
  return [...tokens, ...BASE_UNIT_TOKENS].sort((a, b) => b.length - a.length);
}

/**
 * A leading quantity together with the one unit token behind it — the leading
 * half of the app's own line decoration. The token must be followed by a space
 * or the end of the line, so a name that merely starts with a unit token
 * ("Becherhälse") is not touched.
 *
 * Built per call because the vocabulary follows the runtime master data: a
 * mapping's shopping flag can change when the user's Drive files load, and a
 * module-load regex would keep the seed's vocabulary.
 */
function decorationPattern(): RegExp {
  return new RegExp(
    `^${QUANTITY_SOURCE}(${shoppingLineUnits().map(escapeRegExp).join('|')})(?=\\s|$)`,
    'u',
  );
}

/** A trailing parenthetical, the second half of the app's own line decoration. */
const TRAILING_PARENTHETICAL = /\s*\([^()]*\)\s*$/u;

/**
 * The **name field** of a Keep line: the only part of a line that can name an
 * item (docs/shopping_item_identity.md §2). The line is normalized (Unicode NFC,
 * whitespace collapsed, trimmed) and then the app's own decoration is undone —
 * but only as a whole shape: a trailing parenthetical is dropped together with
 * the leading quantity and unit token, never on its own.
 *
 *   - "2 Becher Joghurt (800 g)" → "Joghurt"   (shopping-unit shape)
 *   - "850 g Butter"             → "Butter"    (base shape)
 *   - "1,15 kg Mehl"             → "Mehl"      (the kg display step)
 *   - "Klopapier"                → "Klopapier" (hand-written: nothing to undo)
 *   - "1 Bund Petersilie"        → "1 Bund Petersilie" (no ingredient is
 *     bought in "Bund" in the current master data, so the app never writes it
 *     and the "1" is not decoration either — the line stays unresolved and is
 *     answered by a suggestion, which is the deliberate strictness)
 *
 * The returned text keeps the spelling the user wrote (only whitespace and
 * Unicode normalization are applied); `shoppingNameKey` folds it for comparison.
 */
export function shoppingNameField(text: string): string {
  const normalized = text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const match = decorationPattern().exec(normalized);
  if (match === null) {
    return normalized;
  }
  return normalized.slice(match[0].length).replace(TRAILING_PARENTHETICAL, '').trim();
}

/**
 * The item name a line names, or null when it names no item of the master data
 * (docs/shopping_item_identity.md §2). The name field is matched as a **whole**
 * name: exactly equal to an item name (step 2) or to a variant (step 3), both
 * compared case-folded. An item name wins over a variant — a variant equal to an
 * item name is rejected at load, so the two rules can never disagree.
 *
 * `Muffins mit Blaubeeren` therefore matches nothing (it only *contains* an item
 * name), and the line is answered by a suggestion instead of a guess.
 */
export function matchShoppingItem(text: string): string | null {
  const key = shoppingNameKey(shoppingNameField(text));
  if (key === '') {
    return null;
  }
  const items = allShoppingItems();
  for (const name of Object.keys(items)) {
    if (shoppingNameKey(name) === key) {
      return name;
    }
  }
  const synonyms = allShoppingSynonyms();
  for (const [variant, item] of Object.entries(synonyms)) {
    if (shoppingNameKey(variant) === key) {
      return item;
    }
  }
  return null;
}

/**
 * The item names offered as suggestions for a line that resolved to nothing
 * (docs/shopping_item_identity.md §4): a guess, never applied automatically.
 * Candidates come from the **item names** — not from the variants, or the
 * candidate set would grow without bound — and the simple engine the user chose
 * is containment on the case-folded names, ranked in three tiers:
 *
 *   1. the item name starts with the name field ("Joghurt" → "Joghurt …"),
 *   2. the item name contains the name field somewhere ("Blaubeer" →
 *      "TK-Blaubeeren"),
 *   3. the name field contains the item name ("1 Bund Petersilie" → "Petersilie";
 *      the shape the app did not undo, and the most useful case of all).
 *
 * Within a tier the names are alphabetical (German). Ties beyond `limit` are cut
 * off — the page only ever shows a handful of chips.
 */
export function shoppingItemSuggestions(text: string, limit = 5): string[] {
  const key = shoppingNameKey(shoppingNameField(text));
  if (key === '') {
    return [];
  }
  const ranked: { name: string; rank: number }[] = [];
  for (const name of Object.keys(allShoppingItems())) {
    const itemKey = shoppingNameKey(name);
    let rank: number;
    if (itemKey.startsWith(key)) {
      rank = 0;
    } else if (itemKey.includes(key)) {
      rank = 1;
    } else if (key.includes(itemKey)) {
      rank = 2;
    } else {
      continue;
    }
    ranked.push({ name, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'de'))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.name);
}

/**
 * Classifies the shopping list: per line, the item it resolved to (or null).
 * This is what the sort flow reads to decide which lines already have master
 * data and which it must ask the user about.
 */
export function analyzeShoppingList(lines: readonly ShoppingListLine[]): ShoppingSortLine[] {
  return lines.map((line) => ({
    text: line.text,
    checked: line.checked,
    item: matchShoppingItem(line.text),
  }));
}

/** Canonical key of a stop (the pair is the key, docs/storage_format.md §10). */
function stopKey(stop: ShoppingStop): string {
  return `${stop.store}\u0000${stop.section}`;
}

/**
 * The target order of the whole list (top first): the lines assigned to a
 * selected market in the route's walking order (stable within one stop), then
 * the lines with no selected market or ignored in Keep's own order, then the
 * checked-off lines last in Keep's own order.
 *
 * `selectedMarkets` is the trip's market selection; `ranks` is the effective
 * market preference (`shoppingStoreRanks`). An item's chosen location is its
 * location at the best-ranked selected market; the stop's route index then
 * decides the position. A line with an explicit `locations` array (a new item
 * decided on the sort page, before its rows are persisted) uses that array;
 * otherwise a known item's locations come from the registry.
 */
export function shoppingSortOrder(
  lines: readonly ShoppingSortLine[],
  selectedMarkets: readonly string[],
  ranks: ReadonlyMap<string, number>,
): readonly string[] {
  const route = allShoppingStops();
  const indexByStop = new Map(route.map((stop, index) => [stopKey(stop), index]));
  const selected = new Set(selectedMarkets);

  const assigned: { text: string; index: number }[] = [];
  const noMarket: string[] = [];
  const checked: string[] = [];

  for (const line of lines) {
    if (line.checked) {
      checked.push(line.text);
      continue;
    }
    if (line.ignored === true) {
      noMarket.push(line.text);
      continue;
    }
    const locations =
      line.locations !== undefined
        ? line.locations
        : line.item !== null
          ? (shoppingStopsFor(line.item) ?? [])
          : [];
    let chosen: ShoppingStop | null = null;
    for (const stop of locations) {
      if (!selected.has(stop.store)) continue;
      if (chosen === null) {
        chosen = stop;
        continue;
      }
      const stopRank = ranks.get(stop.store) ?? Number.MAX_SAFE_INTEGER;
      const chosenRank = ranks.get(chosen.store) ?? Number.MAX_SAFE_INTEGER;
      if (stopRank < chosenRank) chosen = stop;
    }
    if (chosen === null) {
      noMarket.push(line.text);
      continue;
    }
    // A stop the route does not contain cannot happen through the app's picker;
    // a hand-edited item table is read back through the parser, which guards it.
    // It sorts after every known stop instead of throwing.
    assigned.push({ text: line.text, index: indexByStop.get(stopKey(chosen)) ?? -1 });
  }

  // Array.prototype.sort is stable, so lines within one stop keep Keep's order.
  assigned.sort((a, b) => a.index - b.index);

  return [...assigned.map((entry) => entry.text), ...noMarket, ...checked];
}
