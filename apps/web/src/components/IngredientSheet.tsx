/**
 * Ingredient / quantity sheet (bottom sheet) for the recipe editor.
 *
 * Used in three modes:
 * - "row-add" / "row-edit" — add a row to a step's own ingredient list, or
 *   edit one step-row (name + Menge). A row is a *counted* ingredient: it
 *   feeds the recipe's master list (storage_format.md §4). The name is
 *   required and must come from the master data or be an ingredient recipe
 *   (sub-recipe — implicit by name == title).
 * - "inline-add" — insert a display-only inline artifact into the step text
 *   (`{{100 g}}`, `{{100}}` or `{{1500 ml Wasser}}`). Artifacts scale with the
 *   serving count but are never counted; the ingredient name is optional, and
 *   a quantity-only artifact may omit the unit entirely.
 *
 * Decided with the user:
 * - only ingredients from the master data are allowed in rows (no free text) —
 *   the unit is derived from the ingredient's master-data entry (g or ml
 *   family) as soon as the name is chosen, there is no unit selector in row
 *   modes;
 * - sub-recipes behave like regular ingredients: their titles appear in the
 *   same name autofill (tagged "Zutaten-Rezept"), the quantity family comes
 *   from the sub-recipe's yield unit, and picking a title makes the row/
 *   artifact a sub-recipe use implicitly (there is no link field);
 * - the quantity is picked with the QuantityPicker (suggested chips + a
 *   ±1-rung stepper over the full pool 1 … 10000); quantity-only inline
 *   mentions may be Gewicht / Volumen / ohne Einheit;
 * - the live preview shows the full display form ("1 Becher Joghurt (400 g)",
 *   "1,5 l Wasser", "100") via core renderAQS/formatBQ;
 * - the reference role is set on the *master list* only — this sheet never
 *   offers it (recipe_structure.md §Reference).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useMemo, useState } from 'react';

import {
  formatBQ,
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

/** How the confirmed value is applied by the editor. */
export type IngredientSheetMode = 'row-add' | 'row-edit' | 'inline-add';

/** Unit choice for a quantity-only inline mention (g/ml family or unitless). */
export type FreeUnit = QuantityFamily | 'none';

/** A confirmed row/artifact value. Rows always carry a name and a unit;
 *  quantity-only inline artifacts may omit the name and/or the unit. */
export type SheetResult = Ingredient | { quantity: number; unit?: Unit };

interface IngredientSheetProps {
  mode: IngredientSheetMode;
  /** The existing row when editing (row modes only). */
  initial?: Ingredient;
  /** Prefill after the create-master-data flow (name + quantity restored). */
  prefill?: { name: string; quantity: number };
  /** The collection's ingredient recipes, offered in the name autofill. */
  ingredientRecipes: IngredientRecipeOption[];
  /**
   * Called with the resulting value; `action 'remove'` only in row-edit mode.
   * In inline-add mode the name and/or the unit may be absent.
   */
  onConfirm: (ingredient: SheetResult, action: 'add' | 'update' | 'remove') => void;
  onClose: () => void;
  /** Opens the create-master-data sheet for an unregistered name; the current
   *  name+quantity are passed along so the sheet can be restored on return. */
  onCreateNewIngredient: (name: string, quantity: number) => void;
}

/**
 * The bottom sheet with the ingredient/quantity form (see file header).
 * Renders on top of the editor; the backdrop closes it.
 */
