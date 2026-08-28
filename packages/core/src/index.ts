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
 * - recipe format parsing and validation — implemented
 *   (docs/storage_format.md, src/recipe/parse.ts + src/recipe/validate.ts)
 */

export * from './additionalUnits.js';
export * from './additionalUnitsData.js';
export * from './ladder.js';
export * from './recipe/exportHtml.js';
export * from './recipe/ingredientList.js';
export * from './recipe/markers.js';
export * from './recipe/parse.js';
export * from './recipe/rename.js';
export * from './recipe/serialize.js';
export * from './recipe/timeValues.js';
export * from './recipe/types.js';
export * from './recipe/validate.js';

/** Version of the core module, kept in sync with packages/core/package.json. */
export const VERSION = '0.1.0';
