/**
 * Ingredient merging for the marker model (storage_format.md §4).
 *
 * The ingredient list of a recipe is *derived* from the step markers
 * (markers.ts): `deriveIngredients` collects the markers and then merges
 * repeated entries of the same name with `mergeIngredientUses` — "an
 * ingredient used in several places appears once, with the total amount".
 */

import { roundToRung } from '../ladder.js';
import type { Ingredient } from './types.js';

/**
 * Merges repeated entries of the same ingredient name into one entry with the
 * summed quantity (storage_format.md §4: "an ingredient used in several places
 * appears once, with the total amount").
 *
 * The sum of two ladder values is not necessarily a ladder value itself
 * (400 + 750 = 1150), so the sum is rounded to the nearest ladder rung
 * (`roundToRung`) — non-standard numbers do not exist in the app
 * (docs/quantity_scaling.md §3).
 *
 * Entries are grouped by exact name (trimmed). The first entry's unit is kept;
 * `reference` is kept when any entry sets it; the `recipe` link is taken from
 * the first entry that has one. Entries whose quantity cannot be summed
 * meaningfully (different base units for the same name) are kept as separate
 * entries instead of being merged.
 */
export function mergeIngredientUses(ingredients: readonly Ingredient[]): Ingredient[] {
  const byName = new Map<string, Ingredient[]>();
  for (const ingredient of ingredients) {
    const name = ingredient.name.trim();
    const list = byName.get(name);
    if (list === undefined) {
      byName.set(name, [ingredient]);
    } else {
      list.push(ingredient);
    }
  }

  const merged: Ingredient[] = [];
  for (const [name, entries] of byName) {
    // A group always has at least one entry (it was created by a push above).
    const first = entries[0]!;
    // Only sum when every entry shares the first entry's unit — otherwise the
    // amounts are not comparable (e.g. 200 g + 0.2 kg) and stay separate.
    if (entries.every((entry) => entry.unit === first.unit)) {
      merged.push({
        name,
        quantity: roundToRung(entries.reduce((sum, entry) => sum + entry.quantity, 0)),
        unit: first.unit,
        ...(entries.some((entry) => entry.reference === true) ? { reference: true } : {}),
        ...(entries.find((entry) => entry.recipe !== undefined)?.recipe !== undefined
          ? { recipe: entries.find((entry) => entry.recipe !== undefined)!.recipe }
          : {}),
      });
    } else {
      // Mixed units: keep each entry as-is (still trimmed).
      merged.push(...entries.map((entry) => ({ ...entry, name: entry.name.trim() })));
    }
  }
  return merged;
}
