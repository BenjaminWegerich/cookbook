/**
 * Bundled shopping-list selection — the full-screen page behind "Einkaufsliste
 * schreiben" on the home screen (App's `shopping` layer).
 *
 * The page is the "Essensplan" list in a different form: the same resolved
 * meal-plan cards (../keep/mealPlanCards), in Keep's order, but as rows of one
 * list instead of cards, and without photos — the page is about choosing
 * dishes, not about browsing them. What it chooses is the *bundle*: all picked
 * dishes reach the shopping list in one write, so an ingredient several recipes
 * share is rounded to whole packs once instead of once per recipe (two recipes
 * that each need 300 g tofu in 200 g blocks: three blocks, not four).
 *
 * Per row:
 * - a checkbox — recognized Cookbook recipes are checked by default (the user
 *   only *removes* what they do not want to shop for), an entry without a
 *   recipe behind it carries a disabled box: there is nothing to scale and
 *   nothing to add, so it cannot be part of the bundle;
 * - the recipe title and, next to it, the size the dish is cooked at
 *   (`formatPlannedAmount` in @cookbook/core: "6 Portionen" or a yield like
 *   "500 g"). That size is what the Keep entry states, or — when it states none
 *   — the size the recipe is written in: such an entry means the dish at its
 *   written size, which is what its link opens, so the row names the amount
 *   instead of showing nothing (the same fallback the recipe overview's
 *   "Geplant" value uses, core's `writtenPlannedAmount`). Only an entry whose
 *   file could not be read at all shows no size;
 * - for an unrecognized entry the entry's complete text and the familiar danger
 *   badge "Unbekannt" after it, the same one the home screen's card shows.
 *
 * Tapping the row body (never a word inside it) opens the familiar recipe
 * overview in the applicable style — App builds that target from the card, the
 * same way the "Essensplan" tab does. The checkbox is its own target and only
 * toggles: the two adjacent targets are what a list of choices needs, unlike
 * the home screen's cards, where the whole card is one hitbox.
 *
 * The selected dishes are the *only* state of this step: the ingredients of the
 * checked ones are resolved on the next page (the pantry sheet,
 * ./PantrySelect), which then performs the write. The aisle sort is still
 * follow-up work.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { formatPlannedAmount } from '@cookbook/core';

import type { MealPlanCard } from '../keep/mealPlanCards';
import { ErrorIcon } from './icons';

interface ShoppingListSelectProps {
  /**
   * The resolved meal-plan cards in Keep's order, or null while the plan is
   * still being resolved (see ../keep/mealPlanCards). The page is only opened
   * for a plan that has entries; the states below cover a plan that moves while
   * it is open (a Keep re-resolve after an undo, which is no longer a plan).
   */
  cards: MealPlanCard[] | null;
  /**
   * Opens the familiar recipe overview for the tapped row. App builds the
   * target from the card, exactly like the "Essensplan" tab does, so a
   * recognized entry arrives with its stated size and "Umplanen" and an
   * unrecognized one as the destination for replacing or dropping it.
   */
  onOpenCard: (card: MealPlanCard) => void;
  /**
   * Hands the checked dishes over to the pantry step ("Vorräte auswählen") —
   * the second half of the flow, where each ingredient's stock is chosen and
   * only the missing amount reaches the shopping list. App owns that page,
   * because it owns the Keep write and the flow's navigation.
   */
  onChoosePantry: (cards: readonly MealPlanCard[]) => void;
  /** Leaves the page for the home screen (header "Zurück", browser Back). */
  onClose: () => void;
}

/**
 * The selection page (see file header). It owns nothing but the checked state:
 * the cards, the Drive token and the meal-plan targets belong to App.
 */
