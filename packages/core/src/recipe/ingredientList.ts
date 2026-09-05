/**
 * Ingredient merging and master-list derivation (storage_format.md §4).
 *
 * The step rows are the source of truth for the ingredient list: the master
 * list of a recipe is *derived* from the rows of all steps
 * (`deriveIngredients`), with repeated entries of the same name merged by
 * `mergeIngredientUses` — "an ingredient used in several places appears once,
 * with the total amount, at the position of its first use".
 *
 * The `reference` role is recipe-level (the front-matter name list) and is
 * resolved onto the merged entries here; rows never carry it.
 */

import { roundToRung } from '../ladder.js';
import type { Ingredient, MasterIngredient, Step } from './types.js';

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
 * Entries are grouped by exact name (trimmed). The first entry's unit is kept.
 * Entries whose quantity cannot be summed meaningfully (different base units
 * for the same name, e.g. g vs ml) are kept as separate entries instead of
 * being merged.
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
    // amounts are not comparable and stay separate.
    if (entries.every((entry) => entry.unit === first.unit)) {
      merged.push({
        name,
        quantity: roundToRung(entries.reduce((sum, entry) => sum + entry.quantity, 0)),
        unit: first.unit,
      });
    } else {
      // Mixed units: keep each entry as-is (still trimmed).
      merged.push(...entries.map((entry) => ({ ...entry, name: entry.name.trim() })));
    }
  }
  return merged;
}

/**
 * Derives the master ingredient list of a recipe from its step rows
 * (storage_format.md §4): the rows of all steps in order of first use, merged
 * by exact name with the total amount (sum rounded to the nearest ladder rung).
 *
 * The `reference` role is resolved from the recipe-level `reference` name list
 * (front matter): a merged entry is a reference entry when its name is listed.
 */
export function deriveIngredients(
  steps: readonly Step[],
  reference: readonly string[] = [],
): MasterIngredient[] {
  const entries: Ingredient[] = [];
  for (const step of steps) {
    entries.push(...step.ingredients);
  }
  const referenceNames = new Set(reference.map((name) => name.trim()));
  return mergeIngredientUses(entries).map((entry) =>
    referenceNames.has(entry.name) ? { ...entry, reference: true } : entry,
  );
}
