/**
 * Tests for the multi-level sub-recipe plan (core's subRecipePlan.ts).
 *
 * The cases follow the worked example agreed with the user, one assertion per
 * rule:
 * - the requirement of a sub-recipe is the sum over its parents, and a parent
 *   contributes only what it actually cooks;
 * - the stock prefills on `min(required, reorder point)` and the cooking amount
 *   is the rest, exact (no ladder rounding);
 * - a covered sub-recipe (cook 0) demands nothing from its own sub-recipes;
 * - the rows come in topological order even when a recipe names a sub-recipe
 *   before the sub-recipe it depends on;
 * - a cycle and a use in the wrong family unit are reported, never walked.
 *
 * The worked example (the user's A / B / C / D): A is the finished dish with
 * 6 servings and needs 100 g B and 200 g C. B, C and D are ingredient recipes
 * that yield 100 g each; B needs 100 g C and 300 g D, C needs 300 g D, D needs
 * 10 g Salz. B and D have a reorder point of 0, C has 500.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetIngredientMappings, setIngredientMappings } from './ingredientRegistry.js';
import type { Ingredient, Recipe } from './recipe/types.js';
import { planSubRecipes, resolveSubRecipePlan, type SubRecipeNode } from './subRecipePlan.js';

/** A recipe with only the fields this module reads. */
function recipe(fields: Partial<Recipe> & Pick<Recipe, 'type'>): Recipe {
  return {
    title: 'Testrezept',
    prep_time: '25 min',
    steps: [],
    ingredients: [],
    ...fields,
  };
}

/** One ingredient use in the given family unit. */
function use(name: string, quantity: number, unit: Ingredient['unit'] = 'g'): Ingredient {
  return { name, quantity, unit };
}

/** One ingredient recipe yielding `yieldAmount` g of its own name. */
function subRecipe(title: string, ingredients: Ingredient[], yieldAmount = 100): Recipe {
  return recipe({
    title,
    type: 'ingredient_recipe',
    yield: yieldAmount,
    yield_unit: 'g',
    ingredients,
  });
}

/** The plan's rows by title, for the terse expectations below. */
function byName(nodes: readonly SubRecipeNode[]): Record<string, SubRecipeNode> {
  return Object.fromEntries(nodes.map((node) => [node.name, node]));
}

/** The three ingredient recipes of the worked example. */
function workedExample(): Map<string, Recipe> {
  return new Map<string, Recipe>([
    ['B', subRecipe('B', [use('C', 100), use('D', 300)])],
    ['C', subRecipe('C', [use('D', 300)])],
    ['D', subRecipe('D', [use('Salz', 10)])],
  ]);
}

