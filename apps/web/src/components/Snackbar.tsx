/**
 * Snackbar — the app's transient notice at the bottom of the screen (see
 * docs/ui_patterns.md for the full specification).
 *
 * It reports the outcome of an action that just closed a sheet or a screen, and
 * carries the optional way back: the recipe-overview flow that added a dish to
 * the meal plan ends here with "<Titel> zum Essensplan hinzugefügt. Die
 * Einkaufsliste bleibt unverändert." plus "Rückgängig". The behaviour — queue,
 * 6 s countdown, pause on interaction, the action promise — lives in
 * ../hooks/useSnackbar; this component is only its look and its accessibility.
 *
 * Rules it keeps from the shared conventions (docs/CODING_CONVENTIONS.md):
 * - a flat, opaque surface from the token palette (no translucency, no blur);
 * - the leading symbol comes from components/icons.tsx (olive check for success,
 *   the danger exclamation for an error), and the action is a labelled button;
 * - it never takes focus: it is a non-modal report, so a keyboard user keeps the
 *   caret where it was and reaches the action with Tab (focus pauses the timer);
 * - it floats clear of the + FAB, thumb-reachable, and never covers the list's
 *   own controls.
 *
 * UI language is German.
 */

import type { UseSnackbarResult } from '../hooks/useSnackbar';
import { CheckCircleIcon, ErrorIcon } from './icons';

interface SnackbarProps {
  /** The host returned by useSnackbar (queue, countdown, action state). */
  host: UseSnackbarResult;
}

function Snackbar({ host }: SnackbarProps) {
  const { message, busy, runAction, setPaused } = host;
  if (message === null) {
    return null;
  }

  const tone = message.tone ?? 'success';
  const action = message.action;

  return (
    <div
      // A fresh message remounts the region, so a screen reader announces it even
      // when the previous notice was still on screen (aria-live sees a new node).
      key={message.id}
      className={tone === 'error' ? 'snackbar snackbar-error' : 'snackbar'}
      // Success is a quiet report (polite); an error is a problem to notice now.
      role={tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(message.id, true)}
      onPointerLeave={() => setPaused(message.id, false)}
      // React's focus events bubble, so these cover the action button as well.
      onFocus={() => setPaused(message.id, true)}
      onBlur={() => setPaused(message.id, false)}
    >
      {tone === 'error' ? (
        <ErrorIcon className="snackbar-icon" />
      ) : (
        <CheckCircleIcon className="snackbar-icon" />
      )}
      <p className="snackbar-text">{message.text}</p>
      {action !== undefined && (
        <button
          type="button"
          className="text-button snackbar-action"
          onClick={runAction}
          disabled={busy}
          aria-busy={busy}
        >
          {!busy && action.icon}
          {busy ? (action.busyLabel ?? action.label) : action.label}
        </button>
      )}
    </div>
  );
}

export default Snackbar;
