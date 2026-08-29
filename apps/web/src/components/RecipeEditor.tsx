/**
 * Recipe editor screen (ROADMAP, web app Phase 2) — marker model.
 *
 * Decided with the user (round 2):
 * - the step text is the source of truth for the ingredient list: ingredients
 *   are inserted as {{ingredient|…}} markers into the steps and rendered as
 *   artifacts in the step editor; the Zutaten list is *derived* from the
 *   markers (order of first appearance, duplicates merged with the total);
 * - ingredients are only added from the master data, during the steps
 *   ("+ Zutat") — never directly to the list; deleting an artifact from the
 *   text deletes the ingredient;
 * - quantities are stored in the family unit g/ml; the display switches to
 *   kg/l at 1000 (chips carry base quantity AND base unit, no steppers);
 * - sections: Kopfdaten (Foto, Titel, Details, Zeiten, Typ, Portionen/
 *   Ergiebigkeit), Zubereitung, Zutaten.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  RecipeParseError,
  deriveIngredients,
  integerLadderValues,
  parseRecipe,
  parseTimeValue,
  renderAQS,
  replaceMarkers,
  serializeRecipe,
  STANDARD_TIME_VALUES,
  updateMarkersByName,
  type Ingredient,
  type Recipe,
  type Unit,
  type ValidationIssue,
} from '@cookbook/core';

import {
  createRecipe,
  deleteRecipe,
  readRecipe,
  removeRecipeImage,
  saveRecipe,
  uploadRecipeImage,
  type StoredRecipe,
} from '../drive/recipeStorage';
import IngredientSheet from './IngredientSheet';
import StepEditor, { type StepEditorHandle } from './StepEditor';
import QuantityPicker from './QuantityPicker';

/** The draft holds every field except the derived ingredient list. */
type EditorDraft = Omit<Recipe, 'ingredients'>;

/** A fresh draft for a new recipe (all optional fields unset). */
function newRecipeDraft(): EditorDraft {
  return {
    title: '',
    type: 'finished_dish',
    prep_time: '',
    steps: [''],
  };
}

/** Strips the derived ingredients from a loaded recipe (they live in steps). */
function toDraft(recipe: Recipe): EditorDraft {
  const draft: Record<string, unknown> = { ...recipe };
  delete draft.ingredients;
  return normalizeStoredUnits(draft as unknown as EditorDraft);
}

/**
 * Normalizes legacy kg/l values into the g/ml family (decided with the user:
 * quantities are stored in g or ml; kg/l exist only in display). A hand-written
 * file with `yield: 2, yield_unit: kg` or a `{{ingredient|Mehl|2|kg}}` marker
 * is migrated in place (×1000) when the editor loads it — the file is the
 * canonical stored form, and the picker can then always work in the family
 * unit. ×1000 of a ladder rung is a ladder rung (+3 decades), so values stay
 * standard; the conversion cannot double-apply (after one pass the unit is
 * g/ml and never matches again).
 */
function normalizeStoredUnits(draft: EditorDraft): EditorDraft {
  const steps = draft.steps.map((step) =>
    replaceMarkers(step, (marker) => {
      if (marker.unit === 'kg') {
        return { ...marker, quantity: marker.quantity * 1000, unit: 'g' };
      }
      if (marker.unit === 'l') {
        return { ...marker, quantity: marker.quantity * 1000, unit: 'ml' };
      }
      return marker;
    }),
  );
  const yieldIsKg = draft.yield_unit === 'kg';
  const yieldIsL = draft.yield_unit === 'l';
  return {
    ...draft,
    steps,
    yield: yieldIsKg || yieldIsL ? (draft.yield ?? 0) * 1000 : draft.yield,
    yield_unit: yieldIsKg ? 'g' : yieldIsL ? 'ml' : draft.yield_unit,
  };
}

/** Rebuilds a full Recipe from a draft (the list is derived from the steps). */
function withIngredients(draft: EditorDraft): Recipe {
  return { ...draft, ingredients: deriveIngredients(draft.steps) };
}

/** Integer standard numbers 1–30 — the allowed serving counts (decision 7). */
const SERVING_OPTIONS = integerLadderValues(1, 30);

