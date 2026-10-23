/**
 * Master-list quantity provenance (storage_format.md §4).
 *
 * The master row of an ingredient is derived from the step rows, but its
 * display is not just a second optimization of the summed amount: it is tied to
 * the rows the cook reads above it (one-use identity, exact BQ sum, exact AQ
 * sum for a shared unit, a strictly larger master AQ, inherited precision — see
 * `optimizeMasterQuantity` in ../quantityOptimizer.ts).
 *
 * `masterUsesFor` recovers the step uses behind one master entry. The master
 * list groups rows by trimmed name **and base unit** (`mergeIngredientUses`), so
 * this lookup is exact: it returns every use that was merged into the entry.
 * Callers scale the result by the displayed-size factor before rendering, so
 * the constraints hold at every baked export view, not only at the written
 * size.
 */

import type { MasterQuantityUse } from '../quantityOptimizer.js';
import type { Step, Unit } from './types.js';

/** The two fields that identify a master entry in the step rows. */
export interface MasterQuantitySource {
  readonly name: string;
  readonly unit: Unit;
}

/**
 * The step uses behind one master entry, in recipe order.
 *
 * A use's quantity is scaled by `factor` (the exact written → displayed size
 * factor); its optional per-row precision travels along, because the master row
 * inherits the highest precision of its rows. Artifacts are never uses and the
 * name is matched trimmed, exactly like the merge.
 *
 * @param steps the recipe's steps at the written size
 * @param ingredient the master entry to find the uses for
 * @param factor exact scale factor for the displayed size (default 1)
 */
export function masterUsesFor(
  steps: readonly Step[],
  ingredient: MasterQuantitySource,
  factor = 1,
): MasterQuantityUse[] {
  const name = ingredient.name.trim();
  const uses: MasterQuantityUse[] = [];
  for (const step of steps) {
    for (const row of step.ingredients) {
      if (row.name.trim() !== name || row.unit !== ingredient.unit) continue;
      uses.push({
        quantity: row.quantity * factor,
        ...(row.precision !== undefined ? { precision: row.precision } : {}),
      });
    }
  }
  return uses;
}
