/**
 * The multi-level sub-recipe plan of a shopping bundle.
 *
 * A sub-recipe link (docs/recipe_structure.md, "The link means …") turns a
 * parent's ingredient use into a *cooking decision* instead of a purchase: the
 * app decides how much of the sub-recipe is cooked, and only *its* ingredients
 * — which may again be sub-recipes — reach the next level down. This module
 * resolves that whole graph in one pass and answers the two questions the
 * shopping flow asks, in the order the flow asks them:
 *
 * 1. **Which sub-recipes have to be cooked, and how much?** The rows of the
 *    first pantry step ("Vorräte auswählen, Teil 1: Zutaten-Rezepte"), in
 *    topological order — a sub-recipe always stands behind every sub-recipe
 *    that uses it, so its required amount can never be read before it is known.
 * 2. **What does the bottom level need?** The ingredient uses of the selected
 *    dishes *plus* the ones of every cooked sub-recipe. That is the second step
 *    ("Vorräte auswählen, Teil 2: Zutaten"), the only step that buys anything.
 *
 * The arithmetic, per sub-recipe X:
 *
 * ```
 *   required(X) = Σ over every parent P of  scale(amount of X in P, Δx_P)
 *   stock(X)    = min(required(X), reorder point(X))   // prefill, user-editable
 *   cook(X)     = rung(required(X) − stock(X))         // 0 when covered
 *   Δx_X        = pos(cook(X)) − pos(yield(X))
 * ```
 *
 * `required` is an exact sum over parents and therefore not necessarily a rung
 * (exactly like a dish's need in ./shoppingList); `cook` is a stored, scaled
 * recipe size and therefore must be a rung (docs/quantity_scaling.md §3) — the
 * same restriction the HTML export needs to open the sub-recipe at the amount
 * that was cooked (§6). The nearest rung wins, ties toward the larger value
 * (`roundToRung`), so a need of 320 g cooks 300 g: that difference is inherent
 * to the ladder and is neither bought nor cooked.
 *
 * **`cook` is derived, `stock` is chosen.** The user's input is the shelf, not
 * the pot: a tap on a stock chip stores a stock, and a typed cooking amount is
 * back-computed to a stock (`required − cook`) before it reaches this module.
 * That keeps one number per row editable and the plan reproducible from the
 * decisions alone — `decisions` is a stock per sub-recipe title, and everything
 * else is derived from it on every render.
 *
 * The graph is walked as a DAG: the links are acyclic by contract
 * (docs/storage_format.md §7.2 — a cycle would recurse forever), and a cycle
 * found here is reported as an error instead of hanging the shopping sheet.
 * Only `ingredient_recipe` titles are links (./recipe/rename.ts); a name that
 * matches a finished dish or no recipe at all stays an ordinary ingredient and
 * reaches the bottom level unchanged.
 *
 * Everything here is pure and framework-free: the web app loads the recipes and
 * supplies the selected dishes' ingredient lists already scaled to the size the
 * plan cooks them at (./shoppingList `scaledIngredientsForPlan`), because
 * reading the recipe files is its job, not the core's.
 */

import { mappingsFor } from './ingredientRegistry.js';
import { difference, roundToRung, scale } from './ladder.js';
import { familyUnitOf, toFamilyUnit, type FamilyUnit } from './shoppingList.js';
import type { Ingredient, Recipe } from './recipe/types.js';

/**
 * One sub-recipe of the plan: what its parents require, what is on the shelf
 * and what is therefore cooked.
 *
 * `required`, `stock` and `cook` are all in `baseUnit` (g or ml) — the family
 * unit of the recipe's yield, which every parent's use of it must share.
 */
export interface SubRecipeNode {
  /** The recipe's title — the sub-recipe's identity in the collection. */
  readonly name: string;
  /** Family base unit of `yieldAmount`, `required`, `stock` and `cook`. */
  readonly baseUnit: FamilyUnit;
  /** The recipe's written yield, converted into `baseUnit` (a ladder value). */
  readonly yieldAmount: number;
  /**
   * The amount every parent requires together, as the exact sum of their
   * scaled uses — not rounded to a rung (see the file header).
   */
  readonly required: number;
  /**
   * The reorder point from the ingredient master data (docs/storage_format.md
   * §9), 0 when the title is not registered or is registered in another family
   * unit. It is the shelf level this sub-recipe is expected to start from.
   */
  readonly reorderPoint: number;
  /** The stock the row starts on: `min(required, reorderPoint)`. */
  readonly defaultStock: number;
  /** The chosen stock (≥ 0); `defaultStock` when the user decided nothing. */
  readonly stock: number;
  /**
   * The amount to cook: `roundToRung(required − stock)`, or 0 when the stock
   * covers the requirement. Always a ladder rung — see the file header.
   */
  readonly cook: number;
}

