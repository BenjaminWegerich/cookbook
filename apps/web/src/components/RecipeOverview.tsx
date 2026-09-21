/**
 * Recipe overview sheet (home screen → tap a recipe card).
 *
 * Tapping a recipe card no longer jumps straight into the editor: it opens this
 * bottom sheet over the list with the recipe's photo (large square), title,
 * times and description, plus the actions for the recipe.
 *
 * Decided with the user:
 * - modal bottom sheet over the list (not a full-screen view);
 * - large square 1:1 photo (recipe photos are stored square, nothing is cropped);
 * - times (Arbeitszeit / Gesamtzeit) are shown, but not servings/yield or type;
 * - one action row: "Jetzt kochen" (skillet) as the primary action, growing to
 *   fill the row so it is as wide as possible, next to "Einplanen" (calendar with
 *   plus) and the "Mehr" button (vertical three dots), which stay only as wide as
 *   their labels need. Decided with the user, replacing the earlier stacked
 *   layout: the old "Zur Liste hinzufügen" label was so long that an even split
 *   wrapped it to two lines on a narrow phone, but the shorter "Einplanen" lets
 *   all three share one line, and only the primary grows. The two secondary
 *   labels consequently sit on their own natural padding instead of on a
 *   stretched cushion.
 *   "Jetzt kochen" and "Einplanen" are placeholders for now: they report that the
 *   feature is not built yet instead of silently doing nothing.
 * - "Einplanen" is the meal-plan action: it puts the dish on the meal plan.
 *   Building the shopping list is deliberately not its job — that is a separate
 *   flow over several recipes at once (decided with the user), so the overview's
 *   per-recipe action must not be named "Zur Liste hinzufügen".
 * - "Mehr" opens the actions that do not earn a full row column as a small
 *   popover above the row: "Manuell bearbeiten" opens the editor, "Mit KI
 *   bearbeiten" is still a placeholder. The kebab itself is the affordance, and
 *   the entries carry the full wording because the trigger no longer names the
 *   feature. The menu is closed by an outside tap, Escape and any chosen entry.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useRef, useState } from 'react';

import { displayTimeText, type Recipe } from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import {
  CalendarAddIcon,
  CloseIcon,
  MoreVertIcon,
  PencilIcon,
  SkilletIcon,
  SparkleIcon,
} from './icons';
import RecipeThumb from './RecipeThumb';

interface RecipeOverviewProps {
  /** Drive access token, needed to read the recipe and download its photo. */
  token: string;
  /** The tapped list entry: file, title and optional photo. */
  recipe: StoredRecipe;
  /** Closes the sheet (backdrop, close button, browser Back). */
  onClose: () => void;
  /** Opens the recipe in the editor ("Mehr" → "Manuell bearbeiten"). */
  onEdit: (recipe: StoredRecipe) => void;
}

/**
 * The overview sheet (see file header). The list entry already carries title and
 * photo, so the hero renders immediately; times and description are
 * read from the recipe file and fill in when the load finishes.
 */
