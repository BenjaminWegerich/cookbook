/**
 * Quantity data for the editor's QuantityPicker (decided with the user):
 *
 * - the *pool* of selectable quantities is bounded to 1 … 10000 (g/ml, in the
 *   ingredient's family unit); the − / + stepper reaches every ladder rung in
 *   that range, always ladder-valid;
 * - a *suggested* row offers the common values for one-tap selection. The
 *   current list is a deliberate placeholder — the powers of ten 1 / 10 / 100 /
 *   1000 / 10000 — until a later session defines more elaborate suggestion
 *   logic (decided with the user);
 * - values are stored in the family unit (g or ml); the labels switch to
 *   kg / l at 1000 (core formatBQ).
 *
 * Non-standard numbers do not exist in the app (docs/quantity_scaling.md §3):
 * every value here is a ladder value by construction.
 */

import { formatBQ, formatDecimal } from '@cookbook/core';

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

/** The curated suggested values (stored family-unit values), one-tap row:
 *  the powers of ten. Placeholder until more elaborate suggestion logic is
 *  defined in a later session (see file header). */
const SUGGESTED_VALUES = [1, 10, 100, 1000, 10000];

/**
 * The label of a quantity: formatted base form (switches to kg/l at 1000) for
 * a family unit, plain number for a unitless quantity (`{{100}}`). Numbers
 * use the German decimal comma on the display layer (formatDecimal).
 */
export function quantityLabel(quantity: number, family: QuantityFamily | null): string {
  return family === null ? formatDecimal(quantity) : formatBQ(quantity, family);
}

/** The suggested chips with display labels (see file header). */
export function suggestedChips(family: QuantityFamily | null): QuantityChip[] {
  return SUGGESTED_VALUES.map((quantity) => ({ quantity, label: quantityLabel(quantity, family) }));
}
