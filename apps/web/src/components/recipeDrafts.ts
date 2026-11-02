/**
 * Draft factories and the draft type of the recipe editor (RecipeEditor.tsx).
 *
 * They live in a module of their own for two reasons: the editor is a component
 * module, and exporting a plain function next to a component breaks React Fast
 * Refresh ("only export components"); and App needs to build the prefilled draft
 * for a new recipe without importing anything else from the editor component.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md); this module holds no copy.
 */

import type { Recipe } from '@cookbook/core';

/** The draft holds every field except the derived master ingredient list. */
export type EditorDraft = Omit<Recipe, 'ingredients'>;

/**
 * True when a parsed value has at least the fields the editor needs to render
 * it. Used by the local recovery copy and by the saved-draft store: both read
 * JSON that may have been written by an older or a corrupt build, and neither
 * may hand the editor an object it would crash on. Optional fields are not
 * validated here — a draft is allowed to be incomplete.
 */
export function isEditorDraft(value: unknown): value is EditorDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<EditorDraft>;
  if (typeof draft.title !== 'string') return false;
  if (draft.type !== 'finished_dish' && draft.type !== 'ingredient_recipe') return false;
  if (typeof draft.prep_time !== 'string') return false;
  if (!Array.isArray(draft.steps)) return false;
  return draft.steps.every((step) => {
    if (typeof step !== 'object' || step === null) return false;
    const candidate = step as { text?: unknown; ingredients?: unknown };
    return typeof candidate.text === 'string' && Array.isArray(candidate.ingredients);
  });
}

/** A fresh draft for a new recipe (all optional fields unset). */
export function newRecipeDraft(): EditorDraft {
  return {
    title: '',
    type: 'finished_dish',
    prep_time: '',
    steps: [{ ingredients: [], text: '' }],
  };
}

/**
 * A fresh, valid new-recipe draft with a prefilled title. App uses it to open the
 * editor from an unrecognized meal-plan entry ("Eintrag ersetzen" → "Rezept
 * manuell schreiben"): the entry's complete Keep text becomes the starting title,
 * and the derived master list stays empty because there are no ingredient rows
 * yet.
 */
export function newRecipeDraftWithTitle(title: string): Recipe {
  return { ...newRecipeDraft(), title, ingredients: [] };
}
