/**
 * Quantity data for the editor's QuantityPicker (decided with the user):
 *
 * - the *pool* of selectable quantities is bounded, and its values are the
 *   standard numbers of the ingredient's mode:
 *   - **g/ml** (weighted / volumed): the BQ ladder, 1 … 10000 in the family
 *     unit; the − / + stepper reaches every BQ rung in that range;
 *   - **unitless** (`{{…}}` inline count): the AQ ladder — the standard numbers
 *     for additional units, the ones with fractions — 1/10 … 1000 (0.1 … 1000);
 *     the stepper reaches every distinct AQ value.
 * - a *suggested* row offers the common values for one-tap selection: the
 *   powers of ten for g/ml, and 1/10 plus the powers of ten for unitless (the
 *   request: "numbers down to 0.1, and 0.1 as a suggestion"). The row is
 *   deliberately simple until a later session defines more elaborate
 *   suggestion logic (decided with the user);
 * - values are stored in the family unit (g or ml); the labels switch to
 *   kg / l at 1000 (core formatBQ). Unitless counts are labelled with the AQ
 *   fraction typography (core formatAQValue, e.g. ¼, 1 ¼).
 *
 * Non-standard numbers do not exist in the app (docs/quantity_scaling.md §3):
 * every value here is a standard number of its mode by construction.
 */

import { AQ_MIN, formatAQValue, formatBQ, formatDecimal, isAQValue } from '@cookbook/core';

/** The two authorable base-unit families (decided with the user: g/ml only). */
export type QuantityFamily = 'g' | 'ml';

/** One selectable quantity: the stored value (family unit) and its label. */
export interface QuantityChip {
  quantity: number;
  label: string;
}

/** Lower bound of the selectable BQ pool (in the family unit). */
export const QUANTITY_MIN = 1;
/** Upper bound of the selectable BQ pool (in the family unit). */
export const QUANTITY_MAX = 10000;

/** Suggested g/ml values (stored family-unit values): the powers of ten. */
const SUGGESTED_FAMILY_VALUES = [1, 10, 100, 1000, 10000];

/** Suggested unitless values (AQ ladder): 1/10 plus the powers of ten. */
const SUGGESTED_UNITLESS_VALUES = [AQ_MIN, 1, 10, 100, 1000];

/**
 * The label of a quantity: formatted base form (switches to kg/l at 1000) for
 * a family unit, the AQ fraction typography for a unitless count (`{{…}}`).
 * A unitless value that is not an AQ number (a transient state while the unit
 * mode changes) falls back to the decimal form so the picker never crashes;
 * the editor normalizes the value before it is stored.
 */
export function quantityLabel(quantity: number, family: QuantityFamily | null): string {
  if (family !== null) return formatBQ(quantity, family);
  return isAQValue(quantity) ? formatAQValue(quantity) : formatDecimal(quantity);
}

/** The suggested chips with display labels (see file header). */
export function suggestedChips(family: QuantityFamily | null): QuantityChip[] {
  const values = family === null ? SUGGESTED_UNITLESS_VALUES : SUGGESTED_FAMILY_VALUES;
  return values.map((quantity) => ({ quantity, label: quantityLabel(quantity, family) }));
}
