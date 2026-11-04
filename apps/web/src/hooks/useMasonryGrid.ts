/**
 * Keep-style masonry for a card grid (the two card sections of the recipe list).
 *
 * Why this exists: the cards of one section differ in height. A card with a
 * photo is a 4:3 media area plus one to three title lines; a text-only card is
 * a title alone (up to six lines) and may add a badge below it. Until now the
 * grid stretched every card of a row to the tallest one, so a one-line title
 * bought empty surface. The agreed reference is Google Keep (decided with the
 * user): every card is exactly as tall as its content and the next card drops
 * into the lowest free space, which gives up horizontal alignment on purpose —
 * card edges in one column no longer line up with their neighbours' edges.
 *
 * How it works: the list is a CSS grid with one column per breakpoint and very
 * short fixed rows (`grid-auto-rows: var(--space-1)`, see recipe-list.css).
 * This hook measures each card and lets its list item span as many of those
 * rows as the card is tall plus one card gap. With `grid-auto-flow: row dense`
 * the browser then places every item in the first free slot, scanning left to
 * right and top to bottom — which is Keep's "shortest column" rule without
 * measuring the columns. The stylesheet stays the single source of truth for
 * the column count (breakpoints), the row quantum and the gap; this hook only
 * reads those computed values, measures, and writes the row span.
 *
 * The measurement runs before paint after every render (`useLayoutEffect`), so
 * no unpositioned first frame is ever shown, and again whenever a card changes
 * height: `RecipeThumb` downloads a photo asynchronously and a text-only card
 * grows into a photo card, and a font swap reflows the titles.
 *
 * The observer watches the cards, not the list: the list's own height is a
 * result of the spans written here, so watching it would make every write
 * schedule another measurement. A card's height does not depend on its row
 * span (only on its column width and its content), so writing spans cannot
 * feed the observer — the layout settles after one pass.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Row height assumed if the stylesheet's `grid-auto-rows` is unreadable. */
const FALLBACK_ROW_QUANTUM = 1;
/** Card gap assumed if the stylesheet's `column-gap` is unreadable. */
const FALLBACK_GAP = 0;

/**
 * Measures the cards of one grid and spans their list items over the grid's
 * short rows (see the file header). Reads the row quantum and the card gap
 * from the list's computed style, so both stay token-driven in recipe-list.css.
 */
function layoutCards(list: HTMLElement): void {
  const style = window.getComputedStyle(list);
  const quantum = Number.parseFloat(style.gridAutoRows) || FALLBACK_ROW_QUANTUM;
  const gap = Number.parseFloat(style.columnGap) || FALLBACK_GAP;
  const items = Array.from(list.children) as HTMLElement[];

  // Measure every card before writing any span: a read after a write would
  // force the browser to lay the grid out again for every single card. The
  // card is the item's first child element (the `li` itself is stretched to
  // its grid area and says nothing about the content height).
  const spans = items.map((item) => {
    const card = item.firstElementChild;
    if (card === null) return 1;
    const height = card.getBoundingClientRect().height;
    return Math.max(1, Math.ceil((height + gap) / quantum));
  });

  // Writing only when the span differs keeps the observer quiet: React reuses
  // the same `li` across renders, and most cards keep their span.
  items.forEach((item, index) => {
    const span = `span ${spans[index]}`;
    if (item.style.gridRowEnd !== span) item.style.gridRowEnd = span;
  });
}

/**
 * Returns the ref for an element of class `.recipe-list` (see
 * recipe-list.css) and keeps its cards laid out as masonry (see the file
 * header). Takes no arguments: the layout is derived from the stylesheet and
 * the cards themselves.
 */
export function useMasonryGrid<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  // No dependency array on purpose: any render can change a card's height
  // (another title, a badge, a filtered set), so the measurement runs after
  // every one of them. It writes only the spans that actually changed.
  useLayoutEffect(() => {
    const list = ref.current;
    if (list === null) return;
    layoutCards(list);

    // Cards grow later: a downloaded photo, a swapped font. Observing the cards
    // themselves (not the list) cannot loop — see the file header. Re-observing
    // per render keeps the watched set in step with the filtered list.
    const observer = new ResizeObserver(() => layoutCards(list));
    for (const item of Array.from(list.children)) {
      const card = item.firstElementChild;
      if (card !== null) observer.observe(card);
    }
    return () => observer.disconnect();
  });

  return ref;
}
