/**
 * Horizontal swipe pager for the home screen's two view tabs
 * („Essensplan“ / „Sammlung“).
 *
 * The hook drives one gesture over a clipping viewport that holds a track of
 * side-by-side panes:
 *
 * - A pointer press is only *watched* at first. Once the pointer has travelled
 *   far enough to tell the axes apart, a mostly horizontal move becomes a drag
 *   (the track follows the finger) and a mostly vertical move abandons the
 *   gesture, so the page keeps scrolling natively. The viewport carries
 *   `touch-action: pan-y pinch-zoom` (see recipe-list.css), i.e. the browser
 *   keeps vertical panning and pinch-zoom and hands the horizontal drag to us.
 * - Releasing a drag either snaps back or commits the neighbouring pane,
 *   decided by the distance crossed or by the flick velocity. At the first or
 *   last pane the drag rubber-bands instead of moving past the edge.
 * - A drag ends on a card button, where the browser may still raise a click;
 *   that click is swallowed once so dragging never opens a recipe.
 * - The viewport's height follows the active pane (measured, then kept current
 *   with a ResizeObserver), so the two panes — whose content heights differ
 *   almost always — never leave the dead space a track of two columns would
 *   otherwise reserve below the shorter one.
 *
 * The hook is deliberately DOM-only: it owns the gesture, the translate and the
 * viewport height, and reports a committed pane change through `onIndexChange`.
 * Which pane is active stays the caller's decision (RecipeList's tab state).
 *
 * All pixel values come from the design ladder (docs/CODING_CONVENTIONS.md).
 */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Distance a pointer must travel before the gesture's axis is decided. 10 px is
 * a ladder value and small enough that a deliberate swipe feels immediate,
 * large enough that the tiny jitter of a tap never starts a drag.
 */
const AXIS_LOCK_PX = 10;

/** Fraction of the viewport width a drag must cross to commit the neighbour pane. */
const COMMIT_FRACTION = 0.25;

/** Flick velocity (px/ms) that commits the neighbour pane even on a short drag. */
const COMMIT_VELOCITY = 0.35;

/**
 * How much of an over-the-edge drag still follows the finger: the rubber band
 * says "there is nothing here" without the track ever leaving the viewport.
 */
const EDGE_RESISTANCE = 0.35;

interface SwipePagerOptions {
  /** Zero-based pane shown while no drag is in progress. */
  index: number;
  /** Number of panes; a drag never commits past `0` or `count - 1`. */
  count: number;
  /** Called with the neighbouring pane index when a swipe commits. */
  onIndexChange: (next: number) => void;
}

export interface SwipePager {
  /** Clipping viewport: the gesture target and the host of the measured height. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Inline style for the viewport (the active pane's height). */
  viewportStyle: CSSProperties;
  /** The track that translates (holds the panes side by side). */
  trackRef: RefObject<HTMLDivElement | null>;
  /** Inline style for the track (the current translate). */
  trackStyle: CSSProperties;
  /** One stable ref callback per pane, in display order. */
  paneRefs: ((element: HTMLDivElement | null) => void)[];
  /** True while a horizontal drag is moving the track. */
  dragging: boolean;
  /** Pointer handlers to spread onto the viewport. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
}

/**
 * The in-flight gesture. Kept in a ref, not in state: pointer events fire outside
 * React's render cycle and a value that only steers the next event must not wait
 * for a re-render. `phase` is the state machine:
 * `pending` (watching the axis) → `dragging` (the track follows) or the gesture
 * is dropped entirely (vertical move, pointer cancel, release).
 */
interface Gesture {
  phase: 'pending' | 'dragging';
  pointerId: number;
  startX: number;
  startY: number;
  /** Last horizontal sample, for the flick velocity at release. */
  lastX: number;
  lastTime: number;
  /** Horizontal velocity in px/ms, refreshed on every move. */
  velocity: number;
}

/**
 * Drives a touch/mouse drag pager over `count` side-by-side panes (see the file
 * header for the full behaviour).
 */
export function useSwipePager({ index, count, onIndexChange }: SwipePagerOptions): SwipePager {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Mounted pane elements, in display order (measured for the viewport height). */
  const paneElementsRef = useRef<(HTMLDivElement | null)[]>([]);
  /** Height of the active pane in px; null until the first measurement. */
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  /** Current drag distance in px, added to the active pane's position. */
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gestureRef = useRef<Gesture | null>(null);
  /**
   * Set while a drag is in flight: the click the browser may still raise on the
   * card under the finger is swallowed once (see `onClickCapture`).
   */
  const suppressClickRef = useRef(false);

  /**
   * One *stable* ref callback per pane: a fresh callback identity each render
   * would make React detach and re-attach every ref (null → element) on every
   * commit, which would also restart the ResizeObserver below for nothing.
   */
  const paneRefs = useMemo(
    () =>
      Array.from({ length: count }, (_, paneIndex) => (element: HTMLDivElement | null) => {
        paneElementsRef.current[paneIndex] = element;
      }),
    [count],
  );

  // The viewport adopts the active pane's height. useLayoutEffect, not
  // useEffect: the height must be in place before the first paint, otherwise the
  // taller pane's height would flash. The ResizeObserver keeps it honest when
  // the pane's content changes without `index` changing (a refreshed recipe
  // list, resolved meal-plan cards, an empty/loading/connect state).
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const pane = paneElementsRef.current[index];
    if (viewport === null || pane === null) return;
    const applyHeight = (): void => setViewportHeight(pane.offsetHeight);
    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [index, count]);

