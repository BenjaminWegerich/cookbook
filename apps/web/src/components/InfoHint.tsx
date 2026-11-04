import { useId, useState, type ReactNode } from 'react';
import { InfoIcon } from './icons';

/**
 * A caption with an optional explanation behind an (i) toggle — the shared
 * pattern for every field hint (docs/ui_patterns.md §3, docs/DESIGN.md §5.4).
 *
 * A long "how it works" paragraph under a caption is read once and costs a
 * line on every visit; a rule the user needs before acting must stay visible.
 * So the component keeps the caption, the control and the hint together, but
 * shows the hint only on request. It is deliberately an inline disclosure and
 * not a tooltip, popover or sheet:
 *
 * - it works the same with a finger and a mouse (hover-only help has no phone
 *   equivalent);
 * - it needs no anchor measurement, outside-click handling or scrim, so a
 *   two-sentence explanation never interrupts the form;
 * - the hint text keeps the established `.field-hint` look, so hiding it is a
 *   visibility change, not a second visual style.
 *
 * The panel sits between the caption and the control, exactly where DESIGN
 * §5.4 places a hint. The toggle lives at the right end of the caption row, so
 * its position never depends on the caption's length; the card variant moves
 * the same row to the card's title.
 *
 * The toggle is a real button, so it is keyboard reachable and carries the
 * accessible name of what it explains ("Hinweis zur Genauigkeit"). When a hint
 * exists, its panel is always in the DOM with `hidden`, which keeps
 * `aria-controls` valid and lets the browser remove it from the accessibility
 * tree while closed. Escape closes an open hint before the surrounding sheet
 * sees the key.
 */
interface InfoHintProps {
  /** The visible caption (field variant) or card title (card variant). */
  label: string;
  /** The toggle's accessible name, e.g. "Hinweis zur Genauigkeit". */
  hintLabel: string;
  /**
   * The quiet explanation. Omit it where the caption has nothing to explain
   * yet (the editor's empty ingredient list), so the toggle does not promise
   * content that is not there.
   */
  hint?: ReactNode;
  /** Marks the field as optional (field variant only). */
  optional?: boolean;
  /** A form field (default) or a card with a heading row. */
  variant?: 'field' | 'card';
  /** Heading level for the card variant; the editor's sections use h3, the key card h2. */
  headingLevel?: 2 | 3;
  /** The wrapper's class, e.g. "field" or "editor-card". */
  className?: string;
  /** An existing anchor/scroll target on the wrapper. */
  id?: string;
  /** The card section's accessible name, where it differs from the title. */
  ariaLabel?: string;
  /** The control(s) below the caption and hint. */
  children: ReactNode;
}

export default function InfoHint({
  label,
  hintLabel,
  hint,
  optional = false,
  variant = 'field',
  headingLevel = 3,
  className,
  id,
  ariaLabel,
  children,
}: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // An absent hint (not an empty string) means "caption only": the ingredient
  // list is empty before any step row exists, and its sentence would only
  // repeat the empty state below.
  const hasHint = hint !== undefined && hint !== null;

  const toggle = (
    <button
      type="button"
      className="hint-toggle"
      aria-label={hintLabel}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        // The first Escape belongs to the open hint; a second one can then
        // reach the sheet's own Escape handling.
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <InfoIcon className="hint-toggle-icon" optical={20} />
    </button>
  );

  const panel = hasHint && (
    <div className="field-hint" id={panelId} hidden={!open}>
      {hint}
    </div>
  );

  if (variant === 'card') {
    const Heading = headingLevel === 2 ? 'h2' : 'h3';
    return (
      <section className={className} id={id} aria-label={ariaLabel ?? label}>
        <div className="editor-card-head">
          <Heading className="editor-card-title">{label}</Heading>
          {hasHint && toggle}
        </div>
        {panel}
        {children}
      </section>
    );
  }

  return (
    <div className={className} id={id}>
      <div className="field-label-row">
        <span className="field-label">
          {label}
          {optional && <span className="optional-mark">optional</span>}
        </span>
        {hasHint && toggle}
      </div>
      {panel}
      {children}
    </div>
  );
}