interface RecipeEditorProps {
  /** Drive access token. */
  token: string;
  /** The recipe to edit (from the list); null creates a new recipe. */
  target: StoredRecipe | null;
  /** All recipes of the collection, for the cross-recipe checks (§7.2). */
  recipes: StoredRecipe[];
  /** Back without saving (list stays as-is). */
  onClose: () => void;
  /** After a successful save/delete: the list was changed. */
  onSaved: () => void;
}

/** One sheet session: adding into a step or editing an ingredient. */
type SheetState =
  { mode: 'add'; stepIndex: number; insertAt: number } | { mode: 'edit'; name: string };

/** A queued photo change, applied on Speichern (§2). */
type PhotoChange = { kind: 'set'; blob: Blob; extension: 'jpg' | 'png' } | { kind: 'remove' };

/** Where a validation issue is shown in the editor. */
type IssueTarget =
  | {
      kind: 'field';
      field: 'title' | 'prep_time' | 'total_time' | 'servings' | 'yield' | 'yield_unit';
    }
  | { kind: 'step'; index: number }
  | { kind: 'section'; section: 'ingredients' | 'body' | 'global' };

/**
 * Maps a core issue path (storage_format.md §7) to the editor element that
 * shows it. Marker issues use the step index as their path (§4).
 */
function mapIssue(issue: ValidationIssue): IssueTarget {
  const path = issue.path;
  if (path === 'title') return { kind: 'field', field: 'title' };
  if (path === 'prep_time') return { kind: 'field', field: 'prep_time' };
  if (path === 'total_time') return { kind: 'field', field: 'total_time' };
  if (path === 'servings') return { kind: 'field', field: 'servings' };
  if (path === 'yield') return { kind: 'field', field: 'yield' };
  if (path === 'yield_unit') return { kind: 'field', field: 'yield_unit' };
  const stepMatch = /^steps\[(\d+)\]/.exec(path);
  if (stepMatch !== null) {
    return { kind: 'step', index: Number(stepMatch[1]) };
  }
  if (path === 'ingredients') return { kind: 'section', section: 'ingredients' };
  if (path === 'body' || path === 'frontMatter') return { kind: 'section', section: 'body' };
  return { kind: 'section', section: 'global' };
}

/**
 * Normalizes the draft into the form that is written to Drive (§7 round-trip):
 * trimmed single-line steps (internal line breaks collapse to spaces — steps
 * are ordered-list items, §5), empty optional fields dropped, and the
 * ingredient list derived from the markers (§4).
 */
function normalizeRecipe(draft: EditorDraft): Recipe {
  const steps = draft.steps
    .map((step) => step.replace(/\s*\n\s*/g, ' ').trim())
    .filter((step) => step !== '');
  const base = {
    title: draft.title.trim(),
    type: draft.type,
    subtitle: draft.subtitle?.trim() !== '' ? draft.subtitle?.trim() : undefined,
    description: draft.description?.trim() !== '' ? draft.description?.trim() : undefined,
    prep_time: draft.prep_time.trim(),
    total_time:
      draft.total_time !== undefined && draft.total_time.trim() !== ''
        ? draft.total_time.trim()
        : undefined,
    ingredients: deriveIngredients(steps),
    steps: steps.length > 0 ? steps : [''],
  };
  if (draft.type === 'finished_dish') {
    return { ...base, servings: draft.servings };
  }
  return {
    ...base,
    yield: draft.yield,
    yield_unit: draft.yield_unit,
  };
}

/**
 * Renders the BQS + AQS display line defensively. A non-ladder quantity
 * should never exist (docs/quantity_scaling.md §3), but if one sneaks in
 * (e.g. a legacy file), the base form is shown instead of crashing the
 * render.
 */
function safeRenderAQS(name: string, quantity: number, unit: Unit): string {
  try {
    return renderAQS(name, quantity, unit);
  } catch {
    return `${quantity} ${unit} ${name}`;
  }
}

/**
 * Time chips over the standard values (agreed with the user): the chip row is
 * the input — no stepper. A stored value that is not on the list (e.g. "25 min"
 * from a hand-written file) is shown as a highlighted "bestehend" chip — the
 * user replaces it with a standard value. `minMinutes` restricts the offered
 * values (Gesamtzeit must exceed Vorbereitungszeit). When `allowClear` is set
 * (optional fields like Gesamtzeit), a selected value can be removed again.
 */
