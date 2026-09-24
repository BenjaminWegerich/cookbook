import { useMemo, useState, type ReactNode } from 'react';

import type { StoredRecipe } from '../drive/recipeStorage';
import type { MealPlanCard } from '../keep/mealPlanCards';
import type { KeepStatus } from '../keep/useKeep';
import { CloseIcon, ErrorIcon, EventAvailableIcon, SearchIcon } from './icons';
import RecipeThumb from './RecipeThumb';
import TitleThumb from './TitleThumb';

/** The two views of the list, as tab ids (UI labels are German). */
type RecipeTab = 'mealplan' | 'collection';

/** The two tabs in display order (labels are the German UI strings). */
const TABS: { id: RecipeTab; label: string }[] = [
  { id: 'mealplan', label: 'Essensplan' },
  { id: 'collection', label: 'Sammlung' },
];

/**
 * The longest tab label. Each segment carries an invisible copy of it, so both
 * segments are equally wide without a hard-coded pixel width: the control stays
 * content-driven and only ever needs the buttons' own padding around the text.
 */
const LONGEST_TAB_LABEL = TABS.reduce<string>(
  (longest, entry) => (entry.label.length > longest.length ? entry.label : longest),
  '',
);

interface RecipeListProps {
  recipes: StoredRecipe[];
  /** Drive access token, forwarded to the card media areas for photo downloads. */
  token: string;
  /** Called when the user taps a recipe card (opens the recipe overview). */
  onOpenRecipe: (recipe: StoredRecipe) => void;
  /**
   * Resolved meal-plan cards in Keep's display order, or null while they are
   * still being resolved (see ../keep/mealPlanCards).
   */
  mealPlanCards: MealPlanCard[] | null;
  /** Recipe titles recognized on the meal plan ("Eingeplant" badge). */
  plannedRecipeTitles: ReadonlySet<string>;
  /** Where the Keep connection stands (decides the "Essensplan" states). */
  keepStatus: KeepStatus;
  /** German failure text of the last Keep load, when there was one. */
  keepError: string | null;
  /** Opens the Keep token sheet (the "Essensplan" connect state). */
  onConnectKeep: () => void;
  /** Re-runs the Keep load (the "Essensplan" error state). */
  onRetryKeep: () => void;
}

/**
 * Home-screen list (adaptive card grid, phone-first layout that scales to
 * desktop widths) with a sticky search field and two tabs underneath:
 *
 * - **Essensplan** shows the non-checked entries of the Google Keep meal plan,
 *   one card per entry, in Keep's order. An entry recognized as a recipe (its
 *   text is a recipe title, plus an optional fitting size suffix) renders in
 *   the known card format; every other entry renders as a card with a
 *   placeholder image derived from its text, its complete text as the title and
 *   a danger-colored "Kein Cookbook-Rezept" badge.
 * - **Sammlung** shows every recipe of the collection, whether it is on the
 *   meal plan or not; a planned recipe carries the inline "Eingeplant" badge.
 *
 * The search filters whichever tab is active (title for recipes, complete
 * entry text for meal-plan cards), so the tabs act as an additional refinement,
 * never as a replacement for the search. The whole card is the hitbox — the
 * badges are plain content inside it, never a target of their own. UI language
 * is German (see docs/CODING_CONVENTIONS.md).
 */
