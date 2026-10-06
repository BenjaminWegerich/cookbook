/**
 * The shopping list's aisle sort: matching a Keep line back to an item name and
 * deriving the target order from the shopping-route master data.
 *
 * The route (docs/storage_format.md §10) orders stops — level 1 the store, level
 * 2 the section — and the assignment maps an item name to exactly one stop. The
 * sort therefore needs two things this module provides:
 *
 * 1. **Matching a line to an item name.** A Keep line is the app's own display
 *    form ("2 Becher Joghurt (800 g)", "850 g Butter") or a hand-typed line
 *    ("Klopapier"). `matchShoppingItem` decides whether the line already names an
 *    assigned item: the assignment's item names are searched for a **whole-word
 *    occurrence** (case-sensitive, like the assignment itself), and the longest
 *    match wins. A line that names no assigned item has no place in the route yet.
 * 2. **Ordering the lines.** `shoppingSortOrder` turns the list into the target
 *    order the gateway applies: lines the user *ignored* first (in Keep's own
 *    order), then the assigned lines in walking order (stable within one stop),
 *    then the checked-off lines (already bought) last in Keep's own order.
 *
 * The name the sort *persists* for a line that had no assignment is
 * `shoppingItemName`: first a whole-word match against the ingredient master
 * data (a recipe ingredient the app wrote knows its name there), then a
 * decoration-stripping fallback that reverses the app's two line shapes. The
 * app shows that name to the user before it writes a new assignment row.
 *
 * Everything here is pure and framework-free; it reads the runtime registries
 * (ingredient + shopping-route) so the user's own Drive master data is what
 * decides both the matching and the order.
 */

import { masterIngredientNames } from './additionalUnits.js';
import { allShoppingAssignments, allShoppingStops, shoppingStopFor } from './shoppingRouteRegistry.js';
import type { ShoppingStop } from './shoppingRouteCsv.js';

/** One shopping-list entry as the sort flow sees it (the gateway's KeepItem shape). */
export interface ShoppingListLine {
  /** The line's text, exactly as in Keep (trimmed by the caller or here). */
  readonly text: string;
  /** True when the user ticked the item off in Keep (already bought). */
  readonly checked: boolean;
}

/** A line plus what the shopping-route assignment knows about it. */
export interface ShoppingSortLine {
  readonly text: string;
  readonly checked: boolean;
  /** The assignment item name the line matched, or null when it has none. */
  readonly item: string | null;
}

/** How an unmatched line is resolved by the sort flow: a chosen stop or "ignore". */
export type UnmatchedResolution = ShoppingStop | 'ignore';

/** A character that keeps a name together as one word (letters, digits, hyphen). */
const WORD_CHAR = /[\p{L}\p{N}-]/u;

/** True when `name` occurs in `text` as a whole word (case-sensitive). */
function containsWholeWord(text: string, name: string): boolean {
  if (name === '') return false;
  let from = 0;
  for (;;) {
    const index = text.indexOf(name, from);
    if (index === -1) return false;
    const before = index === 0 ? false : WORD_CHAR.test(text[index - 1]!);
    const after = index + name.length;
    const afterIsWord = after >= text.length ? false : WORD_CHAR.test(text[after]!);
    if (!before && !afterIsWord) return true;
    from = index + 1;
  }
}

/**
 * The longest `names` entry that occurs in `text` as a whole word, or null when
 * none does — or when two distinct names of equal length both do (ambiguous:
 * the caller must not guess which one the line means).
 */
function longestWholeWordMatch(text: string, names: readonly string[]): string | null {
  let best: string | null = null;
  for (const name of names) {
    if (!containsWholeWord(text, name)) continue;
    if (best === null || name.length > best.length) {
      best = name;
    } else if (name.length === best.length && name !== best) {
      return null;
    }
  }
  return best;
}

/**
 * The assignment item name a line names, or null when the line names no assigned
 * item (it has no place in the route — docs/storage_format.md §10). Matching is
 * whole-word and case-sensitive, exactly like the assignment itself; where two
 * names overlap ("Sahne" inside "Schlagsahne", "Blaubeeren" inside
 * "TK-Blaubeeren") the word boundary keeps them apart, and the longest name wins
 * when several match ("TK-Blaubeeren" before "Blaubeeren").
 */
