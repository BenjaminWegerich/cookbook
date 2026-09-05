/**
 * Recipe model and validation error types for the canonical Markdown + YAML
 * format (docs/storage_format.md).
 *
 * The logical model is defined in docs/recipe_structure.md; this module is the
 * typed representation of the physical encoding: YAML front matter (metadata +
 * the `reference` name list, §3/§4) plus Markdown body (preparation steps, §5).
 * Parsing and validation live in ./parse.ts, cross-recipe validation in
 * ./validate.ts.
 */

/** The two recipe types (recipe_structure.md §Recipe Type); never derived. */
export type RecipeType = 'finished_dish' | 'ingredient_recipe';

/**
 * Base units. Canonical files and the in-memory model store quantities in the
 * family unit `g` or `ml` only; `kg` / `l` are display-only forms (formatBQ in
 * ./additionalUnits.ts). Hand-written `kg`/`l` values are accepted on read and
 * normalized to the family unit (×1000) by the parser.
 */
export type Unit = 'g' | 'kg' | 'ml' | 'l';

/**
 * One ingredient use (storage_format.md §4): a row of a step's own ingredient
 * list, or the stored form of an inline text artifact.
 *
 * Counted items are stored via their mass/volume equivalent (e.g. `250` `g` for
 * the Tortillas); display forms ("1 Becher Joghurt", "1,5 l") are derived at
 * render time and never stored here. An ingredient has no link field: when its
 * name equals the title of an `ingredient_recipe` in the collection, it *is*
 * that sub-recipe (implicit link, §4).
 */
export interface Ingredient {
  /** German ingredient name (data language, CODING_CONVENTIONS.md). */
  name: string;
  /** Base quantity in the family unit; must be a standard number (ladder value). */
  quantity: number;
  /** Stored base unit: g or ml (kg/l appear only in display), §4. */
  unit: Unit;
}

/**
 * One preparation step (storage_format.md §5): its own ingredient list plus
 * the free-prose text.
 *
 * The step rows are the source of truth for the recipe's ingredient list — the
 * master list is *derived* from the rows of all steps (./ingredientList.ts).
 * The text is prose that may contain inline display-only artifacts
 * (./artifacts.ts): `{{1500 ml Wasser}}` (ingredient mention) and `{{100 g}}`
 * (quantity mention). Artifacts scale with the serving count but are never
 * counted toward any ingredient list.
 */
export interface Step {
  /** The step's own counted ingredients, in order of use within the step. */
  ingredients: Ingredient[];
  /** The instruction prose (single line, may contain {{…}} artifacts). */
  text: string;
}

/**
 * A derived master-list entry (storage_format.md §4): the merged view of the
 * step rows of the whole recipe. `reference` is resolved from the recipe-level
 * `reference` name list and never stored on the rows themselves.
 */
export type MasterIngredient = Ingredient & { reference?: boolean };

/**
 * A parsed recipe (storage_format.md §3–§5).
 *
 * Which optional fields are allowed depends on `type`: `finished_dish` carries
 * `servings` and the `reference` list; `ingredient_recipe` carries `yield` /
 * `yield_unit`. `steps` come from the Markdown body; `ingredients` is the
 * derived master list (never typed directly, §4).
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
  /**
   * finished_dish only: names of 0–2 ingredients anchored to the portion size
   * (§4). The names must match rows of the recipe; never set per step.
   */
  reference?: string[];
  /** finished_dish only: integer standard number (ladder value), e.g. 6. */
  servings?: number;
  /** ingredient_recipe only: standard number in the base unit. */
  yield?: number;
  /** ingredient_recipe only: the base unit of `yield`. */
  yield_unit?: Unit;
  /** Preparation steps in order (own ingredient lists + prose text), §5. */
  steps: Step[];
  /** Derived master list: merged step rows, order of first use (§4). */
  ingredients: MasterIngredient[];
}

/**
 * One precise validation problem (storage_format.md §7 — errors are shown to
 * the user, never silently ignored or auto-corrected).
 */
export interface ValidationIssue {
  /** Field path, e.g. `steps[2].ingredients[0].quantity`, `reference[0]` or `body`. */
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