function IngredientSheet({
  mode,
  initial,
  prefill,
  ingredientRecipes,
  onConfirm,
  onClose,
  onCreateNewIngredient,
}: IngredientSheetProps) {
  const [name, setName] = useState(prefill?.name ?? initial?.name ?? '');
  const [quantity, setQuantity] = useState(prefill?.quantity ?? initial?.quantity ?? 100);
  /** Inline mode without a name: the author picks Gewicht / Volumen / no unit. */
  const [freeUnit, setFreeUnit] = useState<FreeUnit>('g');
  const [error, setError] = useState<string | null>(null);

  const rowMode = mode === 'row-add' || mode === 'row-edit';
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
  /** A name is only valid when it exists in the master data or is a recipe title. */
  const isMasterName = masterNames.includes(trimmedName);
  const validName = isMasterName || isRecipeTitle;
  /** Rows always need a valid name; inline artifacts may be quantity-only. */
  const nameRequired = rowMode || trimmedName !== '';

  /** The quantity family: master data / sub-recipe yield when a name is
   *  chosen, otherwise the free choice of the inline mode (null = unitless). */
  const family: QuantityFamily | null =
    trimmedName === ''
      ? freeUnit === 'none'
        ? null
        : freeUnit
      : isRecipeTitle
        ? ingredientRecipes.find((recipe) => recipe.title === trimmedName)?.yieldUnit === 'ml'
          ? 'ml'
          : 'g'
        : familyOf(trimmedName);
  /** Stored unit: always present for rows/ingredient mentions. */
  const unit: Unit | undefined = family ?? initial?.unit;

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
    if (trimmedName !== '' && !validName) {
      setError(
        `„${trimmedName}" ist weder in der Zutaten-Stammdatenliste noch ein Zutaten-Rezept.`,
      );
      return;
    }
    if (nameRequired && trimmedName === '') {
      setError('Bitte eine Zutat aus der Liste wählen.');
      return;
    }
    const value: SheetResult =
      trimmedName !== ''
        ? { name: trimmedName, quantity, unit: unit ?? 'g' }
        : unit !== undefined
          ? { quantity, unit }
          : { quantity };
    onConfirm(value, mode === 'row-edit' ? 'update' : 'add');
  };

  const showCreate = trimmedName !== '' && !validName;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === 'inline-add'
            ? 'Menge im Text einfügen'
            : mode === 'row-add'
              ? 'Zutat zum Schritt hinzufügen'
              : 'Zutat des Schritts bearbeiten'
        }
      >
        <h3 className="sheet-title">
          {mode === 'inline-add'
            ? 'Menge im Text'
            : mode === 'row-add'
              ? 'Zutat zum Schritt hinzufügen'
              : 'Zutat bearbeiten'}
        </h3>

        <label className="field">
          <span className="field-label">
            Name {mode === 'inline-add' ? '(optional — leer = nur Menge)' : ''}
          </span>
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder={
              mode === 'inline-add' ? 'Leer lassen oder aus Liste wählen' : 'Tippen, um aus der Liste zu wählen'
            }
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
        {showCreate && (
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
              danach kannst du sie im Rezept verwenden.
            </p>
          </div>
        )}

        {mode === 'inline-add' && trimmedName === '' && (
          <div className="field">
            <span className="field-label">Einheit</span>
            <div className="segmented" role="group" aria-label="Einheit der Menge">
              <button
                type="button"
                className={freeUnit === 'g' ? 'segmented-active' : ''}
                onClick={() => setFreeUnit('g')}
              >
                Gewicht
              </button>
              <button
                type="button"
                className={freeUnit === 'ml' ? 'segmented-active' : ''}
                onClick={() => setFreeUnit('ml')}
              >
                Volumen
              </button>
              <button
                type="button"
                className={freeUnit === 'none' ? 'segmented-active' : ''}
                onClick={() => setFreeUnit('none')}
              >
                ohne Einheit
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">Menge</span>
          <QuantityPicker value={quantity} onChange={setQuantity} family={family} />
        </div>

        {/* Live preview of the display form (§2). */}
        <p className="aqs-preview" aria-live="polite">
          {trimmedName !== '' && validName
            ? renderAQS(trimmedName, quantity, unit ?? 'g')
            : unit !== undefined
              ? formatBQ(quantity, unit)
              : String(quantity)}
        </p>

        {error !== null && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="sheet-actions">
          {mode === 'row-edit' && (
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
            {mode === 'inline-add' ? 'Einfügen' : mode === 'row-add' ? 'Hinzufügen' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default IngredientSheet;
