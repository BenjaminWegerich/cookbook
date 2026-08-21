/**
 * @cookbook/core — framework-free TypeScript module.
 *
 * Hosts all deterministic cookbook logic, independent of React and the DOM
 * (see docs/ARCHITECTURE.md):
 * - quantity scaling on the ladder of standard numbers — implemented
 *   (docs/quantity_scaling.md, src/ladder.ts)
 * - additional-unit selection and display — roadmap task
 *   (docs/additional_quantity_specifications.md)
 * - recipe format parsing and validation — roadmap task
 *   (docs/storage_format.md)
 */

export * from './ladder.js';

/** Version of the core module, kept in sync with packages/core/package.json. */
export const VERSION = '0.1.0';
