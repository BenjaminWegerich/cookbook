/**
 * Recipe editor screen (ROADMAP, web app Phase 2) — per-step ingredient model.
 *
 * Decided with the user:
 * - every step carries its own counted ingredient list (rows) that appears
 *   above the step text; rows are added/edited per step ("+ Zutat zur Liste") and feed
 *   the derived master list (order of first use, duplicates merged with the
 *   total, storage_format.md §4);
 * - the step text is free prose; display-only inline artifacts ("+ Menge im
 *   Text") scale with the serving count but are never counted;
 * - the master list (Zutaten section) is read-only except for the reference
 *   role, which can only be set there (finished_dish, max 2);
 * - sub-recipes are implicit (name == ingredient-recipe title) and clickable
 *   wherever they appear (step rows, master list, text artifacts);
 * - quantities are stored in the family unit g/ml; the display switches to
 *   kg/l at 1000 (chips carry base quantity AND base unit, no steppers);
 * - sections: Kopfdaten (Bild, Titel, Details, Zeiten, Typ, Portionen/
 *   Ergiebigkeit), Zubereitung, Zutaten.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';

import {
  NNBSP,
  RecipeParseError,
  deriveIngredients,
  displayTimeText,
  integerLadderValues,
  masterIngredientNames,
  parseRecipe,
  parseTimeValue,
  renderAQS,
  serializeRecipe,
  splitArtifacts,
  artifactToText,
  STANDARD_TIME_VALUES,
  type Ingredient,
  type Recipe,
  type Step,
  type TextArtifact,
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
import { appendIngredientMasterData } from '../drive/ingredientMasterData';
import AutoGrowTextarea from './AutoGrowTextarea';
import IngredientSheet, {
  type IngredientRecipeOption,
  type IngredientSheetMode,
  type SheetResult,
} from './IngredientSheet';
import NewIngredientSheet, { type NewIngredientEntry } from './NewIngredientSheet';
import StepEditor, { type StepEditorHandle } from './StepEditor';
import QuantityPicker from './QuantityPicker';

/** The draft holds every field except the derived master ingredient list. */
type EditorDraft = Omit<Recipe, 'ingredients'>;

/** A fresh draft for a new recipe (all optional fields unset). */
function newRecipeDraft(): EditorDraft {
  return {
    title: '',
    type: 'finished_dish',
    prep_time: '',
    steps: [{ ingredients: [], text: '' }],
  };
}

/** Strips the derived master list from a loaded recipe (it lives in rows). */
function toDraft(recipe: Recipe): EditorDraft {
  const draft: Record<string, unknown> = { ...recipe };
  delete draft.ingredients;
  return draft as unknown as EditorDraft;
}

/** Rebuilds a full Recipe from a draft (the master list is derived, §4). */
function withIngredients(draft: EditorDraft): Recipe {
  return { ...draft, ingredients: deriveIngredients(draft.steps, draft.reference ?? []) };
}

/** Maps a confirmed sheet value to the display-only artifact stored in text. */
function toTextArtifact(value: SheetResult): TextArtifact {
  return 'name' in value
    ? { name: value.name, quantity: value.quantity, unit: value.unit ?? 'g' }
    : { quantity: value.quantity, ...(value.unit !== undefined ? { unit: value.unit } : {}) };
}

/**
 * Collects the ingredient names used by the steps (rows and named inline
 * {{…}} mentions) that `isKnown` does not accept — the names highlighted as
 * new ingredients and rejected on save. Predicate-based so the caller decides
 * the known set (registry accessors are read fresh at call time).
 */
function unknownIngredientNames(
  steps: readonly Step[],
  isKnown: (name: string) => boolean,
): Set<string> {
  const names = new Set<string>();
  for (const step of steps) {
    for (const ingredient of step.ingredients) {
      if (!isKnown(ingredient.name)) names.add(ingredient.name.trim());
    }
    for (const segment of splitArtifacts(step.text).segments) {
      if (
        segment.type === 'artifact' &&
        segment.artifact.name !== undefined &&
        !isKnown(segment.artifact.name)
      ) {
        names.add(segment.artifact.name.trim());
      }
    }
  }
  return names;
}

/**
 * Same check for the named inline {{…}} mentions of one step text only (rows
 * carry their own per-row issues). Unknown mention names live inside the prose
 * and stay step-level issues.
 */
function unknownMentionNames(text: string, isKnown: (name: string) => boolean): Set<string> {
  const names = new Set<string>();
  for (const segment of splitArtifacts(text).segments) {
    if (
      segment.type === 'artifact' &&
      segment.artifact.name !== undefined &&
      !isKnown(segment.artifact.name)
    ) {
      names.add(segment.artifact.name.trim());
    }
  }
  return names;
}

/** Integer standard numbers 1–30 — the allowed serving counts (decision 7). */
const SERVING_OPTIONS = integerLadderValues(1, 30);

/**
 * Imperative handle for the browser-back integration (owned by App): the
 * editor is asked whether it consumes a browser Back before the app closes
 * the editor screen. Consumed means a layer inside the editor was closed
 * (topmost overlay first, or the "Änderungen verwerfen?" step was armed).
 */
export interface RecipeEditorHandle {
  /** True when the back was handled inside the editor; false when the editor
   *  may close and return to the recipe list. */
  notifyBack: () => boolean;
}

interface RecipeEditorProps {
  /** Drive access token. */
  token: string;
  /** The recipe to edit (from the list); null creates a new recipe. */
  target: StoredRecipe | null;
  /**
   * When `target` is null, an optional already-valid draft to open the editor
   * with (e.g. an AI-created draft, Phase 3) instead of an empty new recipe.
   * Ignored when `target` is set.
   */
  initialDraft?: Recipe;
  /** All recipes of the collection, for the cross-recipe checks (§7.2). */
  recipes: StoredRecipe[];
  /** Back without saving (list stays as-is). */
  onClose: () => void;
  /** After a successful save/delete: the list was changed. */
  onSaved: () => void;
  /** Opens another recipe in the editor (jump to a linked sub-recipe). */
  onOpenRecipe?: (recipe: StoredRecipe) => void;
  /** Browser-back consumer handle (React 19: ref is a regular prop). */
  ref?: Ref<RecipeEditorHandle>;
}

