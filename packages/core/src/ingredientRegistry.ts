/**
 * Runtime ingredient registry — the single source of truth for ingredient
 * mappings while the app runs.
 *
 * The built-in mappings (INGREDIENT_MAPPINGS, generated from
 * docs/ingredient_unit_mappings.csv) are the default seed. The web app loads
 * the user's authoritative master data (zutaten-stammdaten.csv in the Drive
 * Cookbook folder) at startup and replaces the whole set with
 * setIngredientMappings — the Drive file wins once it exists. Until then, and
 * whenever the file is missing or unreadable, the built-in seed keeps the app
 * fully functional (autofill, scaling, export).
 *
 * The registry is module-level state on purpose: the recipe editor's
 * autofill, the quantity display and the HTML export generator (all in the
 * same page session) read through it, so a loaded master data set is visible
 * everywhere. Unit tests use resetIngredientMappings() to restore the seed.
 */

import { INGREDIENT_MAPPINGS, type IngredientMapping } from './additionalUnitsData.js';

/** All ingredient mappings keyed by ingredient name (lists sorted by ascending priority). */
export type IngredientMappings = Readonly<Record<string, readonly IngredientMapping[]>>;

/** The current registry content; starts as the built-in seed. */
let registry: IngredientMappings = INGREDIENT_MAPPINGS;

/**
 * Replaces the whole registry (used by the web app when the user's Drive
 * master data is loaded — the Drive file is authoritative once it exists).
 */
export function setIngredientMappings(mappings: IngredientMappings): void {
  registry = mappings;
}

/**
 * The current registry content — the seed plus anything loaded from Drive.
 * Read-only: callers must never mutate the returned object (the registry
 * treats it as immutable).
 */
export function allIngredientMappings(): IngredientMappings {
  return registry;
}

/** The mappings of one ingredient, or undefined when the name is not registered. */
export function mappingsFor(name: string): readonly IngredientMapping[] | undefined {
  return registry[name];
}

/** Restores the built-in seed (used by tests between cases). */
export function resetIngredientMappings(): void {
  registry = INGREDIENT_MAPPINGS;
}
