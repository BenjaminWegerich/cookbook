import { useMemo, useState, type ReactNode } from 'react';

import type { StoredRecipe } from '../drive/recipeStorage';
import type { MealPlanCard } from '../keep/mealPlanCards';
import type { KeepStatus } from '../keep/useKeep';
import { CheckCircleIcon, CloseIcon, ErrorIcon, ListPlusIcon, SearchIcon } from './icons';
import RecipeThumb from './RecipeThumb';
import TitleThumb from './TitleThumb';

/**
 * The search field's placeholder (decided with the user: one short word) and its
 * accessible name. One field serves the whole screen: it filters both sections at
 * once, so the accessible name names both contents — the recipes of the
 * collection and the dish entries of the meal plan (an unrecognized entry is a
 * dish, not a recipe). The placeholder stays deliberately shorter than that: it
 * is a visual hint in a narrow field, while the accessible name is read out in
 * full.
 */
const SEARCH_PLACEHOLDER = 'Suchen';
const SEARCH_LABEL = 'Rezept oder Gericht suchen';

/** DOM ids of the two section captions (the headings' `aria-labelledby` targets). */
const MEALPLAN_CAPTION_ID = 'recipe-section-mealplan';
const COLLECTION_CAPTION_ID = 'recipe-section-collection';

interface RecipeListProps {
  /** Every recipe of the Drive collection (the "Restliche Sammlung" source). */
  recipes: StoredRecipe[];
  /** Drive access token, forwarded to the card media areas for photo downloads. */
  token: string;
  /** Called when the user taps a card of the "Restliche Sammlung" section. */
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
  /**
   * Recipe titles recognized on the meal plan. A planned recipe is the plan
   * section's business, so it is left out of "Restliche Sammlung" — the same
   * recipe never appears twice on one screen.
   */
  plannedRecipeTitles: ReadonlySet<string>;
  /** Where the Keep connection stands (decides the "Essensplan" states). */
  keepStatus: KeepStatus;
  /** German failure text of the last Keep load, when there was one. */
  keepError: string | null;
  /** Signs in with Google to connect Keep (the "Essensplan" connect state). */
  onConnectKeep: () => void;
  /** Re-runs the Keep load (the "Essensplan" error state). */
  onRetryKeep: () => void;
  /**
   * Opens the bundled shopping-list selection for the meal plan (the
   * "Einkaufsliste schreiben" button in the "Essensplan" caption row). App owns
   * that screen, because only App holds the Keep state and the overview targets.
   */
  onWriteShoppingList: () => void;
  /**
   * True while the current meal plan has already been written to the shopping
   * list in this session (App tracks it: Keep itself cannot say whether a list
   * belongs to the plan, and after a reload the app cannot deduce it either).
   * The button then reads "Einkaufsliste geschrieben" and is unavailable.
   */
  shoppingWritten: boolean;
}

