/**
 * StepEditor — a contenteditable step field for the step *prose*.
 *
 * The prose may contain inline display-only artifacts ({{100 g}} /
 * {{1500 ml Wasser}}, storage_format.md §4). Artifacts render as non-editable
 * code-like chips ("wie ein Inline-Code-Schnipsel", decided with the user);
 * they are inserted at the caret from the ingredient sheet and carry a small
 * "×" to remove them. They never count toward any ingredient list — the
 * counted ingredients live in the step's own list above this editor.
 *
 * Model: the step text string is the source of truth. The DOM is authoritative
 * while the user types (re-rendering on every keystroke would lose the caret);
 * the component syncs the string upward via onChange and only re-renders the
 * segments when the string changed externally (artifact insert/remove).
 *
 * The "+ Menge im Text" insertion happens at the caret: the editor calls
 * `insertArtifact` (via the exposed ref) with the tracked caret offset.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import {
  artifactToText,
  formatBQ,
  insertArtifact,
  renderAQS,
  splitArtifacts,
  type TextArtifact,
} from '@cookbook/core';

/** One renderable segment of the step: plain prose or an artifact. */
type Segment =
  | { type: 'text'; value: string }
  | { type: 'artifact'; artifact: TextArtifact; stored: string };

/** Splits a step into segments (prose / artifacts), preserving order. */
function splitSegments(step: string): Segment[] {
  return splitArtifacts(step).segments.map((segment) =>
    segment.type === 'text'
      ? { type: 'text', value: segment.value }
      : { type: 'artifact', artifact: segment.artifact, stored: artifactToText(segment.artifact) },
  );
}

/** Serializes one DOM node back into the step string (recursive). */
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node instanceof HTMLElement) {
    if (node.dataset.artifact !== undefined) {
      // Artifact spans contribute their stored text, never their display text.
      return node.dataset.artifact;
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
    } else if (node instanceof HTMLElement && node.dataset.artifact !== undefined) {
      offset += node.dataset.artifact.length;
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
  /** Inserts an artifact at the given offset (or the current caret, else the end). */
  insertArtifact: (artifact: TextArtifact, at?: number) => void;
  /** The string offset of the current caret (for the "+ Menge im Text" button). */
  caretOffset: () => number;
}

interface StepEditorProps {
  /** The step prose with {{…}} artifacts (source of truth). */
  value: string;
  /** Called with the new prose whenever it changes. */
  onChange: (step: string) => void;
  /** Error text to show under the step (validation feedback, §7). */
  error?: string;
}

/**
 * The contenteditable step field (see file header). The DOM is authoritative
 * while typing; the segments are re-rendered only when `value` changes
 * externally (artifact insert/remove).
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
        const span = document.createElement('span');
        span.className = 'step-artifact';
        span.contentEditable = 'false';
        span.dataset.artifact = segment.stored;
        span.textContent =
          segment.artifact.name === undefined
            ? segment.artifact.unit === undefined
              ? String(segment.artifact.quantity)
              : formatBQ(segment.artifact.quantity, segment.artifact.unit)
            : renderAQS(
                segment.artifact.name,
                segment.artifact.quantity,
                segment.artifact.unit ?? 'g',
              );
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'artifact-remove';
        remove.setAttribute('aria-label', 'Menge entfernen');
        remove.textContent = '×';
        span.appendChild(remove);
        div.appendChild(span);
      }
    }
    // After an artifact insert, place the caret after the new artifact: the
    // span whose accumulated string offset equals the insertion offset.
    const caretTarget = caretAfterRef.current;
    if (caretTarget !== null) {
      caretAfterRef.current = null;
      let offset = 0;
      let target: HTMLElement | undefined;
      for (const node of Array.from(div.childNodes)) {
        if (node instanceof HTMLElement && node.dataset.artifact !== undefined) {
          if (offset === caretTarget.at) {
            target = node;
            break;
          }
          offset += node.dataset.artifact.length;
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
      insertArtifact: (artifact: TextArtifact, at?: number) => {
        const div = divRef.current;
        const offset = at ?? (div === null ? value.length : caretStringOffset(div));
        caretAfterRef.current = { at: offset };
        onChange(insertArtifact(value, offset, artifact));
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

  /** Removes the artifact under the × button (display-only mention). */
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const remove = (event.target as HTMLElement).closest('.artifact-remove');
    if (remove === null) return;
    const span = remove.closest<HTMLElement>('[data-artifact]');
    const parent = span?.parentElement;
    const artifactText = span?.dataset.artifact;
    if (span === undefined || parent === null || parent === undefined || artifactText === undefined)
      return;
    // Remove exactly the clicked artifact (its string offset within the step).
    let at = 0;
    for (const node of Array.from(parent.childNodes)) {
      if (node === span) break;
      if (node instanceof HTMLElement && node.dataset.artifact !== undefined) {
        at += node.dataset.artifact.length;
      } else {
        at += node.textContent?.length ?? 0;
      }
    }
    onChange(`${value.slice(0, at)}${value.slice(at + artifactText.length)}`);
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
