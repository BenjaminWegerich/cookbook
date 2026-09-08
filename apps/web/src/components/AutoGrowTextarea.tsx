/**
 * AutoGrowTextarea — a wrapping text field that grows to fit its content.
 *
 * Used for the Kopf data text fields (Titel, Untertitel, Beschreibung): the
 * field starts one line tall (three with `tall`, matching the step text) and
 * grows so the whole text stays visible — no vertical or horizontal scrolling.
 * The text may wrap across visual lines, but a line break is never *data*:
 * Enter never inserts a newline (the phone keyboard's return acts as a
 * "next" key, see enterKeyHint) and pasted line breaks are flattened to
 * single spaces. The stored string therefore stays a single logical line
 * (docs/storage_format.md §2 — description is "A single paragraph").
 */

import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

interface AutoGrowTextareaProps {
  /** The current text — source of truth, controlled by the parent. */
  value: string;
  /** Called with the new text on every change. */
  onChange: (value: string) => void;
  /** Runs instead of inserting a line break when Enter is pressed — focus the
   *  next text field (omit to keep Enter a no-op). */
  onEnter?: () => void;
  /** Starts three lines tall instead of one (Beschreibung). */
  tall?: boolean;
  /** Mobile keyboard key label (default "next"). */
  enterKeyHint?: 'next' | 'done';
  /** Wired to the <textarea> (validation scroll/focus targets). */
  id?: string;
}

/**
 * See the file header. Height is synced to the content (scrollHeight) so the
 * box always fits exactly; the start sizes are CSS floors (42 px / 74 px,
 * both on the design ladder) that only matter while the field is empty.
 */
const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  function AutoGrowTextarea(
    { value, onChange, onEnter, tall = false, enterKeyHint = 'next', id },
    ref,
  ) {
    const nodeRef = useRef<HTMLTextAreaElement | null>(null);

    /** Bridges the internal node ref to the forwarded ref. */
    const setRef = (node: HTMLTextAreaElement | null): void => {
      nodeRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref !== null) {
        ref.current = node;
      }
    };

    /** Sizes the box to its content. The CSS floor is temporarily dropped
     *  during the measurement so scrollHeight reflects only the text; the
     *  floor (min-height) still applies afterwards, keeping empty fields at
     *  their start size. scrollHeight excludes the borders, so their height
     *  is added back (the app uses border-box sizing). */
    const fitToContent = useCallback((): void => {
      const element = nodeRef.current;
      if (element === null) return;
      const previousMinHeight = element.style.minHeight;
      element.style.minHeight = '0px';
      element.style.height = '0px';
      const borderY =
        parseFloat(getComputedStyle(element).borderTopWidth) +
        parseFloat(getComputedStyle(element).borderBottomWidth);
      element.style.height = `${element.scrollHeight + borderY}px`;
      element.style.minHeight = previousMinHeight;
    }, []);

    // Fit on mount and whenever the text changed externally (recipe load,
    // cleared draft).
    useLayoutEffect(() => {
      fitToContent();
    }, [value, fitToContent]);

    // Refit when the available width changes (viewport rotation, zoom, ...):
    // different wrapping needs a different height.
    useLayoutEffect(() => {
      const element = nodeRef.current;
      if (element === null) return;
      const observer = new ResizeObserver(fitToContent);
      observer.observe(element);
      return () => observer.disconnect();
    }, [fitToContent]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Line breaks are not data here: Enter never inserts one; it acts as
      // the "next" key and hands over to the next text field.
      if (event.key === 'Enter') {
        event.preventDefault();
        onEnter?.();
      }
    };

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      // Flatten pasted line breaks to single spaces (single logical line).
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      const flat = text
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join(' ');
      document.execCommand('insertText', false, flat);
    };

    return (
      <textarea
        ref={setRef}
        id={id}
        className={tall ? 'grow-tall' : undefined}
        value={value}
        enterKeyHint={enterKeyHint}
        rows={tall ? 3 : 1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
    );
  },
);

export default AutoGrowTextarea;
