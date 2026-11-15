/**
 * TipsField — the collapsible long-text field of the recipe editor.
 *
 * One component serves the recipe-level tips at the bottom of the Kopfdaten
 * card and each step's tips under its prose. The field is always visible as a
 * quiet row, but the editor only opens on request:
 *
 * - empty, closed: `+ Tipps` (quiet text button), tapping opens and focuses;
 * - filled, closed: `▸ Tipps · <first line>` — the preview keeps several
 *   collapsed blocks recognizable;
 * - open: `▾ Tipps`, a paragraph editor and `Entfernen`.
 *
 * Line breaks are data here (unlike Titel/Beschreibung): Enter creates a new
 * paragraph, and every paragraph is a block with an 18 px gap. The parent stores
 * the raw text (paragraphs joined by blank lines) and `normalizeRecipe()` trims
 * it and drops an empty value on save.
 * The visible label is always „Tipps“; `ariaLabel` names the subject for screen
 * readers („Tipps“ or „Tipps zu Schritt 2“).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';

import { CaretDownIcon, PlusIcon } from './icons';

interface TipsFieldProps {
  /** The current tips text; absent or whitespace-only means "no tips". */
  value: string | undefined;
  /** Raw text change; the parent normalizes on save (paragraphs are data). */
  onChange: (value: string) => void;
  /** The field's accessible name, e.g. „Tipps“ or „Tipps zu Schritt 2“. */
  ariaLabel: string;
}

/** The first non-empty line, used as the collapsed row's preview. */
function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/**
 * The inline text of one node: text stays text, a <br> is a line break, and
 * nested inline markup contributes its children. Block elements are handled by
 * `readTips`, never here.
 */
function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'BR') return '\n';
  return Array.from(node.childNodes).map(inlineText).join('');
}

/** True for the block elements a contenteditable creates for a paragraph. */
function isBlockElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(node.tagName);
}

/**
 * Reads the contenteditable back into the stored plain-text shape: every block
 * is one paragraph, a <br> is a line break inside it. This does not depend on
 * `innerText`'s browser-specific block spacing, so Enter's <p> and <div> both
 * produce the canonical blank-line separation.
 */
function readTips(element: HTMLElement): string {
  const paragraphs: string[] = [];
  let inline = '';

  /** Pushes one inline run, splitting it at blank lines as well. */
  const flush = (): void => {
    for (const part of inline.split(/\n{2,}/)) paragraphs.push(part);
    inline = '';
  };

  for (const node of Array.from(element.childNodes)) {
    if (isBlockElement(node)) {
      if (inline !== '') flush();
      paragraphs.push(inlineText(node));
    } else {
      inline += inlineText(node);
    }
  }
  if (inline !== '' || paragraphs.length === 0) flush();

  return paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''))
        .join('\n')
        .trim(),
    )
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

/**
 * Writes the stored paragraphs into the editor as real block elements, so the
 * stylesheet can put the 18 px paragraph gap between them. A single line break
 * inside a paragraph becomes a <br>; an empty value gets one <br> as the caret
 * anchor.
 */
function writeTips(element: HTMLElement, text: string): void {
  element.replaceChildren();
  const paragraphs =
    text.trim() === '' ? [] : text.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== '');
  if (paragraphs.length === 0) {
    element.appendChild(document.createElement('br'));
    return;
  }
  for (const paragraph of paragraphs) {
    const block = document.createElement('p');
    paragraph.split('\n').forEach((line, index) => {
      if (index > 0) block.appendChild(document.createElement('br'));
      block.appendChild(document.createTextNode(line));
    });
    element.appendChild(block);
  }
}

/** Focuses the editor with the caret after its last character. */
function focusEnd(element: HTMLElement): void {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export default function TipsField({ value, onChange, ariaLabel }: TipsFieldProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLButtonElement | null>(null);
  /** True only for an add click, so opening existing tips does not pop the
   *  mobile keyboard while the user just wants to read them. */
  const focusOnOpenRef = useRef(false);
  const text = value ?? '';
  const textRef = useRef(text);
  const isEmpty = text.trim() === '';
  const preview = isEmpty ? '' : firstLine(text);

  // Keep the latest stored value available to the open effect without making
  // the effect rerun (and the caret reset) on every keystroke.
  useLayoutEffect(() => {
    textRef.current = text;
  }, [text]);

  useLayoutEffect(() => {
    if (!open) return;
    const element = editorRef.current;
    if (element === null) return;
    // The DOM is authoritative while the editor is open; the stored value is
    // synced on every input. Only an opening re-seeds the visible paragraphs.
    writeTips(element, textRef.current);
    if (focusOnOpenRef.current) {
      focusOnOpenRef.current = false;
      focusEnd(element);
    }
  }, [open]);

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    if (isEmpty) focusOnOpenRef.current = true;
    setOpen(true);
  };

  const close = (): void => {
    setOpen(false);
    // Focus was inside the panel; the summary stays and takes it back.
    summaryRef.current?.focus();
  };

  const remove = (): void => {
    onChange('');
    close();
  };

  return (
    <div className="tips-field">
      <button
        ref={summaryRef}
        type="button"
        className={`text-button tips-summary${isEmpty && !open ? ' tips-summary-empty' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        {isEmpty && !open ? (
          <PlusIcon className="button-icon" optical={20} />
        ) : (
          <CaretDownIcon
            className={`button-icon tips-caret${open ? ' tips-caret-open' : ''}`}
            optical={20}
          />
        )}
        <span className="tips-label">Tipps</span>
        {!open && !isEmpty && (
          <span className="tips-preview" aria-hidden="true">
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div
          className="tips-panel"
          id={panelId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div
            ref={editorRef}
            className="tips-editor"
            role="textbox"
            aria-multiline="true"
            aria-label={ariaLabel}
            contentEditable
            suppressContentEditableWarning
            enterKeyHint="enter"
            onInput={() => {
              const element = editorRef.current;
              if (element !== null) onChange(readTips(element));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              document.execCommand(event.shiftKey ? 'insertLineBreak' : 'insertParagraph');
              const element = editorRef.current;
              if (element !== null) onChange(readTips(element));
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData('text/plain');
              if (pasted === '') return;
              document.execCommand('insertText', false, pasted);
            }}
          />
          {!isEmpty && (
            <button type="button" className="text-button danger-text tips-remove" onClick={remove}>
              Entfernen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
