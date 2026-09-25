/**
 * Meal-plan overlay: puts a known recipe on the Google Keep meal plan, or
 * changes the size of a dish that is already on it.
 *
 * Opened from the recipe overview's meal-plan action — "Einplanen" for a known
 * recipe that is not planned yet, "Umplanen" for one that is. Both modes share
 * the size input and the reference readout; they differ in the heading, the
 * size they start on and the buttons:
 *
 * - **Einplanen** (`mode: 'plan'`) — "Zum Essensplan hinzufügen" writes the
 *   dish. The size starts on the size the recipe is written in (its servings /
 *   its yield).
 * - **Umplanen** (`mode: 'replan'`) — "Menge ändern" replaces the entry with
 *   one at the newly chosen size. The size starts on the size the meal-plan
 *   entry states (`previous`, decided with the user); an entry that states none
 *   falls back to the written size, exactly like "Einplanen". The button is
 *   unavailable until the size actually differs from the one the plan states
 *   (docs/CODING_CONVENTIONS.md, unavailable buttons: the selected chips/stepper
 *   right above it show the reason). The overlay deliberately carries no
 *   "remove" action — taking the dish off the plan lives behind the overview's
 *   "Mehr" menu (decided with the user).
 *
 * In both modes:
 * - the heading names the action with the recipe ("<Titel> einplanen" /
 *   "<Titel> umplanen");
 * - the size input is the editor's own control for the recipe type — the
 *   serving chips for a finished dish, the QuantityPicker (suggested chips +
 *   ladder stepper) for an ingredient recipe;
 * - below it one small muted line shows the recipe's reference ingredients
 *   scaled to the selected size: the sanity check described in
 *   docs/recipe_structure.md ("the reference ingredient's amount moves by the
 *   same steps"). It carries the amounts only, without a caption (decided with
 *   the user) — it is a readout, not another form field, and the overview
 *   already names the recipe. The line is omitted when the recipe defines no
 *   reference;
 * - "Abbrechen" closes the overlay without writing. The writing button hands the
 *   caller the chosen size; App builds the Keep line there, because only App
 *   knows the recipe's export file, the entries to replace and the shortener.
 *   With a short link that is "Kürbissuppe (6 Portionen): https://tinyurl.com/…"
 *   — the size as the visible label, the promised size baked into the short
 *   link's target — and without a shortener the long export link stays
 *   ("Kürbissuppe: https://…/exec?f=…&portionen=6"). A recipe without an export
 *   file falls back to "Kürbissuppe (6 Portionen)". On failure the sheet stays
 *   open and shows the reason next to the button, while the button reports the
 *   running write ("Wird hinzugefügt …" / "Wird geändert …", the shared busy
 *   label).
 *
 * The selectable sizes are exactly what the meal plan accepts
 * (packages/core/src/mealPlan.ts): a finished dish takes an integer standard
 * number 1–30 ("6 Portionen"), an ingredient recipe a ladder value in its own
 * family unit that also has a baked export view — the picker is bounded by
 * `yieldViewQuantities` (±2 decades around the written yield, see
 * packages/core/src/recipe/yieldViews.ts). Because the controls only ever
 * produce such a value, the write needs no re-validation.
 *
 * The overlay is a layer inside the recipe overview, not a screen of its own:
 * the overview owns Escape and the browser Back for it (RecipeOverviewHandle),
 * and its own backdrop closes just this layer. "Abbrechen" is the only way back
 * to the overview: a successful write ends the whole flow in App in both modes
 * (decided with the user), exactly like "Zum Essensplan hinzufügen" always did,
 * so the list's card is the confirmation of the change.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import {
  difference,
  integerLadderValues,
  scale,
  writtenPlannedAmount,
  yieldViewQuantities,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

import QuantityPicker from './QuantityPicker';
import { safeRenderAQS } from './ingredientDisplay';

/**
 * The serving options of a finished dish: the same integer standard numbers
 * 1–30 the editor offers and the meal plan accepts (mealPlan.ts). They cover
 * every value the plan can carry, so the dish needs no stepper — exactly like
 * the editor's Portionen field.
 */
const SERVING_OPTIONS = integerLadderValues(1, 30);

/** Which meal-plan action the overlay runs (see the file header). */
export type MealPlanSheetMode = 'plan' | 'replan';

interface MealPlanSheetProps {
  /** The action the overlay runs: put the dish on the plan, or change its size. */
  mode: MealPlanSheetMode;
  /** The parsed recipe; its written size is the scale reference. */
  recipe: Recipe;
  /**
   * The size the meal-plan entry currently states, when it states one. It is
   * the pre-selected default in `replan` mode (decided with the user); a null
   * falls back to the size the recipe is written in, and `plan` mode ignores it.
   */
  previous: PlannedAmount | null;
  /** Closes the overlay without writing ("Abbrechen", backdrop, Escape, Back). */
  onClose: () => void;
  /**
   * Performs the write for the chosen size. App builds the complete Keep line
   * there — the recipe's export link, shortened when the gateway can do it, or
   * the long URL as before; a recipe without an export file falls back to the
   * linkless parenthetical shape — because only App knows the recipe's export
   * file, the existing plan entries to replace and the shortener. Resolves when
   * the plan holds the choice (App then closes the whole flow, so this overlay
   * unmounts with the overview) and rejects with the reason when it failed,
   * which keeps the overlay open.
   */
  onConfirm: (planned: PlannedAmount) => Promise<void>;
}

/**
 * The meal-plan overlay (see file header).
 */