describe('planSubRecipes', () => {
  beforeEach(() => {
    // The worked example's reorder points (docs/storage_format.md §9): B and D
    // are only ever cooked for a recipe, C is kept at 500 g.
    setIngredientMappings({
      B: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
      C: { bu: 'g', precision: 'medium', reorderPoint: 500, entries: [] },
      D: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
    });
  });

  afterEach(() => {
    resetIngredientMappings();
  });

  it('plans the worked example: required, prefill, cooking amount, topological order', () => {
    const plan = planSubRecipes([[use('B', 100), use('C', 200)]], workedExample());

    // B before C before D: a sub-recipe always stands behind the sub-recipes
    // that use it.
    expect(plan.nodes.map((node) => node.name)).toEqual(['B', 'C', 'D']);

    const nodes = byName(plan.nodes);
    // B: required 100 from the dish, nothing on the shelf → all 100 is cooked.
    expect(nodes['B']).toMatchObject({
      required: 100,
      reorderPoint: 0,
      defaultStock: 0,
      cook: 100,
    });
    // C: 200 from the dish plus the 100 B cooks (B yields 100 g and needs
    // 100 g C for it) = 300; the reorder point covers it → nothing is cooked.
    expect(nodes['C']).toMatchObject({
      required: 300,
      reorderPoint: 500,
      defaultStock: 300,
      stock: 300,
      cook: 0,
    });
    // D: 300 from B (B cooks its written size, so its list applies as written)
    // and nothing from C, which is not cooked at all.
    expect(nodes['D']).toMatchObject({
      required: 300,
      reorderPoint: 0,
      defaultStock: 0,
      cook: 300,
    });
    expect(nodes['D']!.yieldAmount).toBe(100);

    // Only D's own ingredient reaches the bottom level, scaled from D's yield
    // to the 300 g cooked (factor 3): 10 g Salz → 30 g.
    expect(plan.bottomUses).toEqual([use('Salz', 30)]);
  });

  it('raises the requirement of a lower level when less of a sub-recipe is on stock', () => {
    // The user's second step: only 200 g of C are on the shelf, so 100 g of it
    // are cooked — and D's requirement jumps from 300 g to 600 g.
    const decisions = new Map([['C', 200]]);
    const plan = planSubRecipes([[use('B', 100), use('C', 200)]], workedExample(), decisions);

    const nodes = byName(plan.nodes);
    expect(nodes['C']).toMatchObject({ required: 300, stock: 200, cook: 100 });
    expect(nodes['D']).toMatchObject({ required: 600, defaultStock: 0, cook: 600 });
    // D now cooks six times its yield (Δx = +12): 10 g Salz → 60 g.
    expect(plan.bottomUses).toEqual([use('Salz', 60)]);
  });

  it('demands nothing from a sub-recipe that is covered by stock', () => {
    // C cooking nothing is what keeps D at 300 g — the whole point of the
    // "cook only what is missing" rule.
    const plan = planSubRecipes([[use('B', 100), use('C', 200)]], workedExample());
    expect(byName(plan.nodes)['C']!.cook).toBe(0);
    expect(byName(plan.nodes)['D']!.required).toBe(300);
  });

  it('keeps a parent before its child even when the parent names the child first', () => {
    // A names C before B, but C's requirement depends on B's cooking amount:
    // the order has to come from the links, not from the first appearance.
    const recipes = new Map<string, Recipe>([
      ['B', subRecipe('B', [use('C', 100)])],
      ['C', subRecipe('C', [use('Salz', 10)])],
    ]);
    const plan = planSubRecipes([[use('C', 100), use('B', 100)]], recipes);

    expect(plan.nodes.map((node) => node.name)).toEqual(['B', 'C']);
    // C: 100 from the dish plus the 100 B cooks = 200 (B cooks its written size).
    expect(byName(plan.nodes)['C']!.required).toBe(200);
  });

  it('keeps the cooking amount exact (no ladder rounding)', () => {
    // 200 g on the shelf of a 321 g requirement leaves exactly 121 g to cook.
    // The new quantity model scales by the exact factor cook / yield (1.21), so
    // 10 g Salz becomes 12.1 g — the former ladder rounded 121 g to 120 g.
    const recipes = new Map<string, Recipe>([['B', subRecipe('B', [use('Salz', 10)])]]);
    const plan = planSubRecipes([[use('B', 321)]], recipes, new Map([['B', 200]]));

    const node = byName(plan.nodes)['B']!;
    expect(node.required).toBe(321);
    expect(node.stock).toBe(200);
    expect(node.cook).toBe(121);
    expect(plan.bottomUses).toEqual([use('Salz', 12.1)]);
  });

  it('scales a sub-recipe by a fractional cooking factor', () => {
    // 150 g required of a 100 g yield is a factor of 1.5 — not a ladder step,
    // but a perfectly valid scaled recipe size under the exact model.
    const recipes = new Map<string, Recipe>([['B', subRecipe('B', [use('Salz', 10)])]]);
    const plan = planSubRecipes([[use('B', 150)]], recipes);

    expect(byName(plan.nodes)['B']).toMatchObject({ required: 150, cook: 150 });
    expect(plan.bottomUses).toEqual([use('Salz', 15)]);
  });

  it('cooks nothing when the chosen stock exceeds the requirement', () => {
    const recipes = new Map<string, Recipe>([['B', subRecipe('B', [use('Salz', 10)])]]);
    const plan = planSubRecipes([[use('B', 100)]], recipes, new Map([['B', 250]]));

    expect(byName(plan.nodes)['B']).toMatchObject({ stock: 250, cook: 0 });
    expect(plan.bottomUses).toEqual([]);
  });

  it('leaves ordinary ingredients at the bottom level when no link exists', () => {
    const plan = planSubRecipes([[use('Mehl', 400), use('Milch', 200, 'ml')]], workedExample());

    expect(plan.nodes).toEqual([]);
    expect(plan.bottomUses).toEqual([use('Mehl', 400), use('Milch', 200, 'ml')]);
  });

  it('does not follow a name that matches a finished dish', () => {
    // Only ingredient_recipe titles are sub-recipe links (./recipe/rename.ts);
    // a finished dish used as an ingredient name stays an ordinary ingredient.
    const recipes = new Map<string, Recipe>([
      ['Lasagne', recipe({ title: 'Lasagne', type: 'finished_dish', servings: 4 })],
    ]);
    const plan = planSubRecipes([[use('Lasagne', 500)]], recipes);

    expect(plan.nodes).toEqual([]);
    expect(plan.bottomUses).toEqual([use('Lasagne', 500)]);
  });

  it('reports a cycle instead of walking it', () => {
    const recipes = new Map<string, Recipe>([
      ['B', subRecipe('B', [use('C', 100)])],
      ['C', subRecipe('C', [use('B', 100)])],
    ]);
    expect(() => planSubRecipes([[use('B', 100)]], recipes)).toThrow(/cycle/);
  });

  it('reports a sub-recipe used in the other family unit', () => {
    const recipes = new Map<string, Recipe>([['B', subRecipe('B', [use('Salz', 10)])]]);
    expect(() => planSubRecipes([[use('B', 100, 'ml')]], recipes)).toThrow(/yield unit/);
  });

  it('reports an ingredient recipe without a yield', () => {
    const recipes = new Map<string, Recipe>([
      ['B', recipe({ title: 'B', type: 'ingredient_recipe', ingredients: [use('Salz', 10)] })],
    ]);
    expect(() => planSubRecipes([[use('B', 100)]], recipes)).toThrow(/states no yield/);
  });

  it('reports a sub-recipe used in the other family unit by another sub-recipe', () => {
    const recipes = new Map<string, Recipe>([
      ['B', subRecipe('B', [use('C', 100, 'ml')])],
      ['C', subRecipe('C', [use('Salz', 10)])],
    ]);
    expect(() => planSubRecipes([[use('B', 100), use('C', 50)]], recipes)).toThrow(/yield unit/);
  });

  it('ignores decisions for names that are no sub-recipe', () => {
    const plan = planSubRecipes([[use('Mehl', 400)]], new Map(), new Map([['Mehl', 999]]));
    expect(plan.nodes).toEqual([]);
    expect(plan.bottomUses).toEqual([use('Mehl', 400)]);
  });

  it('sums the requirement over several parents and orders a diamond by its links', () => {
    // D is used by B *and* by C, whichever order the recipes name them in: it
    // has to stand behind both, and its requirement is the sum of what each of
    // them cooks (100 g + 200 g = 300 g, both cooking their written size).
    const recipes = new Map<string, Recipe>([
      ['B', subRecipe('B', [use('D', 100)])],
      ['C', subRecipe('C', [use('D', 200)])],
      ['D', subRecipe('D', [use('Salz', 10)])],
    ]);
    setIngredientMappings({
      B: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
      C: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
      D: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
    });

    const plan = planSubRecipes([[use('B', 100), use('C', 100)]], recipes);

    expect(plan.nodes.map((node) => node.name)).toEqual(['B', 'C', 'D']);
    expect(byName(plan.nodes)['D']).toMatchObject({ required: 300, defaultStock: 0, cook: 300 });
    // 300 g from a 100 g yield is a factor of 3: 10 g Salz → 30 g.
    expect(plan.bottomUses).toEqual([use('Salz', 30)]);
  });
});

