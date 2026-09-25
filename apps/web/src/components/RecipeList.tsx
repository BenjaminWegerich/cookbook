import { useMemo, useState, type ReactNode } from 'react';

import type { StoredRecipe } from '../drive/recipeStorage';
import { useSwipePager } from '../hooks/useSwipePager';
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
   * Called when the user taps an "Essensplan" card. A recognized card hands over
   * its resolved entry (the overview shows the stated size and "Umplanen"); an
   * unrecognized entry is handed over as-is, and the overview opens it as the
   * destination for replacing or dropping it.
   */
  onOpenPlanCard: (card: MealPlanCard) => void;
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
  /** Signs in with Google to connect Keep (the "Essensplan" connect state). */
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
 *   a danger-colored "Unbekannt" badge. Tapping either card opens
 *   the overview: the recognized one with its stated size and "Umplanen", the
 *   unrecognized one as the destination for replacing or dropping the entry.
 * - **Sammlung** shows every recipe of the collection, whether it is on the
 *   meal plan or not; a planned recipe carries the inline "Eingeplant" badge.
 *
 * The search filters whichever tab is active (title for recipes, complete
 * entry text for meal-plan cards), so the tabs act as an additional refinement,
 * never as a replacement for the search. The two tab bodies also sit side by
 * side in a swipeable pager: a horizontal swipe on the card area follows the
 * finger and snaps onto the neighbouring tab, the phone-native counterpart of
 * tapping a tab (../hooks/useSwipePager). The whole card is the hitbox — the
 * badges are plain content inside it, never a target of their own. UI language
 * is German (see docs/CODING_CONVENTIONS.md).
 */
function RecipeList({
  recipes,
  token,
  onOpenRecipe,
  onOpenPlanCard,
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

  /**
   * The pager behind the two tab bodies: a horizontal swipe on the card area
   * commits the neighbouring pane exactly like tapping its tab, so the picked
   * tab stays authoritative over the Keep-driven default (see
   * ../hooks/useSwipePager). The search field and the tab control sit outside
   * the swipe area and are never dragged.
   */
  const {
    viewportRef,
    viewportStyle,
    trackRef,
    trackStyle,
    paneRefs,
    handlers: pagerHandlers,
    dragging: pagerDragging,
  } = useSwipePager({
    index: TABS.findIndex((entry) => entry.id === tab),
    count: TABS.length,
    onIndexChange: (next) => setPickedTab(TABS[next].id),
  });

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

  // A meal-plan card is searched by its human text, not only by the matched
  // title: "Kürbissuppe (6 Portionen)" is found by "portionen" as well. The
  // export URL of the raw Keep line is deliberately not searched.
  const visiblePlanCards = useMemo(
    () =>
      mealPlanCards === null || needle === ''
        ? mealPlanCards
        : mealPlanCards.filter((card) => card.displayText.toLowerCase().includes(needle)),
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
      if (keepStatus === 'needs-signin') {
        return (
          <section className="plan-connect">
            <p>Verbinde Google Keep, um deinen Essensplan hier zu sehen.</p>
            <p className="plan-connect-note">
              Cookbook meldet sich dafür mit deinem Google-Konto an — ein Zugangscode ist nicht mehr
              nötig.
            </p>
            {/* A refused sign-in (wrong account, mismatched client id) is not a first-run state:
                it has a reason, and only the account chooser behind the button can fix it. */}
            {keepError !== null && <p role="alert">{keepError}</p>}
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
            // badge (it would repeat on every card of this tab). The overview
            // receives the whole card, so it can show the entry's stated size
            // and turn its travel action into "Umplanen".
            return (
              <li key={card.key}>
                <button type="button" className="recipe-card" onClick={() => onOpenPlanCard(card)}>
                  <span className="recipe-media">
                    <RecipeThumb recipe={recipe} token={token} />
                  </span>
                  <span className="recipe-card-title">
                    <span className="recipe-card-title-text">{recipe.title}</span>
                  </span>
                </button>
              </li>
            );
          }
          // Unrecognized: the same card look, but the overview behind it is the
          // destination that lets the entry be replaced by or turned into a
          // recipe (or dropped from the plan). The card shows the entry's human
          // form — a Cookbook line's export URL would otherwise fill the title.
          return (
            <li key={card.key}>
              <button type="button" className="recipe-card" onClick={() => onOpenPlanCard(card)}>
                <span className="recipe-media">
                  <TitleThumb title={card.displayText} />
                  <span className="recipe-badge recipe-badge-unknown recipe-badge-on-media">
                    <ErrorIcon className="recipe-badge-icon" />
                    <span>Unbekannt</span>
                  </span>
                </span>
                <span className="recipe-card-title">
                  <span className="recipe-card-title-text">{card.displayText}</span>
                </span>
              </button>
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
              <span className="recipe-media">
                <RecipeThumb recipe={recipe} token={token} />
                {plannedRecipeTitles.has(recipe.title) && (
                  <span className="recipe-badge recipe-badge-planned recipe-badge-on-media">
                    <EventAvailableIcon className="recipe-badge-icon" />
                    <span>Eingeplant</span>
                  </span>
                )}
              </span>
              <span className="recipe-card-title">
                <span className="recipe-card-title-text">{recipe.title}</span>
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

      {/* The two tab bodies side by side in one track: a horizontal drag on the
          viewport moves the track and the release snaps onto the neighbour tab
          (../hooks/useSwipePager). Both bodies are rendered, since the drag has
          to reveal the next one; the off-screen pane is `inert`, so it can
          neither be focused nor reached by assistive tech. The pane order is
          TABS, the same order the tab control uses. */}
      <div
        className={pagerDragging ? 'recipe-panes recipe-panes-dragging' : 'recipe-panes'}
        ref={viewportRef}
        style={viewportStyle}
        {...pagerHandlers}
      >
        <div className="recipe-panes-track" ref={trackRef} style={trackStyle}>
          {TABS.map((entry, paneIndex) => (
            <div
              key={entry.id}
              className="recipe-pane"
              ref={paneRefs[paneIndex]}
              inert={tab !== entry.id}
            >
              {entry.id === 'mealplan' ? renderMealPlan() : renderCollection()}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default RecipeList;
