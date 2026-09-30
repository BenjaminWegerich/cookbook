/**
 * StockSlider — the pantry sheet's stock picker for one ingredient row
 * (components/PantrySelect). It replaces the earlier chip row and −/ + stepper:
 * one discrete slider whose stops are the row's stock values, and beside it the
 * chosen amount as two tappable fields.
 *
 * **The stops are core's pool** (`@cookbook/core`, `stockPool`): every value at
 * which the bought amount changes, ascending from 0 to the need. The slider
 * *snaps* to them, and — decided with the user — it spaces them **evenly**, one
 * stop per step of the range, rather than by their mathematical distance: a
 * 200 g step between "two packs" and "one pack" is as easy to hit as the 1000 g
 * step from there to "nothing to buy". The amounts themselves say what each stop
 * means, not the gaps between the ticks.
 *
 * **Two readings of one value, both editable.** The shelves are stocked in the
 * ingredient's family base unit (g / ml) and, where the master data gives the
 * ingredient one, in a shopping unit ("2 Stück", "1 Packung"). So the picker
 * shows both next to the slider, and *both* fields are buttons: tapping one
 * opens an input with the phone's number keypad (`inputMode="decimal"`), and the
 * typed number is read in that field's own unit — grams/millilitres in the base
 * field, a count of the shopping unit in the other. A typed stock is **not**
 * required to be a stop (decided with the user): the slider thumb then sits on
 * the last stop at or below it — the bucket that stock belongs to, exactly as
 * the old chip row marked it — while the fields keep the exact amount.
 *
 * A shopping unit is only *shown* when the stock is a whole number of it
 * (`stockCountText`): "0,2 Packung" would name a shelf that cannot exist, so the
 * field prints a dash instead. A dash is still editable — the tap works, and the
 * typed count is the way back onto a whole unit. An **approximate** unit
 * ("Stück") is a translation, not a count of packages, and always reads as its
 * nearest whole number.
 *
 * The pool values, the reading and the rounding live in core, where they are
 * tested; this component owns the slider, the two inputs, the labels and the
 * even spacing. UI language is German.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { formatBQ, formatDecimal, type AdditionalUnit } from '@cookbook/core';

interface StockSliderProps {
  /** The slider's stops (family base unit), ascending — 0 … the row's need. */
  values: readonly number[];
  /** The row's current stock, 0 … need (not necessarily a stop). */
  value: number;
  /** Family base unit of the values (g / ml): the base field and the typed number. */
  baseUnit: 'g' | 'ml';
  /**
   * The ingredient's shopping unit, or null when the master data gives it none
   * (then there is no second field). The factor is the family base unit per one
   * unit, so a typed count is read in the ingredient's own terms.
   */
  unit: { au: AdditionalUnit; factor: number } | null;
  /**
   * The stock's shopping-unit reading ("2 Stück", "1 Packung"), or null when the
   * stock is no whole number of the unit — the field shows a dash then. Ignored
   * without a `unit`.
   */
  unitText: string | null;
  /** Reports the new stock: a slider stop or a typed amount. */
  onChange: (next: number) => void;
  /** Accessible name of the control, e.g. "Vorrat für Mehl". */
  label: string;
}

/** The dash a shopping-unit field shows while the stock is no whole unit. */
const EMPTY_UNIT_TEXT = '—';

/**
 * The index of the stop a stock belongs to: the last stop at or below it. There
 * is always one — the pool starts at 0 and ends on the need, and the stock can
 * never be above the need (it is clamped there).
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
 * Parses a typed number with German typography: the comma is the decimal
 * separator and a dot may separate thousands ("1.200" is 1200, "1,2" is 1.2).
 * Anything else is ignored, so a typed unit or a stray space does not spoil the
 * input ("1200 g"). NaN for an input without a number — the caller keeps the
 * stock then.
 */
function parseInput(text: string): number {
  return Number(
    text
      .replace(/[^\d.,]/g, '')
      .replaceAll('.', '')
      .replace(',', '.'),
  );
}

