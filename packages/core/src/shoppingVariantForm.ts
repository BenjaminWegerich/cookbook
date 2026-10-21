/**
 * Form rules for a synonym typed on the shopping master-data screen —
 * `einkaufs-synonyme.csv` (docs/storage_format.md §10,
 * docs/shopping_item_identity.md §1/§5).
 *
 * The CSV parser rejects an invalid synonym table as a whole, which is the
 * right behaviour for a load or a write, but it is not usable as live feedback
 * while the user types: the form needs to know *which* rule a single candidate
 * breaks, and it needs the answer in German next to the field (DESIGN §5.3).
 * This module is that single check, framework-free and unit-tested, so the
 * sheet and any future surface validate a candidate identically.
 *
 * The rules are the parser's own identity rules, in the order the user meets
 * them:
 * - a synonym is mandatory and has content;
 * - a cell may not contain the CSV separators (the format has no quoting, see
 *   csv.ts) — the serializer's round-trip would fail on such a value;
 * - a synonym may not be the article's own name (case-folded);
 * - a synonym may not be another article's name, because a canonical item name
 *   must never be shadowed;
 * - a synonym may not already belong to another article;
 * - a synonym may not already be stored for this article.
 *
 * The comparison is case-folded through `shoppingNameKey`, exactly like the
 * matching itself: „möhren“ and „Möhren“ are the same candidate. The returned
 * spelling is the input trimmed, but otherwise exactly as typed — the stored
 * data keeps the user's spelling (only the key is folded).
 */

import { shoppingNameKey } from './shoppingRouteCsv.js';
import type { ShoppingItems, ShoppingSynonyms } from './shoppingRouteCsv.js';

/**
 * The outcome of checking one typed synonym: either the value to store (trimmed)
 * or the German message the field shows under its input.
 */
export type ShoppingVariantCheck =
  | { readonly ok: true; readonly variant: string }
  | { readonly ok: false; readonly message: string };

/**
 * Checks one candidate synonym for one article.
 *
 * The `items` and `synonyms` arguments are the *draft* tables the candidate
 * would be written into — not necessarily the registry's current tables. The
 * sheet passes its own edited synonym list, so removing a stored synonym and
 * adding it again is not rejected by the row it is about to replace. The
 * article's own name is passed separately because the sheet edits one article
 * that is (and stays) part of `items`.
 *
 * @param input the raw text of the synonym field
 * @param item the canonical name of the article the synonym will name
 * @param items the item table the candidate must not shadow
 * @param synonyms the synonym table the candidate must not duplicate
 */
export function validateShoppingVariant(
  input: string,
  item: string,
  items: ShoppingItems,
  synonyms: ShoppingSynonyms,
): ShoppingVariantCheck {
  const variant = input.trim();
  if (variant === '') {
    return { ok: false, message: 'Bitte ein Synonym eingeben.' };
  }
  // The master-data format has no quoting: a semicolon or a line break would
  // split the row on the next load. Reject it here with a message the user can
  // act on, instead of failing the whole save in the serializer.
  if (/[;\r\n]/u.test(variant)) {
    return {
      ok: false,
      message: 'Ein Synonym darf kein Semikolon und keinen Zeilenumbruch enthalten.',
    };
  }

  const key = shoppingNameKey(variant);
  if (key === shoppingNameKey(item)) {
    return { ok: false, message: 'Das Synonym muss sich vom Artikelnamen unterscheiden.' };
  }

  // An article name may never be shadowed by a synonym — the same rule the
  // parser enforces at load, applied to the one candidate (case-folded).
  for (const name of Object.keys(items)) {
    if (shoppingNameKey(name) === key) {
      return { ok: false, message: `„${name}“ ist bereits ein Artikel.` };
    }
  }

  // A variant names exactly one article. Re-adding a stored synonym of the
  // same article is a duplicate (the sheet shows it already), while a synonym
  // of another article is a conflict the user has to resolve there.
  for (const [existing, owner] of Object.entries(synonyms)) {
    if (shoppingNameKey(existing) !== key) continue;
    if (owner === item) {
      return { ok: false, message: `„${existing}“ ist für diesen Artikel schon hinterlegt.` };
    }
    return { ok: false, message: `„${existing}“ ist bereits ein Synonym für „${owner}“.` };
  }

  return { ok: true, variant };
}
