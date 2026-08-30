/**
 * Ingredient sheet (bottom sheet) for the recipe editor.
 *
 * Used in two modes:
 * - "add" — create a new ingredient (from a step's "+ Zutat"). The editor
 *   inserts the marker {{ingredient|…}} into the step text at the caret;
 * - "edit" — adjust every marker of the selected ingredient (Menge/Einheit/
 *   Referenz) or remove them.
 *
 * Decided with the user:
 * - only ingredients from the master data are allowed (no free text) — the
 *   unit is derived from the ingredient's master-data entry (g or ml family)
 *   as soon as the name is chosen, there is no unit selector;
 * - sub-recipes behave like regular ingredients: their titles appear in the
 *   same name autofill (tagged "Zutaten-Rezept"), the quantity family comes
 *   from the sub-recipe's yield unit, and picking a title sets the |recipe:
 *   link implicitly (name == title invariant) — there is no separate
 *   "Verknüpftes Rezept" field;
 * - the quantity is picked with the QuantityPicker (suggested chips + a
 *   ±1-rung stepper over the full pool 1 … 10000);
 * - the live preview shows the full display arrangement ("1 Becher Joghurt
 *   (1.2 kg)") via the core renderAQS.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useMemo, useState } from 'react';

import {
  masterIngredientNames,
  mappingsFor,
  renderAQS,
  type Ingredient,
  type Unit,
} from '@cookbook/core';

import QuantityPicker from './QuantityPicker';
import type { QuantityFamily } from './quantityChips';

/** One ingredient recipe of the collection, as the sheet needs it for the
 * name autofill (a sub-recipe is chosen by its title, like any ingredient). */
export interface IngredientRecipeOption {
  title: string;
  /** The recipe's yield in its family unit — adopted as the suggested amount. */
  yield: number;
  /** The recipe's yield unit (g or ml family) — the sub-recipe's quantity family. */
  yieldUnit: Unit;
}

/** The base unit of an ingredient from the master data (family g or ml). */
function familyOf(name: string): QuantityFamily | null {
  const entry = mappingsFor(name);
  if (entry === undefined) {
    return null;
  }
  return entry.bu === 'ml' ? 'ml' : 'g';
}

interface IngredientSheetProps {
  mode: 'add' | 'edit';
  /** The existing (derived, merged) entry when editing; after the
   *  create-master-data flow (add mode) a synthetic entry carrying the
   *  name+quantity to restore. */
  initial?: Ingredient;
  /** finished_dish recipes allow the reference flag (§4: at most 2 per recipe). */
  referenceAllowed: boolean;
  /** Count of other entries already flagged as reference (for the max-2 rule). */
  referenceUsed: number;
  /** The collection's ingredient recipes, offered in the name autofill. */
  ingredientRecipes: IngredientRecipeOption[];
  /** Called with the resulting entry; action 'remove' only in edit mode. */
  onConfirm: (ingredient: Ingredient, action: 'add' | 'update' | 'remove') => void;
  onClose: () => void;
  /** Opens the create-master-data sheet for an unregistered name; the current
   *  name+quantity are passed along so the sheet can be restored on return. */
  onCreateNewIngredient: (name: string, quantity: number) => void;
}

/**
 * The bottom sheet with the ingredient form (see file header). Renders on top
 * of the editor; the backdrop closes it.
 */
