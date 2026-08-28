/**
 * StepEditor — a contenteditable step field that renders ingredient markers
 * ({{ingredient|…}}) as non-editable artifacts (decided with the user: an
 * artifact "is not plain text, but an artifact — like an inline code
 * snippet").
 *
 * Model: the step string (with markers) is the source of truth. The DOM is
 * authoritative while the user types (re-rendering on every keystroke would
 * lose the caret); the component syncs the string upward via onChange and
 * only re-renders the segments when the string changed externally (marker
 * insert/remove). Artifacts carry a small "×" to remove them — removing the
 * artifact from the text also removes the ingredient from the derived list
 * (the list is derived from the markers, storage_format.md §4).
 *
 * The "+ Zutat" insertion happens at the caret: the editor calls
 * `insertMarker` (via the exposed ref) with the tracked caret offset.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import {
  extractMarkers,
  insertMarkerIntoStep,
  markerToText,
  type IngredientMarker,
} from '@cookbook/core';
import { renderAQS } from '@cookbook/core';

/** One renderable segment of the step: plain text or an ingredient marker. */
type Segment = { type: 'text'; value: string } | { type: 'marker'; marker: IngredientMarker };

/** Splits a step into segments (text / markers), preserving order. */
function splitSegments(step: string): Segment[] {
  const segments: Segment[] = [];
  const markerPattern = /\{\{ingredient\|[^}]*\}\}/g;
  let lastIndex = 0;
  for (const match of step.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: step.slice(lastIndex, index) });
    }
    const marker = extractMarkers(match[0])[0];
    if (marker !== undefined) {
      segments.push({ type: 'marker', marker });
    } else {
      // A malformed {{…}} block is shown as plain text (the validator flags
      // it on save); it must never be dropped from the display.
      segments.push({ type: 'text', value: match[0] });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < step.length) {
    segments.push({ type: 'text', value: step.slice(lastIndex) });
  }
  return segments;
}

/** Serializes one DOM node back into the step string (recursive). */
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node instanceof HTMLElement) {
    if (node.dataset.marker !== undefined) {
      // Artifact spans contribute their marker text, never their display text.
      return node.dataset.marker;
    }
    // Browser-created block elements from Enter (<div>, <br>) carry their
    // inner text; line breaks collapse on save (steps are single-line, §5).
    let result = '';
    for (const child of Array.from(node.childNodes)) {
      result += serializeNode(child);
    }
    return result;
  }
  return '';
}

/** Serializes the DOM back to the step string (text nodes + artifact spans). */
function serializeDom(div: HTMLDivElement): string {
  return Array.from(div.childNodes).map(serializeNode).join('');
}

/** The string offset of the current caret within the step. */
function caretStringOffset(div: HTMLDivElement): number {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return serializeDom(div).length;
  const range = selection.getRangeAt(0);
  let offset = 0;
  for (const node of Array.from(div.childNodes)) {
    if (node === range.startContainer) {
      return offset + range.startOffset;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
    } else if (node instanceof HTMLElement && node.dataset.marker !== undefined) {
      offset += node.dataset.marker.length;
    }
  }
  return offset;
}

