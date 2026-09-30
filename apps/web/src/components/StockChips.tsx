/**
 * StockChips — the pantry sheet's chip picker for a row whose bought amount can
 * only take a few values (components/PantrySelect; which rows those are is
 * core's `stockPool`).
 *
 * One chip per stock value at which the shopping result changes, so a single tap
 * answers "roughly this much is at home". A chip's label is just that amount
 * (decided with the user): the sheet's intro says what the amounts mean — "at
 * least this much is in the pantry" — so no chip needs a comparison sign of its
 * own, and the first chip (the pool's 0) reads "0 g", i.e. nothing.
 *
 * The chip whose range holds the current stock is the pressed one. The pool's
 * last value is the need, so the last chip always stands for "nothing to buy":
 * it carries the check symbol (like the stepper's shortcut, which names the same
 * amount), and the sheet's amount line prints a dash while it is the pressed one.
 *
 * A chip stands for a whole range, not for an exact shelf count: nothing is
 * written back to the master data (only the shopping list is written), and every
 * stock inside a range buys the same amount.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { formatBQ } from '@cookbook/core';
import { CheckCircleIcon } from './icons';

interface StockChipsProps {
  /** The chip values (family base unit), ascending — 0 … the row's need. */
  values: readonly number[];
  /** The row's current stock, 0 … need (not necessarily a chip value). */
  value: number;
  /** Family base unit of the values (g / ml), for the labels. */
  baseUnit: 'g' | 'ml';
  /** Reports the stock the tapped chip stands for. */
  onChange: (next: number) => void;
  /** Accessible name of the group, e.g. "Vorrat für Mehl". */
  label: string;
}

/**
 * The chip whose range holds `value`: the last boundary at or below it. There is
 * always one — the pool starts at 0 and ends on the need, and the stock can never
 * be above the need (it is clamped there).
 */
function activeIndex(values: readonly number[], value: number): number {
  let active = 0;
  for (let index = 0; index < values.length; index += 1) {
    if ((values[index] ?? 0) <= value) {
      active = index;
    }
  }
  return active;
}

/**
 * The chip row (see the file header). A chip's label is the amount it stands for
 * (the sheet's intro explains that the amounts mean "at least this much"). The
 * last chip covers the need: it is the "nothing to buy" answer, so it carries the
 * same check symbol as the stepper's shortcut, which names the same amount
 * (".chip-covered" in styles/pantry-select.css).
 */
function StockChips({ values, value, baseUnit, onChange, label }: StockChipsProps) {
  const active = activeIndex(values, value);
  return (
    <div className="stock-chips" role="group" aria-label={label}>
      {values.map((poolValue, index) => {
        const covered = index === values.length - 1;
        const classes = ['chip'];
        if (covered) classes.push('chip-covered');
        if (index === active) classes.push('chip-active');
        return (
          <button
            key={poolValue}
            type="button"
            className={classes.join(' ')}
            aria-pressed={index === active}
            onClick={() => onChange(poolValue)}
          >
            {covered && <CheckCircleIcon className="chip-icon" />}
            {formatBQ(poolValue, baseUnit)}
          </button>
        );
      })}
    </div>
  );
}

export default StockChips;