/** The resolved plan of one shopping bundle (see the file header). */
export interface SubRecipePlan {
  /**
   * The sub-recipes of the bundle, in topological order: every sub-recipe
   * stands behind all of the sub-recipes that use it, so `required` is complete
   * when the row is read and a change can only ever cascade downwards.
   */
  readonly nodes: readonly SubRecipeNode[];
  /**
   * The bottom-level ingredient uses of the whole bundle: the selected dishes'
   * own uses plus those of every cooked sub-recipe, in order of first use. Not
   * merged yet — ./shoppingList `sumIngredientUses` is the merge the sheet uses,
   * so the two levels share one bundling rule.
   */
  readonly bottomUses: readonly Ingredient[];
}

/** Rounds a quantity to thousandths, removing the float noise of a summed need. */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The family base unit and amount of an ingredient recipe's yield. */
function yieldOf(recipe: Recipe): { baseUnit: FamilyUnit; amount: number } {
  const amount = recipe.yield;
  const unit = recipe.yield_unit;
  if (amount === undefined || unit === undefined) {
    // Unreachable for a validated collection: an ingredient recipe must state
    // its yield (docs/recipe_structure.md, "Servings"). A hand-edited file that
    // does not cannot be scaled, and guessing a yield would silently produce a
    // wrong shopping list.
    throw new Error(`planSubRecipes: "${recipe.title}" states no yield`);
  }
  // The same conversion the ingredient uses take (./shoppingList), so a yield
  // written in kg / l lands in the same family unit as the uses of it.
  const use = toFamilyUnit({ name: recipe.title, quantity: amount, unit });
  return { baseUnit: familyUnitOf(use), amount: use.quantity };
}

/**
 * Scales one ingredient list by `deltaX` rungs. Quantities are converted into
 * their family base unit first, exactly like `scaledIngredientsForPlan`; a
 * quantity the ladder cannot scale (a hand-written, off-ladder file) stays
 * unscaled instead of failing the whole bundle — the same tolerance the dish
 * level shows.
 */
function scaleList(ingredients: readonly Ingredient[], deltaX: number): Ingredient[] {
  return ingredients.map((raw) => {
    const use = toFamilyUnit(raw);
    if (deltaX === 0) {
      return use;
    }
    try {
      return { ...use, quantity: scale(use.quantity, deltaX) };
    } catch {
      return use;
    }
  });
}

/**
 * The sub-recipe plan of a shopping bundle (see the file header).
 *
 * @param dishes the selected dishes' ingredient lists, each already scaled to
 *   the size the plan cooks it at (./shoppingList `scaledIngredientsForPlan`)
 * @param recipesByTitle the recipes of every sub-recipe that can be reached
 *   from those dishes, keyed by title. A title that is absent — or present as a
 *   finished dish — is not a link and stays a bottom-level ingredient.
 * @param decisions the chosen stock per sub-recipe title, in the family base
 *   unit. A title the user decided nothing for keeps its `defaultStock`; the
 *   values are never written back to the master data.
 * @throws {Error} when a sub-recipe states no yield, when a parent uses one in
 *   another family unit (g against ml), or when the links form a cycle
 */
