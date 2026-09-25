/**
 * "Bestehendes Rezept auswählen" overlay — replaces an unrecognized meal-plan
 * entry with an existing recipe of the collection.
 *
 * Opened from the recipe overview of an unrecognized entry, whose "Eintrag
 * ersetzen" menu offers it as the first of three entries (./RecipeOverview). It
 * is a layer inside the recipe overview, not a screen of its own: the overview
 * owns Escape and the browser Back for it (RecipeOverviewHandle), and its own
 * backdrop closes just this layer — exactly like the meal-plan overlay
 * (./MealPlanSheet), whose stacking layer (z-index 40 / 41) it shares, since the
 * two are never open at the same time.
 *
 * The sheet, top to bottom:
 * - its title names the action ("Bestehendes Rezept auswählen");
 * - one explanatory line states the consequence with the entry it replaces:
 *   "Ersetzt den Eintrag „…“ auf dem Essensplan." The entry is named in its
 *   human form (without the export URL) — the same text the overview shows as
 *   its title and the removal notice uses;
 * - the collection's search field, focused on open so the user can type right
 *   away. It works like the ingredient sheet's name picker (./IngredientSheet):
 *   suggestions appear only while something is typed — recipe titles containing
 *   the text, capped at six — and picking one pastes its complete title into the
 *   field, which empties the list: the picked title has moved into the field and
 *   is not listed below it again. The picked recipe is simply the
 *   one whose title the field then holds exactly, so a hand-typed full title
 *   selects it too;
 * - once a recipe is picked and its file has been read, the familiar size input
 *   for the recipe type — the serving chips for a finished dish, the
 *   QuantityPicker (suggested chips + ladder stepper) for an ingredient recipe —
 *   starting on the size the recipe is written in, exactly like "Einplanen", so
 *   an untouched size replaces the entry with the dish as it stands;
 * - below the size input, the recipe's reference ingredients scaled to the
 *   choice — the same readout the meal-plan overlay shows, and the sanity check
 *   described in docs/recipe_structure.md ("the reference ingredient's amount
 *   moves by the same steps");
 * - "Abbrechen" closes the overlay without writing; "Eintrag ersetzen" hands the
 *   chosen recipe and size to App, which builds the Keep line and performs the
 *   write — only App knows the entry's exact text, the recipe's export file and
 *   the shortener. The write ends the whole flow back at the list like the other
 *   meal-plan writes (decided with the user), so only "Abbrechen" returns to the
 *   overview; a failure keeps the overlay open and shows the reason next to the
 *   button while the button reports the running write ("Wird ersetzt …", the
 *   shared busy label).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useMemo, useState } from 'react';

import {
  difference,
  integerLadderValues,
  scale,
  writtenPlannedAmount,
  yieldViewQuantities,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import QuantityPicker from './QuantityPicker';
import { safeRenderAQS } from './ingredientDisplay';
import { CloseIcon, SearchIcon } from './icons';

/**
 * The serving options of a finished dish: the same integer standard numbers
 * 1–30 the editor offers and the meal plan accepts (mealPlan.ts). They cover
 * every value the plan can carry, so the dish needs no stepper — exactly like
 * the meal-plan overlay's size input.
 */
const SERVING_OPTIONS = integerLadderValues(1, 30);

/**
 * How many suggestions the field offers at once. The same cap the ingredient
 * sheet's name picker uses: a candidate list is a shortcut, not a browser.
 */
const MAX_SUGGESTIONS = 6;

/** The search field's placeholder and accessible name. */
const SEARCH_LABEL = 'Rezept suchen';

/** The picked recipe's read state, tagged with the file it belongs to (see below). */
type PickRead =
  | { fileId: string; status: 'loaded'; recipe: Recipe }
  | { fileId: string; status: 'error'; message: string };