function IngredientSheet({
  mode,
  initial,
  referenceAllowed,
  referenceUsed,
  ingredientRecipes,
  onConfirm,
  onClose,
  onCreateNewIngredient,
}: IngredientSheetProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? 100);
  const [reference, setReference] = useState(initial?.reference === true);
  const [error, setError] = useState<string | null>(null);

  /** Titles of the collection's ingredient recipes (Set for O(1) lookups). */
  const recipeTitles = useMemo(
    () => new Set(ingredientRecipes.map((recipe) => recipe.title)),
    [ingredientRecipes],
  );

  const trimmedName = name.trim();
  /** A chosen ingredient-recipe title IS a sub-recipe (name == title, §4). */
  const isRecipeTitle = recipeTitles.has(trimmedName);
  /** Master names are read on every render: the runtime registry changes when
   *  the create sheet saves a new ingredient (see ingredientRegistry.ts). */
  const masterNames = masterIngredientNames();
  /** The ingredient is only valid when its name exists in the master data. */
  const isMasterName = masterNames.includes(trimmedName);
  const validName = isMasterName || isRecipeTitle;

  /**
   * The sub-recipe link is implied by the chosen name. In edit mode a legacy
   * entry whose link no longer matches any recipe title (e.g. a hand-written
   * file with a divergent name) keeps its link as long as the name is
   * unchanged — editing anything else must not silently drop the link.
   */
  const recipeLink: string | undefined = isRecipeTitle
    ? trimmedName
    : mode === 'edit' && trimmedName === initial?.name && initial?.recipe !== undefined
      ? initial.recipe
      : undefined;

  /**
   * The ingredient's family unit: the master-data unit, or — for a
   * sub-recipe — the yield unit of the ingredient recipe (a recipe title
   * wins over a master-data collision: the entry IS the sub-recipe).
   */
  const family: QuantityFamily | null = isRecipeTitle
    ? ingredientRecipes.find((recipe) => recipe.title === trimmedName)?.yieldUnit === 'ml'
      ? 'ml'
      : 'g'
    : familyOf(trimmedName);
  /** Stored unit of this ingredient: the family unit, or the legacy unit when editing. */
  const unit: Unit = family ?? initial?.unit ?? 'g';

  /**
   * Suggestions: master-data ingredient names plus ingredient-recipe titles
   * matching the typed name (prefix + substring). A title that is also a
   * master name appears once — the sub-recipe interpretation wins. Computed
   * per render so newly created master data shows up immediately.
   */
  const needle = trimmedName.toLowerCase();
  let suggestions: string[] = [];
  if (needle !== '') {
    const master = masterNames.filter((candidate) => candidate.toLowerCase().includes(needle));
    const titles = ingredientRecipes
      .map((recipe) => recipe.title)
      .filter((title) => title.toLowerCase().includes(needle));
    suggestions = [...master];
    for (const title of titles) {
      if (!suggestions.some((candidate) => candidate.toLowerCase() === title.toLowerCase())) {
        suggestions.push(title);
      }
    }
    suggestions = suggestions.slice(0, 6);
  }

  /**
   * Adopts a suggestion: exact name, plus the quantity base (the master data's
   * base unit factor, or the sub-recipe's yield) so the preview starts at a
   * meaningful value (e.g. Joghurt → 400 g → "1 Becher"; Béchamelsauce →
   * 500 ml).
   */
  const adoptSuggestion = (candidate: string): void => {
    setName(candidate);
    const recipe = ingredientRecipes.find((entry) => entry.title === candidate);
    if (recipe !== undefined) {
      setQuantity(recipe.yield);
      return;
    }
    const entry = mappingsFor(candidate);
    if (entry !== undefined && entry.entries.length > 0) {
      setQuantity(entry.entries[0].factor);
    }
  };

  const handleConfirm = (): void => {
    if (trimmedName === '') {
      setError('Bitte eine Zutat aus der Liste wählen.');
      return;
    }
    if (!validName) {
      setError(
        `„${trimmedName}" ist weder in der Zutaten-Stammdatenliste noch ein Zutaten-Rezept.`,
      );
      return;
    }
    const ingredient: Ingredient = {
      name: trimmedName,
      quantity,
      unit,
      ...(reference ? { reference: true } : {}),
      ...(recipeLink !== undefined ? { recipe: recipeLink } : {}),
    };
    onConfirm(ingredient, mode === 'edit' ? 'update' : 'add');
  };

  /** The reference toggle is locked when both slots are taken by others. */
  const referenceLocked = referenceUsed >= 2 && !reference;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'add' ? 'Zutat hinzufügen' : 'Zutat bearbeiten'}
      >
        <h3 className="sheet-title">{mode === 'add' ? 'Zutat hinzufügen' : 'Zutat bearbeiten'}</h3>

        <label className="field">
          <span className="field-label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tippen, um aus der Liste zu wählen"
            autoFocus
          />
        </label>
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((candidate) => (
              <li key={candidate}>
                <button type="button" onClick={() => adoptSuggestion(candidate)}>
                  {candidate}
                  {recipeTitles.has(candidate) && (
                    <span className="badge olive suggestion-tag">Zutaten-Rezept</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {trimmedName !== '' && !validName && (
          <div className="not-in-master">
            <p className="field-error" role="alert">
              Weder in der Zutaten-Stammdatenliste noch ein Zutaten-Rezept — bitte einen Vorschlag
              wählen oder die Zutat neu anlegen.
            </p>
            <button
              type="button"
              className="create-ingredient-button"
              onClick={() => onCreateNewIngredient(trimmedName, quantity)}
            >
              Neue Zutat anlegen
            </button>
            <p className="create-ingredient-hint">
              Legt „{trimmedName}“ mit Stammdaten an (Basis-Einheit + optionale Umrechnungen) —
              danach kannst du sie zum Rezept hinzufügen.
            </p>
          </div>
        )}

        <div className="field">
          <span className="field-label">Menge</span>
          <QuantityPicker value={quantity} onChange={setQuantity} family={family ?? 'g'} />
        </div>

        {/* Live BQS + AQS preview (docs/additional_quantity_specifications.md §2). */}
        <p className="aqs-preview" aria-live="polite">
          {validName ? renderAQS(trimmedName, quantity, unit) : `${quantity} ${unit} …`}
        </p>

        {referenceAllowed && (
          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={reference}
              disabled={referenceLocked}
              onChange={(event) => setReference(event.target.checked)}
            />
            <span>
              Referenz-Menge
              <small>Anker für die Portionsgröße (max. 2 pro Rezept)</small>
            </span>
          </label>
        )}

        {error !== null && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          {mode === 'edit' && (
            <button
              type="button"
              className="danger-button"
              onClick={() => onConfirm(initial!, 'remove')}
            >
              Entfernen
            </button>
          )}
          <button type="button" className="text-button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary-button" onClick={handleConfirm}>
            {mode === 'add' ? 'Hinzufügen' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default IngredientSheet;