function RecipeOverview({ token, recipe, onClose, onEdit }: RecipeOverviewProps) {
  /** The full recipe; null while it is being read from Drive. */
  const [details, setDetails] = useState<Recipe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Feedback line for the placeholder actions (null = nothing tapped yet). */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The "Mehr" overflow menu (popover above the action row). Closed by an
   * outside tap, Escape, choosing an entry or closing the whole sheet.
   */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  /** The "Mehr" button + popover: the wrapper the outside-tap check uses. */
  const moreWrapRef = useRef<HTMLDivElement | null>(null);

  // Read the recipe file for the details the list entry does not carry. The
  // sheet unmounts when it closes, so every open starts from the initial null
  // state; state is only set in the promise callbacks, never synchronously
  // (same rule as App's startup load).
  useEffect(() => {
    let cancelled = false;
    void readRecipe(token, recipe.fileId)
      .then((loaded) => {
        if (!cancelled) setDetails(loaded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, recipe.fileId]);

  // Escape closes the sheet for keyboard users through the shared exit trigger
  // (useLeaveGuard), the same one the editor, the AI screen and the create menu
  // use — backdrop tap and the browser Back button (App's history integration)
  // close it as well. No confirmation: the overview is read-only.
  useEscapeTrigger(onClose);

  // Escape closes the overflow menu before it reaches the sheet: the shared
  // escape trigger closes whatever layer it is wired to, so the popover installs
  // its own listener (capture) that consumes the key while it is open. The
  // cleanup order guarantees the menu listener is removed before the sheet's.
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [moreMenuOpen]);

  // A tap anywhere outside the overflow menu (and outside its trigger) closes
  // it. This runs after the click finished its own handling, so the tapped
  // element — the sheet's close button, the backdrop, another action — still
  // does its job once and only the menu additionally closes (decided with the
  // user: progressive dismissal, the tap is never swallowed).
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && moreWrapRef.current?.contains(target) === true) return;
      setMoreMenuOpen(false);
    };
    document.addEventListener('click', onDocumentClick);
    return () => {
      document.removeEventListener('click', onDocumentClick);
    };
  }, [moreMenuOpen]);

  /** Reports a not-yet-built action instead of letting the tap do nothing. */
  const notBuiltYet = (label: string): void => {
    setNotice(`„${label}“ folgt in einer späteren Version.`);
  };

  /** "Manuell bearbeiten": closes the menu and hands over to the editor. */
  const openManualEdit = (): void => {
    setMoreMenuOpen(false);
    onEdit(recipe);
  };

  const title = details?.title ?? recipe.title;
  const description = details?.description;
  // Times use the core display helper, so number and unit are joined with the
  // narrow no-break space like everywhere else (docs/CODING_CONVENTIONS.md).
  const prepTime =
    details !== null && details.prep_time !== '' ? displayTimeText(details.prep_time) : null;
  const totalTime =
    details?.total_time !== undefined && details.total_time !== ''
      ? displayTimeText(details.total_time)
      : null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet overview-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-title"
      >
        <button
          type="button"
          className="overview-close"
          aria-label="Schließen"
          onClick={onClose}
          autoFocus
        >
          <CloseIcon />
        </button>

        {/* List entry data: renders before the file read finishes. The wrapper
            carries the hero size; the square thumb fills it (see the row-sizing
            note in recipe-overview.css). */}
        <div className="overview-hero">
          <RecipeThumb recipe={recipe} token={token} />
        </div>

        <div className="overview-body">
          <h2 className="overview-title" id="overview-title">
            {title}
          </h2>

          {description !== undefined && description !== '' && (
            <p className="overview-description">{description}</p>
          )}

          {/* Times sit below the description (decided with the user): the
              prose explains the dish first, the timing is the lookup value. */}
          {(prepTime !== null || totalTime !== null) && (
            <dl className="overview-meta">
              {prepTime !== null && (
                <div className="overview-meta-item">
                  <dt>Arbeitszeit</dt>
                  <dd>{prepTime}</dd>
                </div>
              )}
              {totalTime !== null && (
                <div className="overview-meta-item">
                  <dt>Gesamtzeit</dt>
                  <dd>{totalTime}</dd>
                </div>
              )}
            </dl>
          )}

          {details === null && loadError === null && (
            <p className="overview-loading" role="status">
              Details werden geladen …
            </p>
          )}
          {loadError !== null && (
            <p className="overview-error" role="alert">
              {loadError}
            </p>
          )}
        </div>

        {/* One action row (decided with the user): "Jetzt kochen" is the primary
            action and grows to fill the row; "Einplanen" and the "Mehr" overflow
            button stay at their content width. "Mehr" opens its menu as a popover
            directly above the row, so the menu sits next to its trigger instead of
            floating anywhere in the sheet. */}
        <div className="overview-actions">
          <button
            type="button"
            className="overview-action is-primary"
            onClick={() => notBuiltYet('Jetzt kochen')}
          >
            <SkilletIcon />
            <span>Jetzt kochen</span>
          </button>
          <button
            type="button"
            className="overview-action"
            onClick={() => notBuiltYet('Einplanen')}
          >
            <CalendarAddIcon />
            <span>Einplanen</span>
          </button>
          <div className="overview-more" ref={moreWrapRef}>
            <button
              type="button"
              className={moreMenuOpen ? 'overview-action is-open' : 'overview-action'}
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => setMoreMenuOpen((open) => !open)}
            >
              <MoreVertIcon />
              <span>Mehr</span>
            </button>

            {moreMenuOpen && (
              <div className="overview-menu" role="menu" aria-label="Weitere Aktionen">
                <button type="button" role="menuitem" onClick={openManualEdit}>
                  <PencilIcon />
                  <span>Manuell bearbeiten</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    notBuiltYet('Mit KI bearbeiten');
                  }}
                >
                  <SparkleIcon />
                  <span>Mit KI bearbeiten</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {notice !== null && (
          <p className="overview-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </>
  );
}

export default RecipeOverview;