describe('a sub-recipe nothing requires', () => {
  beforeEach(() => {
    setIngredientMappings({
      B: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
      C: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
    });
  });

  afterEach(() => {
    resetIngredientMappings();
  });

  /** B yields 100 g from 100 g C; C yields 100 g from 10 g Salz. */
  function chain(): Map<string, Recipe> {
    return new Map<string, Recipe>([
      ['B', subRecipe('B', [use('C', 100)])],
      ['C', subRecipe('C', [use('Salz', 10)])],
    ]);
  }

  it('is a zero row when its parent is covered by stock, and cooks nothing', () => {
    // 100 g of B on the shelf covers the dish, so B is not cooked at all and C
    // is reached by nobody — an honest row reading "0 g", not a missing one: a
    // recipe of the closure stays visible while it can still become required.
    const plan = planSubRecipes([[use('B', 100)]], chain(), new Map([['B', 100]]));

    expect(byName(plan.nodes)['B']).toMatchObject({ required: 100, stock: 100, cook: 0 });
    expect(byName(plan.nodes)['C']).toMatchObject({ required: 0, defaultStock: 0, cook: 0 });
    expect(plan.bottomUses).toEqual([]);
  });

  it('is invalidated when it becomes required', () => {
    // B's stock drops to zero, so B cooks again and C is needed after all. The
    // row was acknowledged while nothing required it, so it is marked.
    const resolved = resolveSubRecipePlan(
      [[use('B', 100)]],
      chain(),
      new Map([['B', 0]]),
      new Map([
        ['B', 100],
        ['C', 0],
      ]),
    );

    expect([...resolved.invalidated]).toEqual(['C']);
    expect(byName(resolved.plan.nodes)['C']!.required).toBe(100);
  });

  it('is invalidated when it stops being required', () => {
    // The other direction: C was acknowledged at 100 g, then the shelf gets
    // enough B to cover the dish and C's requirement disappears.
    const resolved = resolveSubRecipePlan(
      [[use('B', 100)]],
      chain(),
      new Map([['B', 100]]),
      new Map([
        ['B', 100],
        ['C', 100],
      ]),
    );

    expect([...resolved.invalidated]).toEqual(['C']);
    expect(byName(resolved.plan.nodes)['C']!.required).toBe(0);
  });
});