function RecipeList({
  recipes,
  token,
  onOpenRecipe,
  mealPlanCards,
  plannedRecipeTitles,
  keepStatus,
  keepError,
  onConnectKeep,
  onRetryKeep,
}: RecipeListProps) {
  const [query, setQuery] = useState('');
  /**
   * The tab the user picked, or null while they have not touched the tabs. The
   * default (decided with the user) is "Essensplan" once Keep is connected and
   * "Sammlung" otherwise — a stored null keeps the app from jumping to an empty
   * meal plan before the token is entered, and lets the view follow the
   * connection the moment it becomes ready.
   */
  const [pickedTab, setPickedTab] = useState<RecipeTab | null>(null);
  const tab: RecipeTab = pickedTab ?? (keepStatus === 'ready' ? 'mealplan' : 'collection');

  // Normalized once so the per-render filters below only repeat the cheap
  // includes comparisons, not the normalization. Empty query and thus an empty
  // trim collapse to the same "show everything" state, so a query of only
  // spaces is treated as no query at all.
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  const visibleRecipes = useMemo(
    () => (needle === '' ? recipes : recipes.filter((r) => r.title.toLowerCase().includes(needle))),
    [recipes, needle],
  );

  // A meal-plan card is searched by its complete text, not only by the matched
  // title: "Kürbissuppe (6 Portionen)" is found by "portionen" as well.
  const visiblePlanCards = useMemo(
    () =>
      mealPlanCards === null || needle === ''
        ? mealPlanCards
        : mealPlanCards.filter((card) => card.text.toLowerCase().includes(needle)),
    [mealPlanCards, needle],
  );

  const searchPlaceholder = tab === 'mealplan' ? 'Essensplan durchsuchen' : 'Rezept suchen';

  /** The "Essensplan" tab body: connection states, then the entry cards. */
  function renderMealPlan(): ReactNode {
    if (keepStatus !== 'ready') {
      // A gateway that is missing from the build can never be connected from
      // the app, so it gets an explanation instead of a connect button.
      if (keepStatus === 'off') {
        return (
          <p className="recipe-search-empty" role="status">
            Google Keep ist in dieser Installation nicht eingerichtet — der Essensplan ist deshalb
            leer.
          </p>
        );
      }
      if (keepStatus === 'needs-token') {
        return (
          <section className="plan-connect">
            <p>Verbinde Google Keep, um deinen Essensplan hier zu sehen.</p>
            <p className="plan-connect-note">
              Dafür wird der Keep-Zugangscode benötigt. Er bleibt nur für diese Sitzung im Speicher.
            </p>
            <button type="button" className="primary-button" onClick={onConnectKeep}>
              Keep verbinden
            </button>
          </section>
        );
      }
      if (keepStatus === 'unreachable' || keepStatus === 'error') {
        return (
          <section className="plan-connect">
            <p role="alert">{keepError ?? 'Der Essensplan konnte nicht geladen werden.'}</p>
            <button type="button" className="primary-button" onClick={onRetryKeep}>
              Erneut versuchen
            </button>
          </section>
        );
      }
      return (
        <p className="loading-message" role="status">
          Essensplan wird geladen …
        </p>
      );
    }

    if (visiblePlanCards === null) {
      return (
        <p className="loading-message" role="status">
          Essensplan wird geladen …
        </p>
      );
    }
    if (visiblePlanCards.length === 0) {
      return (
        <p className="recipe-search-empty" role="status">
          {trimmedQuery === ''
            ? 'Kein Gericht im Essensplan.'
            : `Nichts im Essensplan für „${trimmedQuery}“ gefunden.`}
        </p>
      );
    }

    return (
      <ul className="recipe-list">
        {visiblePlanCards.map((card) => {
          const recipe = card.recipe;
          if (recipe !== null) {
            // Recognized: the known card format, without the "Eingeplant"
            // badge (it would repeat on every card of this tab).
            return (
              <li key={card.key}>
                <button type="button" className="recipe-card" onClick={() => onOpenRecipe(recipe)}>
                  <RecipeThumb recipe={recipe} token={token} />
                  <span className="recipe-card-title">
                    <span className="recipe-card-title-text">{recipe.title}</span>
                  </span>
                </button>
              </li>
            );
          }
          return (
            <li key={card.key}>
              <div className="recipe-card recipe-card-plain">
                <TitleThumb title={card.text} />
                <span className="recipe-card-title">
                  <span className="recipe-card-title-text">{card.text}</span>
                  <span className="recipe-badge recipe-badge-unknown">
                    <ErrorIcon className="recipe-badge-icon" />
                    <span>Kein Cookbook-Rezept</span>
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  /** The "Sammlung" tab body: every recipe, planned ones badged. */
  function renderCollection(): ReactNode {
    if (visibleRecipes.length === 0) {
      return (
        <p className="recipe-search-empty" role="status">
          {trimmedQuery === ''
            ? 'Keine Rezepte im Cookbook-Ordner.'
            : `Kein Rezept für „${trimmedQuery}“ gefunden.`}
        </p>
      );
    }
    return (
      <ul className="recipe-list">
        {visibleRecipes.map((recipe) => (
          <li key={recipe.fileId}>
            <button type="button" className="recipe-card" onClick={() => onOpenRecipe(recipe)}>
              <RecipeThumb recipe={recipe} token={token} />
              <span className="recipe-card-title">
                <span className="recipe-card-title-text">{recipe.title}</span>
                {plannedRecipeTitles.has(recipe.title) && (
                  <span className="recipe-badge recipe-badge-planned">
                    <EventAvailableIcon className="recipe-badge-icon" />
                    <span>Eingeplant</span>
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="recipe-search">
        <div className="recipe-search-field" role="search">
          <SearchIcon className="recipe-search-icon" />
          <input
            type="search"
            className="recipe-search-input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={searchPlaceholder}
          />
          {/* The clear button is an overlay inside the field, not a second grid
              column: the field keeps the full content width (the same width as
              the recipe grid below) whether or not the button is shown. */}
          {query !== '' && (
            <button
              type="button"
              className="recipe-search-clear"
              aria-label="Suche löschen"
              onClick={() => setQuery('')}
            >
              <CloseIcon className="recipe-search-clear-icon" />
            </button>
          )}
        </div>

        {/* Two value-picking tabs (role group + aria-pressed, the same pattern
            the editor's segmented controls use): both views show the same card
            grid, they only filter what it contains. The row centers the
            content-width control; the invisible sizer inside each button makes
            both segments exactly as wide as the longest label. */}
        <div className="recipe-tabs-row">
          <div className="recipe-tabs" role="group" aria-label="Ansicht">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={tab === entry.id ? 'recipe-tab recipe-tab-active' : 'recipe-tab'}
                aria-pressed={tab === entry.id}
                onClick={() => setPickedTab(entry.id)}
              >
                <span>{entry.label}</span>
                <span className="recipe-tab-sizer" aria-hidden="true">
                  {LONGEST_TAB_LABEL}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'mealplan' ? renderMealPlan() : renderCollection()}
    </>
  );
}

export default RecipeList;
