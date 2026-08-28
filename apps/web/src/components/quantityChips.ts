/**
 * Quantity data for the editor's QuantityPicker (decided with the user):
 *
 * - the *pool* of selectable quantities is bounded to 1 … 10000 (g/ml, in the
 *   ingredient's family unit); the − / + stepper reaches every ladder rung in
 *   that range, always ladder-valid;
 * - a *suggested* row offers the common values for one-tap selection (the
 *   app may later highlight additional suggestions, e.g. a whole Becher);
 * - values are stored in the family unit (g or ml); the labels switch to
 *   kg / l at 1000 (core formatBQ).
 *
 * Non-standard numbers do not exist in the app (docs/quantity_scaling.md §3):
 * every value here is a ladder value by construction.
 */

import { formatBQ } from '@cookbook/core';

/** The two authorable base-unit families (decided with the user: g/ml only). */
export type QuantityFamily = 'g' | 'ml';

/** One selectable quantity: the stored value (family unit) and its label. */
export interface QuantityChip {
  quantity: number;
  label: string;
}

/** Lower bound of the selectable pool (in the family unit). */
export const QUANTITY_MIN = 1;
/** Upper bound of the selectable pool (in the family unit). */
export const QUANTITY_MAX = 10000;

/** The curated suggested values (stored family-unit values), one-tap row. */
const SUGGESTED_VALUES = [
  1, 2, 3, 5, 7, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800,
  1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000,
];

/** The suggested chips with display labels (see file header). */
export function suggestedChips(family: QuantityFamily): QuantityChip[] {
  return SUGGESTED_VALUES.map((quantity) => ({ quantity, label: formatBQ(quantity, family) }));
}
