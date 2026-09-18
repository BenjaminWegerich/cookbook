/**
 * Per-page window scroll memory for the in-place screen navigation (App.tsx).
 *
 * Why this exists: the app is a single document with one window scroll offset,
 * and it swaps full-screen pages in place (the recipe list is unmounted, the
 * editor levels are mounted and hidden via `hidden`). The browser keeps its one
 * offset across such a swap, so without this hook every newly opened page is
 * painted at the previous page's scroll distance. The agreed behaviour is the
 * opposite:
 * - a page that is opened (list → editor, editor level → linked sub-recipe)
 *   starts at the top;
 * - going back to the page below reveals it exactly where it was left.
 *
 * How it works: the caller passes the key of the page/level that is visible
 * right now. Every navigation handler first calls `remember()` while the old
 * page is still in the DOM, so `window.scrollY` is still its exact offset — a
 * later read would be too late, because by then the browser has already clamped
 * the offset to the new document height. A layout effect then reveals the new
 * page at its remembered offset before the browser paints; a page that was
 * never stored — i.e. an instance opened for the first time — starts at the top.
 *
 * `forget(key)` drops the memory of a page instance that no longer exists (a
 * popped editor level), so opening the same recipe again is a fresh page and
 * starts at the top again.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export interface ScrollMemory {
  /**
   * Stores the current window offset under the page that is visible now. Called
   * by the navigation handlers before they change the visible page.
   */
  remember: () => void;
  /** Drops the remembered offset of one page key. */
  forget: (pageKey: string) => void;
}

/**
 * Tracks the window scroll of the page identified by `pageKey` and restores the
 * remembered offset whenever the visible page changes (see the file header).
 */
export function useScrollMemory(pageKey: string): ScrollMemory {
  /** Remembered offset per page key. */
  const offsetsRef = useRef(new Map<string, number>());
  /** The page key that owns `window.scrollY` right now (before the effect). */
  const activeKeyRef = useRef(pageKey);

  // The app restores page offsets itself, so the browser's own scroll
  // restoration for history entries must stay out of the way: it would run
  // after the popstate commit and paint a stale offset over ours.
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // The visible page changed: adopt the new key and reveal it at the offset it
  // was left at. A first-time page (no stored offset) starts at the top.
  // useLayoutEffect, not useEffect: the restore must happen before the browser
  // paints, otherwise the new page flashes at the old scroll distance first.
  useLayoutEffect(() => {
    if (activeKeyRef.current === pageKey) return;
    activeKeyRef.current = pageKey;
    window.scrollTo(0, offsetsRef.current.get(pageKey) ?? 0);
  }, [pageKey]);

  const remember = useCallback((): void => {
    offsetsRef.current.set(activeKeyRef.current, window.scrollY);
  }, []);

  const forget = useCallback((key: string): void => {
    offsetsRef.current.delete(key);
  }, []);

  // Memoized so the returned object is referentially stable and can be a
  // dependency of the caller's useCallback hooks.
  return useMemo(() => ({ remember, forget }), [remember, forget]);
}
