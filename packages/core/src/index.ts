/**
 * @cookbook/core — framework-free TypeScript module.
 *
 * Hosts all deterministic cookbook logic, independent of React and the DOM
 * (see docs/ARCHITECTURE.md):
 * - the quantity optimizer and its BQ/AQ master tables — implemented
 *   (docs/recipe_scaling_algorithm.md, src/quantityOptimizer.ts,
 *   src/quantityValues.ts, src/quantityData.ts)
 * - additional-unit display — implemented (docs/additional_quantity_specifications.md,
 *   src/additionalUnits.ts; master data in docs/*.csv, compiled by
 *   scripts/generate-additional-data.mjs)
 * - ingredient and shopping master data parsing — implemented
 *   (docs/storage_format.md §9/§10, src/ingredientCsv.ts +
 *   src/shoppingRouteCsv.ts: route, item table and synonym table)
 * - the shopping runtime registry: the current route, the item table, the
 *   synonym table and the store/section lists the pickers are built from —
 *   implemented (src/shoppingRouteRegistry.ts; seed data in
 *   src/shoppingRouteData.ts, compiled by scripts/generate-shopping-route.mjs)
 * - the synonym rule of the shopping master-data screen — implemented
 *   (src/shoppingVariantForm.ts)
 * - the shopping list's item identity at read time — deriving a line's name
 *   field, resolving it to an item (or a variant) and suggesting similar item
 *   names — implemented (docs/shopping_item_identity.md, src/shoppingSort.ts)
 * - recipe format parsing and validation — implemented
 *   (docs/storage_format.md, src/recipe/parse.ts + src/recipe/validate.ts)
 */

export * from './additionalUnits.js';
export * from './additionalUnitsData.js';
export * from './aqLadder.js';
export * from './quantityValues.js';
export * from './quantityOptimizer.js';
export * from './servingSizes.js';
export * from './tolerance.js';
export * from './ingredientCsv.js';
export * from './ingredientRegistry.js';
export * from './ladder.js';
export * from './mealPlan.js';
export * from './planLink.js';
export * from './recipe/artifacts.js';
export * from './recipe/exportHtml.js';
export * from './recipe/ingredientList.js';
export * from './recipe/parse.js';
export * from './recipe/rename.js';
export * from './recipe/serialize.js';
export * from './recipe/theme.js';
export * from './recipe/timeValues.js';
export * from './recipe/types.js';
export * from './recipe/validate.js';
export * from './recipe/yieldViews.js';
export * from './shoppingList.js';
export * from './shoppingRouteCsv.js';
export * from './shoppingSort.js';
export * from './shoppingRouteData.js';
export * from './shoppingRouteRegistry.js';
export * from './shoppingVariantForm.js';
export * from './subRecipePlan.js';

/** Version of the core module, kept in sync with packages/core/package.json. */
export const VERSION = '0.1.0';