function MealPlanSheet({ mode, recipe, previous, onClose, onConfirm }: MealPlanSheetProps) {
  const isDish = recipe.type === 'finished_dish';
  /** The recipe's own family unit; the meal plan only accepts a size in it. */
  const family = recipe.yield_unit === 'ml' ? 'ml' : 'g';
  /**
   * The size the recipe is written in, in the plan's own shape (core's
   * `writtenPlannedAmount`). It is the overlay's fallback and the value the app
   * names wherever an entry states no size, so both come from one definition.
   */
  const written = writtenPlannedAmount(recipe);
  /**
   * The size the overlay starts on. `replan` pre-selects the plan's stated size
   * (decided with the user) and only falls back to the written size when the
   * entry states none — or when the stated kind does not match the recipe type
   * (impossible after the fit check, but this sheet must not guess a size). The
   * nested guards mirror `written.kind === isDish` for TypeScript: the helper
   * reads the same `recipe.type` the line above does.
   */
  const initialServings =
    isDish && previous?.kind === 'servings'
      ? previous.servings
      : written.kind === 'servings'
        ? written.servings
        : 1;
  const initialYield =
    !isDish && previous?.kind === 'yield'
      ? previous.quantity
      : written.kind === 'yield'
        ? written.quantity
        : 1000;
  /** Selected serving count (finished dish). */
  const [servings, setServings] = useState(initialServings);
  /** Selected yield in the family unit (ingredient recipe). */
  const [yieldQuantity, setYieldQuantity] = useState(initialYield);
  /** True while the write is running — both buttons are unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the buttons (null = no failure). */
  const [error, setError] = useState<string | null>(null);

  /**
   * The yields the recipe's export bakes a view for (±2 decades around the
   * written yield, core's recipe/yieldViews.ts). The picker is bounded by it, so
   * every size offered here is one the Keep entry's link can really open; the
   * core's fit check refuses anything outside it too.
   */
  const bakedYields =
    isDish || recipe.yield === undefined ? null : yieldViewQuantities(recipe.yield);

  /** The size the user picked. */
  const selectedSize = isDish ? servings : yieldQuantity;
  /** The size the recipe is written in — the scale reference. */
  const writtenSize = isDish ? recipe.servings : recipe.yield;
  /**
   * Ladder-step difference between the written and the selected size. A recipe
   * that states no size (invalid, so normally impossible) keeps the references
   * unscaled instead of guessing.
   */
  const deltaX = writtenSize === undefined ? 0 : difference(writtenSize, selectedSize);

  /**
   * True when the chosen size differs from the one the plan states. "Menge
   * ändern" is unavailable until it does (docs/CODING_CONVENTIONS.md): the
   * chips/stepper above the button show the current selection, so the cause is
   * visible right next to it. "Einplanen" always writes, so it is unaffected.
   */
  const sizeChanged = isDish ? servings !== initialServings : yieldQuantity !== initialYield;
  const canConfirm = mode === 'plan' || sizeChanged;

  /** The selection in the shape the write needs (and the core's formatter reads). */
  const planned: PlannedAmount = isDish
    ? { kind: 'servings', servings }
    : { kind: 'yield', quantity: yieldQuantity, baseUnit: family };

  // Reference ingredients scaled by the same step as everything else
  // (docs/recipe_structure.md): the display is the sanity check of the choice.
  const references = recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) =>
      safeRenderAQS(ingredient.name, scale(ingredient.quantity, deltaX), ingredient.unit),
    );

  /**
   * Confirms the choice. The write itself belongs to App (it owns the meal-plan
   * state, the removal list and the entry text); on success the caller closes
   * the whole flow, so this overlay unmounts and only the failure path has state
   * to restore.
   */
  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(planned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const isReplan = mode === 'replan';

  return (
    <>
      {/* Its own backdrop above the overview sheet, so a tap outside closes this
          layer only. */}
      <div className="sheet-backdrop meal-plan-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet meal-plan-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meal-plan-title"
      >
        <h2 className="sheet-title" id="meal-plan-title">
          {recipe.title} {isReplan ? 'umplanen' : 'einplanen'}
        </h2>

        {isDish ? (
          <div className="field">
            <span className="field-label">Portionen</span>
            <div className="quantity-chips" role="group" aria-label="Portionen">
              {SERVING_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === servings ? 'chip chip-active' : 'chip'}
                  onClick={() => setServings(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // The unit is fixed to the recipe's own family unit (the meal plan
          // only accepts a size that fits the recipe, mealPlan.ts), so only the
          // quantity is chosen here — no Gewicht/Volumen switch.
          <div className="field">
            <span className="field-label">Ergiebigkeit</span>
            <QuantityPicker
              value={yieldQuantity}
              onChange={setYieldQuantity}
              family={family}
              {...(bakedYields !== null
                ? { min: bakedYields[0]!, max: bakedYields[bakedYields.length - 1]! }
                : {})}
            />
          </div>
        )}

        {/* The reference ingredients, scaled to the choice. Deliberately no
            caption: the line is a readout of the amounts, not a form field, and
            a label would repeat what the recipe overview already said. */}
        {references.length > 0 && <p className="meal-plan-reference">{references.join(', ')}</p>}

        {error !== null && (
          <p className="meal-plan-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          <button type="button" className="text-button" onClick={onClose} disabled={busy} autoFocus>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleConfirm()}
            disabled={busy || !canConfirm}
            aria-busy={busy}
          >
            {busy
              ? isReplan
                ? 'Wird geändert …'
                : 'Wird hinzugefügt …'
              : isReplan
                ? 'Menge ändern'
                : 'Zum Essensplan hinzufügen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default MealPlanSheet;
