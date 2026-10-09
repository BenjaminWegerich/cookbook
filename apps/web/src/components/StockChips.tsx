/**
 * StockChips — the pantry sheet's stock picker for one ingredient row
 * (components/PantrySelect). It replaces the discrete slider: a single row of
 * suggestion chips, one per suggested stock value (the values come from core's
 * `suggestedStocks`, the labels from `renderPantryChip`).
 *
 * The chips arrive in **keep-priority** order — 0 and the need first, then the
 * remaining candidates most-wanted first — so that, when the row runs out of
 * space, the earliest entries are the ones that stay. The row always displays
 * the kept chips in **increasing** value order: priority decides *which*
 * survive a narrow screen, never the display order.
 *
 * The value the user typed through the "andere" chip's keyboard is tracked
 * explicitly by the parent and passed in as the `customChip` (labelled with the
 * ingredient's full arrangement, shopping unit included); it is shown as an
 * additional, always-visible chip at its correct (increasing) position — even
 * when it happens to equal a suggestion, in which case it replaces that
 * suggestion chip. The custom chip carries an edit (pencil) symbol and replaces
 * the "andere" chip: tapping it opens the keyboard again, on the row's
 * base-unit field. "andere" itself (the three-dots "more" chip) is only shown
 * when suggestions overflow one line and no custom value is present.
 *
 * How many chips fit is a measurement, not a guess: an off-screen strip holds
 * every chip plus the "andere" chip, so their widths stay measurable even after
 * the visible row hides the overflow. A ResizeObserver on the visible row and a
 * one-off re-measure after the bundled font loads keep the count right when the
 * viewport changes. UI language is German.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { formatDecimal } from '@cookbook/core';

import { MoreVertIcon, PencilIcon } from './icons';
import { parseInput, roundThousandths } from './pantryInput';

/** One suggested stock value and its label ("1 Becher (400 g)", "600 g", "0"). */
export interface StockChip {
  readonly value: number;
  readonly label: string;
}

interface StockChipsProps {
  /**
   * The suggested stock values in **keep-priority** order: 0 and the need
   * first, then the remaining candidates most-wanted first. The component
   * displays the kept subset in increasing value order. The parent already
   * leaves the custom value out, so no suggestion duplicates the custom chip.
   */
  chips: readonly StockChip[];
  /** The row's current stock (family unit) — the active chip's value. */
  value: number;
  /** Family base unit (g / ml): the keyboard input's unit label. */
  baseUnit: 'g' | 'ml';
  /**
   * The custom value chip (the value typed through the keyboard, with its
   * arrangement label — shopping unit included when one exists), or null when
   * no custom value has been entered.
   */
  customChip: StockChip | null;
  /**
   * Whether the "andere" chip stays visible even when every suggestion fits on
   * one row. The parent sets this for ingredients **without** a shopping unit:
   * there the suggestions are ladder stops rather than package thresholds, so
   * the typed-value entry must always be reachable without an overflow first.
   */
  alwaysShowAndere?: boolean;
  /** Reports a suggestion chip that was tapped. */
  onChange: (stock: number) => void;
  /** Reports a value the user typed into the keyboard input (base unit). */
  onCommitCustom: (value: number) => void;
  /** Accessible name of the control, e.g. "Vorrat für Mehl". */
  label: string;
}

/** The gap between two chips (space-2, mirrored in pantry-select.css). */
const CHIP_GAP = 6;

/**
 * How many leading chips (in keep-priority order) fit beside one reserved
 * element of `reservedWidth` px (the custom chip, the "andere" chip, or the
 * keyboard input). 0 = no reserved element; the first chip then has no leading
 * gap.
 */