export function planSubRecipes(
  dishes: readonly (readonly Ingredient[])[],
  recipesByTitle: ReadonlyMap<string, Recipe>,
  decisions: ReadonlyMap<string, number> = new Map(),
): SubRecipePlan {
  /** The sub-recipe behind a name, or undefined when the name is no link. */
  const recipeFor = (name: string): Recipe | undefined => {
    const recipe = recipesByTitle.get(name);
    return recipe !== undefined && recipe.type === 'ingredient_recipe' ? recipe : undefined;
  };

  // ── Discovery ─────────────────────────────────────────────────────────────
  // Every sub-recipe reachable from the dishes, plus the parent → child edges
  // that decide the topological order. `order` is the first-appearance order:
  // it is both the worklist of the walk below (it grows while it is iterated)
  // and the tie-break that keeps the topological order stable and intuitive —
  // two sub-recipes that could stand in either order keep the order in which
  // the recipes name them.
  const recipes = new Map<string, Recipe>();
  const order: string[] = [];
  const children = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  /** Registers a sub-recipe (idempotent); false when the name is no link. */
  const register = (name: string): boolean => {
    if (recipeFor(name) === undefined) {
      return false;
    }
    if (!recipes.has(name)) {
      recipes.set(name, recipeFor(name)!);
      order.push(name);
      children.set(name, new Set());
      indegree.set(name, 0);
    }
    return true;
  };

  /**
   * Scans one ingredient list for sub-recipe uses. `owner` is the sub-recipe
   * that list belongs to, or null for a top-level dish: only a sub-recipe's own
   * list creates an edge, because a dish is always cooked and never has to wait
   * for anything. The list itself need not be scaled here — scaling never
   * changes a name, and this pass only collects names.
   */
  const scan = (list: readonly Ingredient[], owner: string | null): void => {
    for (const use of list) {
      if (!register(use.name) || owner === null) {
        continue;
      }
      const edges = children.get(owner)!;
      if (!edges.has(use.name)) {
        edges.add(use.name);
        indegree.set(use.name, (indegree.get(use.name) ?? 0) + 1);
      }
    }
  };

  for (const list of dishes) {
    scan(list, null);
  }
  // Expanding `order` while iterating it walks the whole closure, level by
  // level: each discovered sub-recipe appends the links of its own list.
  for (let index = 0; index < order.length; index += 1) {
    scan(recipes.get(order[index]!)!.ingredients, order[index]!);
  }

  // ── Topological order ─────────────────────────────────────────────────────
  // Kahn's algorithm, with the first-appearance order as the tie-break. A
  // sub-recipe enters `ready` only once every sub-recipe that uses it has been
  // emitted, so `required` is complete when its row is built.
  const appearance = new Map(order.map((name, index) => [name, index]));
  const remaining = new Map(indegree);
  const ready = order.filter((name) => (remaining.get(name) ?? 0) === 0);
  const sorted: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (appearance.get(a) ?? 0) - (appearance.get(b) ?? 0));
    const name = ready.shift()!;
    sorted.push(name);
    for (const child of children.get(name)!) {
      const left = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, left);
      if (left === 0) {
        ready.push(child);
      }
    }
  }
  if (sorted.length !== order.length) {
    // The links are acyclic by contract (docs/storage_format.md §7.2). A cycle
    // in a hand-edited file must be reported, never walked.
    const cycle = order.filter((name) => !sorted.includes(name));
    throw new Error(`planSubRecipes: the sub-recipe links form a cycle (${cycle.join(' → ')})`);
  }

  // ── One pass over the graph ───────────────────────────────────────────────
  /** The required amount accumulated so far, per sub-recipe title. */
  const required = new Map<string, number>();
  /** The family unit a sub-recipe was used in — every use must agree. */
  const usedIn = new Map<string, FamilyUnit>();
  const bottomUses: Ingredient[] = [];

  /** Files one ingredient use: the requirement of a sub-recipe, or the bottom level. */
  const addUse = (use: Ingredient): void => {
    if (!recipes.has(use.name)) {
      bottomUses.push(use);
      return;
    }
    const unit = familyUnitOf(use);
    const known = usedIn.get(use.name);
    if (known !== undefined && known !== unit) {
      // g against ml for one name: summing them would be meaningless, and a
      // sub-recipe has exactly one yield unit. Worse than an error is a
      // silently wrong amount, so the sheet reports it.
      throw new Error(
        `planSubRecipes: "${use.name}" is used in ${known} and in ${unit} — a sub-recipe has one yield unit`,
      );
    }
    usedIn.set(use.name, unit);
    required.set(use.name, (required.get(use.name) ?? 0) + use.quantity);
  };

  // The dishes first: their uses are the roots of the graph and are already
  // scaled to the size the plan cooks them at.
  for (const list of dishes) {
    for (const use of list) {
      addUse(use);
    }
  }

  const nodes: SubRecipeNode[] = [];
  for (const name of sorted) {
    const recipe = recipes.get(name)!;
    const { baseUnit, amount: yieldAmount } = yieldOf(recipe);
    const used = usedIn.get(name);
    if (used !== undefined && used !== baseUnit) {
      throw new Error(
        `planSubRecipes: "${name}" yields ${baseUnit} but is used in ${used} — a sub-recipe has one yield unit`,
      );
    }

    const need = roundThousandths(required.get(name) ?? 0);
    const entry = mappingsFor(name);
    const known = entry !== undefined && entry.bu === baseUnit;
    const reorderPoint = known ? entry.reorderPoint : 0;
    const defaultStock = Math.min(need, reorderPoint);
    const chosen = decisions.get(name);
    const stock = Math.max(0, roundThousandths(chosen === undefined ? defaultStock : chosen));
    const missing = roundThousandths(need - stock);
    const cook = missing > 0 ? roundToRung(missing) : 0;
    nodes.push({
      name,
      baseUnit,
      yieldAmount,
      required: need,
      reorderPoint,
      defaultStock,
      stock,
      cook,
    });

    if (cook > 0) {
      // The sub-recipe is cooked at a ladder rung, so the step count to its
      // written yield is an integer and every one of its ingredients moves by
      // it — the same rule the export applies when it opens the sub-recipe
      // (docs/quantity_scaling.md §6). A yield the ladder cannot read (an
      // off-ladder hand-edited file) leaves the list unscaled instead of
      // failing the bundle, like ./shoppingList's plan scaling.
      let deltaX = 0;
      try {
        deltaX = difference(yieldAmount, cook);
      } catch {
        deltaX = 0;
      }
      for (const scaled of scaleList(recipe.ingredients, deltaX)) {
        addUse(scaled);
      }
    }
  }

  return { nodes, bottomUses };
}

