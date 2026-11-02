/**
 * "Nicht gespeicherten Entwurf wiederherstellen?" — offers the local recovery
 * copy back when its recipe is opened again (see recipeDraftRecovery.ts).
 *
 * Decided with the user: only the recipe that was open when the work was lost
 * is offered back, and the question is an ordinary bottom sheet like every other
 * change (docs/DESIGN.md §5.6/§6.2). The title names the recipe and the moment,
 * so the user can tell whether this is the work they remember.
 *
 * Closing the sheet (scrim, Escape, browser Back) is not answering it: the
 * record stays on disk and the prompt can be offered again on the next open.
 * Only „Verwerfen" deletes the recovery copy; „Wiederherstellen" puts it into
 * the editor as the working draft. The primary answer takes focus; the
 * destructive one sits at the left end of the action row.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { formatRecoverableDraftTime, type RecoverableDraft } from './recipeDraftRecovery';

interface DraftRecoverySheetProps {
  /** The stored copy to offer. */
  recovery: RecoverableDraft;
  /** Puts the copy back into the editor (primary answer). */
  onRestore: () => void;
  /** Deletes the copy (destructive answer, at the left end). */
  onDiscard: () => void;
  /** Closing without answering: the copy stays on disk for a later open. */
  onCancel: () => void;
}

export default function DraftRecoverySheet({
  recovery,
  onRestore,
  onDiscard,
  onCancel,
}: DraftRecoverySheetProps) {
  // The draft's own title is the best label for "which work is this?"; an
  // untitled new recipe is named as what it is rather than shown as "".
  const title =
    recovery.draft.title.trim() === '' ? 'Neues Rezept' : `„${recovery.draft.title.trim()}“`;

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="draft-recovery-title">
        <div className="sheet-head">
          <h2 className="sheet-title" id="draft-recovery-title">
            Nicht gespeicherten Entwurf wiederherstellen?
          </h2>
          <p className="sheet-subtitle">
            {title} — zuletzt bearbeitet am {formatRecoverableDraftTime(recovery.savedAt)}.
          </p>
        </div>
        <div className="sheet-actions">
          <button type="button" className="danger-button" onClick={onDiscard}>
            Verwerfen
          </button>
          <button type="button" className="primary-button" onClick={onRestore} autoFocus>
            Wiederherstellen
          </button>
        </div>
      </div>
    </>
  );
}