describe('resolveSubRecipePlan', () => {
  beforeEach(() => {
    setIngredientMappings({
      B: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
      C: { bu: 'g', precision: 'medium', reorderPoint: 500, entries: [] },
      D: { bu: 'g', precision: 'medium', reorderPoint: 0, entries: [] },
    });
  });

  afterEach(() => {
    resetIngredientMappings();
  });

  /** The worked example's dishes and recipes (see the file header). */
  const dishes = [[use('B', 100), use('C', 200)]];

  it('invalidates the rows below a changed decision and keeps the rest', () => {
    // The user's second step: 200 g of C on the shelf moves D's requirement
    // from 300 g to 600 g. C itself is untouched — its own requirement did not
    // move — while D has to be looked at again.
    const resolved = resolveSubRecipePlan(
      dishes,
      workedExample(),
      new Map([['C', 200]]),
      new Map([
        ['B', 100],
        ['C', 300],
        ['D', 300],
      ]),
    );

    expect([...resolved.invalidated]).toEqual(['D']);
    expect([...resolved.effective]).toEqual([['C', 200]]);
    const nodes = byName(resolved.plan.nodes);
    expect(nodes['C']).toMatchObject({ stock: 200, cook: 100 });
    // The invalidated row falls back to its prefill: the old choice is dropped,
    // so it cannot reappear with the next change of the requirement.
    expect(nodes['D']).toMatchObject({ required: 600, defaultStock: 0, stock: 0, cook: 600 });
  });

  it('invalidates nothing while every requirement still matches', () => {
    const resolved = resolveSubRecipePlan(
      dishes,
      workedExample(),
      new Map(),
      new Map([
        ['B', 100],
        ['C', 300],
        ['D', 300],
      ]),
    );

    expect(resolved.invalidated.size).toBe(0);
    expect(resolved.effective.size).toBe(0);
    expect(resolved.plan.bottomUses).toEqual([use('Salz', 30)]);
  });

  it('lets an invalidation cascade downwards until it settles', () => {
    // A requirement that moved invalidates B, whose dropped decision changes how
    // much B cooks — which moves C's and D's requirements in turn, even though
    // they matched the first pass. One round per level is what settles it.
    const resolved = resolveSubRecipePlan(
      dishes,
      workedExample(),
      new Map([['B', 50]]),
      new Map([
        ['B', 999],
        ['C', 250],
        ['D', 180],
      ]),
    );

    expect([...resolved.invalidated].sort()).toEqual(['B', 'C', 'D']);
    // Every decision was dropped, so B cooks its whole requirement again and C
    // and D are back at the requirements of the untouched plan.
    expect(resolved.effective.size).toBe(0);
    const nodes = byName(resolved.plan.nodes);
    expect(nodes['B']).toMatchObject({ required: 100, cook: 100 });
    expect(nodes['C']).toMatchObject({ required: 300 });
    expect(nodes['D']).toMatchObject({ required: 300 });
  });

  it('never invalidates a row that was not acknowledged', () => {
    // A row nobody confirmed has no earlier reading to compare against — it is
    // simply unfolded in the cooking step and cannot be "stale".
    const resolved = resolveSubRecipePlan(
      dishes,
      workedExample(),
      new Map([['C', 200]]),
      new Map(),
    );

    expect(resolved.invalidated.size).toBe(0);
    expect([...resolved.effective]).toEqual([['C', 200]]);
    expect(byName(resolved.plan.nodes)['D']!.required).toBe(600);
  });
});
