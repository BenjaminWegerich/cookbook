/**
 * SuggestionChips — the adaptive chip row of a quantity field.
 *
 * The chips arrive in **ranking order** from core's `suggestQuantities` /
 * `suggestUnitlessQuantities` (lowest weighted penalty + distance first). The
 * component walks that order, takes a chip when it fits and **skips** a chip
 * that does not, so a later, narrower chip can use the remaining space
 * (decided with the user). The chosen subset is displayed in increasing BQ
 * order. There is no wrapping, no scroll container and no "andere" chip — the
 * keyboard and the stepper cover everything the row cannot show.
 *
 * The active chip is deliberately **not reserved**: if the current amount has
 * no clean arrangement, or its chip is too wide to fit, the row may show no
 * clay chip. That absence is information, not a bug.
 *
 * How many fit is a measurement, not a guess: an off-screen strip holds every
 * chip so its natural width stays measurable after the visible row hides the
 * overflow. A ResizeObserver on the row and the strip, plus one re-measure after
 * the bundled font loads, keeps the choice right when the viewport or the font
 * changes. This is the same technique as components/StockChips, without the
 * pantry's custom/"andere" slots.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** One chip: the target to store and the arrangement label to show. */
export interface SuggestionChip {
  /** The target value (`V0`) the chip stores. */
  readonly value: number;
  /**
   * The chip's reading ("1 Becher (500 g)", "400 g", "½"). A ReactNode because
   * the core label is an `ArrangementDisplay` whose note the caller renders as
   * a muted run (`ArrangementLine`).
   */
  readonly label: ReactNode;
}

interface SuggestionChipsProps {
  /** The chips in keep-priority order (see the file header). */
  chips: readonly SuggestionChip[];
  /** The field's current value, or undefined when nothing is set yet. */
  value: number | undefined;
  /** Accessible name of the group ("Vorgeschlagene Mengen"). */
  ariaLabel: string;
  /** Reports the chip the user tapped. */
  onChange: (value: number) => void;
}

/** The gap between two chips (space-4, mirrored in editor.css). */
const CHIP_GAP = 10;

/**
 * The ranked chips that fit on one line, in ranking order (the caller displays
 * them ascending). The walk does not stop at the first chip that does not fit:
 * a later, narrower chip may use the remaining space. A chip is only compared
 * against the space already taken by *chosen* chips, so the leading gap is
 * added only after the first one.
 *
 * This greedy is lexicographically optimal by rank: it keeps the best chip that
 * fits, then the next best that fits alongside it, and so on. A different set
 * could only be obtained by dropping a higher-ranked chip to make room for two
 * lower-ranked ones, which is not what the row is for.
 */
function chooseFitting(rowWidth: number, chipWidths: readonly number[], gap: number): number[] {
  const chosen: number[] = [];
  let used = 0;
  for (let index = 0; index < chipWidths.length; index += 1) {
    const next = used + (chosen.length > 0 ? gap : 0) + chipWidths[index]!;
    if (next <= rowWidth) {
      chosen.push(index);
      used = next;
    }
  }
  return chosen;
}

/** True when the field's value is this chip's target (up to float noise). */
function isActive(value: number | undefined, candidate: number): boolean {
  if (value === undefined) {
    return false;
  }
  return Math.abs(value - candidate) <= 1e-9 * Math.max(1, Math.abs(value));
}

/**
 * The one-line chip row of a quantity field (see the file header). It renders
 * nothing when the field has no value: without a current value there is no
 * anchor to adapt to, and the fixed decade chips are not used here (a real
 * field is never empty — every call site initializes its quantity).
 */
function SuggestionChips({ chips, value, ariaLabel, onChange }: SuggestionChipsProps) {
  /**
   * The values of the chosen chips, in no particular order. Values rather than
   * indices, so a value that disappears between renders cannot point at the
   * wrong chip; the layout effect replaces the set before the browser paints.
   */
  const [visibleValues, setVisibleValues] = useState<number[]>([]);
  /** The visible row — measured for its available width. */
  const rowRef = useRef<HTMLDivElement>(null);
  /** The off-screen strip holding every chip for width measurement. */
  const stripRef = useRef<HTMLDivElement>(null);

  /** Recomputes the ranked chips that fit on one line (round 6). */
  const measure = useCallback(() => {
    const row = rowRef.current;
    const strip = stripRef.current;
    if (row === null || strip === null) {
      return;
    }
    // Read fractional widths rather than integer offsetWidth: with a capped
    // page width the row and its chips often meet exactly, and integer rounding
    // would let the last chip overflow and be clipped mid-pill.
    const rowWidth = row.getBoundingClientRect().width;
    const chipWidths = Array.from(strip.querySelectorAll<HTMLElement>('[data-chip]')).map(
      (element) => element.getBoundingClientRect().width,
    );
    // The visible row's own gap token is the truthful value (editor.css mirrors
    // CHIP_GAP); reading it keeps the measurement correct if the ladder moves.
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || CHIP_GAP;
    const chosen = chooseFitting(rowWidth, chipWidths, gap).map((index) => chips[index]!.value);
    // Keep the old array when the choice did not change, so a resize or a font
    // event does not re-render the row.
    setVisibleValues((previous) =>
      previous.length === chosen.length && previous.every((item, i) => item === chosen[i])
        ? previous
        : chosen,
    );
  }, [chips]);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    const strip = stripRef.current;
    if (row === null || strip === null) {
      return;
    }
    // Observe both the visible row (viewport / page cap) and the strip (the
    // bundled font loading widens the chips while the row's width stays put).
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measure, chips]);

  // Re-measure once the bundled font has loaded (the fallback font differs by
  // a few pixels per chip, enough to change the count).
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready
      .then(() => {
        if (!cancelled) {
          measure();
        }
      })
      .catch(() => {
        /* a failed font load keeps the fallback measurement */
      });
    return () => {
      cancelled = true;
    };
  }, [measure]);

  if (chips.length === 0) {
    return null;
  }

  const visible = new Set(visibleValues);
  // Rank decided which chips survived; the row always reads ascending.
  const sorted = chips.filter((chip) => visible.has(chip.value)).sort((a, b) => a.value - b.value);

  return (
    <div className="suggestion-chips-wrap">
      <div
        className="suggested-chips suggested-chips-one-line"
        ref={rowRef}
        role="group"
        aria-label={ariaLabel}
      >
        {sorted.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={isActive(value, chip.value) ? 'chip chip-active' : 'chip'}
            onClick={() => onChange(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* The measurement strip: every chip, laid out off-screen so the visible
          row can hide its overflow without losing a width it still needs after
          a viewport or font change. Non-interactive and screen-reader hidden. */}
      <div className="suggested-chips-measure" ref={stripRef} aria-hidden="true">
        {chips.map((chip) => (
          <button key={chip.value} type="button" tabIndex={-1} data-chip className="chip">
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SuggestionChips;