function TimeChips({
  value,
  minMinutes,
  allowClear = false,
  onChange,
}: {
  value: string;
  minMinutes?: number;
  allowClear?: boolean;
  onChange: (label: string) => void;
}) {
  const options =
    minMinutes === undefined
      ? STANDARD_TIME_VALUES
      : STANDARD_TIME_VALUES.filter((entry) => entry.minutes > minMinutes);
  const currentMinutes = parseTimeValue(value);
  const currentIndex = options.findIndex((entry) => entry.minutes === currentMinutes);
  const isCustom = value !== '' && currentMinutes !== null && currentIndex === -1;

  return (
    <div className="quantity-chips" role="group" aria-label="Zeiten">
      {isCustom && (
        <button
          type="button"
          className="chip chip-active"
          title="Bestehender Wert — durch einen Standardwert ersetzen"
        >
          {value}
        </button>
      )}
      {options.map((entry) => (
        <button
          key={entry.minutes}
          type="button"
          className={entry.minutes === currentMinutes ? 'chip chip-active' : 'chip'}
          onClick={() => onChange(entry.label)}
        >
          {entry.label}
        </button>
      ))}
      {allowClear && value !== '' && (
        <button
          type="button"
          className="chip chip-clear"
          onClick={() => onChange('')}
          aria-label="Gewählte Zeit entfernen"
        >
          → entfernen
        </button>
      )}
    </div>
  );
}

/**
 * The editor screen (see file header). Owns the draft, the validation
 * feedback and all Drive interactions.
 */
