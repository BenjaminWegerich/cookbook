/**
 * Ingredient sheet (bottom sheet) for the recipe editor.
 *
 * Used in two modes:
 * - "add" — create a new ingredient (from a step's "+ Zutat"). The editor
 *   inserts the marker {{ingredient|…}} into the step text at the caret;
 * - "edit" — adjust every marker of the selected ingredient (Menge/Einheit/
 *   Referenz/Verknüpftes Rezept) or remove them.
 *
 * Decided with the user:
 * - only ingredients from the master data are allowed (no free text) — the
 *   unit is derived from the ingredient's master-data entry (g or ml family)
 *   as soon as the name is chosen, there is no unit selector;
 * - the quantity is picked with the QuantityPicker (suggested chips + a
 *   ±1-rung stepper over the full pool 1 … 10000);
 * - the live preview shows the full display arrangement ("1 Becher Joghurt
 *   (1.2 kg)") via the core renderAQS.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useMemo, useState } from 'react';

import {
  INGREDIENT_MAPPINGS,
  masterIngredientNames,
  renderAQS,
  type Ingredient,
  type Unit,
} from '@cookbook/core';

import QuantityPicker from './QuantityPicker';
import type { QuantityFamily } from './quantityChips';

/** The base unit of an ingredient from the master data (family g or ml). */
function familyOf(name: string): QuantityFamily | null {
  const mappings = INGREDIENT_MAPPINGS[name];
  if (mappings === undefined || mappings.length === 0) {
    return null;
  }
  const bu = mappings[0].bu;
  return bu === 'ml' ? 'ml' : 'g';
}

interface IngredientSheetProps {
  mode: 'add' | 'edit';
  /** The existing (derived, merged) entry when editing. */
  initial?: Ingredient;
  /** finished_dish recipes allow the reference flag (§4: at most 2 per recipe). */
  referenceAllowed: boolean;
  /** Count of other entries already flagged as reference (for the max-2 rule). */
  referenceUsed: number;
  /** Titles of existing ingredient recipes, for the Verknüpftes Rezept suggestions. */
  ingredientRecipeTitles: string[];
  /** Called with the resulting entry; action 'remove' only in edit mode. */
  onConfirm: (ingredient: Ingredient, action: 'add' | 'update' | 'remove') => void;
  onClose: () => void;
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
  ingredientRecipeTitles,
  onConfirm,
  onClose,
}: IngredientSheetProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity ?? 100);
  const [reference, setReference] = useState(initial?.reference === true);
  const [recipe, setRecipe] = useState(initial?.recipe ?? '');
  const [error, setError] = useState<string | null>(null);

  /** The ingredient's family unit, derived from the master data (§7). */
  const family = familyOf(name);
  /** Stored unit of this ingredient: the family unit, or the legacy unit when editing. */
  const unit: Unit = family ?? initial?.unit ?? 'g';

  /** Master-data ingredient names matching the typed name (prefix + substring). */
  const suggestions = useMemo(() => {
    const needle = name.trim().toLowerCase();
    if (needle === '') return [];
    return masterIngredientNames()
      .filter((candidate) => candidate.toLowerCase().includes(needle))
      .slice(0, 5);
  }, [name]);

  /** The ingredient is only valid when its name exists in the master data. */
  const isMasterName = useMemo(() => masterIngredientNames().includes(name.trim()), [name]);

  /**
   * Adopts a suggestion: exact name, plus the master data's base unit and a
   * quantity of one additional unit (e.g. Joghurt → 400 g → "1 Becher"), so
   * the preview starts at a meaningful value.
   */
  const adoptSuggestion = (candidate: string): void => {
    setName(candidate);
    const mappings = INGREDIENT_MAPPINGS[candidate];
    if (mappings !== undefined && mappings.length > 0) {
      setQuantity(mappings[0].factor);
    }
  };

  const handleConfirm = (): void => {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('Bitte eine Zutat aus der Liste wählen.');
      return;
    }
    if (!isMasterName) {
      setError(`„${trimmedName}" ist nicht in der Zutaten-Stammdatenliste.`);
      return;
    }
    const ingredient: Ingredient = {
      name: trimmedName,
      quantity,
      unit,
      ...(reference ? { reference: true } : {}),
      ...(recipe.trim() !== '' ? { recipe: recipe.trim() } : {}),
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
                </button>
              </li>
            ))}
          </ul>
        )}
        {name.trim() !== '' && !isMasterName && (
          <p className="field-error" role="alert">
            Nicht in der Zutaten-Stammdatenliste — bitte eine Vorschlags-Zutat wählen.
          </p>
        )}

        <div className="field">
          <span className="field-label">Menge</span>
          <QuantityPicker value={quantity} onChange={setQuantity} family={family ?? 'g'} />
        </div>

        {/* Live BQS + AQS preview (docs/additional_quantity_specifications.md §2). */}
        <p className="aqs-preview" aria-live="polite">
          {isMasterName ? renderAQS(name.trim(), quantity, unit) : `${quantity} ${unit} …`}
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

        <label className="field">
          <span className="field-label">Verknüpftes Rezept</span>
          <input
            type="text"
            list="ingredient-recipe-titles"
            value={recipe}
            onChange={(event) => setRecipe(event.target.value)}
            placeholder="Zutaten-Rezept, z. B. Béchamelsauce"
          />
          <datalist id="ingredient-recipe-titles">
            {ingredientRecipeTitles.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
        </label>

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