/**
 * Home screen: one sticky search field, below it the two captioned sections of
 * the collection, each rendered as the same adaptive card grid (two columns on a
 * phone, more on wider screens) and both filtered by the one search field
 * (decided with the user):
 *
 * - **Essensplan** shows the non-checked entries of the Google Keep meal plan,
 *   one card per entry, in Keep's order. An entry recognized as a recipe (its
 *   text is a recipe title, plus an optional fitting size suffix) renders in
 *   the known card format; every other entry renders as a card with a
 *   placeholder image derived from its text, its complete text as the title and
 *   a danger-colored "Unbekannt" badge. Tapping either card opens
 *   the overview: the recognized one with its stated size and "Umplanen", the
 *   unrecognized one as the destination for replacing or dropping the entry.
 * - **Restliche Sammlung** shows the recipes that are *not* on the meal plan.
 *   The planned ones are already in the section above, so repeating them here
 *   would put the same card on one screen twice; the plan section is where a
 *   planned dish is read, changed and cooked from. With Keep off every recipe is
 *   "restlich", which is exactly what the section then shows.
 *
 * Each section carries its counter in its caption ("Essensplan (5 Einträge,
 * davon 2 unbekannt)", "Restliche Sammlung (8 Rezepte)"). The captions copy the
 * editor's field-caption typography (.field-label: small, semibold, muted, all
 * caps), with the counter itself set exactly like the editor's quiet
 * "(optional)" marker: normal case, italic, slightly translucent, one en space
 * after the caption word. The counter disappears while a search runs (it
 * counts the section, not the result), the caption stays: it is the section's
 * heading, and a section that is empty only because of the search still has to
 * say which section it is. The body then carries the placeholder sentence.
 *
 * In the "Essensplan" caption row sits **"Einkaufsliste schreiben"** (decided
 * with the user), the entry into the bundled shopping-list selection: there the
 * recipes of the meal plan are selected, and one write adds all of their
 * ingredients at once. Bundling is the point, not only the saved clicks — two
 * recipes that each need 300 g tofu round to two 200 g blocks on their own, but
 * to three blocks when they are written together (./ShoppingListSelect). The
 * button belongs to the plan, so it lives in the plan's caption row rather than
 * in a toolbar of its own; it is a soft accent chip (clay text on a light clay
 * tint, one clay hairline, pill shape, plus symbol) — decided with the user,
 * who wanted the entry clearly more prominent than the bare text button it used
 * to be, while the filled floating action button stays the screen's one loud
 * control. The screen it opens is a mode of the meal plan, so the button only
 * appears while the plan is connected and actually carries entries.
 *
 * Once that flow has written the list, the button reads **"Einkaufsliste
 * geschrieben"**, carries the check instead of the plus and is unavailable — for
 * as long as the meal plan is the one that was written (App tracks that in
 * memory, see the `shoppingWritten` prop).
 *
 * Search filters the cards of both sections (recipe title, complete meal-plan
 * entry text), never the captions. The whole card is the hitbox — the badges are
 * plain content inside it, never a target of their own. UI language is German
 * (see docs/CODING_CONVENTIONS.md).
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
  onWriteShoppingList,
  shoppingWritten,
}: RecipeListProps) {
  const [query, setQuery] = useState('');

  // Normalized once so the per-render filters below only repeat the cheap
  // includes comparisons, not the normalization. Empty query and thus an empty
  // trim collapse to the same "show everything" state, so a query of only
  // spaces is treated as no query at all.
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  /**
   * The recipes of "Restliche Sammlung": the collection without the titles the
   * meal plan already shows. Kept separate from the search filter below so the
   * section's counter always counts the section and never the search result.
   */
  const remainingRecipes = useMemo(
    () => recipes.filter((recipe) => !plannedRecipeTitles.has(recipe.title)),
    [recipes, plannedRecipeTitles],
  );

  const visibleRecipes = useMemo(
    () =>
      needle === ''
        ? remainingRecipes
        : remainingRecipes.filter((recipe) => recipe.title.toLowerCase().includes(needle)),
    [remainingRecipes, needle],
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

  /**
   * Whether the bundled shopping-list view can be entered at all: it selects
   * from the meal plan, so an unconnected or empty plan offers nothing to
   * select. Deliberately the *unfiltered* cards — the button concerns the whole
   * plan, not the current search result.
   */
  const canWriteShoppingList =
    keepStatus === 'ready' && mealPlanCards !== null && mealPlanCards.length > 0;

  /**
   * Whether the collection's counter can be stated at all. While Keep is
   * connected but the plan is still resolving, "restlich" is not known yet: the
   * count would first claim the whole collection and then drop by every planned
   * recipe the moment the plan arrives. The caption then stays bare, the same
   * honesty the header's status line used to keep.
   */
  const collectionCountable = !(keepStatus === 'ready' && mealPlanCards === null);

  /**
   * The counter of the "Essensplan" caption: `x Einträge, davon y unbekannt` —
   * y is how many of Keep's entries are not recognized as a recipe (the
   * "Unbekannt" badge; every entry counts, even a repeated one). Null while the
   * plan is not resolved (Keep off, connecting, still loading or failed): the
   * app must not claim a zero it cannot know.
   */
  const planCounter =
    mealPlanCards === null
      ? null
      : `(${mealPlanCards.length} ${mealPlanCards.length === 1 ? 'Eintrag' : 'Einträge'}, davon ${
          mealPlanCards.filter((card) => card.recipe === null).length
        } unbekannt)`;

  /** The counter of the "Restliche Sammlung" caption: `x Rezepte`. */
  const collectionCounter = collectionCountable
    ? `(${remainingRecipes.length} ${remainingRecipes.length === 1 ? 'Rezept' : 'Rezepte'})`
    : null;

  /** The "Essensplan" section body: connection states, then the entry cards. */
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
      // The caption above still names the section, so the placeholder only has
      // to say why nothing is listed here.
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
            // Recognized: the known card format. The overview receives the whole
            // card, so it can show the entry's stated size and turn its travel
            // action into "Umplanen".
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

  /**
   * The "Restliche Sammlung" section body: the collection's unplanned recipes.
   * No "Eingeplant" badge is needed here — the plan section above is the whole
   * set of planned dishes, and a recipe of this section is unplanned by
   * construction.
   */
  function renderCollection(): ReactNode {
    if (visibleRecipes.length === 0) {
      return (
        <p className="recipe-search-empty" role="status">
          {trimmedQuery !== ''
            ? `Kein Rezept für „${trimmedQuery}“ gefunden.`
            : remainingRecipes.length === 0
              ? // Every recipe of the collection stands on the meal plan.
                'Alle Rezepte stehen auf dem Essensplan.'
              : 'Keine Rezepte im Cookbook-Ordner.'}
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
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={SEARCH_LABEL}
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
      </div>

      {/* "Essensplan": the plan entries, with the bundled shopping-list entry in
          the caption row. The row is the section's heading line: caption left,
          the plan's one action right. It wraps on a narrow phone, so the button
          may continue on a second line — still aligned to the section, never
          floating over it. */}
      <section className="recipe-section" aria-labelledby={MEALPLAN_CAPTION_ID}>
        <div className="recipe-section-header">
          <h2 className="recipe-section-caption" id={MEALPLAN_CAPTION_ID}>
            Essensplan
            {/* No counter while a search runs: it counts the plan, not the
                result, and a number that ignores the query would contradict the
                cards below it. */}
            {needle === '' && planCounter !== null && (
              <span className="recipe-section-counter">{planCounter}</span>
            )}
          </h2>

          {/* The entry into the bundled shopping-list view. It only exists while
              the plan is connected and carries entries — there is nothing to
              select from otherwise. After the flow wrote the list, the same
              place reports that state: the symbol becomes a check, the label
              says so and the button is unavailable (a second write would
              duplicate the lines, and Keep itself cannot tell the app whether
              the list matches the plan). */}
          {canWriteShoppingList && (
            <button
              type="button"
              className="text-button shopping-list-button"
              onClick={onWriteShoppingList}
              disabled={shoppingWritten}
            >
              {shoppingWritten ? (
                <CheckCircleIcon className="button-icon" />
              ) : (
                <ListPlusIcon className="button-icon" />
              )}
              <span>
                {shoppingWritten ? 'Einkaufsliste geschrieben' : 'Einkaufsliste schreiben'}
              </span>
            </button>
          )}
        </div>
        {renderMealPlan()}
      </section>

      {/* "Restliche Sammlung": everything the meal plan does not use. */}
      <section className="recipe-section" aria-labelledby={COLLECTION_CAPTION_ID}>
        <div className="recipe-section-header">
          <h2 className="recipe-section-caption" id={COLLECTION_CAPTION_ID}>
            Restliche Sammlung
            {needle === '' && collectionCounter !== null && (
              <span className="recipe-section-counter">{collectionCounter}</span>
            )}
          </h2>
        </div>
        {renderCollection()}
      </section>
    </>
  );
}

export default RecipeList;
