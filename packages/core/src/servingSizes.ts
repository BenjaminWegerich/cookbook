/**
 * The serving counts a finished dish may have.
 *
 * The values are the integer standard numbers of the old ladder 1 … 30. They
 * stay restricted (decided with the user) so the HTML export can keep baking
 * one view per serving count. The list is the single source for the editor's
 * Portionen chips, the meal plan and the export; no other module keeps a copy.
 */

/** Every allowed serving count, ascending. */
export const SERVING_COUNTS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30,
];

/** The same values as a membership set. */
export const SERVING_COUNT_SET: ReadonlySet<number> = new Set(SERVING_COUNTS);

/** True when `value` is an allowed serving count (a positive integer in the list). */
export function isServingCount(value: number): boolean {
  return Number.isInteger(value) && SERVING_COUNT_SET.has(value);
}
