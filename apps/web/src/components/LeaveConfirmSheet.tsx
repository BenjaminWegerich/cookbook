/**
 * The confirmation question, as the app's ordinary bottom sheet.
 *
 * Why this exists (decided with the user, docs/DESIGN.md §6.2): the discard
 * question used to be a third line inside the screen's sticky header, and the
 * destructive confirmations used to swap their own label in place. Both made a
 * decision look like a change of state on a control. The question is now a real
 * change over the screen (§6.1) — the same sheet every other change uses (§5.6),
 * with the same scrim, the same 32rem cap and the same bottom action row.
 *
 * The row keeps §5.1's order for a dangerous decision: the danger button leaves
 * the no | yes order and sits at the left end (`.sheet-actions .danger-button`
 * pulls it there), with the quiet „Abbrechen" beside the right edge.
 *
 * Closing the sheet is not answering it: the scrim, Escape and the browser Back
 * button all call `onCancel`, and only `onConfirm` performs the action. The
 * caller owns both — this component is only the look and the row.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

interface LeaveConfirmSheetProps {
  /** The question, as the sheet's head („Änderungen am Rezept verwerfen?"). */
  question: string;
  /** One muted line naming what would be lost, under the question. */
  detail: string;
  /** The danger answer's label: the action in the infinitive („Verwerfen"). */
  confirmLabel: string;
  /** Dismisses the question and keeps working („Abbrechen", scrim, Escape, Back). */
  onCancel: () => void;
  /** The confirmed action — the one control that discards. */
  onConfirm: () => void;
}

export default function LeaveConfirmSheet({
  question,
  detail,
  confirmLabel,
  onCancel,
  onConfirm,
}: LeaveConfirmSheetProps) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={question}>
        <div className="sheet-head">
          <h2 className="sheet-title">{question}</h2>
          <p className="sheet-subtitle">{detail}</p>
        </div>
        <div className="sheet-actions">
          <button type="button" className="danger-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          {/* Focus starts on the quiet answer, so a stray Enter cancels instead
              of discarding. */}
          <button type="button" className="text-button" onClick={onCancel} autoFocus>
            Abbrechen
          </button>
        </div>
      </div>
    </>
  );
}
