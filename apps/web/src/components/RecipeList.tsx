import { useMemo, useState, type ReactNode } from 'react';

import { matchShoppingItem } from '@cookbook/core';

import type { StoredRecipe } from '../drive/recipeStorage';
import type { KeepItem } from '../keep/keepClient';
import type { MealPlanCard } from '../keep/mealPlanCards';
import type { KeepStatus } from '../keep/useKeep';
import {
  CheckCircleIcon,
  CloseIcon,
  ListPlusIcon,
  RoomServiceIcon,
  SearchIcon,
  SortIcon,
} from './icons';
import RecipeThumb from './RecipeThumb';

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

/** DOM ids of the three captions (the headings' `aria-labelledby` targets). */
const SHOPPING_CAPTION_ID = 'recipe-section-shopping';
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
   * "Einkaufsliste schreiben" button in the "Einkaufsliste" heading). App
   * owns that screen, because only App holds the Keep state and the overview
   * targets.
   */
  onWriteShoppingList: () => void;
  /**
   * True while the current meal plan has already been written to the shopping
   * list in this session (App tracks it: Keep itself cannot say whether a list
   * belongs to the plan, and after a reload the app cannot deduce it either).
   * The button then reads "Einkaufsliste geschrieben" and is unavailable.
   */
  shoppingWritten: boolean;
  /**
   * Opens the shopping-list sort ("sortieren", the button next to the write
   * button under the "Einkaufsliste" caption). App owns that screen, because
   * only App holds the Keep state and the Drive writes for the newly assigned
   * stops.
   */
  onSortShoppingList: () => void;
  /**
   * True while the shopping list carries entries and can be sorted. The sort is
   * about the shopping list, not the meal plan, so this is independent of the
   * write button's condition.
   */
  shoppingSortable: boolean;
  /**
   * True while the current shopping list has already been sorted this session
   * (App tracks it, like `shoppingWritten`): Keep itself cannot say whether the
   * list is in route order. The button then reads "sortiert".
   */
  shoppingSorted: boolean;
  /**
   * The current shopping list's entries in Keep's display order, or null while
   * Keep is off, connecting, loading or failed. The "Einkaufsliste" caption
   * counts the list's own work (its unchecked lines and how many of them name no
   * assigned stop), so it receives the list itself and not only a boolean like
   * the sort button, whose condition is a single yes/no.
   */
  shoppingItems: readonly KeepItem[] | null;
}