function RecipeEditor({ token, target, recipes, onClose, onSaved }: RecipeEditorProps) {
  /** The working draft; null while the recipe + collection are loading. */
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  /** The recipe as loaded from Drive — rollback target and dirty check. */
  const [original, setOriginal] = useState<EditorDraft | null>(null);
  /** Every other recipe of the collection (parse errors skipped). */
  const [collection, setCollection] = useState<Recipe[]>([]);
  /** Issues from the last save attempt; shown inline + in the banner. */
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Two-step confirmations for discarding changes / deleting. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Photo change queued into the save flow (applied with Speichern, §2). */
  const [photoChange, setPhotoChange] = useState<PhotoChange | null>(null);
  /** Drive file id of a newly created recipe (so a retry updates instead of duplicating). */
  const createdFileRef = useRef<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const photoUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stepEditorRefs = useRef<(StepEditorHandle | null)[]>([]);

  // Load the recipe (or the empty draft) and the rest of the collection.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded =
          target !== null ? toDraft(await readRecipe(token, target.fileId)) : newRecipeDraft();
        const others: Recipe[] = [];
        for (const entry of recipes) {
          if (entry.fileId === target?.fileId) continue;
          try {
            others.push(await readRecipe(token, entry.fileId));
          } catch {
            // A broken file is the user's pre-existing problem, not this
            // editor's — skip it (it also never appears in the link picker).
            console.warn(
              `Rezept "${entry.title}" konnte nicht gelesen werden — wird übersprungen.`,
            );
          }
        }
        if (cancelled) return;
        setDraft(loaded);
        setOriginal(loaded);
        setCollection(others);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, target, recipes]);

  // Load the photo preview (edit mode) and revoke object URLs on unmount.
  useEffect(() => {
    const image = target?.image;
    if (image === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(image.fileId)}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) return;
        const blob = await response.blob();
        if (cancelled) return;
        if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
        const url = URL.createObjectURL(blob);
        photoUrlRef.current = url;
        setPhotoUrl(url);
      } catch {
        // The photo is optional (§2) — show the placeholder silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, target?.image]);

  useEffect(
    () => () => {
      if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    },
    [],
  );

  /**
   * The draft would change the saved file (unsaved changes). Compared on the
   * normalized forms: defaulted fields that do not reach the file (e.g. the
   * yield defaults written when toggling the type) are not "dirty".
   */
  const dirty = useMemo(
    () =>
      (draft !== null &&
        original !== null &&
        JSON.stringify(normalizeRecipe(draft)) !== JSON.stringify(normalizeRecipe(original))) ||
      photoChange !== null,
    [draft, original, photoChange],
  );

  // Any change cancels the two-step "verwerfen" confirmation.
  useEffect(() => {
    setConfirmDiscard(false);
  }, [draft]);

  // Gesamtzeit must be larger than Vorbereitungszeit: clear it when it isn't.
  useEffect(() => {
    if (draft === null || draft.total_time === undefined || draft.total_time === '') return;
    const prep = parseTimeValue(draft.prep_time);
    const total = parseTimeValue(draft.total_time);
    if (prep !== null && total !== null && total <= prep) {
      updateDraft((current) => ({ ...current, total_time: undefined }));
    }
  }, [draft?.prep_time]);

  /** The normalized recipe — what is written to Drive (derived list, §4). */
  const saved = useMemo(() => (draft === null ? null : normalizeRecipe(draft)), [draft]);

  /** The computed ingredient list: exactly the rows that will be saved. */
  const computedIngredients = saved?.ingredients ?? [];

  /** Titles of all ingredient recipes (for the Verknüpftes Rezept picker). */
  const ingredientRecipeTitles = useMemo(
    () =>
      collection
        .filter((recipe) => recipe.type === 'ingredient_recipe')
        .map((recipe) => recipe.title)
        .sort((a, b) => a.localeCompare(b, 'de')),
    [collection],
  );

  /** How many reference slots are already taken (max 2, §4). */
  const referenceUsed = computedIngredients.filter(
    (ingredient) => ingredient.reference === true,
  ).length;

  /** All issues for the saved form (core per-file + editor + §7.2 cross checks). */
  const collectIssues = (savedRecipe: Recipe): ValidationIssue[] => {
    const list: ValidationIssue[] = [];
    if (savedRecipe.prep_time === '') {
      list.push({ path: 'prep_time', message: 'Bitte die Vorbereitungszeit angeben.' });
    }
    if (savedRecipe.steps.every((step) => step === '')) {
      list.push({ path: 'body', message: 'Bitte mindestens einen Zubereitungsschritt angeben.' });
    }
    try {
      parseRecipe(serializeRecipe(savedRecipe));
    } catch (err) {
      if (err instanceof RecipeParseError) list.push(...err.issues);
      else throw err;
    }
    // §7.2: title unique across the collection (collection excludes this file).
    if (
      savedRecipe.title !== '' &&
      collection.some((recipe) => recipe.title === savedRecipe.title)
    ) {
      list.push({
        path: 'title',
        message: `Der Titel "${savedRecipe.title}" ist bereits vergeben.`,
      });
    }
    // §7.2: every |recipe: marker must point to an existing ingredient recipe.
    savedRecipe.ingredients.forEach((ingredient, index) => {
      if (ingredient.recipe === undefined) return;
      const linkTarget = collection.find((recipe) => recipe.title === ingredient.recipe);
      if (linkTarget === undefined) {
        list.push({
          path: `ingredients[${index}].recipe`,
          message: `Das verlinkte Rezept "${ingredient.recipe}" existiert nicht.`,
        });
      } else if (linkTarget.type !== 'ingredient_recipe') {
        list.push({
          path: `ingredients[${index}].recipe`,
          message: `Das verlinkte Rezept "${ingredient.recipe}" muss ein Zutaten-Rezept sein.`,
        });
      }
    });
    return list;
  };

  /** Focuses / scrolls to the element for the first issue of a save attempt. */
  const focusFirstIssue = (list: ValidationIssue[], draftNow: EditorDraft): void => {
    if (list.length === 0) return;
    const target = mapIssue(list[0]);
    let id = 'editor-banner';
    if (target.kind === 'field') {
      id = `editor-field-${target.field}`;
    } else if (target.kind === 'step') {
      // The issue index refers to the normalized steps (empty steps are dropped
      // before validation) — map back to the draft step index for the DOM id.
      const normalizedIndices = draftNow.steps
        .map((step, index) => (step.trim() !== '' ? index : -1))
        .filter((index) => index !== -1);
      id = `editor-step-${normalizedIndices[target.index] ?? target.index}`;
    }
    requestAnimationFrame(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus();
      }
    });
  };

  /** Applies a queued photo change to a recipe file on Drive. */
  const applyPhotoChange = async (change: PhotoChange, fileId: string): Promise<void> => {
    if (change.kind === 'set') {
      await uploadRecipeImage(token, fileId, change.blob, change.extension);
    } else {
      await removeRecipeImage(token, fileId);
    }
  };

  /**
   * Validates, then saves (create / update / §6 rename) and returns to the
   * list. Photo changes are part of the save: they are applied after the
   * recipe text is written, and a failed save leaves them queued for a retry.
   */
  const handleSave = async (): Promise<void> => {
    if (draft === null || saving) return;
    const savedRecipe = normalizeRecipe(draft);
    const list = collectIssues(savedRecipe);
    if (list.length > 0) {
      setIssues(list);
      focusFirstIssue(list, draft);
      return;
    }
    setIssues([]);
    setSaving(true);
    try {
      if (target !== null) {
        await saveRecipe(
          token,
          target.fileId,
          savedRecipe,
          original !== null ? withIngredients(original) : savedRecipe,
        );
        if (photoChange !== null) {
          await applyPhotoChange(photoChange, target.fileId);
        }
      } else {
        // New recipe: create once; a retry after a failure updates the same
        // file instead of creating a duplicate (Drive allows duplicate names).
        let fileId = createdFileRef.current;
        if (fileId === null) {
          const created = await createRecipe(token, savedRecipe);
          fileId = created.id;
          createdFileRef.current = fileId;
        } else {
          await saveRecipe(token, fileId, savedRecipe, savedRecipe);
        }
        if (photoChange !== null) {
          await applyPhotoChange(photoChange, fileId);
        }
      }
      setPhotoChange(null);
      onSaved();
    } catch (err) {
      setSaving(false);
      setIssues([
        {
          path: 'global',
          message: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  };

  /** Deletes the recipe (file + photo + export) after the two-step confirm. */
  const handleDelete = async (): Promise<void> => {
    if (target === null || saving) return;
    setSaving(true);
    try {
      await deleteRecipe(token, target.fileId);
      onSaved();
    } catch (err) {
      setSaving(false);
      setIssues([{ path: 'global', message: err instanceof Error ? err.message : String(err) }]);
    }
  };

  // ---- Draft helpers ------------------------------------------------------

  /**
   * Applies an updater to the draft; a no-op while the draft is still loading
   * (the updater always receives a non-null EditorDraft).
   */
  const updateDraft = (updater: (current: EditorDraft) => EditorDraft): void => {
    setDraft((current) => (current === null ? current : updater(current)));
  };

  const patchDraft = (patch: Partial<EditorDraft>): void => {
    updateDraft((current) => ({ ...current, ...patch }) as EditorDraft);
  };

  // ---- Sheet handlers -----------------------------------------------------

  const handleSheetConfirm = (
    ingredient: Ingredient,
    action: 'add' | 'update' | 'remove',
  ): void => {
    if (sheet === null) return;
    if (action === 'add' && sheet.mode === 'add') {
      // Insert the marker at the caret of the step (the StepEditor handles the
      // string insertion and caret placement; the derived list updates via the
      // value change).
      stepEditorRefs.current[sheet.stepIndex]?.insertMarker(ingredient, sheet.insertAt);
    } else if (action === 'remove' && sheet.mode === 'edit') {
      updateDraft((current) => ({
        ...current,
        steps: updateMarkersByName(current.steps, sheet.name, () => null),
      }));
    } else if (sheet.mode === 'edit') {
      updateDraft((current) => ({
        ...current,
        steps: updateMarkersByName(current.steps, sheet.name, () => ingredient),
      }));
    }
    setSheet(null);
  };

  // ---- Photo handlers -----------------------------------------------------

  const showPhotoUrl = (blob: Blob): void => {
    if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    const url = URL.createObjectURL(blob);
    photoUrlRef.current = url;
    setPhotoUrl(url);
  };

  /** Queues a photo replacement; the Drive write happens on Speichern. */
  const handlePhotoFile = (file: File): void => {
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : null;
    if (extension === null) {
      setPhotoError('Nur JPG- oder PNG-Bilder werden unterstützt.');
      return;
    }
    setPhotoError(null);
    showPhotoUrl(file);
    setPhotoChange({ kind: 'set', blob: file, extension });
  };

  /** Queues a photo removal; the Drive write happens on Speichern. */
  const handleRemovePhoto = (): void => {
    setPhotoError(null);
    if (photoUrlRef.current !== null) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setPhotoUrl(null);
    setPhotoChange({ kind: 'remove' });
  };

  // ---- Render -------------------------------------------------------------

  if (loadError !== null) {
    return (
      <main className="app">
        <section className="editor" aria-label="Rezept-Editor">
          <div className="editor-header">
            <button type="button" className="text-button" onClick={onClose}>
              ← Zurück
            </button>
            <h2>{target?.title ?? 'Neues Rezept'}</h2>
            <span className="header-spacer" />
          </div>
          <p className="error-message" role="alert">
            {loadError}
          </p>
        </section>
      </main>
    );
  }

  if (draft === null) {
    return (
      <main className="app">
        <p className="loading-message" role="status">
          Rezept wird geladen …
        </p>
      </main>
    );
  }

  const prepMinutes = parseTimeValue(draft.prep_time) ?? 0;
  const mappedIssues = issues.map((issue) => ({ issue, target: mapIssue(issue) }));
  /** Issues belonging to one editor field (by its IssueTarget field name). */
  const fieldIssue = (
    field: 'title' | 'prep_time' | 'total_time' | 'servings' | 'yield' | 'yield_unit',
  ): ValidationIssue[] =>
    mappedIssues
      .filter((entry) => entry.target.kind === 'field' && entry.target.field === field)
      .map((entry) => entry.issue);
  const sectionIssues = (section: 'ingredients' | 'body' | 'global'): ValidationIssue[] =>
    mappedIssues
      .filter((entry) => entry.target.kind === 'section' && entry.target.section === section)
      .map((entry) => entry.issue);
  // normalizeRecipe drops empty steps before validation, so the issue paths
  // refer to the normalized steps; map them back to the draft's step indices.
  const normalizedIndices = draft.steps
    .map((step, index) => (step.trim() !== '' ? index : -1))
    .filter((index) => index !== -1);
  const stepIssues = (index: number): ValidationIssue[] =>
    mappedIssues
      .filter(
        (entry) =>
          entry.target.kind === 'step' && entry.target.index === normalizedIndices.indexOf(index),
      )
      .map((entry) => entry.issue);
  const bannerIssues = sectionIssues('global').concat(
    sectionIssues('ingredients'),
    sectionIssues('body'),
  );

  return (
    <main className="app">
      <section className="editor" aria-label="Rezept-Editor">
        <div className="editor-header">
          <button
            type="button"
            className={confirmDiscard ? 'text-button danger-text' : 'text-button'}
            onClick={() => {
              if (dirty && !confirmDiscard) {
                setConfirmDiscard(true);
              } else {
                onClose();
              }
            }}
          >
            {confirmDiscard ? 'Wirklich verwerfen?' : '← Zurück'}
          </button>
          <h2>{target?.title ?? 'Neues Rezept'}</h2>
          <button
            type="button"
            className="primary-button save-button"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </div>

        {issues.length > 0 && (
          <div className="validation-banner" id="editor-banner" role="alert">
            <p>
              {issues.length === 1
                ? 'Ein Punkt muss korrigiert werden:'
                : `${issues.length} Punkte müssen korrigiert werden:`}
            </p>
            <ul>
              {bannerIssues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Kopfdaten — Foto, Titel, Details, Zeiten, Typ und Portionen/Ergiebigkeit */}
        <section className="editor-card" aria-label="Kopfdaten">
          <h3 className="editor-card-title">Kopfdaten</h3>

          {/* Foto (§2, optional sibling file) */}
          <div className="field">
            <span className="field-label">Foto</span>
            <div className="photo-row">
              {photoUrl !== null ? (
                <img className="photo-preview" src={photoUrl} alt="Rezeptfoto" />
              ) : (
                <div className="photo-placeholder">Kein Foto</div>
              )}
              <div className="photo-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) handlePhotoFile(file);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photoUrl !== null ? 'Foto ersetzen' : 'Foto wählen'}
                </button>
                {photoUrl !== null && (
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={handleRemovePhoto}
                  >
                    Entfernen
                  </button>
                )}
              </div>
            </div>
            {photoError !== null && (
              <p className="field-error" role="alert">
                {photoError}
              </p>
            )}
          </div>

          <label className="field">
            <span className="field-label">Titel</span>
            <input
              id="editor-field-title"
              type="text"
              value={draft.title}
              onChange={(event) => patchDraft({ title: event.target.value })}
              placeholder="z. B. Shredded Tofu Wraps"
            />
          </label>
          {fieldIssue('title').map((issue, index) => (
            <p className="field-error" key={`title-${index}`} role="alert">
              {issue.message}
            </p>
          ))}

          <label className="field">
            <span className="field-label">Untertitel</span>
            <input
              type="text"
              value={draft.subtitle ?? ''}
              onChange={(event) => patchDraft({ subtitle: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Beschreibung</span>
            <textarea
              rows={3}
              value={draft.description ?? ''}
              onChange={(event) => patchDraft({ description: event.target.value })}
            />
          </label>

          <div className="field" id="editor-field-prep_time">
            <span className="field-label">Arbeitszeit</span>
            <TimeChips
              value={draft.prep_time}
              onChange={(label) => patchDraft({ prep_time: label })}
            />
          </div>
          {fieldIssue('prep_time').map((issue, index) => (
            <p className="field-error" key={`prep-${index}`} role="alert">
              {issue.message}
            </p>
          ))}

          <div className="field" id="editor-field-total_time">
            <span className="field-label">Gesamtzeit</span>
            <span className="field-hint">nur wenn sie größer als die Arbeitszeit ist</span>
            <TimeChips
              value={draft.total_time ?? ''}
              minMinutes={prepMinutes}
              allowClear
              onChange={(label) => patchDraft({ total_time: label })}
            />
          </div>
          {fieldIssue('total_time').map((issue, index) => (
            <p className="field-error" key={`total-${index}`} role="alert">
              {issue.message}
            </p>
          ))}

          {/* Typ — direkt vor den typabhängigen Feldern (Portionen/Ergiebigkeit) */}
          <div className="field">
            <span className="field-label">Typ</span>
            <div className="segmented" role="group" aria-label="Rezept-Typ">
              <button
                type="button"
                className={draft.type === 'finished_dish' ? 'segmented-active' : ''}
                onClick={() => patchDraft({ type: 'finished_dish' })}
              >
                Gericht
              </button>
              <button
                type="button"
                className={draft.type === 'ingredient_recipe' ? 'segmented-active' : ''}
                onClick={() =>
                  patchDraft({
                    type: 'ingredient_recipe',
                    // Defaults for a fresh ingredient recipe: Gewicht, 1000 (1 kg).
                    yield: draft.yield ?? 1000,
                    yield_unit: draft.yield_unit ?? 'g',
                  })
                }
              >
                Zutaten-Rezept
              </button>
            </div>
          </div>

          {draft.type === 'finished_dish' ? (
            <div className="field" id="editor-field-servings">
              <span className="field-label">Portionen</span>
              <div className="quantity-chips" role="group" aria-label="Portionen">
                {SERVING_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === draft.servings ? 'chip chip-active' : 'chip'}
                    onClick={() => patchDraft({ servings: option })}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="field" id="editor-field-yield">
                <span className="field-label">Ergiebigkeit</span>
                {/* Einheit (Gewicht/Volumen) sits directly under the caption,
                    above the amount picker. */}
                <div className="segmented" role="group" aria-label="Einheit der Ergiebigkeit">
                  <button
                    type="button"
                    className={draft.yield_unit !== 'ml' ? 'segmented-active' : ''}
                    onClick={() => patchDraft({ yield_unit: 'g' })}
                  >
                    Gewicht
                  </button>
                  <button
                    type="button"
                    className={draft.yield_unit === 'ml' ? 'segmented-active' : ''}
                    onClick={() => patchDraft({ yield_unit: 'ml' })}
                  >
                    Volumen
                  </button>
                </div>
                <QuantityPicker
                  value={draft.yield}
                  onChange={(yieldValue) => patchDraft({ yield: yieldValue })}
                  family={draft.yield_unit === 'ml' ? 'ml' : 'g'}
                />
              </div>
            </>
          )}
          {fieldIssue('servings')
            .concat(fieldIssue('yield'), fieldIssue('yield_unit'))
            .map((issue, index) => (
              <p className="field-error" key={`target-${index}`} role="alert">
                {issue.message}
              </p>
            ))}
        </section>

        {/* Zubereitung — steps; ingredients are added here ("+ Zutat") */}
        <section className="editor-card" id="editor-steps-section" aria-label="Zubereitung">
          <div className="card-head">
            <h3 className="editor-card-title">Zubereitung</h3>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                updateDraft((current) => ({ ...current, steps: [...current.steps, ''] }))
              }
            >
              + Schritt
            </button>
          </div>
          {draft.steps.map((step, index) => (
            <div className="step-card" id={`editor-step-${index}`} key={index}>
              <div className="step-head">
                <span className="step-number">{index + 1}.</span>
                <div className="step-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={index === 0}
                    onClick={() =>
                      updateDraft((current) => {
                        const steps = [...current.steps];
                        [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
                        return { ...current, steps };
                      })
                    }
                    aria-label="Schritt nach oben"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={index === draft.steps.length - 1}
                    onClick={() =>
                      updateDraft((current) => {
                        const steps = [...current.steps];
                        [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]];
                        return { ...current, steps };
                      })
                    }
                    aria-label="Schritt nach unten"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        steps: current.steps.filter((_, i) => i !== index),
                      }))
                    }
                    aria-label="Schritt entfernen"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <StepEditor
                ref={(element) => {
                  stepEditorRefs.current[index] = element;
                }}
                value={step}
                onChange={(next) =>
                  updateDraft((current) => {
                    const steps = [...current.steps];
                    steps[index] = next;
                    return { ...current, steps };
                  })
                }
                error={stepIssues(index)[0]?.message}
              />
              <button
                type="button"
                className="add-ingredient"
                onClick={() =>
                  setSheet({
                    mode: 'add',
                    stepIndex: index,
                    insertAt: stepEditorRefs.current[index]?.caretOffset() ?? step.length,
                  })
                }
              >
                + Zutat
              </button>
            </div>
          ))}
        </section>

        {/* Zutaten — derived from the step markers, never typed directly (§4) */}
        <section className="editor-card" aria-label="Zutaten">
          <h3 className="editor-card-title">Zutaten</h3>
          {computedIngredients.length === 0 ? (
            <p className="empty-hint">
              Zutaten werden über „+ Zutat“ in den Schritten hinzugefügt und hier automatisch
              geordnet und zusammengefasst.
            </p>
          ) : (
            <ul className="ingredient-list">
              {computedIngredients.map((ingredient) => (
                <li key={ingredient.name} className="ingredient-row">
                  <button
                    type="button"
                    className="ingredient-row-button"
                    onClick={() => setSheet({ mode: 'edit', name: ingredient.name })}
                  >
                    <span className="ingredient-line">
                      {safeRenderAQS(ingredient.name, ingredient.quantity, ingredient.unit)}
                      {ingredient.reference === true && <span className="badge">Referenz</span>}
                      {ingredient.recipe !== undefined && (
                        <span className="badge olive">Verknüpft</span>
                      )}
                    </span>
                    <span className="ingredient-hint">Antippen zum Bearbeiten</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Danger zone (edit mode only) */}
        {target !== null && (
          <section className="editor-card danger-zone" aria-label="Rezept löschen">
            <button
              type="button"
              className={confirmDelete ? 'danger-button' : 'danger-text-button'}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                } else {
                  void handleDelete();
                }
              }}
              disabled={saving}
            >
              {confirmDelete ? `„${target.title}“ wirklich löschen?` : 'Rezept löschen'}
            </button>
            {confirmDelete && (
              <button
                type="button"
                className="text-button"
                onClick={() => setConfirmDelete(false)}
                disabled={saving}
              >
                Abbrechen
              </button>
            )}
          </section>
        )}
      </section>

      {sheet !== null && (
        <IngredientSheet
          mode={sheet.mode}
          initial={
            sheet.mode === 'edit'
              ? computedIngredients.find((ingredient) => ingredient.name === sheet.name)
              : undefined
          }
          referenceAllowed={draft.type === 'finished_dish'}
          referenceUsed={
            sheet.mode === 'edit'
              ? referenceUsed -
                (computedIngredients.some(
                  (ingredient) => ingredient.name === sheet.name && ingredient.reference === true,
                )
                  ? 1
                  : 0)
              : referenceUsed
          }
          ingredientRecipeTitles={ingredientRecipeTitles}
          onConfirm={handleSheetConfirm}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

export default RecipeEditor;
