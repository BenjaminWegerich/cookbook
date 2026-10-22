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
 * - **Umplanen** (`mode: 'replan'`) — "Übernehmen" replaces the entry with
 *   one at the newly chosen size. The size starts on the size the meal-plan
 *   entry states (`previous`, decided with the user); an entry that states none
 *   falls back to the written size, exactly like "Einplanen". The button is
 *   always enabled: answered on the size the plan already states, it closes the
 *   overlay without writing, so the tap cannot fail and the row needs no hint
 *   line (§5.1, "unavailable is only allowed for a local cause"). The replan
 *   overlay additionally carries the
 *   "Abhaken" action (decided with the user): it sits first in the action row,
 *   in the bottom-left corner, so taking the dish off the plan lives next to
 *   "Abbrechen" and "Übernehmen" instead of behind the overview's "Mehr" menu.
 *   "Einplanen" has no such button — a dish that is not on the plan has nothing
 *   to remove.
 *
 * In both modes:
 * - the heading names the action with the recipe ("<Titel> einplanen" /
 *   "<Titel> umplanen");
 * - the size input is the editor's own control for the recipe type — the
 *   serving chips for a finished dish, the ValueStepper (suggested chips +
 *   baked views) for an ingredient recipe;
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
 *   With a short link that is "Kürbissuppe (6 Portionen): tinyurl.com/…"
 *   — the size as the visible label, the promised size baked into the short
 *   link's target, and the link written without its scheme because Keep links
 *   the bare host too — and without a shortener the long export link stays
 *   ("Kürbissuppe: https://…/exec?f=…&portionen=6"). A recipe without an export
 *   file falls back to "Kürbissuppe (6 Portionen)". On failure the sheet stays
 *   open and shows the reason next to the button, while the button reports the
 *   running write ("Wird hinzugefügt …" / "Wird übernommen …", the shared busy
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
  SERVING_COUNTS,
  defaultYieldView,
  formatBQ,
  writtenPlannedAmount,
  yieldViewQuantities,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

import { CheckBoxIcon } from './icons';
import ValueStepper from './ValueStepper';
import { safeRenderAQS } from './ingredientDisplay';
import { useSaveShortcut } from '../hooks/useSaveShortcut';

/**
 * The serving options of a finished dish: the same allowed counts the editor
 * offers and the meal plan accepts (servingSizes.ts). They cover every value
 * the plan can carry, so the dish needs no stepper — exactly like the editor's
 * Portionen field.
 */
const SERVING_OPTIONS = SERVING_COUNTS;

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
  /**
   * "Abhaken" (replan only): takes the dish off the meal plan. App owns the
   * Keep check write and its undo notice; this overlay only hands over, exactly
   * like the overview's other removal paths. On success App closes the whole
   * flow (overview included), so this overlay unmounts with it; a failure is
   * reported by App as its own error notice, because a fire-and-forget removal
   * has no place here to show a reason. `plan` mode never offers it — a dish
   * that is not on the plan has nothing to remove.
   */
  onRemove: () => void;
}

/**
 * The meal-plan overlay (see file header).
 */
