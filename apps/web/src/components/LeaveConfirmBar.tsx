/**
 * The armed "Änderungen verwerfen?" answer, shared by every screen that holds
 * unsaved work (RecipeEditor, AiCreateSheet).
 *
 * Why this exists: the confirmation used to be the „Zurück" button's own second
 * label. That coupled two different jobs into one control — recognised
 * navigation („Zurück") and the answer to a decision („verwerfen") — and it made
 * the question invisible whenever its carrier was not on screen (the AI screen's
 * header scrolls with the page; a Back press on a scrolled page armed a question
 * the user never saw). The question now lives in a bar of its own, right under
 * the header, and each control keeps one meaning:
 *
 * - the header's „Zurück" stays „Zurück" and never changes its label;
 * - „Abbrechen" drops the question (the armed state) and the user keeps working —
 *   the same answer as dismissing a modal (see useLeaveGuard, rule 2), and the
 *   same label every other in-place question in the app uses;
 * - „Verwerfen" is the confirmed exit and runs the screen's one `onLeave` hop.
 *
 * One line, three columns (styles/editor.css, .leave-confirm): the question under
 * the screen's back button, then the two answers in the app's no | yes order.
 * On the editor the second column lands under „Speichern" and the third under its
 * right edge, so the decision reads as a second row of the header above it.
 *
 * The bar renders directly under a sticky header, so it stays on screen from any
 * scroll position (the header's stickiness is what carries it). Its wording
 * follows the confirmation pattern of every other destructive question in the
 * app („Rezept löschen?" → „Wirklich löschen?"): the question is text, the answer
 * is an action button. A caption (`leave-confirm-label`) is never a button.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import type { ReactNode } from 'react';

interface LeaveConfirmBarProps {
  /**
   * The screen the question is about, named inside the sentence
   * (e.g. „Änderungen am Rezept verwerfen?"). The caller supplies the noun
   * phrase because only the screen knows what its draft is.
   */
  question: ReactNode;
  /** Drops the question and stays on the screen (the armed state is cleared). */
  onKeep: () => void;
  /** Confirmed exit: runs the screen's own leave hop. */
  onDiscard: () => void;
}

/**
 * One armed discard question on a single line: the sentence plus its two
 * answers, „Abbrechen" (quiet, the answer that keeps the work) and „Verwerfen"
 * (danger — the answer that loses it).
 */
export default function LeaveConfirmBar({ question, onKeep, onDiscard }: LeaveConfirmBarProps) {
  return (
    <div className="leave-confirm" role="alert">
      <p className="leave-confirm-label">{question}</p>
      <button type="button" className="text-button" onClick={onKeep}>
        Abbrechen
      </button>
      <button type="button" className="danger-button" onClick={onDiscard}>
        Verwerfen
      </button>
    </div>
  );
}
