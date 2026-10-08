/**
 * @cookbook/core — framework-free TypeScript module.
 *
 * Hosts all deterministic cookbook logic, independent of React and the DOM
 * (see docs/ARCHITECTURE.md):
 * - quantity scaling on the ladder of standard numbers — implemented
 *   (docs/quantity_scaling.md, src/ladder.ts)
 * - additional-unit selection and display — implemented
 *   (docs/additional_quantity_specifications.md, src/additionalUnits.ts;
 *   master data in docs/*.csv, compiled by scripts/generate-additional-data.mjs)
 * - the AQ ladder — the standard numbers for additional quantities and for
 *   unitless inline counts — implemented (src/aqLadder.ts)
 * - ingredient and shopping-route master data parsing — implemented
 *   (docs/storage_format.md §9/§10, src/ingredientCsv.ts +
 *   src/shoppingRouteCsv.ts)
 * - the shopping-route runtime registry: the current route, the item
 *   assignment and the store/section lists the pickers are built from —
 *   implemented (src/shoppingRouteRegistry.ts; seed data in
 *   src/shoppingRouteData.ts, compiled by scripts/generate-shopping-route.mjs)
 * - recipe format parsing and validation — implemented
 *   (docs/storage_format.md, src/recipe/parse.ts + src/recipe/validate.ts)
 */

export * from './additionalUnits.js';
export * from './additionalUnitsData.js';
export * from './aqLadder.js';
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

/** Version of the core module, kept in sync with packages/core/package.json. */
export const VERSION = '0.1.0';