/** One sheet session: add/edit a step row, insert or edit an inline artifact. */
type SheetState =
  | { kind: 'row-add'; stepIndex: number }
  | { kind: 'row-edit'; stepIndex: number; rowIndex: number }
  | { kind: 'inline'; stepIndex: number; insertAt: number }
  | { kind: 'inline-edit'; stepIndex: number; at: number; artifact: TextArtifact };

/** A queued photo change, applied on Speichern (§2). */
type PhotoChange = { kind: 'set'; blob: Blob; extension: 'jpg' | 'png' } | { kind: 'remove' };

/** JPEG re-encode quality (canvas default) for cropped photos. */
const JPEG_QUALITY = 0.92;

/**
 * Decodes a blob URL into an image. EXIF orientation is applied during
 * decoding (modern browsers), so a portrait phone photo arrives upright.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    image.src = url;
  });
}

/**
 * Center-crops a photo file to a square and re-encodes it in the same format.
 * Recipe photos are stored as squares (recipe_structure.md, "Image"): the
 * source is cropped to its shorter side at original resolution — a landscape
 * 4000×3000 shot becomes 3000×3000 — so no pixel information is discarded
 * except the bars that the square crop removes. The cropped result is drawn
 * upright (EXIF is applied while decoding and not written back).
 */
async function squareCropPhoto(file: File, extension: 'jpg' | 'png'): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const { naturalWidth: width, naturalHeight: height } = image;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('Canvas wird nicht unterstützt.');
    }
    // Copy the centered square of the source onto the canvas.
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, side, side);
    const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/png';
    const cropped = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, JPEG_QUALITY),
    );
    if (cropped === null) {
      throw new Error('Bild konnte nicht verarbeitet werden.');
    }
    return cropped;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Where a validation issue is shown in the editor. */
type IssueTarget =
  | {
      kind: 'field';
      field: 'title' | 'prep_time' | 'total_time' | 'servings' | 'yield' | 'yield_unit';
    }
  | { kind: 'step'; index: number }
  | { kind: 'step-row'; index: number; rowIndex: number }
  | { kind: 'section'; section: 'ingredients' | 'body' | 'global' };

/**
 * Maps a core issue path (storage_format.md §7) to the editor element that
 * shows it. Step issues (rows and text) use the step index as their path (§4).
 */
function mapIssue(issue: ValidationIssue): IssueTarget {
  const path = issue.path;
  if (path === 'title') return { kind: 'field', field: 'title' };
  if (path === 'prep_time') return { kind: 'field', field: 'prep_time' };
  if (path === 'total_time') return { kind: 'field', field: 'total_time' };
  if (path === 'servings') return { kind: 'field', field: 'servings' };
  if (path === 'yield') return { kind: 'field', field: 'yield' };
  if (path === 'yield_unit') return { kind: 'field', field: 'yield_unit' };
  const rowMatch = /^steps\[(\d+)\]\.ingredients\[(\d+)\]$/.exec(path);
  if (rowMatch !== null) {
    return {
      kind: 'step-row',
      index: Number(rowMatch[1]),
      rowIndex: Number(rowMatch[2]),
    };
  }
  const stepMatch = /^steps\[(\d+)\]/.exec(path);
  if (stepMatch !== null) {
    return { kind: 'step', index: Number(stepMatch[1]) };
  }
  if (path === 'reference' || /^reference\[/.test(path)) {
    return { kind: 'section', section: 'ingredients' };
  }
  if (path === 'body' || path === 'frontMatter') return { kind: 'section', section: 'body' };
  return { kind: 'section', section: 'global' };
}

/**
 * Normalizes the draft into the form that is written to Drive (§7 round-trip):
 * trimmed single-line step prose (internal line breaks collapse to spaces),
 * empty optional fields dropped, the reference list kept for finished dishes
 * only, and the master list derived from the step rows (§4).
 */
function normalizeRecipe(draft: EditorDraft): Recipe {
  // A step is kept when it has prose OR counted rows — a row-only step stays
  // visible so the editor can report the missing text instead of silently
  // dropping the rows. Purely empty placeholder steps are removed.
  const steps = draft.steps
    .map((step) => ({
      ingredients: step.ingredients.map((ingredient) => ({
        name: ingredient.name.trim(),
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      })),
      text: step.text.replace(/\s*\n\s*/g, ' ').trim(),
    }))
    .filter((step) => step.text !== '' || step.ingredients.length > 0);
  const reference =
    draft.type === 'finished_dish' && draft.reference !== undefined && draft.reference.length > 0
      ? draft.reference
      : undefined;
  const ingredients = deriveIngredients(steps, reference ?? []);
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
    steps: steps.length > 0 ? steps : [{ ingredients: [], text: '' }],
  };
  if (draft.type === 'finished_dish') {
    return {
      ...base,
      ingredients,
      servings: draft.servings,
      ...(reference !== undefined ? { reference } : {}),
    };
  }
  return {
    ...base,
    ingredients,
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
    // Defensive fallback: same number↔unit narrow no-break space as renderAQS
    // (docs/CODING_CONVENTIONS.md), then a plain space before the name.
    return `${quantity}${NNBSP}${unit} ${name}`;
  }
}