/** The outcome of `resolveSubRecipePlan` (see there). */
export interface SubRecipeResolution {
  /** The plan with only the decisions that still apply. */
  readonly plan: SubRecipePlan;
  /**
   * The sub-recipes whose requirement moved away from the one they were
   * acknowledged at — the rows the cooking step has to show again (unfolded and
   * highlighted) before they may be left.
   */
  readonly invalidated: ReadonlySet<string>;
  /**
   * The decisions that survived: the caller's map without the invalidated rows,
   * whose stock fell back to their prefill. This is what the next step computes
   * the bottom level from.
   */
  readonly effective: ReadonlyMap<string, number>;
}

/**
 * The plan with the user's *acknowledged* decisions applied — the rule that
 * keeps a cooking step honest when a requirement moves under it.
 *
 * Each entry of `acknowledged` is the requirement a row was confirmed at (the
 * cooking step records it when the user folds the row). A row whose requirement
 * has moved away from that value is **invalidated**: the amount the user chose
 * no longer answers the question, so
 *
 * - its chosen stock is dropped and the row falls back to `defaultStock`
 *   (`min(required, reorder point)`) — the choice is gone, not hidden, or it
 *   would reappear with the next change of the requirement;
 * - and because that changes how much of the sub-recipe is cooked, the rows
 *   *below* it need something else in turn. Their requirements are therefore
 *   recomputed until no further row drops out.
 *
 * The rounds terminate because the invalidated set only grows: there are at most
 * as many rounds as there are sub-recipes. The walked order is the plan's own
 * topological order, so one round settles a straight chain and the loop is what
 * a diamond needs.
 *
 * @param decisions the chosen stock per sub-recipe title (see `planSubRecipes`)
 * @param acknowledged the requirement each row was confirmed at, per title; a
 *   title that is absent was never confirmed and can never be invalidated
 */
export function resolveSubRecipePlan(
  dishes: readonly (readonly Ingredient[])[],
  recipesByTitle: ReadonlyMap<string, Recipe>,
  decisions: ReadonlyMap<string, number> = new Map(),
  acknowledged: ReadonlyMap<string, number> = new Map(),
): SubRecipeResolution {
  const invalidated = new Set<string>();
  let effective = new Map(decisions);
  let plan = planSubRecipes(dishes, recipesByTitle, effective);
  for (;;) {
    let grew = false;
    for (const node of plan.nodes) {
      const seen = acknowledged.get(node.name);
      if (seen !== undefined && seen !== node.required && !invalidated.has(node.name)) {
        invalidated.add(node.name);
        grew = true;
      }
    }
    if (!grew) {
      return { plan, invalidated, effective };
    }
    effective = new Map([...decisions].filter(([name]) => !invalidated.has(name)));
    plan = planSubRecipes(dishes, recipesByTitle, effective);
  }
}