  /**
   * Dampens a drag that points past the first/last pane, so the edge is felt
   * instead of the track silently leaving the viewport.
   */
  const clampToEdges = (dx: number): number => {
    const pastStart = index === 0 && dx > 0;
    const pastEnd = index === count - 1 && dx < 0;
    return pastStart || pastEnd ? dx * EDGE_RESISTANCE : dx;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Only the primary mouse button drags; a right/middle click is not a swipe.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // One gesture at a time (a second finger on the pane is ignored).
    if (gestureRef.current !== null) return;
    // A new press starts a new gesture: forget the click guard of the previous
    // one, so a drag that raised no click cannot swallow a later, honest tap.
    suppressClickRef.current = false;
    gestureRef.current = {
      phase: 'pending',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (gesture.phase === 'pending') {
      // Wait until the movement is big enough to be a direction at all.
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        // Mostly vertical: this is the page scroll, and the pager steps aside
        // for the rest of the gesture (a "pending" gesture is never resumed).
        gestureRef.current = null;
        return;
      }
      // Mostly horizontal: from here on the drag is ours. Capture the pointer,
      // so a finger that leaves the viewport keeps driving the drag, and mark
      // the click a finished drag may raise for suppression.
      gesture.phase = 'dragging';
      suppressClickRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    // The track follows the finger; the browser's own scrolling is already off
    // the table for this gesture (touch-action), and preventing the default
    // additionally keeps the compatibility mouse events out of the way.
    event.preventDefault();

    const elapsed = event.timeStamp - gesture.lastTime;
    if (elapsed > 0) gesture.velocity = (event.clientX - gesture.lastX) / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;

    setDragOffset(clampToEdges(dx));
  };

  /**
   * Ends the gesture: drops the drag distance and the dragging flag, and — for a
   * release that travelled far enough or flicked fast enough — commits the
   * neighbouring pane. Shared by `pointerup` (may commit) and `pointercancel`
   * (never commits; the browser took the gesture, e.g. for a page scroll).
   */
  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, mayCommit: boolean): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    const wasDragging = gesture.phase === 'dragging';
    const dx = event.clientX - gesture.startX;
    const velocity = gesture.velocity;
    gestureRef.current = null;
    setDragging(false);
    setDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!wasDragging || !mayCommit) return;

    const width = viewportRef.current?.clientWidth ?? 0;
    const travelled = width > 0 && Math.abs(dx) > width * COMMIT_FRACTION;
    const flicked = Math.abs(velocity) > COMMIT_VELOCITY;
    if (!travelled && !flicked) return;
    // A flick decides by its direction, a slow drag by the distance it covered.
    const intent = flicked ? velocity : dx;
    const next = index + (intent < 0 ? 1 : -1);
    if (next < 0 || next >= count) return;
    onIndexChange(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void =>
    finishGesture(event, true);

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void =>
    finishGesture(event, false);

  /**
   * Swallows exactly the one click a finished drag raises on the card that
   * happens to be under the finger. Capture phase, so the card's own onClick
   * never runs. A tap that never became a drag leaves the guard clear and is
   * handled by the card as always.
   */
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    viewportRef,
    viewportStyle: viewportHeight === null ? {} : { height: viewportHeight },
    trackRef,
    // `translateX` in percent is relative to the track's own width, which equals
    // one pane, so `-index * 100%` lands exactly on the active pane; the drag
    // offset rides on top of it in pixels.
    trackStyle: { transform: `translateX(calc(${-index * 100}% + ${dragOffset}px))` },
    paneRefs,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  };
}