/**
 * Home screen: one sticky search field, below it the "Einkaufsliste" heading and
 * then the two captioned sections of the collection, each rendered as the same
 * adaptive card grid (two columns on a phone, more on wider screens) and both
 * filtered by the one search field (decided with the user):
 *
 * - **Einkaufsliste** is the shopping list's own heading, directly below the
 *   search field: the caption names the list on a line of its own and carries its
 *   two actions underneath — the bundled write of the meal plan's dishes
 *   ("Einkaufsliste schreiben") and the aisle sort ("sortieren"), both described
 *   below. It has no body of its own: the heading *is* the section, because the
 *   actions belong to the Keep list rather than to a set of cards, and it appears
 *   only once that list is known — without a Keep connection there is neither a
 *   counter nor an action, and a bare caption over nothing would be a dead end
 *   (decided with the user). Its counter
 *   states the list's own work — `x Einträge, davon y unbekannt`: x counts the
 *   list's *unchecked* lines (the checked ones are done, and the aisle sort
 *   leaves them at the bottom), y counts those unchecked lines that name no
 *   assigned stop (core's `matchShoppingItem`), i.e. exactly the lines the sort
 *   page has to ask about.
 * - **Essensplan** shows the non-checked entries of the Google Keep meal plan,
 *   one card per entry, in Keep's order. An entry recognized as a recipe (its
 *   text is a recipe title, plus an optional fitting size suffix) renders in
 *   the known card format; every other entry renders as a card whose media area
 *   is the danger "unbekannt" symbol instead of a photo, with the entry's title
 *   as its title (the export link, a stated size and a free-text note are left
 *   out — the overview behind the card shows them). Tapping either card opens
 *   the overview: the recognized one with its stated size and "Umplanen", the
 *   unrecognized one as the destination for replacing or dropping the entry.
 * - **Restliche Sammlung** shows the recipes that are *not* on the meal plan.
 *   The planned ones are already in the section above, so repeating them here
 *   would put the same card on one screen twice; the plan section is where a
 *   planned dish is read, changed and cooked from. With Keep off every recipe is
 *   "restlich", which is exactly what the section then shows.
 *
 * Each caption carries its counter ("Essensplan (5 Einträge, davon 2 unbekannt)",
 * "Restliche Sammlung (8 Rezepte)", "Einkaufsliste (4 Einträge, davon 1
 * unbekannt)"). The captions copy the editor's field-caption typography
 * (.field-label: small, semibold, muted, all caps), with the counter itself set
 * exactly like the editor's quiet "(optional)" marker: normal case, italic,
 * slightly translucent, one en space after the caption word. The two card
 * sections' counters disappear while the search is active — the field is focused
 * or carries a query — because each counts its section, not the result; their
 * captions stay: they are the sections' headings, and a section that is empty
 * only because of the search still has to say which section it is. The body then
 * carries the placeholder sentence. The "Einkaufsliste" heading follows the same
 * reason more strictly and disappears as a whole (see the search note below).
 *
 * Under the "Einkaufsliste" caption sits **"Einkaufsliste schreiben"** (decided
 * with the user), the entry into the bundled shopping-list selection: there the
 * recipes of the meal plan are selected, and one write adds all of their
 * ingredients at once. Bundling is the point, not only the saved clicks — two
 * recipes that each need 300 g tofu round to two 200 g blocks on their own, but
 * to three blocks when they are written together (./ShoppingListSelect). The
 * button acts on the plan, so it appears only while the plan is connected and
 * actually carries entries; it is a soft accent chip (clay text on a light clay
 * tint, one clay hairline, pill shape, plus symbol) — decided with the user, who
 * wanted the entry clearly more prominent than the bare text button it used to
 * be, while the filled floating action button stays the screen's one loud
 * control. The heading keeps the list's name in the caption and in this button's
 * label, so the entry into the flow reads on its own.
 *
 * Once that flow has written the list, the button reads **"Einkaufsliste
 * geschrieben"**, carries the check instead of the plus and is unavailable — for
 * as long as the meal plan is the one that was written (App tracks that in
 * memory, see the `shoppingWritten` prop).
 *
 * Next to it, in the same row under the caption, sits **"sortieren"** — the aisle
 * sort. Its label drops the list's name, because the caption right above it
 * already says "Einkaufsliste" (decided with the user); the write button keeps
 * the full phrase, since it names the flow it opens. The sort acts on the
 * shopping list itself, so it appears whenever that list carries unchecked
 * entries, independently of whether the meal plan offers anything to write, and
 * it reads **"sortiert"** once this session's sort ran (see the
 * `shoppingSortable` / `shoppingSorted` props).
 *
 * Search filters the cards of the two card sections (recipe title, complete
 * meal-plan entry text), never the captions. The two card sections' counters hide
 * as soon as the search field is focused or carries a query: a counter that
 * ignores the query would contradict the cards below it. The whole
 * "Einkaufsliste" heading — caption, counter and both actions — disappears at the
 * same moment: its actions act on the whole Keep list, not on whatever the search
 * narrows the cards to, and a caption left standing over nothing but those
 * actions would open onto a dead end, so the caption goes with them (decided with
 * the user). The whole card is the hitbox — the badges are plain content inside
 * it, never a target of their own. UI language is German (see
 * docs/CODING_CONVENTIONS.md).
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
  onSortShoppingList,
  shoppingSortable,
  shoppingSorted,
  shoppingItems,
}: RecipeListProps) {
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Normalized once so the per-render filters below only repeat the cheap
  // includes comparisons, not the normalization. Empty query and thus an empty
  // trim collapse to the same "show everything" state, so a query of only
  // spaces is treated as no query at all.
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  // The search is "active" while the field is focused or carries a query: the
  // two caption-row actions of the "Essensplan" section and the section counters
  // hide then, because the user is busy with the search, not with the whole
  // list — and a counter that ignores the query would contradict the cards
  // below it.
  const searchActive = needle !== '' || searchFocused;

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
   * y is how many of Keep's entries are not recognized as a recipe (the cards
   * with the danger "unbekannt" symbol; every entry counts, even a repeated
   * one). Null while the
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

  /**
   * The shopping list's unchecked lines — the ones the list still has to be
   * shopped for and the only ones the aisle sort reorders (the checked ones stay
   * at the bottom). Null while the list is not known, so the counter below can
   * stay silent instead of claiming a zero.
   */
  const uncheckedShoppingItems =
    shoppingItems === null ? null : shoppingItems.filter((item) => !item.checked);

  /**
   * The counter of the "Einkaufsliste" caption: `x Einträge, davon y unbekannt`
   * over the unchecked lines — y is how many of them name no assigned stop
   * (core's `matchShoppingItem` returns null), exactly the lines the sort page
   * has to ask about. Null while Keep is off, connecting, still loading or
   * failed: the app must not claim a zero it cannot know, the same honesty the
   * plan counter keeps. An empty but known list reads "(0 Einträge, davon 0
   * unbekannt)".
   */
  const shoppingCounter =
    uncheckedShoppingItems === null
      ? null
      : `(${uncheckedShoppingItems.length} ${
          uncheckedShoppingItems.length === 1 ? 'Eintrag' : 'Einträge'
        }, davon ${
          uncheckedShoppingItems.filter((item) => matchShoppingItem(item.text) === null).length
        } unbekannt)`;

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
      // to say why nothing is listed here: a search that found nothing is
      // answer enough, so the text is a bare em dash.
      return (
        <p className="recipe-search-empty" role="status">
          —
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
          // Unrecognized: no recipe stands behind the entry, so the card's media
          // area is not a photo but the danger "unbekannt" symbol — the serving
          // cloche of RoomServiceIcon, decided with the user, who wanted it to
          // read as "a dish, not known yet" instead of as an error — which is why
          // the card carries no badge any more. The title is the entry
          // without its export URL, its stated size and its free-text note —
          // exactly the shape a known recipe's card has — and the overview
          // behind the card shows those recognized parts (size, note, link)
          // plus the "Unbekannt" badge.
          return (
            <li key={card.key}>
              <button type="button" className="recipe-card" onClick={() => onOpenPlanCard(card)}>
                <span className="recipe-media">
                  <span className="recipe-thumb recipe-thumb-unknown">
                    <RoomServiceIcon className="recipe-thumb-icon" />
                  </span>
                </span>
                <span className="recipe-card-title">
                  <span className="recipe-card-title-text">{card.title}</span>
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
      // Same placeholder as the plan section above: the caption names the
      // section, and a search without a match needs no sentence of its own.
      return (
        <p className="recipe-search-empty" role="status">
          —
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
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
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

      {/* "Einkaufsliste": the shopping list's own heading, directly below the
          search field and above the two card sections. The caption names the list
          on its own line; underneath it a row carries the list's two actions —
          the bundled write into the list ("Einkaufsliste schreiben") and the
          aisle sort ("sortieren"). It has no body: the heading *is* the section,
          because the actions belong to the Keep list, not to a set of cards. The
          caption keeps the list's name, which the sort button then does not have
          to repeat. The heading exists only while the list itself is known
          (`shoppingItems`): without a connection there is neither a counter nor
          an action, and a bare caption over nothing would be a dead end (decided
          with the user). While the search is active (the field is focused or
          carries a query) it disappears as a whole: the search narrows the card
          sections below, and its two actions act on the whole Keep list, so
          caption, counter and actions go together (decided with the user). */}
      {!searchActive && shoppingItems !== null && (
        <section className="recipe-section" aria-labelledby={SHOPPING_CAPTION_ID}>
          <div className="recipe-section-header">
            <h2 className="recipe-section-caption" id={SHOPPING_CAPTION_ID}>
              Einkaufsliste
              {shoppingCounter !== null && (
                <span className="recipe-section-counter">{shoppingCounter}</span>
              )}
            </h2>

            {/* The entry into the bundled shopping-list view. It only exists
                while the plan is connected and carries entries — there is nothing
                to select from otherwise. After the flow wrote the list, the same
                place reports that state: the symbol becomes a check, the label
                says so and the button is unavailable (a second write would
                duplicate the lines, and Keep itself cannot tell the app whether
                the list matches the plan). The label keeps the list's name, so
                the entry reads on its own even though the caption above it
                already names the list. */}
            {(canWriteShoppingList || shoppingSortable) && (
              <div className="shopping-list-actions">
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

                {/* The aisle sort ("sortieren"), next to the write button. Its
                    label drops the list's name because the caption above it says
                    it (decided with the user). It acts on the shopping list, so
                    it appears whenever that list carries unchecked entries —
                    independently of whether the meal plan offers anything to
                    write. After the sort ran, the same place reports the state: a
                    check instead of the sort symbol and an unavailable button (a
                    second sort is a no-op until the list changes again). */}
                {shoppingSortable && (
                  <button
                    type="button"
                    className="text-button shopping-list-button"
                    onClick={onSortShoppingList}
                    disabled={shoppingSorted}
                  >
                    {shoppingSorted ? (
                      <CheckCircleIcon className="button-icon" />
                    ) : (
                      <SortIcon className="button-icon" />
                    )}
                    <span>{shoppingSorted ? 'sortiert' : 'sortieren'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* "Essensplan": the plan entries, one captioned section. The caption
          carries the plan's counter above the cards; the shopping-list actions
          no longer live in this row — they moved to the "Einkaufsliste" heading
          above, where they belong to the list they act on. */}
      <section className="recipe-section" aria-labelledby={MEALPLAN_CAPTION_ID}>
        <div className="recipe-section-header">
          <h2 className="recipe-section-caption" id={MEALPLAN_CAPTION_ID}>
            Essensplan
            {/* No counter while the search is active (the field is focused or
                carries a query): it counts the plan, not the result, and a
                number that ignores the query would contradict the cards below
                it. */}
            {!searchActive && planCounter !== null && (
              <span className="recipe-section-counter">{planCounter}</span>
            )}
          </h2>
        </div>
        {renderMealPlan()}
      </section>

      {/* "Restliche Sammlung": everything the meal plan does not use. */}
      <section className="recipe-section" aria-labelledby={COLLECTION_CAPTION_ID}>
        <div className="recipe-section-header">
          <h2 className="recipe-section-caption" id={COLLECTION_CAPTION_ID}>
            Restliche Sammlung
            {!searchActive && collectionCounter !== null && (
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