function ShoppingListSelect({
  cards,
  onOpenCard,
  onChoosePantry,
  onClose,
}: ShoppingListSelectProps) {
  /**
   * The keys the user has *unchecked*. Storing the deviation instead of the
   * selection keeps one rule true for every recognized card, including one that
   * only appears while the page is open (the plan can move: an undo re-plans a
   * dish, the resolution catches up): a new dish arrives checked like every
   * other recognized one, and it can never arrive silently unselected.
   */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set<string>());

  /** A recognized card is checked unless the user took the check away. */
  function isChecked(card: MealPlanCard): boolean {
    return card.recipe !== null && !unchecked.has(card.key);
  }

  /** The checked, recognized cards: the bundle the pantry step receives. */
  function checkedCards(): MealPlanCard[] {
    return (cards ?? []).filter(isChecked);
  }

  /** Takes one dish in or out of the bundle. */
  function toggleChecked(card: MealPlanCard): void {
    setUnchecked((previous) => {
      const next = new Set(previous);
      if (next.has(card.key)) {
        next.delete(card.key);
      } else {
        next.add(card.key);
      }
      return next;
    });
  }

  /** The meal-plan rows, or the state the plan is in instead. */
  function renderPlan(): ReactNode {
    if (cards === null) {
      return (
        <p className="loading-message" role="status">
          Essensplan wird geladen …
        </p>
      );
    }
    if (cards.length === 0) {
      return (
        <p className="shopping-select-empty" role="status">
          Kein Gericht im Essensplan.
        </p>
      );
    }
    return (
      <ul className="shopping-select-list">
        {cards.map((card) => {
          const recipe = card.recipe;
          /**
           * The size the dish is really cooked at: what the Keep entry states,
           * or — when it states none — the size the recipe is written in
           * (resolved onto the card, see ../keep/mealPlanCards). A size-less
           * entry is not "no amount": its link opens the dish at its written
           * size, so the row must name that amount.
           */
          const planned = card.planned ?? card.writtenPlanned;
          return (
            <li key={card.key} className="shopping-select-item">
              {/* The two hitboxes of the row. Recognized: a real checkbox the
                  user can take the dish out of the bundle with. Unrecognized:
                  a disabled box — there is no recipe behind the entry, so it
                  can neither be scaled nor added. */}
              {recipe !== null ? (
                <label className="shopping-select-check">
                  <input
                    type="checkbox"
                    checked={isChecked(card)}
                    onChange={() => toggleChecked(card)}
                    aria-label={`${recipe.title} auswählen`}
                  />
                </label>
              ) : (
                <span className="shopping-select-check">
                  <input
                    type="checkbox"
                    disabled
                    aria-label={`${card.displayText} — unbekannt, nicht auswählbar`}
                  />
                </span>
              )}

              <button
                type="button"
                className="shopping-select-open"
                onClick={() => onOpenCard(card)}
              >
                <span className="shopping-select-title">
                  {recipe !== null ? recipe.title : card.displayText}
                </span>
                {recipe !== null && planned !== null && (
                  <span className="shopping-select-size">{formatPlannedAmount(planned)}</span>
                )}
                {recipe === null && (
                  <span className="recipe-badge recipe-badge-unknown">
                    <ErrorIcon className="recipe-badge-icon" />
                    <span>Unbekannt</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <main className="app shopping-select">
      {/* "Zurück" on its own line at the top left, the screen title below it —
          the editor's back placement, shared with the AI screen
          (.app-header-stacked in styles/recipe-list.css). */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button" onClick={onClose}>
          Zurück
        </button>
        <h1>Gerichte vom Essensplan auswählen</h1>
      </header>

      <p className="shopping-select-intro">
        Die Zutaten für die ausgewählten Gerichte werden zur Einkaufsliste hinzugefügt. Du kannst im
        nächsten Schritt Zutaten ausschließen, die im Vorrat sind.
      </p>

      {renderPlan()}

      {/* The forward action of this step: it hands the checked dishes to the
          pantry step, where the ingredients behind them are compared with the
          stock. Accent, content width and right-aligned (decided with the
          user). It only exists while the plan carries entries, and it is
          unavailable while nothing is checked — a bundle of no dishes has no
          ingredients to shop for, and its pantry page would be empty. */}
      {cards !== null && cards.length > 0 && (
        <div className="shopping-select-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onChoosePantry(checkedCards())}
            disabled={checkedCards().length === 0}
          >
            Vorräte auswählen
          </button>
        </div>
      )}
    </main>
  );
}

export default ShoppingListSelect;