/**
 * Time chips over the standard values (agreed with the user): the chip row is
 * the input — no stepper. A stored value that is not on the list (e.g. "25 min"
 * from a hand-written file) is shown as a highlighted "bestehend" chip — the
 * user replaces it with a standard value. `minMinutes` restricts the offered
 * values (Gesamtzeit must exceed Vorbereitungszeit). When `allowClear` is set
 * (optional fields like Gesamtzeit), a selected value can be removed again.
 *
 * Chips *display* durations with the narrow no-break space typography
 * (displayTimeText); what is stored on selection is the plain-space form
 * (entry.label) — files always keep plain ASCII spaces.
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
          {displayTimeText(value)}
        </button>
      )}
      {options.map((entry) => (
        <button
          key={entry.minutes}
          type="button"
          className={entry.minutes === currentMinutes ? 'chip chip-active' : 'chip'}
          onClick={() => onChange(entry.label)}
        >
          {displayTimeText(entry.label)}
        </button>
      ))}
      {allowClear && value !== '' && (
        <button
          type="button"
          className="chip chip-clear"
          onClick={() => onChange('')}
          aria-label="Gewählte Zeit entfernen"
        >
          entfernen
        </button>
      )}
    </div>
  );
}

/**
 * The editor screen (see file header). Owns the draft, the validation
 * feedback and all Drive interactions.
 */
