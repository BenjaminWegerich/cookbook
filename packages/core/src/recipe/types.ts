/**
 * Recipe model and validation error types for the canonical Markdown + YAML
 * format (docs/storage_format.md).
 *
 * The logical model is defined in docs/recipe_structure.md; this module is the
 * typed representation of the physical encoding: YAML front matter (metadata +
 * ingredients, §3/§4) plus Markdown body (preparation steps, §5). Parsing and
 * validation live in ./parse.ts, cross-recipe validation in ./validate.ts.
 */

/** The two recipe types (recipe_structure.md §Recipe Type); never derived. */
export type RecipeType = 'finished_dish' | 'ingredient_recipe';

/** Base units for quantities; additional units are computed at display time. */
export type Unit = 'g' | 'kg' | 'ml' | 'l';

/**
 * One ingredient entry (storage_format.md §4).
 *
 * Counted items are stored via their mass/volume equivalent (e.g. `240` `g` for
 * 6 Tortillas); the "6 Stück" display form is derived from the additional-unit
 * master data, never stored here.
 */
export interface Ingredient {
  /** German ingredient name (data language, CODING_CONVENTIONS.md). */
  name: string;
  /** Base quantity; must be a standard number (ladder value), §4. */
  quantity: number;
  /** Base unit: g / kg / ml / l, §4. */
  unit: Unit;
  /** `true` on 0–2 ingredients per finished-dish recipe (portion anchor). */
  reference?: boolean;
  /** Title of a linked sub-recipe (ingredient_recipe), §4. */
  recipe?: string;
}

/**
 * A parsed recipe (storage_format.md §3–§5).
 *
 * Which optional fields are allowed depends on `type`: `finished_dish` carries
 * `servings`; `ingredient_recipe` carries `yield` / `yield_unit` / `yield_note`.
 * `steps` come from the Markdown body (the `## Zubereitung` ordered list).
 */
export interface Recipe {
  /** Unique within the whole collection; the stable identifier (§6). */
  title: string;
  type: RecipeType;
  /** Display-only extension of the title. */
  subtitle?: string;
  /** A single paragraph; may suggest side dishes or other uses. */
  description?: string;
  /** Free-text display value, e.g. `25 min`, `1 h 30 min`; required. */
  prep_time: string;
  /** Only if it differs from `prep_time`. */
  total_time?: string;
  /** Ingredients in the order of their first use in the preparation (§4). */
  ingredients: Ingredient[];
  /** finished_dish only: integer standard number (ladder value), e.g. 6. */
  servings?: number;
  /** ingredient_recipe only: standard number in the base unit. */
  yield?: number;
  /** ingredient_recipe only: the base unit of `yield`. */
  yield_unit?: Unit;
  /** ingredient_recipe only: free text about the use. */
  yield_note?: string;
  /** Preparation steps in order, extracted from the `## Zubereitung` list. */
  steps: string[];
}

/**
 * One precise validation problem (storage_format.md §7 — errors are shown to
 * the user, never silently ignored or auto-corrected).
 */
export interface ValidationIssue {
  /** Field path, e.g. `ingredients[2].quantity`, `title` or `body`. */
  path: string;
  /** German message — user-facing, consistent with the German UI language. */
  message: string;
}

/**
 * Base class for all recipe errors; carries every issue found in one parse.
 * Consumers can render `issues` directly or use `message` for a summary.
 */
export class RecipeError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = 'RecipeError';
    this.issues = issues;
  }
}

/** Thrown by `parseRecipe()` when a single file fails validation (§7.1). */
export class RecipeParseError extends RecipeError {
  constructor(issues: readonly ValidationIssue[]) {
    super(`Rezept konnte nicht geparst werden (${issues.length} Problem(e)).`, issues);
    this.name = 'RecipeParseError';
  }
}

/** Thrown by `validateCollection()` when cross-recipe rules are violated (§7.2). */
export class RecipeCollectionError extends RecipeError {
  constructor(issues: readonly ValidationIssue[]) {
    super(`Sammlung ungültig (${issues.length} Problem(e)).`, issues);
    this.name = 'RecipeCollectionError';
  }
}
