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
 * - action order and weight: "Jetzt kochen" is the primary action, the other
 *   three are quiet secondary buttons, in the order "Zur Liste hinzufügen",
 *   "Manuell bearbeiten", "Mit KI bearbeiten".
 *
 * Only "Manuell bearbeiten" is wired (it opens the editor). The other three are
 * placeholders for now: they report that the feature is not built yet instead
 * of silently doing nothing.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useState } from 'react';

import { displayTimeText, type Recipe } from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import RecipeThumb from './RecipeThumb';

interface RecipeOverviewProps {
  /** Drive access token, needed to read the recipe and download its photo. */
  token: string;
  /** The tapped list entry: file, title and optional photo. */
  recipe: StoredRecipe;
  /** Closes the sheet (backdrop, close button, browser Back). */
  onClose: () => void;
  /** Opens the recipe in the editor ("Manuell bearbeiten"). */
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

  // Escape closes the sheet for keyboard users (backdrop tap and the browser
  // Back button — App's history integration — close it as well).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /** Reports a not-yet-built action instead of letting the tap do nothing. */
  const notBuiltYet = (label: string): void => {
    setNotice(`„${label}“ folgt in einer späteren Version.`);
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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"
              fill="currentColor"
            />
          </svg>
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

        <div className="overview-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => notBuiltYet('Jetzt kochen')}
          >
            Jetzt kochen
          </button>
          <button
            type="button"
            className="overview-secondary"
            onClick={() => notBuiltYet('Zur Liste hinzufügen')}
          >
            Zur Liste hinzufügen
          </button>
          <button type="button" className="overview-secondary" onClick={() => onEdit(recipe)}>
            Manuell bearbeiten
          </button>
          <button
            type="button"
            className="overview-secondary"
            onClick={() => notBuiltYet('Mit KI bearbeiten')}
          >
            Mit KI bearbeiten
          </button>
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