function RecipeEditor({
  token,
  target,
  initialDraft,
  recipes,
  onClose,
  onSaved,
  onOpenRecipe,
  ref,
}: RecipeEditorProps) {
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
  /** Two-step confirmations for discarding changes / deleting / photo removal. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Two-step "Wirklich entfernen?" before the queued photo removal (§2). */
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false);
  /** The armed "Schritt wirklich entfernen?" row (index of the step to remove). */
  const [confirmRemoveStep, setConfirmRemoveStep] = useState<number | null>(null);

  /** Focuses a Kopf text field with the caret at the end (Enter = next). */
  const focusEditorField = (field: HTMLTextAreaElement | null): void => {
    if (field === null) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };
  /** Photo change queued into the save flow (applied with Speichern, §2). */
  const [photoChange, setPhotoChange] = useState<PhotoChange | null>(null);
  /** Drive file id of a newly created recipe (so a retry updates instead of duplicating). */
  const createdFileRef = useRef<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  /** Create-master-data sheet (opened from the ingredient sheet). */
  const [createSheet, setCreateSheet] = useState<{ name: string } | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  /** Drive error of the last create attempt (German, from the storage layer). */
  const [createError, setCreateError] = useState<string | null>(null);
  /** The ingredient sheet's context while the create sheet is open — the
   *  restore target when the create sheet closes (cancel or save). */
  const [sheetContext, setSheetContext] = useState<{
    sheet: SheetState;
    mode: IngredientSheetMode;
    name: string;
    quantity: number;
  } | null>(null);
  /** Prefill for a reopened ingredient sheet (add modes). */
  const [sheetPrefill, setSheetPrefill] = useState<{ name: string; quantity: number } | null>(null);

  const photoUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Kopf text fields — Enter (the phone keyboard's "next") walks this chain. */
  const titleFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const subtitleFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const stepEditorRefs = useRef<(StepEditorHandle | null)[]>([]);

  // Load the recipe (or the empty draft) and the rest of the collection.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded =
          target !== null
            ? toDraft(await readRecipe(token, target.fileId))
            : initialDraft !== undefined
              ? toDraft(initialDraft)
              : newRecipeDraft();
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
  }, [token, target, initialDraft, recipes]);

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

  // Any change cancels the two-step "verwerfen" and "Schritt entfernen?"
  // confirmations: an armed confirm must never outlive the state it refers
  // to — reordering or removing steps shifts the armed step index, and
  // editing elsewhere means the user moved on ("Behalten").
  useEffect(() => {
    setConfirmDiscard(false);
    setConfirmRemoveStep(null);
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

  /** The derived master list: exactly the rows that will be saved. */
  const computedIngredients = saved?.ingredients ?? [];

  /** Ingredient recipes of the collection, offered in the sheet's name
   *  autofill (title + yield, so a sub-recipe is picked like an ingredient). */
  const ingredientRecipes = useMemo<IngredientRecipeOption[]>(
    () =>
      collection
        .filter((recipe) => recipe.type === 'ingredient_recipe')
        .map((recipe) => ({
          title: recipe.title,
          // yield/yield_unit are required for ingredient_recipe (§3); the
          // fallbacks only satisfy the type checker for hand-built recipes.
          yield: recipe.yield ?? 0,
          yieldUnit: recipe.yield_unit ?? 'g',
        }))
        .sort((a, b) => a.title.localeCompare(b.title, 'de')),
    [collection],
  );

  /** Reference names currently flagged on the master list (§4). */
  const referenceNames = useMemo(() => {
    const names = new Set(draft?.reference ?? []);
    // Only names that exist in the derived list are meaningful to show.
    for (const entry of computedIngredients) {
      if (entry.reference === true) names.add(entry.name);
    }
    return names;
  }, [draft?.reference, computedIngredients]);

  /** How many reference slots are already taken (max 2, §4). */
  const referenceUsed = referenceNames.size;

  /**
   * A name a row or named inline mention may reference: it exists in the
   * ingredient master data (runtime registry, incl. entries created during
   * this session) or it is the title of an ingredient_recipe of the
   * collection (implicit sub-recipe link). Read fresh on every call — the
   * registry updates when the create-master-data flow saves (see
   * ingredientRegistry.ts), and newly saved sub-recipes appear in
   * `ingredientRecipes`.
   */
  const isKnownIngredientName = (name: string): boolean =>
    masterIngredientNames().includes(name.trim()) ||
    ingredientRecipes.some((recipe) => recipe.title === name.trim());

  /**
   * Names used by the draft (rows + named inline mentions) that are not known
   * to the master data / collection — these rows are highlighted as new
   * ingredients and block the save (see collectIssues). Computed on every
   * render (not memoized): the master registry is module state that updates
   * when the create-master-data flow saves, and only a fresh read reflects
   * that new ingredient immediately.
   */
  const unknownUsedNames = unknownIngredientNames(draft?.steps ?? [], (name) =>
    isKnownIngredientName(name),
  );

  /** All issues for the saved form (core per-file + editor + §7.2 cross checks). */
  const collectIssues = (savedRecipe: Recipe): ValidationIssue[] => {
    const list: ValidationIssue[] = [];
    if (savedRecipe.prep_time === '') {
      list.push({ path: 'prep_time', message: 'Bitte die Arbeitszeit angeben.' });
    }
    if (savedRecipe.steps.every((step) => step.text === '')) {
      list.push({ path: 'body', message: 'Bitte mindestens einen Zubereitungsschritt angeben.' });
    }
    // Per-step checks come out in step order so the first issue (the focus
    // target) points at the earliest problem: text rules, then the
    // ingredient-name gate. Unknown *rows* each get their own row issue so the
    // error message sits directly under the row; unknown named inline {{…}}
    // mentions live inside the prose and stay step-level issues.
    savedRecipe.steps.forEach((step, index) => {
      if (step.text === '' && step.ingredients.length > 0) {
        list.push({
          path: `steps[${index}]`,
          message: 'Jeder Schritt braucht nach seinen Zutaten einen Text.',
        });
      }
      if (step.text.startsWith('- ')) {
        list.push({
          path: `steps[${index}].text`,
          message:
            'Der Schritt-Text darf nicht mit "- " beginnen (das ist Zutaten-Zeilen vorbehalten).',
        });
      }
      step.ingredients.forEach((ingredient, rowIndex) => {
        if (!isKnownIngredientName(ingredient.name)) {
          list.push({
            path: `steps[${index}].ingredients[${rowIndex}]`,
            message: 'Bitte diese Zutat anlegen oder ersetzen.',
          });
        }
      });
      const unknownMentions = unknownMentionNames(step.text, (name) => isKnownIngredientName(name));
      if (unknownMentions.size > 0) {
        const names = [...unknownMentions].map((name) => `„${name}“`).join(', ');
        list.push({
          path: `steps[${index}]`,
          message: `${names}: Bitte diese Zutat anlegen oder ersetzen.`,
        });
      }
    });
    // The core round-trip only runs when the editor-level checks above are
    // clean — serializeRecipe refuses values the canonical format cannot
    // represent (e.g. a row-only step), and those have a precise German
    // message already.
    if (list.length === 0) {
      try {
        parseRecipe(serializeRecipe(savedRecipe));
      } catch (err) {
        if (err instanceof RecipeParseError) list.push(...err.issues);
        else throw err;
      }
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
    return list;
  };

  /** Focuses / scrolls to the element for the first issue of a save attempt. */
  const focusFirstIssue = (list: ValidationIssue[], draftNow: EditorDraft): void => {
    if (list.length === 0) return;
    const targetIssue = mapIssue(list[0]);
    let id = 'editor-banner';
    if (targetIssue.kind === 'field') {
      id = `editor-field-${targetIssue.field}`;
    } else if (targetIssue.kind === 'step' || targetIssue.kind === 'step-row') {
      // The issue index refers to the normalized steps (empty steps are dropped
      // before validation) — map back to the draft step index for the DOM id.
      const normalizedIndices = draftNow.steps
        .map((step, index) => (step.text.trim() !== '' || step.ingredients.length > 0 ? index : -1))
        .filter((index) => index !== -1);
      const draftStepIndex = normalizedIndices[targetIssue.index] ?? targetIssue.index;
      id =
        targetIssue.kind === 'step-row'
          ? `editor-step-${draftStepIndex}-row-${targetIssue.rowIndex}`
          : `editor-step-${draftStepIndex}`;
    } else if (targetIssue.section === 'ingredients') {
      id = 'editor-master-list';
    } else if (targetIssue.section === 'body') {
      id = 'editor-steps-section';
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

  /** Applies an updater to the rows of one step. */
  const updateStep = (stepIndex: number, updater: (step: Step) => Step): void => {
    updateDraft((current) => {
      const steps = [...current.steps];
      steps[stepIndex] = updater(steps[stepIndex]!);
      return { ...current, steps };
    });
  };

  /** Removes a step from the draft (the armed ✕'s confirming tap, or an
   *  empty step's immediate ✕). Called only when the step being removed is
   *  the one the armed state refers to. */
  const removeStep = (stepIndex: number): void => {
    setConfirmRemoveStep(null);
    updateDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, i) => i !== stepIndex),
    }));
  };

  /**
   * ✕ tap on a step (two-step confirm like the photo removal): a content-
   * bearing step (prose or rows) first swaps the ✕ for a red "Wirklich
   * entfernen?" button; the second tap on it performs the removal. Any other
   * change (arrows, editing, adding) cancels the armed state = "Behalten"
   * (see the draft-change effect above). A truly empty step has nothing to
   * lose and is removed immediately.
   */
  const toggleRemoveStep = (stepIndex: number): void => {
    if (draft === null) return;
    const step = draft.steps[stepIndex];
    if (step === undefined) return;
    if (confirmRemoveStep === stepIndex) {
      removeStep(stepIndex);
      return;
    }
    const hasContent = step.text.trim() !== '' || step.ingredients.length > 0;
    if (hasContent) {
      setConfirmRemoveStep(stepIndex);
    } else {
      removeStep(stepIndex);
    }
  };

  // ---- Sheet handlers -----------------------------------------------------

  /** The sheet mode for a SheetState (used when the create sheet reopens it). */
  const sheetMode = (state: SheetState): IngredientSheetMode => {
    if (state.kind === 'row-add') return 'row-add';
    if (state.kind === 'row-edit') return 'row-edit';
    return state.kind === 'inline' ? 'inline-add' : 'inline-edit';
  };

  /**
   * Jump to a linked sub-recipe (a step row, the master list or an artifact).
   * Unsaved changes are guarded by the same two-step "verwerfen" confirmation
   * as the back button: the first tap arms it, the second tap (label "Wirklich
   * verwerfen?") jumps.
   */
  const requestJump = (recipe: StoredRecipe): void => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    onOpenRecipe?.(recipe);
  };

  /** The StoredRecipe of a sub-recipe title, when it is an ingredient recipe. */
  const subRecipeTarget = (name: string): StoredRecipe | undefined => {
    const isSub = collection.some(
      (recipe) => recipe.type === 'ingredient_recipe' && recipe.title === name,
    );
    if (!isSub) return undefined;
    return recipes.find((recipe) => recipe.title === name);
  };

  const handleSheetConfirm = (value: SheetResult, action: 'add' | 'update' | 'remove'): void => {
    if (sheet === null) return;
    if (sheet.kind === 'row-add' && 'name' in value) {
      updateStep(sheet.stepIndex, (step) => ({
        ...step,
        ingredients: [...step.ingredients, value as Ingredient],
      }));
    } else if (sheet.kind === 'row-edit') {
      if (action === 'remove') {
        updateStep(sheet.stepIndex, (step) => ({
          ...step,
          ingredients: step.ingredients.filter((_, index) => index !== sheet.rowIndex),
        }));
      } else if ('name' in value) {
        updateStep(sheet.stepIndex, (step) => {
          const ingredients = [...step.ingredients];
          ingredients[sheet.rowIndex] = value as Ingredient;
          return { ...step, ingredients };
        });
      }
    } else if (sheet.kind === 'inline') {
      // Insert the display-only artifact at the caret of the step (the
      // StepEditor handles the string insertion and caret placement).
      stepEditorRefs.current[sheet.stepIndex]?.insertArtifact(
        toTextArtifact(value),
        sheet.insertAt,
      );
    } else if (sheet.kind === 'inline-edit') {
      // Replace the edited artifact in place: the span's start offset and its
      // stored length were captured when the chip was tapped.
      stepEditorRefs.current[sheet.stepIndex]?.replaceArtifact(
        toTextArtifact(value),
        sheet.at,
        artifactToText(sheet.artifact).length,
      );
    }
    setSheet(null);
    setSheetPrefill(null);
  };

  /**
   * Persists a new ingredient to the Drive master data. On success the create
   * sheet closes and the ingredient sheet re-opens (restore target) — with
   * the saved name and the quantity the user had typed, where they confirm
   * the actual recipe addition (decided with the user).
   */
  const handleCreateIngredient = async (
    name: string,
    bu: string,
    entries: NewIngredientEntry[],
  ): Promise<void> => {
    setCreateSaving(true);
    setCreateError(null);
    try {
      await appendIngredientMasterData(token, name, bu, entries);
      setCreateSheet(null);
      if (sheetContext !== null) {
        setSheet(sheetContext.sheet);
        // Restore the typed name + quantity so the flow continues where it
        // was interrupted (quantity-only inline mentions without a name keep
        // the empty name and just the quantity).
        setSheetPrefill({ name: sheetContext.name, quantity: sheetContext.quantity });
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateSaving(false);
    }
  };

  /** Closes the create sheet without saving — restore the ingredient sheet.
   *  Guarded against closing while a save runs: the backdrop stays disabled
   *  then (NewIngredientSheet), so a late error is never reported into an
   *  unmounted sheet (the restore would swallow it). */
  const handleCreateClose = (): void => {
    if (createSaving) return;
    setCreateError(null);
    setCreateSheet(null);
    if (sheetContext !== null) {
      setSheet(sheetContext.sheet);
      // Restore the typed name+quantity so nothing is lost on cancel.
      setSheetPrefill({ name: sheetContext.name, quantity: sheetContext.quantity });
    }
  };

  /** Toggles the reference role of a master-list row (§4, finished_dish only). */
  const toggleReference = (name: string): void => {
    if (draft === null || draft.type !== 'finished_dish') return;
    const flagged = referenceNames.has(name);
    if (!flagged && referenceUsed >= 2) return;
    updateDraft((current) => {
      const reference = new Set(current.reference ?? []);
      if (flagged) {
        reference.delete(name);
      } else {
        reference.add(name);
      }
      return { ...current, reference: [...reference] };
    });
  };

  // ---- Photo handlers -----------------------------------------------------

  const showPhotoUrl = (blob: Blob): void => {
    // A new preview invalidates an armed "Wirklich entfernen?" — it would
    // otherwise target the previous image on the next tap.
    setConfirmRemovePhoto(false);
    if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    const url = URL.createObjectURL(blob);
    photoUrlRef.current = url;
    setPhotoUrl(url);
  };

  /**
   * Queues a photo replacement; the Drive write happens on Speichern. The
   * file is center-cropped to a square first (recipe_structure.md, "Image"),
   * and the preview shows the cropped result — what you see is what is saved.
   */
  const handlePhotoFile = async (file: File): Promise<void> => {
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : null;
    if (extension === null) {
      setPhotoError('Nur JPG- oder PNG-Bilder werden unterstützt.');
      return;
    }
    setPhotoError(null);
    try {
      const cropped = await squareCropPhoto(file, extension);
      showPhotoUrl(cropped);
      setPhotoChange({ kind: 'set', blob: cropped, extension });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Bild konnte nicht verarbeitet werden.');
    }
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

  /**
   * Browser-back consumer (see RecipeEditorHandle and App): closes the
   * topmost layer and reports whether the back was consumed, mirroring the
   * order of the visible stack — NewIngredientSheet first (closing restores
   * the ingredient sheet underneath), then the IngredientSheet, and only then
   * does an unsaved draft arm the "Änderungen verwerfen?" step (the same
   * two-step guard as the header back button). Fresh every render, so it
   * always sees the current state.
   */
  useImperativeHandle(ref, () => ({
    notifyBack: (): boolean => {
      if (saving) {
        // A Drive write is in flight — do not unmount the editor mid-save
        // (a late error would be reported into a dead component).
        return true;
      }
      if (createSheet !== null) {
        // handleCreateClose guards against closing while a save runs.
        handleCreateClose();
        return true;
      }
      if (sheet !== null) {
        setSheet(null);
        setSheetPrefill(null);
        return true;
      }
      if (dirty && !confirmDiscard) {
        setConfirmDiscard(true);
        return true;
      }
      return false;
    },
  }));

  // ---- Render -------------------------------------------------------------

  if (loadError !== null) {
    return (
      <main className="app">
        <section className="editor" aria-label="Rezept-Editor">
          <div className="editor-header">
            <button type="button" className="text-button" onClick={onClose}>
              Zurück
            </button>
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

  /**
   * The stored save-attempt issues that still apply to the current draft.
   *
   * `issues` holds the result of the last *failed* save attempt and is only
   * ever refreshed there — validation messages must not nag live while the
   * user is still typing. But once the user resolves a reported problem (the
   * prominent case: creating the master data for a previously unknown
   * ingredient — the runtime registry updates), the stale message must vanish
   * without requiring another Speichern click. Intersecting the stored list
   * with the issues the current draft still produces achieves exactly that:
   * nothing new appears live, yet each message disappears the moment its
   * cause is gone. Storage-level failures (path 'global', e.g. a Drive write
   * error) are not draft issues — they persist until the next save attempt.
   * Issue paths encode the *normalized* step/row indices, so reordering above
   * a flagged element shifts its path and prunes the message although the
   * cause remains — acceptable: the row highlight is live, and the next save
   * attempt re-announces the problem under its new index. The same holds for
   * messages that embed changing text (e.g. a step-level list of unknown
   * inline-mention names): resolving one of several names changes the text,
   * so the whole message clears and the next save announces what is left.
   */
  const liveIssues: ValidationIssue[] =
    issues.length === 0 || saved === null || issues.every((issue) => issue.path === 'global')
      ? issues
      : (() => {
          let applicable: Set<string>;
          try {
            applicable = new Set(
              collectIssues(saved).map((issue) => `${issue.path}\u0000${issue.message}`),
            );
          } catch {
            // A thrown core validation must not crash the render — keep the
            // stored issues untouched; the next save attempt reports properly.
            return issues;
          }
          return issues.filter(
            (issue) =>
              issue.path === 'global' || applicable.has(`${issue.path}\u0000${issue.message}`),
          );
        })();
  const mappedIssues = liveIssues.map((issue) => ({ issue, target: mapIssue(issue) }));
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
    .map((step, index) => (step.text.trim() !== '' || step.ingredients.length > 0 ? index : -1))
    .filter((index) => index !== -1);
  const stepIssues = (index: number): ValidationIssue[] =>
    mappedIssues
      .filter(
        (entry) =>
          entry.target.kind === 'step' && entry.target.index === normalizedIndices.indexOf(index),
      )
      .map((entry) => entry.issue);
  /** Row issue (unknown ingredient) of one draft step row, after a failed save. */
  const rowIssue = (stepIndex: number, rowIndex: number): ValidationIssue | undefined => {
    const normalizedIndex = normalizedIndices.indexOf(stepIndex);
    if (normalizedIndex === -1) return undefined;
    return mappedIssues.find(
      (entry) =>
        entry.target.kind === 'step-row' &&
        entry.target.index === normalizedIndex &&
        entry.target.rowIndex === rowIndex,
    )?.issue;
  };
  /** General issues: shown in the top box, never under a field. */
  const globalIssues = sectionIssues('global');
  /** Any non-global issue exists → the top box shows the generic prompt. */
  const hasValidationIssues = liveIssues.length > globalIssues.length;

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
            {confirmDiscard ? 'Änderungen verwerfen?' : 'Zurück'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Speichert …' : 'Speichern'}
          </button>
        </div>

        {(hasValidationIssues || globalIssues.length > 0) && (
          <div className="validation-banner" id="editor-banner" role="alert">
            {hasValidationIssues && <p>Bitte alle Pflichtfelder ausfüllen.</p>}
            {globalIssues.length > 0 && (
              <ul>
                {globalIssues.map((issue, index) => (
                  <li key={`global-${index}`}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Kopfdaten — Bild, Titel, Details, Zeiten, Typ und Portionen/Ergiebigkeit */}
        <section className="editor-card" aria-label="Kopfdaten">
          <h3 className="editor-card-title">Kopfdaten</h3>

          {/* Bild (§2, optional sibling file) */}
          <div className="field">
            <span className="field-label">
              Bild<span className="optional-mark">(optional)</span>
            </span>
            <div className="photo-row">
              {photoUrl !== null ? (
                <img className="photo-preview" src={photoUrl} alt="Rezeptbild" />
              ) : (
                <div className="photo-placeholder">Kein Bild</div>
              )}
              <div className="photo-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) void handlePhotoFile(file);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photoUrl !== null ? 'Ersetzen' : 'Auswählen'}
                </button>
                {photoUrl !== null && (
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() => {
                      if (!confirmRemovePhoto) {
                        setConfirmRemovePhoto(true);
                      } else {
                        handleRemovePhoto();
                      }
                    }}
                  >
                    {confirmRemovePhoto ? 'Wirklich entfernen?' : 'Entfernen'}
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
            <AutoGrowTextarea
              ref={titleFieldRef}
              id="editor-field-title"
              value={draft.title}
              onChange={(title) => patchDraft({ title })}
              onEnter={() => focusEditorField(subtitleFieldRef.current)}
            />
          </label>
          {fieldIssue('title').map((issue, index) => (
            <p className="field-error" key={`title-${index}`} role="alert">
              {issue.message}
            </p>
          ))}

          <label className="field">
            <span className="field-label">
              Untertitel<span className="optional-mark">(optional)</span>
            </span>
            <AutoGrowTextarea
              ref={subtitleFieldRef}
              value={draft.subtitle ?? ''}
              onChange={(subtitle) => patchDraft({ subtitle })}
              onEnter={() => focusEditorField(descriptionFieldRef.current)}
            />
          </label>
          <label className="field">
            <span className="field-label">
              Beschreibung<span className="optional-mark">(optional)</span>
            </span>
            <AutoGrowTextarea
              ref={descriptionFieldRef}
              tall
              enterKeyHint="done"
              value={draft.description ?? ''}
              onChange={(description) => patchDraft({ description })}
              onEnter={() => descriptionFieldRef.current?.blur()}
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
            <span className="field-label">
              Gesamtzeit<span className="optional-mark">(optional)</span>
            </span>
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
                onClick={() =>
                  patchDraft({
                    type: 'finished_dish',
                    // A finished dish may again define references.
                    reference: draft.reference ?? [],
                  })
                }
              >
                Gericht
              </button>
              <button
                type="button"
                className={draft.type === 'ingredient_recipe' ? 'segmented-active' : ''}
                onClick={() =>
                  patchDraft({
                    type: 'ingredient_recipe',
                    // References are finished_dish-only (§4): drop them.
                    reference: undefined,
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

        {/* Zubereitung — steps with their own ingredient lists + prose */}
        <section className="editor-card" id="editor-steps-section" aria-label="Zubereitung">
          <h3 className="editor-card-title">Zubereitung</h3>
          {draft.steps.length === 0 &&
            sectionIssues('body').map((issue, index) => (
              <p className="field-error" key={`body-empty-${index}`} role="alert">
                {issue.message}
              </p>
            ))}
          {draft.steps.map((step, stepIndex) => {
            return (
              <div className="step-card" id={`editor-step-${stepIndex}`} key={stepIndex}>
                <div className="step-head">
                  <span className="step-number">{stepIndex + 1}.</span>
                  <div className="step-actions">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={stepIndex === 0}
                      onClick={() =>
                        updateDraft((current) => {
                          const steps = [...current.steps];
                          [steps[stepIndex - 1], steps[stepIndex]] = [
                            steps[stepIndex],
                            steps[stepIndex - 1],
                          ];
                          return { ...current, steps };
                        })
                      }
                      aria-label="Schritt nach oben"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={stepIndex === draft.steps.length - 1}
                      onClick={() =>
                        updateDraft((current) => {
                          const steps = [...current.steps];
                          [steps[stepIndex + 1], steps[stepIndex]] = [
                            steps[stepIndex],
                            steps[stepIndex + 1],
                          ];
                          return { ...current, steps };
                        })
                      }
                      aria-label="Schritt nach unten"
                    >
                      ↓
                    </button>
                    {confirmRemoveStep === stepIndex ? (
                      <button
                        type="button"
                        className="text-button danger-text step-confirm-remove"
                        onClick={() => removeStep(stepIndex)}
                        aria-label="Schritt wirklich entfernen?"
                      >
                        Wirklich entfernen?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="icon-button danger-text"
                        onClick={() => toggleRemoveStep(stepIndex)}
                        aria-label="Schritt entfernen"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* The step's own counted ingredient list (appears above the text). */}
                {step.ingredients.length > 0 && (
                  <ul className="ingredient-list">
                    {step.ingredients.map((ingredient, rowIndex) => {
                      const jumpTarget = subRecipeTarget(ingredient.name);
                      const isNewName = unknownUsedNames.has(ingredient.name.trim());
                      const rowError = rowIssue(stepIndex, rowIndex);
                      return (
                        <Fragment key={`${stepIndex}-${rowIndex}`}>
                          <li
                            id={`editor-step-${stepIndex}-row-${rowIndex}`}
                            className={isNewName ? 'step-row is-new-ingredient' : 'step-row'}
                          >
                            <button
                              type="button"
                              className="ingredient-row-button"
                              onClick={() =>
                                setSheet({
                                  kind: 'row-edit',
                                  stepIndex,
                                  rowIndex,
                                })
                              }
                            >
                              <span className="ingredient-line">
                                {safeRenderAQS(
                                  ingredient.name,
                                  ingredient.quantity,
                                  ingredient.unit,
                                )}
                                {isNewName && <span className="new-ingredient-tag">neu</span>}
                              </span>
                              <span className="ingredient-hint">
                                {isNewName
                                  ? 'Nicht in Stammdaten — antippen zum Anlegen'
                                  : 'Antippen zum Bearbeiten'}
                              </span>
                            </button>
                            <div className="step-row-actions">
                              {jumpTarget !== undefined && (
                                <button
                                  type="button"
                                  className="badge olive link-badge"
                                  onClick={() => requestJump(jumpTarget)}
                                  title={`Zutaten-Rezept „${ingredient.name}“ öffnen`}
                                >
                                  verknüpft
                                </button>
                              )}
                              <button
                                type="button"
                                className="text-button danger-text"
                                onClick={() =>
                                  updateStep(stepIndex, (current) => ({
                                    ...current,
                                    ingredients: current.ingredients.filter(
                                      (_, index) => index !== rowIndex,
                                    ),
                                  }))
                                }
                                aria-label={`${ingredient.name} aus dem Schritt entfernen`}
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                          {rowError !== undefined && (
                            <li className="row-issue" role="alert">
                              {rowError.message}
                            </li>
                          )}
                        </Fragment>
                      );
                    })}
                  </ul>
                )}
                <div className="step-add-row">
                  <button
                    type="button"
                    className="add-ingredient"
                    onClick={() => setSheet({ kind: 'row-add', stepIndex })}
                  >
                    + Zutat zur Liste
                  </button>
                </div>

                <StepEditor
                  ref={(element) => {
                    stepEditorRefs.current[stepIndex] = element;
                  }}
                  value={step.text}
                  onChange={(next) =>
                    updateStep(stepIndex, (current) => ({ ...current, text: next }))
                  }
                  onArtifactEdit={(artifact, at) =>
                    setSheet({ kind: 'inline-edit', stepIndex, at, artifact })
                  }
                  onEnterNext={() => {
                    // Enter advances to the next step's text (phone keyboard
                    // "next"); the last step hands back to the form.
                    if (stepIndex + 1 < draft.steps.length) {
                      stepEditorRefs.current[stepIndex + 1]?.focus();
                    } else {
                      (document.activeElement as HTMLElement | null)?.blur();
                    }
                  }}
                />
                {stepIssues(stepIndex).map((issue, index) => (
                  <p className="field-error" key={`step-${stepIndex}-${index}`} role="alert">
                    {issue.message}
                  </p>
                ))}
                {stepIndex === 0 &&
                  sectionIssues('body').map((issue, index) => (
                    <p className="field-error" key={`body-${index}`} role="alert">
                      {issue.message}
                    </p>
                  ))}
                <button
                  type="button"
                  className="add-ingredient"
                  onClick={() =>
                    setSheet({
                      kind: 'inline',
                      stepIndex,
                      insertAt:
                        stepEditorRefs.current[stepIndex]?.caretOffset() ?? step.text.length,
                    })
                  }
                >
                  + Zutat oder Menge zum Text
                </button>
              </div>
            );
          })}

          {/* + Schritt — adds a new empty step after the last one. */}
          <button
            type="button"
            className="add-step"
            onClick={() =>
              updateDraft((current) => ({
                ...current,
                steps: [...current.steps, { ingredients: [], text: '' }],
              }))
            }
          >
            + Schritt
          </button>
        </section>

        {/* Zutaten — the read-only master list (reference role only, §4) */}
        <section className="editor-card" aria-label="Zutaten" id="editor-master-list">
          <h3 className="editor-card-title">Zutaten</h3>
          {sectionIssues('ingredients').map((issue, index) => (
            <p className="field-error" key={`ingredients-${index}`} role="alert">
              {issue.message}
            </p>
          ))}
          {computedIngredients.length === 0 ? (
            <p className="empty-hint">
              Die Zutatenliste wird aus den Listen der Zubereitungsschritte zusammengestellt — füge
              Zutaten über „+ Zutat zur Liste“ in den Schritten hinzu.
            </p>
          ) : (
            <>
              {/* The &shy; (U+00AD soft hyphen) lets "zusammengesetzt" break as
                  "zusammen-gesetzt" on narrow widths; invisible when the line fits. */}
              <p className="empty-hint">
                Liste aus den Zubereitungsschritten zusammen&shy;gesetzt. Bis zu zwei
                Referenz-Zutaten mit ★ markieren.
              </p>
              <ul className="ingredient-list">
                {computedIngredients.map((ingredient) => {
                  const jumpTarget = subRecipeTarget(ingredient.name);
                  const isReference = ingredient.reference === true;
                  const isNewName = unknownUsedNames.has(ingredient.name.trim());
                  return (
                    <li
                      key={ingredient.name}
                      className={
                        isNewName
                          ? 'ingredient-row is-new-ingredient'
                          : isReference
                            ? 'ingredient-row is-reference'
                            : 'ingredient-row'
                      }
                    >
                      <span className="ingredient-line">
                        {safeRenderAQS(ingredient.name, ingredient.quantity, ingredient.unit)}
                        {jumpTarget !== undefined && (
                          <button
                            type="button"
                            className="badge olive link-badge"
                            onClick={() => requestJump(jumpTarget)}
                            title={`Zutaten-Rezept „${ingredient.name}“ öffnen`}
                          >
                            verknüpft
                          </button>
                        )}
                      </span>
                      {draft.type === 'finished_dish' && (
                        <button
                          type="button"
                          className={isReference ? 'ref-toggle on' : 'ref-toggle'}
                          disabled={!isReference && referenceUsed >= 2}
                          aria-pressed={isReference}
                          title={
                            isReference
                              ? 'Referenz-Menge entfernen'
                              : 'Als Referenz-Menge markieren'
                          }
                          aria-label={
                            isReference
                              ? `„${ingredient.name}“ als Referenz-Menge entfernen`
                              : `„${ingredient.name}“ als Referenz-Menge markieren`
                          }
                          onClick={() => toggleReference(ingredient.name)}
                        >
                          {isReference ? '★' : '☆'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
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
          mode={sheetMode(sheet)}
          initial={
            sheet.kind === 'row-edit'
              ? draft.steps[sheet.stepIndex]!.ingredients[sheet.rowIndex]
              : sheet.kind === 'inline-edit'
                ? sheet.artifact
                : undefined
          }
          prefill={sheetPrefill ?? undefined}
          ingredientRecipes={ingredientRecipes}
          onConfirm={handleSheetConfirm}
          onClose={() => {
            setSheet(null);
            setSheetPrefill(null);
          }}
          onCreateNewIngredient={(name, quantity) => {
            if (sheet === null) return;
            setSheetContext({ sheet, mode: sheetMode(sheet), name, quantity });
            setSheet(null);
            // A fresh create flow must not start with the stale Drive error of
            // a previous (failed or cancelled) attempt.
            setCreateError(null);
            setCreateSheet({ name });
          }}
        />
      )}

      {createSheet !== null && (
        <NewIngredientSheet
          initialName={createSheet.name}
          saving={createSaving}
          error={createError}
          onSave={(name, bu, entries) => void handleCreateIngredient(name, bu, entries)}
          onEdited={() => setCreateError(null)}
          onClose={handleCreateClose}
        />
      )}
    </main>
  );
}

export default RecipeEditor;