export function matchShoppingItem(text: string): string | null {
  return longestWholeWordMatch(text, Object.keys(allShoppingAssignments()));
}

/**
 * Reverses the app's own shopping-line decoration to recover the item name, or
 * returns the line unchanged when there is none to strip. The two shapes the app
 * writes (see ../shoppingList):
 *
 *   - "2 Becher Joghurt (800 g)" — a whole count of a shopping unit, the amount
 *     in parentheses; and
 *   - "850 g Butter" — the base form, amount + unit + name.
 *
 * A trailing parenthetical is dropped first, then a leading quantity and its
 * unit token (a base unit or one of the additional units the app writes). The
 * quantity spans digits, the German decimal comma and the fraction glyphs joined
 * by a narrow no-break space. Hand-written lines without that shape ("Klopapier",
 * "Wandfarbe") keep their text.
 */
function stripShoppingDecoration(text: string): string {
  let result = text.trim();
  result = result.replace(/\s*\([^()]*\)\s*$/, '');
  const quantity = /^[\d.,\u202F\u00A0\u00BC\u00BD\u00BE\u2044\u2150-\u215E\/+ ]+/u;
  const lead = result.match(quantity);
  if (lead !== null && lead[0].length > 0) {
    result = result.slice(lead[0].length);
    // One unit token directly after the quantity (never part of the name: the
    // token must be followed by a space or the end of the line).
    result = result.replace(/^(?:g|kg|ml|l|Becher|EL|TL|Packung|Stück)(?=\s|$)/u, '');
  }
  return result.trim();
}

/**
 * The item name to persist for a line that has no assignment: first the longest
 * whole-word match against the ingredient master data (the app knows a recipe
 * ingredient's name there), else the decoration-stripping fallback.
 */
export function shoppingItemName(text: string): string {
  const known = longestWholeWordMatch(text, masterIngredientNames());
  return known ?? stripShoppingDecoration(text);
}

/**
 * Classifies the shopping list: per line, the assignment item it names (or null).
 * This is what the sort flow reads to decide which lines already have master
 * data and which it must ask the user about.
 */
export function analyzeShoppingList(lines: readonly ShoppingListLine[]): ShoppingSortLine[] {
  return lines.map((line) => ({ text: line.text, checked: line.checked, item: matchShoppingItem(line.text) }));
}

/** Canonical key of a stop (the pair is the key, docs/storage_format.md §10). */
function stopKey(stop: ShoppingStop): string {
  return `${stop.store}\u0000${stop.section}`;
}

/**
 * The target order of the whole list (top first): ignored lines first in Keep's
 * own order, then assigned lines in walking order (stable within one stop), then
 * checked-off lines last in Keep's own order. `resolveUnmatched` answers only
 * for lines whose item is null: a chosen stop, or 'ignore' (placed at the top).
 */
export function shoppingSortOrder(
  lines: readonly ShoppingSortLine[],
  resolveUnmatched: (text: string) => UnmatchedResolution,
): readonly string[] {
  const route = allShoppingStops();
  const indexByStop = new Map(route.map((stop, index) => [stopKey(stop), index]));

  const ignored: string[] = [];
  const assigned: { text: string; index: number }[] = [];
  const checked: string[] = [];

  for (const line of lines) {
    if (line.checked) {
      checked.push(line.text);
      continue;
    }
    let stop: ShoppingStop | undefined =
      line.item !== null ? shoppingStopFor(line.item) : undefined;
    if (stop === undefined) {
      const decision = resolveUnmatched(line.text);
      if (decision === 'ignore') {
        ignored.push(line.text);
        continue;
      }
      stop = decision;
    }
    // A stop the route does not contain (cannot happen through the app's picker,
    // but a hand-edited assignment is read back through the parser, which guards
    // it) sorts after every known stop instead of throwing.
    assigned.push({ text: line.text, index: indexByStop.get(stopKey(stop)) ?? -1 });
  }

  // Array.prototype.sort is stable, so lines within one stop keep Keep's order.
  assigned.sort((a, b) => a.index - b.index);

  return [...ignored, ...assigned.map((entry) => entry.text), ...checked];
}