function countFitting(
  rowWidth: number,
  chipWidths: readonly number[],
  reservedWidth: number,
): number {
  let count = 0;
  let total = reservedWidth;
  let shown = reservedWidth > 0 ? 1 : 0;
  for (const width of chipWidths) {
    const next = total + (shown > 0 ? CHIP_GAP : 0) + width;
    if (next <= rowWidth) {
      total = next;
      shown += 1;
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

/**
 * The stock picker of one row (see the file header): the suggestion chips, the
 * custom value chip, the "andere" chip and the keyboard input, with the one-row
 * clipping measured against the row width.
 */
function StockChips({
  chips,
  value,
  baseUnit,
  customChip,
  alwaysShowAndere = false,
  onChange,
  onCommitCustom,
  label,
}: StockChipsProps) {
  /** How many leading suggestion chips are shown (the rest hide). */
  const [visibleCount, setVisibleCount] = useState(chips.length);
  /** True while the base-unit keyboard input is open; `draft` holds the text. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** The visible chip row — measured for its available width. */
  const rowRef = useRef<HTMLDivElement>(null);
  /** The off-screen strip holding every chip + "andere" for width measurement. */
  const stripRef = useRef<HTMLDivElement>(null);
  /** The open keyboard input together with its unit, measured while it is open
   *  (the unit must share the reserved space, or the row's hidden overflow
   *  would clip it). */
  const editRef = useRef<HTMLSpanElement>(null);

  /** The custom chip, hidden while its keyboard is open. */
  const shownCustomChip: StockChip | null = editing ? null : customChip;

  // Recomputes how many leading suggestion chips fit beside the one reserved
  // element (custom chip / "andere" / keyboard input).
  const measure = useCallback(() => {
    const row = rowRef.current;
    const strip = stripRef.current;
    if (row === null || strip === null) {
      return;
    }
    const rowWidth = row.clientWidth;
    const chipWidths = Array.from(strip.querySelectorAll<HTMLElement>('[data-chip]')).map(
      (el) => el.offsetWidth,
    );
    const customWidth = strip.querySelector<HTMLElement>('[data-custom]')?.offsetWidth ?? 0;
    const andereWidth = strip.querySelector<HTMLElement>('[data-andere]')?.offsetWidth ?? 0;
    const editWidth = editRef.current?.offsetWidth ?? 0;
    const customShown = !editing && customChip !== null;

    if (editing) {
      setVisibleCount(countFitting(rowWidth, chipWidths, editWidth));
    } else if (customShown) {
      setVisibleCount(countFitting(rowWidth, chipWidths, customWidth));
    } else if (!alwaysShowAndere && countFitting(rowWidth, chipWidths, 0) === chips.length) {
      // All suggestions fit without "andere": show them all.
      setVisibleCount(chips.length);
    } else {
      // "andere" is reserved — either because not all suggestions fit, or
      // because it must always stay visible. The suggestions are measured
      // against the space that remains beside it.
      setVisibleCount(countFitting(rowWidth, chipWidths, andereWidth));
    }
  }, [chips, customChip, editing, alwaysShowAndere]);

  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (row === null) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  // Re-measure once the bundled font has loaded: the strip's chip widths are
  // what the visible row uses, and the fallback font can differ by a few px.
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

  /** Opens the keyboard, pre-filled with the current stock. */
  function beginEdit(): void {
    setEditing(true);
    setDraft(formatDecimal(roundThousandths(value)));
  }

  /** Commits the typed base-unit value (unchanged input is a no-op). */
  function commit(): void {
    setEditing(false);
    const parsed = parseInput(draft);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const rounded = roundThousandths(parsed);
    if (rounded === roundThousandths(value)) {
      return;
    }
    onCommitCustom(rounded);
  }

  /** Closes the keyboard, keeping the previous value. */
  function cancel(): void {
    setEditing(false);
  }

  const visibleSuggestions = chips.slice(0, visibleCount);
  // The kept chips always display in increasing value order — the keep-priority
  // only decided *which* of them survived the one-row fit. The custom chip, when
  // present, sits at its own increasing position among the suggestions.
  const sorted =
    shownCustomChip === null
      ? [...visibleSuggestions].sort((a, b) => a.value - b.value)
      : [...visibleSuggestions, shownCustomChip].sort((a, b) => a.value - b.value);
  const showAndere =
    !editing && customChip === null && (alwaysShowAndere || visibleCount < chips.length);

  return (
    <div className="stock-chips-wrap">
      <div className="stock-chips" ref={rowRef} role="group" aria-label={label}>
        {sorted.map((chip) =>
          shownCustomChip !== null && chip === shownCustomChip ? (
            <button
              key={`custom-${chip.value}`}
              type="button"
              className="chip chip-active chip-custom"
              onClick={beginEdit}
              title="Eigenen Wert bearbeiten"
            >
              <PencilIcon className="chip-icon" />
              <span>{chip.label}</span>
            </button>
          ) : (
            <button
              key={chip.value}
              type="button"
              className={chip.value === value ? 'chip chip-active' : 'chip'}
              onClick={() => onChange(chip.value)}
            >
              {chip.label}
            </button>
          ),
        )}
        {showAndere && (
          <button
            type="button"
            className="chip chip-clear"
            onClick={beginEdit}
            title="Anderen Wert eintippen"
          >
            <MoreVertIcon className="chip-icon" />
            <span>andere</span>
          </button>
        )}
        {editing && (
          <span className="pantry-value-edit" ref={editRef}>
            <input
              className="pantry-value-input"
              // The phone's number keypad; the value may carry a decimal comma.
              inputMode="decimal"
              enterKeyHint="done"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') cancel();
              }}
              aria-label={`${label} in ${baseUnit}`}
            />
            <span className="pantry-value-unit">{baseUnit}</span>
          </span>
        )}
      </div>

      {/* The measurement strip: every suggestion chip + the custom chip (when it
          exists) + "andere", laid out off-screen so the visible row can hide its
          overflow without losing a width it still needs for a later (wider)
          layout. Non-interactive and screen-reader hidden. */}
      <div className="stock-chips-measure" ref={stripRef} aria-hidden="true">
        {chips.map((chip) => (
          <button key={chip.value} type="button" tabIndex={-1} data-chip className="chip">
            {chip.label}
          </button>
        ))}
        {shownCustomChip !== null && (
          <button type="button" tabIndex={-1} data-custom className="chip chip-active chip-custom">
            <PencilIcon className="chip-icon" />
            <span>{shownCustomChip.label}</span>
          </button>
        )}
        <button type="button" tabIndex={-1} data-andere className="chip chip-clear">
          <MoreVertIcon className="chip-icon" />
          <span>andere</span>
        </button>
      </div>
    </div>
  );
}

export default StockChips;
