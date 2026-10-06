/**
 * StockSlider — the pantry sheet's stock slider for one ingredient row
 * (components/PantrySelect). It is the third line of a row: a discrete slider
 * whose stops are the row's stock values, with the chosen amount shown in the
 * tappable fields of the row's second line instead of beside the slider.
 *
 * **The stops are core's pool** (`@cookbook/core`, `stockPool`): every value at
 * which the bought amount changes, ascending from 0 to the need. The slider
 * *snaps* to them, and — decided with the user — it spaces them **evenly**, one
 * stop per step of the range, rather than by their mathematical distance: a
 * 200 g step between "two packs" and "one pack" is as easy to hit as the 1000 g
 * step from there to "nothing to buy". The amounts themselves say what each stop
 * means, not the gaps between the ticks.
 *
 * A stock typed into the row's fields need not be a stop (decided with the
 * user): the slider thumb then sits on the last stop at or below it — the
 * bucket that stock belongs to — while the fields keep the exact number. The
 * pool values, the reading and the rounding live in core, where they are
 * tested; this component owns the slider and the even spacing. UI language is
 * German.
 */

import { formatBQ } from '@cookbook/core';

interface StockSliderProps {
  /** The slider's stops (family base unit), ascending — 0 … the row's need. */
  values: readonly number[];
  /** The row's current stock, 0 … need or above it (not necessarily a stop). */
  value: number;
  /** Family base unit of the values (g / ml), for the accessible value text. */
  baseUnit: 'g' | 'ml';
  /** Reports the new stock: a slider stop. */
  onChange: (next: number) => void;
  /** Accessible name of the control, e.g. "Vorrat für Mehl". */
  label: string;
}

/**
 * The index of the stop a stock belongs to: the last stop at or below it. There
 * is always one — the pool starts at 0 and ends on the need, and a stock above
 * the need lands on the last stop (the row reads as covered).
 */
function stopIndex(values: readonly number[], value: number): number {
  let active = 0;
  for (let index = 0; index < values.length; index += 1) {
    if ((values[index] ?? 0) <= value) {
      active = index;
    }
  }
  return active;
}

/**
 * The stock slider of one row (see the file header): the full-width discrete
 * slider, without the value fields (they live in the row's second line now).
 */
function StockSlider({ values, value, baseUnit, onChange, label }: StockSliderProps) {
  /** The stop the thumb shows (see `stopIndex`). */
  const index = stopIndex(values, value);
  /** The furthest stop index — 0 for a row whose pool holds a single value. */
  const lastIndex = Math.max(0, values.length - 1);

  return (
    <div className="stock-track">
      {/* The discrete slider: a tick per stop (aria-hidden — the second line's
          fields carry the amounts), and the thumb. `aria-valuetext` makes a
          screen reader announce the amount, not the stop's index. */}
      <input
        type="range"
        className={value >= (values[values.length - 1] ?? 0) ? 'stock-range stock-range-covered' : 'stock-range'}
        min={0}
        max={lastIndex}
        step={1}
        value={index}
        disabled={lastIndex === 0}
        onChange={(event) => onChange(values[Number(event.target.value)] ?? 0)}
        aria-label={label}
        aria-valuetext={formatBQ(value, baseUnit)}
      />
      <div className="stock-ticks" aria-hidden="true">
        {values.map((stop) => (
          <span key={stop} className="stock-tick" />
        ))}
      </div>
    </div>
  );
}

export default StockSlider;