/** One thousandth — the precision the sheet rounds a stock to. */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Which of the two fields currently holds the keyboard (null = both closed). */
type EditingField = 'base' | 'unit';

/**
 * The stock picker of one row (see the file header): the two tappable value
 * fields above the full-width discrete slider.
 */
function StockSlider({
  values,
  value,
  baseUnit,
  unit,
  unitText,
  onChange,
  label,
}: StockSliderProps) {
  /** The need itself: the pool's last stop, i.e. "nothing to buy". */
  const need = values[values.length - 1] ?? 0;
  /** The stop the thumb shows (see `stopIndex`). */
  const index = stopIndex(values, value);
  /** The furthest stop index — 0 for a row whose pool holds a single value. */
  const lastIndex = Math.max(0, values.length - 1);

  /** The open field and the text in it, or null while both are closed. */
  const [editing, setEditing] = useState<EditingField | null>(null);
  const [draft, setDraft] = useState('');

  /**
   * Publishes a typed number: read in the field's own unit, clamped to the stock
   * range 0 … need and rounded to thousandths. NaN (an input without a number)
   * changes nothing — a typo must not alter what goes on the list.
   */
  function commitTyped(): void {
    if (editing === null) return;
    const parsed = parseInput(draft);
    setEditing(null);
    if (!Number.isFinite(parsed)) return;
    const typed = editing === 'base' ? parsed : parsed * (unit?.factor ?? 1);
    const next = Math.min(need, Math.max(0, roundThousandths(typed)));
    if (next !== value) onChange(next);
  }

  /** Opens a field: the base one shows the stock in g / ml, the shopping-unit
   *  one the exact count (which may be fractional for a stock between units). */
  function beginEdit(field: EditingField): void {
    const shown = field === 'base' ? value : value / (unit?.factor ?? 1);
    setEditing(field);
    setDraft(formatDecimal(roundThousandths(shown)));
  }

  /** One open field: the phone's number keypad, committed on Enter or blur. The
   *  unit's name is printed beside the number and names the field to a reader. */
  function renderInput(unitName: string): ReactNode {
    return (
      <span className="stock-value-edit">
        <input
          className="stock-value-input"
          // The phone's number keypad, not the full keyboard. The value may carry
          // a decimal comma, hence "decimal" rather than "numeric".
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitTyped}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitTyped();
            if (event.key === 'Escape') setEditing(null);
          }}
          aria-label={`${label} in ${unitName}`}
        />
        {/* The field's unit while it is open: g / ml for the base one, the
            shopping unit's name for the other. */}
        <span className="stock-value-unit">{unitName}</span>
      </span>
    );
  }

  /** One closed field: a button that opens the keyboard for its unit. */
  function renderValue(field: EditingField, text: string, unitName: string): ReactNode {
    return (
      <button
        type="button"
        className="stock-value"
        onClick={() => beginEdit(field)}
        aria-label={`${label} eintippen (${unitName})`}
      >
        {text}
      </button>
    );
  }

  return (
    <div className="stock-slider">
      {/* The chosen amount in both readings, the base unit first (the value the
          slider itself moves in). Each field is its own tap target. */}
      <div className="stock-values">
        {editing === 'base'
          ? renderInput(baseUnit)
          : renderValue('base', formatBQ(value, baseUnit), baseUnit)}
        {unit !== null &&
          (editing === 'unit'
            ? renderInput(unit.au.name)
            : renderValue('unit', unitText ?? EMPTY_UNIT_TEXT, unit.au.name))}
      </div>
      {/* The discrete slider: a tick per stop (aria-hidden — the value fields
          carry the amounts), and the thumb. `aria-valuetext` makes a screen
          reader announce the amount, not the stop's index. */}
      <div className="stock-track">
        <input
          type="range"
          className={value >= need ? 'stock-range stock-range-covered' : 'stock-range'}
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
    </div>
  );
}

export default StockSlider;
