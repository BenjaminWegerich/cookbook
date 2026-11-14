/**
 * TipsField — the collapsible long-text field of the recipe editor.
 *
 * One component serves the recipe-level tips at the bottom of the Kopfdaten
 * card and each step's tips under its prose. The field is always visible as a
 * quiet row, but the textarea only opens on request:
 *
 * - empty, closed: `+ Tipps` (quiet text button), tapping opens and focuses;
 * - filled, closed: `▸ Tipps · <first line>` — the preview keeps several
 *   collapsed blocks recognizable;
 * - open: `▾ Tipps`, a growing multi-line textarea and `Entfernen`.
 *
 * Line breaks are data here (unlike Titel/Beschreibung): Enter inserts a
 * paragraph, and blank lines separate paragraphs. The parent stores the raw
 * text and `normalizeRecipe()` trims it and drops an empty value on save.
 * The visible label is always „Tipps“; `ariaLabel` names the subject for screen
 * readers („Tipps“ or „Tipps zu Schritt 2“).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';

import AutoGrowTextarea from './AutoGrowTextarea';
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

export default function TipsField({ value, onChange, ariaLabel }: TipsFieldProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryRef = useRef<HTMLButtonElement | null>(null);
  /** True only for an add click, so opening existing tips does not pop the
   *  mobile keyboard while the user just wants to read them. */
  const focusOnOpenRef = useRef(false);
  const text = value ?? '';
  const isEmpty = text.trim() === '';
  const preview = isEmpty ? '' : firstLine(text);

  useLayoutEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const element = textareaRef.current;
    if (element !== null) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
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
          <div className="field">
            <AutoGrowTextarea
              ref={textareaRef}
              multiline
              ariaLabel={ariaLabel}
              value={text}
              onChange={onChange}
            />
          </div>
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