function MealPlanSheet({
  mode,
  recipe,
  previous,
  onClose,
  onConfirm,
  onRemove,
}: MealPlanSheetProps) {
  const isDish = recipe.type === 'finished_dish';
  /** True in the "Umplanen" form: the dish is already on the plan (see header). */
  const isReplan = mode === 'replan';
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
  /**
   * The yields the recipe's export bakes a view for (allowed BQ values within
   * ±1 decade of the written yield, core's recipe/yieldViews.ts). The picker is
   * bounded by it, so every size offered here is one the Keep entry's link can
   * really open; the core's fit check refuses anything outside it too.
   */
  const bakedYields =
    isDish || recipe.yield === undefined ? null : yieldViewQuantities(recipe.yield);
  /** The view the recipe opens at: the written yield when it is a BQ value. */
  const defaultYield =
    recipe.yield === undefined ? initialYield : defaultYieldView(recipe.yield);

  /** Selected serving count (finished dish). */
  const [servings, setServings] = useState(initialServings);
  /** Selected yield in the family unit (ingredient recipe). */
  const [yieldQuantity, setYieldQuantity] = useState(() =>
    bakedYields !== null && bakedYields.includes(initialYield) ? initialYield : defaultYield,
  );
  /** True while the write is running — both buttons are unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the buttons (null = no failure). */
  const [error, setError] = useState<string | null>(null);

  /** The effective yield: a stale previous size falls back to the default view. */
  const effectiveYield =
    bakedYields !== null && !bakedYields.includes(yieldQuantity) ? defaultYield : yieldQuantity;
  /** The size the user picked. */
  const selectedSize = isDish ? servings : effectiveYield;
  /** The size the recipe is written in — the scale reference. */
  const writtenSize = isDish ? recipe.servings : recipe.yield;
  /**
   * Exact scale factor between the written and the selected size. A recipe
   * that states no size (invalid, so normally impossible) keeps the references
   * unscaled instead of guessing.
   */
  const factor = writtenSize === undefined ? 1 : selectedSize / writtenSize;

  /**
   * True when the chosen size differs from the one the overlay opened on (in
   * replan mode: the size the plan states). It decides whether "Übernehmen" has
   * anything to write — not whether it can be pressed (§5.1).
   */
  const sizeChanged = isDish ? servings !== initialServings : effectiveYield !== initialYield;

  /** The selection in the shape the write needs (and the core's formatter reads). */
  const planned: PlannedAmount = isDish
    ? { kind: 'servings', servings }
    : { kind: 'yield', quantity: effectiveYield, baseUnit: family };

  // Reference ingredients scaled by the same factor as everything else
  // (docs/recipe_structure.md): the display is the sanity check of the choice.
  const references = recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) =>
      safeRenderAQS(
        ingredient.name,
        ingredient.quantity * factor,
        ingredient.unit,
        {
          ...(ingredient.tolerance !== undefined ? { quantity: ingredient.tolerance } : {}),
          ...(recipe.tolerance !== undefined ? { recipe: recipe.tolerance } : {}),
        },
      ),
    );

  /**
   * Runs the confirmation: keeps the overlay open while the write runs, and on
   * failure shows the reason next to the buttons instead of closing. On success
   * the caller closes the whole flow, so only the failure path has state to
   * restore.
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

  /**
   * The confirm button's action. In replan mode an unchanged size is a
   * confirmation without a change: the overlay closes and the entry stays as it
   * is — no write, no notice, and deliberately no error, so the always-enabled
   * button never has to fail (§5.1). "Einplanen" always writes; there the
   * pre-selected size is the recipe's written size, which is never "no choice".
   */
  const handleApply = (): void => {
    if (!isReplan || sizeChanged) {
      void handleConfirm();
      return;
    }
    onClose();
  };

  // Ctrl+S is the keyboard equivalent of the confirm button ("Übernehmen" /
  // "Zum Essensplan hinzufügen"): the overlay is only ever mounted while it is
  // the topmost layer, so the shortcut is always enabled here. It runs the same
  // action the button does, including the unchanged-size close (an unchanged
  // choice is a confirmation without a change, not an error).
  useSaveShortcut(handleApply);

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
            <span className="field-label">Menge</span>
            <ValueStepper
              value={effectiveYield}
              values={bakedYields ?? [effectiveYield]}
              onChange={setYieldQuantity}
              format={(candidate) => formatBQ(candidate, family)}
              ariaLabel="Menge"
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
          {/* "Abhaken" (replan only): takes the dish off the plan. It sits
              first in the row, in the bottom-left corner (the shared
              .sheet-actions .sheet-actions-lead rule pulls it there), next to
              "Abbrechen" and "Übernehmen". Like "Abbrechen" it is unavailable
              while a write runs, so the two writes cannot interleave. */}
          {isReplan && (
            <button
              type="button"
              className="outlined-button sheet-actions-lead"
              onClick={onRemove}
              disabled={busy}
            >
              <CheckBoxIcon className="button-icon" optical={20} />
              <span>Abhaken</span>
            </button>
          )}
          <button type="button" className="text-button" onClick={onClose} disabled={busy} autoFocus>
            Abbrechen
          </button>
          {/* Always enabled. "Übernehmen" answers the choice: an unchanged size
              in replan mode closes the overlay without a write (handleApply), so
              no muted look and no hint line are needed (§5.1). */}
          <button
            type="button"
            className="primary-button"
            onClick={handleApply}
            disabled={busy}
            aria-busy={busy}
          >
            {busy
              ? isReplan
                ? 'Wird übernommen …'
                : 'Wird hinzugefügt …'
              : isReplan
                ? 'Übernehmen'
                : 'Zum Essensplan hinzufügen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default MealPlanSheet;