interface ReplaceRecipeSheetProps {
  /**
   * The unrecognized entry in its human form (without the export URL). It is
   * what the explanatory line names — the same text the overview shows as its
   * title.
   */
  entryLabel: string;
  /** Every recipe of the collection: the picker's candidates. */
  recipes: StoredRecipe[];
  /** Drive access token, needed to read the picked recipe's file. */
  token: string;
  /** Closes the overlay without writing ("Abbrechen", backdrop, Escape, Back). */
  onClose: () => void;
  /**
   * Performs the replace write for the chosen recipe and size. App builds the
   * complete Keep line there — the recipe's export link, shortened when the
   * gateway can do it, or the long URL as before — because only App knows the
   * entry's exact text, the recipe's export file and the shortener. Resolves
   * when the entry was replaced (App then closes the whole flow, so this overlay
   * unmounts) and rejects with the reason when it failed, which keeps the
   * overlay open.
   */
  onConfirm: (recipe: StoredRecipe, planned: PlannedAmount) => Promise<void>;
}

/**
 * The replace overlay (see file header). It owns the search text, the picked
 * recipe's read state and the size choice; the write and the collection belong
 * to App.
 */
function ReplaceRecipeSheet({
  entryLabel,
  recipes,
  token,
  onClose,
  onConfirm,
}: ReplaceRecipeSheetProps) {
  /** The search text. The sheet unmounts on close, so every open starts empty. */
  const [query, setQuery] = useState('');
  /**
   * The read state of the last picked recipe, tagged with its file id. Tagging
   * is what lets the render show only the state that belongs to the *current*
   * pick: editing the field drops the old pick without a second state to clear,
   * and picking the same title again keeps the file that is already there.
   */
  const [pick, setPick] = useState<PickRead | null>(null);
  /** Selected serving count (finished dish). */
  const [servings, setServings] = useState(1);
  /** Selected yield in the family unit (ingredient recipe). */
  const [yieldQuantity, setYieldQuantity] = useState(1000);
  /** True while the write is running — both buttons are unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the buttons (null = no failure). */
  const [error, setError] = useState<string | null>(null);

  // Normalized once so the filter below only repeats the cheap includes
  // comparison, not the normalization (same rule as the ingredient sheet's
  // name picker).
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  /**
   * The picked recipe: the one whose title the field holds exactly — the same
   * rule the ingredient sheet applies to a chosen name. A clicked suggestion
   * pastes the exact title, a hand-typed full title selects it just the same,
   * and anything else means "nothing picked yet".
   */
  const selected = useMemo(
    () => (trimmedQuery === '' ? null : (recipes.find((r) => r.title === trimmedQuery) ?? null)),
    [recipes, trimmedQuery],
  );

  /**
   * Suggestions: titles containing the typed text, capped like the ingredient
   * sheet. Computed per render from `recipes`, which never changes while the
   * sheet is open. Nothing is offered while the field is empty — the list is a
   * reaction to typing, never a browser of the whole collection. Once the field
   * holds a recipe's exact title, that recipe has moved into the field (a
   * clicked suggestion, or a title typed out in full): the list stays empty
   * instead of repeating the pick or fanning related titles out around it.
   */
  const suggestions = useMemo(() => {
    if (needle === '') return [];
    if (selected !== null) return [];
    return recipes
      .filter((recipe) => recipe.title.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [recipes, needle, selected]);

  /** The picked recipe's file id, or null while nothing is picked. */
  const selectedFileId = selected?.fileId ?? null;

  /**
   * The picked recipe's file, or null while there is none / it does not belong
   * to the current pick / it is still being read.
   */
  const details =
    pick !== null && pick.status === 'loaded' && pick.fileId === selectedFileId
      ? pick.recipe
      : null;
  /** Reason the read of the *current* pick failed, or null. */
  const loadError =
    pick !== null && pick.status === 'error' && pick.fileId === selectedFileId
      ? pick.message
      : null;

  // Read the picked recipe's file: the size input needs its type, its written
  // size and — for an ingredient recipe — the yields its export bakes, and the
  // reference readout needs its master list. The effect runs when the picked
  // file changes; it only sets state in the promise callbacks, never
  // synchronously (same rule as the overview's own read). The cleanup drops a
  // superseded read, so a quick change of the pick cannot apply a stale file.
  useEffect(() => {
    if (selectedFileId === null) return;
    let cancelled = false;
    void readRecipe(token, selectedFileId)
      .then((loaded) => {
        if (cancelled) return;
        setPick({ fileId: selectedFileId, status: 'loaded', recipe: loaded });
        // Start on the size the recipe is written in, exactly like "Einplanen":
        // replacing without touching the size uses the dish as it stands. A
        // size that does not fit the recipe type (impossible after parsing, but
        // this sheet must not guess) keeps the neutral default.
        const written = writtenPlannedAmount(loaded);
        if (loaded.type === 'finished_dish') {
          setServings(written.kind === 'servings' ? written.servings : 1);
        } else {
          setYieldQuantity(written.kind === 'yield' ? written.quantity : 1000);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPick({
          fileId: selectedFileId,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedFileId]);

  /** True while the picked recipe is a finished dish (the chips mode). */
  const isDish = details?.type === 'finished_dish';

  /**
   * The picked recipe's family unit; the meal plan only accepts a size in it.
   * Only read while `details` is loaded, so the fallback is never used.
   */
  const family = details?.yield_unit === 'ml' ? 'ml' : 'g';

  /**
   * The yields the recipe's export bakes a view for (±2 decades around the
   * written yield, core's recipe/yieldViews.ts). The picker is bounded by it, so
   * every size offered here is one the Keep entry's link can really open.
   */
  const bakedYields =
    details !== null && !isDish && details.yield !== undefined
      ? yieldViewQuantities(details.yield)
      : null;

  /** The size the user picked, in the shape the write needs. */
  const planned: PlannedAmount | null =
    details === null
      ? null
      : details.type === 'finished_dish'
        ? { kind: 'servings', servings }
        : { kind: 'yield', quantity: yieldQuantity, baseUnit: family };

  /**
   * The reference ingredients scaled by the same step as everything else
   * (docs/recipe_structure.md): the display is the sanity check of the choice,
   * the same readout the meal-plan overlay shows below its size input.
   */
  const writtenSize = details === null ? undefined : isDish ? details.servings : details.yield;
  const deltaX =
    writtenSize === undefined ? 0 : difference(writtenSize, isDish ? servings : yieldQuantity);
  const references =
    details === null
      ? []
      : details.ingredients
          .filter((ingredient) => ingredient.reference)
          .map((ingredient) =>
            safeRenderAQS(ingredient.name, scale(ingredient.quantity, deltaX), ingredient.unit),
          );

  /**
   * "Eintrag ersetzen" is unavailable until a recipe is picked *and* its file is
   * read (the size input appears right above it meanwhile) and while the write
   * runs: a local cause the sheet shows, so the muted look alone carries it
   * (docs/CODING_CONVENTIONS.md, unavailable buttons).
   */
  const canConfirm = details !== null && !busy;

  /**
   * Edits the search text. The picked-recipe state above is derived from the
   * text, so a change simply stops matching: the old size input and read state
   * disappear on their own. Only the previous *write* failure is cleared here —
   * it belonged to a pick that is being changed.
   */
  const handleQueryChange = (value: string): void => {
    setQuery(value);
    setError(null);
  };

  /**
   * Picks a suggestion: its complete title goes into the field, which makes it
   * the only suggestion and the picked recipe (identical to the ingredient
   * sheet's name picker). Writing the same title again is a no-op, so a pick
   * that is already loaded is never dropped.
   */
  const adoptSuggestion = (recipe: StoredRecipe): void => {
    if (recipe.title === trimmedQuery) return;
    handleQueryChange(recipe.title);
  };

  /**
   * Confirms the choice. The write itself belongs to App (it owns the entry's
   * exact text and the Keep action); on success the caller closes the whole
   * flow, so this overlay unmounts and only the failure path has state to
   * restore.
   */
  const handleConfirm = async (): Promise<void> => {
    if (selected === null || planned === null) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected, planned);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      {/* Its own backdrop above the overview sheet, so a tap outside closes this
          layer only. */}
      <div
        className="sheet-backdrop replace-recipe-backdrop"
        onClick={onClose}
        role="presentation"
      />
      <div
        className="sheet replace-recipe-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-recipe-title"
      >
        <h2 className="sheet-title" id="replace-recipe-title">
          Bestehendes Rezept auswählen
        </h2>

        {/* The consequence, with the entry it replaces named in its human form
            (the overview's title text, without the export URL). */}
        <p className="replace-recipe-intro">
          Ersetzt den Eintrag „{entryLabel}“ auf dem Essensplan.
        </p>

        {/* The home screen's own search control: field, symbol and clear button
            share its styles (recipe-list.css), only the sticky wrapper is left
            off — inside the sheet the field is a normal block. It takes the
            focus on open, so the user can start typing right away. */}
        <div className="recipe-search-field" role="search">
          <SearchIcon className="recipe-search-icon" />
          <input
            type="search"
            className="recipe-search-input"
            placeholder={SEARCH_LABEL}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            aria-label={SEARCH_LABEL}
            autoFocus
          />
          {query !== '' && (
            <button
              type="button"
              className="recipe-search-clear"
              aria-label="Suche löschen"
              onClick={() => handleQueryChange('')}
            >
              <CloseIcon className="recipe-search-clear-icon" />
            </button>
          )}
        </div>

        {/* The suggestions, in the ingredient sheet's own list style: only while
            something is typed, and each one pastes its complete title. */}
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((recipe) => (
              <li key={recipe.fileId}>
                <button type="button" onClick={() => adoptSuggestion(recipe)}>
                  {recipe.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Nothing matches the typed text: a quiet report instead of a blank
            area, so the field never looks broken. Suppressed while the field
            holds a recipe's exact title — the list is empty because the pick
            moved into the field, not because nothing was found. */}
        {trimmedQuery !== '' && selected === null && suggestions.length === 0 && (
          <p className="recipe-search-empty" role="status">
            {`Kein Rezept für „${trimmedQuery}“ gefunden.`}
          </p>
        )}

        {/* The picked recipe's file is being read: the size input is not there
            yet, so this line is the visible cause of the unavailable button
            below it (docs/CODING_CONVENTIONS.md, unavailable buttons). */}
        {selected !== null && details === null && loadError === null && (
          <p className="replace-recipe-loading" role="status">
            Rezept wird geladen …
          </p>
        )}

        {/* The read of the picked recipe failed (corrupt or deleted file): the
            reason next to the size input, which stays absent. */}
        {loadError !== null && (
          <p className="replace-recipe-error" role="alert">
            {loadError}
          </p>
        )}

        {/* The size input, once the picked recipe is known: the editor's own
            control for the recipe type, exactly like the meal-plan overlay. */}
        {details !== null &&
          (isDish ? (
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
            // only accepts a size that fits the recipe), so only the quantity is
            // chosen here — no Gewicht/Volumen switch.
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
          ))}

        {/* The reference ingredients, scaled to the choice — the same readout
            the meal-plan overlay shows, in the same shared style. Deliberately
            no caption: it is a readout of the amounts, not a form field. */}
        {references.length > 0 && <p className="meal-plan-reference">{references.join(', ')}</p>}

        {error !== null && (
          <p className="replace-recipe-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          <button type="button" className="text-button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            aria-busy={busy}
          >
            {busy ? 'Wird ersetzt …' : 'Eintrag ersetzen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default ReplaceRecipeSheet;