/** Places the caret right after the artifact span (used after an insert). */
function placeCaretAfter(span: HTMLElement): void {
  const range = document.createRange();
  range.setStartAfter(span);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export interface StepEditorHandle {
  /** Inserts a marker at the given offset (or the current caret, else the end). */
  insertMarker: (marker: IngredientMarker, at?: number) => void;
  /** The string offset of the current caret (for the "+ Zutat" button). */
  caretOffset: () => number;
}

interface StepEditorProps {
  /** The step string with markers (source of truth). */
  value: string;
  /** Called with the new step string whenever it changes. */
  onChange: (step: string) => void;
  /** Error text to show under the step (validation feedback, §7). */
  error?: string;
}

/**
 * The contenteditable step field (see file header). The DOM is authoritative
 * while typing; the segments are re-rendered only when `value` changes
 * externally (marker insert/remove).
 */
const StepEditor = forwardRef<StepEditorHandle, StepEditorProps>(function StepEditor(
  { value, onChange, error },
  ref,
) {
  const divRef = useRef<HTMLDivElement | null>(null);
  /** Insert position whose artifact should receive the caret after the next render. */
  const caretAfterRef = useRef<{ at: number } | null>(null);

  /** Renders the segments into the DOM (text nodes + artifact spans). */
  const renderSegments = (): void => {
    const div = divRef.current;
    if (div === null) return;
    div.innerHTML = '';
    for (const segment of splitSegments(value)) {
      if (segment.type === 'text') {
        div.appendChild(document.createTextNode(segment.value));
      } else {
        const markerText = markerToText(segment.marker);
        const span = document.createElement('span');
        span.className = 'step-artifact';
        span.contentEditable = 'false';
        span.dataset.marker = markerText;
        span.textContent = renderAQS(
          segment.marker.name,
          segment.marker.quantity,
          segment.marker.unit,
        );
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'artifact-remove';
        remove.setAttribute('aria-label', `Zutat ${segment.marker.name} entfernen`);
        remove.textContent = '×';
        span.appendChild(remove);
        div.appendChild(span);
      }
    }
    // After a marker insert, place the caret after the new artifact: the span
    // whose accumulated string offset equals the insertion offset (exact even
    // when an identical marker already exists).
    const caretTarget = caretAfterRef.current;
    if (caretTarget !== null) {
      caretAfterRef.current = null;
      let offset = 0;
      let target: HTMLElement | undefined;
      for (const node of Array.from(div.childNodes)) {
        if (node instanceof HTMLElement && node.dataset.marker !== undefined) {
          if (offset === caretTarget.at) {
            target = node;
            break;
          }
          offset += node.dataset.marker.length;
        } else {
          offset += node.textContent?.length ?? 0;
        }
      }
      if (target !== undefined) {
        placeCaretAfter(target);
      }
    }
  };

  // Initial render; re-render only when the value changed externally (the DOM
  // is authoritative while the user types — re-rendering would lose the caret).
  useEffect(() => {
    const div = divRef.current;
    if (div !== null && serializeDom(div) !== value) {
      renderSegments();
    }
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      insertMarker: (marker: IngredientMarker, at?: number) => {
        const div = divRef.current;
        const offset = at ?? (div === null ? value.length : caretStringOffset(div));
        caretAfterRef.current = { at: offset };
        onChange(insertMarkerIntoStep(value, offset, marker));
      },
      caretOffset: () => (divRef.current === null ? 0 : caretStringOffset(divRef.current)),
    }),
    [value, onChange],
  );

  const handleInput = (): void => {
    const div = divRef.current;
    if (div !== null) {
      onChange(serializeDom(div));
    }
  };

  /** Removes the artifact under the × button (removal = list entry disappears). */
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const remove = (event.target as HTMLElement).closest('.artifact-remove');
    if (remove === null) return;
    const span = remove.closest<HTMLElement>('[data-marker]');
    const parent = span?.parentElement;
    const markerText = span?.dataset.marker;
    if (span === undefined || parent === null || parent === undefined || markerText === undefined)
      return;
    // Remove exactly the clicked marker (its string offset within the step).
    // Artifact siblings count by their marker text length, text by text length.
    let at = 0;
    for (const node of Array.from(parent.childNodes)) {
      if (node === span) break;
      if (node instanceof HTMLElement && node.dataset.marker !== undefined) {
        at += node.dataset.marker.length;
      } else {
        at += node.textContent?.length ?? 0;
      }
    }
    onChange(`${value.slice(0, at)}${value.slice(at + markerText.length)}`);
  };

  return (
    <div className="step-editor-wrap">
      <div
        ref={divRef}
        className="step-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={handleInput}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        data-placeholder="Schritt beschreiben …"
      />
      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export default StepEditor;
