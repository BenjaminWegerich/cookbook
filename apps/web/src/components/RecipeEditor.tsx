/**
 * Recipe editor screen (ROADMAP, web app Phase 2) — per-step ingredient model.
 *
 * Decided with the user:
 * - every step carries its own counted ingredient list (rows) that appears
 *   above the step text; rows are added, edited and reordered per step
 *   ("Zutatenzeile hinzufügen", ↑/↓ on the row) and feed
 *   the derived master list (order of first use, duplicates merged with the
 *   total, storage_format.md §4);
 * - the step text is free prose; display-only inline artifacts ("Menge zum Text
 *   hinzufügen") scale with the serving count but are never counted;
 * - the master list (Zutaten section) is read-only except for the reference
 *   role, which can only be set there (both recipe types, no limit); a step row
 *   shows an existing reference but cannot set one (its "REFERENZ" tag's × can
 *   only clear it);
 * - sub-recipes are implicit (name == ingredient-recipe title) and clickable
 *   wherever they appear (step rows, master list, text artifacts). Tapping the
 *   "REZEPT" badge opens the sub-recipe as a new level above the current one
 *   (App keeps every open level mounted): the parent stays hidden with its
 *   draft, so a jump never asks to discard and Back / „Zurück" lands on the
 *   parent exactly as it was left. The "Änderungen verwerfen?" question only
 *   appears when a level is left whose own draft is unsaved — a popped
 *   sub-recipe discards its own draft, the parent below keeps its own;
 * - quantities are stored in the family unit g/ml; the display switches to
 *   kg/l at 1000 (chips carry base quantity AND base unit, no steppers);
 * - sections: Kopfdaten (Titel, Details, Typ, Portionen/Ergiebigkeit,
 *   Zeiten, Bild), one card per step (there is no „Zubereitung" card or heading:
 *   the card rung never nests, §4.4), Zutaten, Design.
 * - symbols follow the app-wide icon set (see components/icons.tsx): pencil =
 *   edit, upload = choose/replace photo, trash = destructive, cross = remove,
 *   star = reference quantity, arrows = reorder.
 * - the ingredient tags share one style and always appear in the order
 *   "NEU" (danger, star badge) - "REZEPT" (terracotta, chain link) -
 *   "REFERENZ" (olive, outline star + ×), so every ingredient row reads the
 *   same way in both lists; every tag leads with its symbol (docs/
 *   CODING_CONVENTIONS.md, "inline badges"); only the master list carries the
 *   star toggle, and it is hidden while the reference role is active (the
 *   badge's × is the way to clear it then).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';

import {
  RecipeParseError,
  DEFAULT_THEME,
  THEME_FONT_SHORTLIST,
  deriveIngredients,
  displayTimeText,
  isHexColor,
  mappingsFor,
  masterIngredientNames,
  masterUsesFor,
  parseRecipe,
  parseTimeValue,
  resolveTheme,
  resolveThemeFonts,
  serializeRecipe,
  splitArtifacts,
  artifactToText,
  SERVING_COUNTS,
  STANDARD_TIME_VALUES,
  allShoppingItems,
  shoppingNameKey,
  type Ingredient,
  type PrecisionLevel,
  type Recipe,
  type RecipeTheme,
  type Step,
  type ShoppingStop,
  type TextArtifact,
  type ValidationIssue,
} from '@cookbook/core';

import {
  createRecipe,
  deleteRecipe,
  peekRecipeContent,
  readRecipe,
  removeRecipeImage,
  saveRecipe,
  uploadRecipeImage,
  writeRecipeExportSafely,
  type StoredRecipe,
} from '../drive/recipeStorage';
import { listCookbookFolder } from '../drive/cookbookFolder';
import { appendIngredientMasterData } from '../drive/ingredientMasterData';
import { createShoppingItem, saveShoppingItem } from '../drive/shoppingRouteMasterData';
import { loadRecipePhoto } from '../drive/recipePhoto';
import { useEscapeTrigger, useLeaveGuard, type LeaveReason } from '../hooks/useLeaveGuard';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import type { SnackbarMessage } from '../hooks/useSnackbar';
import AutoGrowTextarea from './AutoGrowTextarea';
import EditIngredientSheet from './EditIngredientSheet';
import IngredientSheet, {
  type IngredientRecipeOption,
  type IngredientSheetMode,
  type SheetResult,
} from './IngredientSheet';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import NewIngredientSheet, { type NewIngredientEntry } from './NewIngredientSheet';
import {
  updateIngredientMasterAndShopping,
  type IngredientMasterSheetUpdate,
} from './ingredientMasterUpdate';
import StepEditor, { type StepEditorHandle } from './StepEditor';
import QuantityInput from './QuantityInput';
import ArrangementLine from './ArrangementLine';
import { safeRenderAQSDisplay, safeRenderMasterAQSDisplay } from './ingredientDisplay';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  LinkIcon,
  NewReleasesIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
} from './icons';
import { newRecipeDraft, type EditorDraft } from './recipeDrafts';

/** Strips the derived master list from a loaded recipe (it lives in rows). */
function toDraft(recipe: Recipe): EditorDraft {
  const draft: Record<string, unknown> = { ...recipe };
  delete draft.ingredients;
  return draft as unknown as EditorDraft;
}

/** Rebuilds a full Recipe from a draft (the master list is derived, §4). */
function withIngredients(draft: EditorDraft): Recipe {
  return {
    ...draft,
    ingredients: deriveIngredients(draft.steps, draft.reference ?? []),
  };
}

/**
 * The baseline draft the editor can show before any Drive read: the cached text
 * of the target recipe (e.g. the overview sheet already read it, so "Manuell
 * bearbeiten" opens instantly) or the empty / AI draft for a new recipe.
 * `null` means the target is not cached yet — the load effect fetches it.
 *
 * The baseline is what the draft is compared against (dirty check, save
 * rollback). For an AI revision of an existing recipe the working draft is the
 * revision (`initialDraft`) while the baseline stays this stored file.
 */
function baselineDraftFor(target: StoredRecipe | null, initialDraft?: Recipe): EditorDraft | null {
  if (target === null) {
    return initialDraft !== undefined ? toDraft(initialDraft) : newRecipeDraft();
  }
  const cached = peekRecipeContent(target.fileId);
  if (cached === undefined) return null;
  try {
    return toDraft(parseRecipe(cached));
  } catch {
    // Invalid cached text (should not happen — only canonical writes are
    // cached) is left to the load effect, which reports the parse error.
    return null;
  }
}

/** Maps a confirmed sheet value to the display-only artifact stored in text.
 *  The optional quantity-level precision travels with it, so the artifact keeps
 *  an override the sheet chose (the sheet drops one that equals the ingredient
 *  default). */
function toTextArtifact(value: SheetResult): TextArtifact {
  return 'name' in value
    ? {
        name: value.name,
        quantity: value.quantity,
        unit: value.unit ?? 'g',
        ...(value.precision !== undefined ? { precision: value.precision } : {}),
      }
    : {
        quantity: value.quantity,
        ...(value.unit !== undefined ? { unit: value.unit } : {}),
        ...(value.precision !== undefined ? { precision: value.precision } : {}),
      };
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
const SERVING_OPTIONS = SERVING_COUNTS;

/**
 * Imperative handle for the exit-trigger integration (owned by App): the editor
 * is asked whether it consumes a browser Back (or a swipe-back, which arrives
 * as one) before the app closes the editor screen. Consumed means a layer inside
 * the editor was closed (topmost overlay first, or the discard question was
 * armed). Escape is handled by the editor itself and follows the same order.
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
   * An already-valid draft to open the editor with instead of the target's
   * stored text: an AI-created draft (with `target` null) or an AI revision of
   * an existing recipe (with `target` set, Phase 3). With a `target` the draft
   * is the working copy while the stored file remains the baseline for the
   * dirty check and the save rollback.
   */
  initialDraft?: Recipe;
  /** All recipes of the collection, for the cross-recipe checks (§7.2). */
  recipes: StoredRecipe[];
  /** Back without saving (list stays as-is). */
  onClose: () => void;
  /**
   * Label of the header's back button (default „Zurück"). An editor opened
   * from the AI screen passes a label that names the conversation it returns
   * to, so the user can tell where Back leads before pressing it.
   */
  backLabel?: string;
  /** After a successful save/delete: the list was changed. `saved` is the
   *  stored recipe (as saved, so with a possibly renamed title), or null after
   *  a delete — the AI-create handoff needs the saved title and type. */
  onSaved: (saved: Recipe | null) => void;
  /** Opens another recipe in the editor (jump to a linked sub-recipe). */
  onOpenRecipe?: (recipe: StoredRecipe) => void;
  /** The app-root notice host, so a master-data save can offer its undo. */
  showSnackbar: (message: SnackbarMessage) => void;
  /**
   * True while this level is the visible one. The editor chain mounts every
   * open level (the parent stays underneath, hidden), and only the visible one
   * may react to Escape.
   */
  visible?: boolean;
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

/** Aspect ratio (width / height) a stored recipe photo is cropped to: 4:3
 * landscape (DESIGN.md §5.8, recipe_structure.md "Image"). */
const PHOTO_ASPECT_RATIO = 4 / 3;

/**
 * Center-crops a photo file to a 4:3 landscape and re-encodes it in the same
 * format. Recipe photos are stored as 4:3 landscapes (recipe_structure.md,
 * "Image"): the source is cropped to the largest centered 4:3 box at original
 * resolution — an already-4:3 4000×3000 shot is stored unchanged, a portrait
 * 3000×4000 becomes 3000×2250 — so no pixel information is discarded except the
 * bars that the crop removes. The cropped result is drawn upright (EXIF is
 * applied while decoding and not written back).
 */
async function landscapeCropPhoto(file: File, extension: 'jpg' | 'png'): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const { naturalWidth: width, naturalHeight: height } = image;
    // Largest centered 4:3 box that fits the source: a source wider than 4:3
    // keeps its full height and loses width, a taller one keeps its full width.
    const cropWidth = Math.min(width, Math.round(height * PHOTO_ASPECT_RATIO));
    const cropHeight = Math.min(height, Math.round(width / PHOTO_ASPECT_RATIO));
    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('Canvas wird nicht unterstützt.');
    }
    // Copy the centered 4:3 box of the source onto the canvas.
    ctx.drawImage(
      image,
      (width - cropWidth) / 2,
      (height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );
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
 * Normalizes a recipe theme for writing (DESIGN §4.8, storage_format.md §3):
 * drops tokens that equal their default (files never write defaults) and
 * lower-cases hex colours to the canonical form; a theme with no remaining
 * token collapses to undefined — equivalent to no theme.
 */
function normalizeTheme(theme: RecipeTheme | undefined): RecipeTheme | undefined {
  if (theme === undefined) return undefined;
  const result: RecipeTheme = {};
  if (theme.font !== undefined && theme.font !== DEFAULT_THEME.font) {
    result.font = theme.font;
  }
  for (const key of ['accent', 'paper', 'ink', 'line'] as const) {
    const value = theme[key];
    if (value !== undefined && value.toLowerCase() !== DEFAULT_THEME[key].toLowerCase()) {
      result[key] = value.toLowerCase();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Normalizes the draft into the form that is written to Drive (§7 round-trip):
 * trimmed single-line step prose (internal line breaks collapse to spaces),
 * empty optional fields dropped, the reference list kept for both recipe types,
 * and the master list derived from the step rows (§4).
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
        ...(ingredient.precision !== undefined ? { precision: ingredient.precision } : {}),
      })),
      text: step.text.replace(/\s*\n\s*/g, ' ').trim(),
    }))
    .filter((step) => step.text !== '' || step.ingredients.length > 0);
  const reference =
    draft.reference !== undefined && draft.reference.length > 0 ? draft.reference : undefined;
  const ingredients = deriveIngredients(steps, reference ?? []);
  const theme = normalizeTheme(draft.theme);
  const base = {
    title: draft.title.trim(),
    type: draft.type,
    description: draft.description?.trim() !== '' ? draft.description?.trim() : undefined,
    prep_time: draft.prep_time.trim(),
    total_time:
      draft.total_time !== undefined && draft.total_time.trim() !== ''
        ? draft.total_time.trim()
        : undefined,
    steps: steps.length > 0 ? steps : [{ ingredients: [], text: '' }],
    ...(theme !== undefined ? { theme } : {}),
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
    ...(reference !== undefined ? { reference } : {}),
  };
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
          title="Gewählte Zeit entfernen"
        >
          <CloseIcon className="chip-icon" optical={20} />
          <span>Entfernen</span>
        </button>
      )}
    </div>
  );
}

/**
 * CSS font stacks for the export's theme faces, as declared by
 * styles/fonts.css. Every current face is a bundled variable font registered
 * under its "<Name> Variable" family. The retired Noto Sans Condensed and Noto
 * Sans Mono keep their stacks so an old recipe still previews in the face it
 * exports in; the picker no longer offers them. The plain system family names
 * are deliberately absent: on Windows a broken duplicate of the installed Noto
 * Sans resolves to its italic face, so a failed font load would turn the
 * preview cursive. Each stack therefore ends in a genre-appropriate generic
 * fallback only.
 */
const THEME_FONT_STACKS: Readonly<Record<string, string>> = {
  'Noto Sans': "'Noto Sans Variable', system-ui, sans-serif",
  'Noto Serif': "'Noto Serif Variable', Georgia, serif",
  'Noto Serif Display': "'Noto Serif Display Variable', Georgia, serif",
  'Noto Sans Mono': "'Noto Sans Mono Variable', ui-monospace, monospace",
  'Noto Sans Condensed': "'Noto Sans Condensed', system-ui, sans-serif",
};

/** The CSS font stack that renders one theme typeface in the web app. */
function themeFontStack(name: string): string {
  return THEME_FONT_STACKS[name] ?? 'system-ui, sans-serif';
}

/**
 * The short label a theme-font chip shows. Every face in the shortlist belongs
 * to the Noto superfamily, so the shared prefix is redundant in the picker
 * ("Noto Sans" -> "Sans"); stored values and rendered font names keep the full
 * family.
 */
function themeFontLabel(name: string): string {
  return name.replace(/^Noto /, '');
}

/** Relative luminance (WCAG) of a #rrggbb colour, 0 (black) … 1 (white). */
function relativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two relative luminances (1 … 21). */
function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Text colour on a filled accent surface — the derived `on-accent` of DESIGN
 * §4.8: `ink` or `paper`, whichever contrasts more strongly against `accent`.
 */
function onAccentColor(accent: string, ink: string, paper: string): string {
  const accentLuminance = relativeLuminance(accent);
  return contrastRatio(accentLuminance, relativeLuminance(ink)) >=
    contrastRatio(accentLuminance, relativeLuminance(paper))
    ? ink
    : paper;
}

/** HSV colour: hue in degrees (0–360), saturation and value in 0–1. */
interface HsvColor {
  h: number;
  s: number;
  v: number;
}

/** #rrggbb → HSV. Callers pass a resolved token, so the input is always valid. */
function hexToHsv(hex: string): HsvColor {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

/** HSV → #rrggbb (rounded, 6-digit, lower-case). */
function hsvToHex({ h, s, v }: HsvColor): string {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = chroma;
    g = x;
  } else if (h < 120) {
    r = x;
    g = chroma;
  } else if (h < 180) {
    g = chroma;
    b = x;
  } else if (h < 240) {
    g = x;
    b = chroma;
  } else if (h < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const channel = (value: number): string =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Clamps a value to 0…1 (pointer/keyboard math at the edges of a surface). */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** One colour token: a swatch (opens the custom picker) plus a #rrggbb field. */
function ThemeColorField({
  label,
  value,
  overridden,
  onChange,
}: {
  label: string;
  /** The resolved colour — always a valid #rrggbb (the default when unset). */
  value: string;
  /** True when the token carries a non-default override ("Standard" shows). */
  overridden: boolean;
  /** Passed undefined to clear the override (back to the default). */
  onChange: (hex: string | undefined) => void;
}) {
  // The text field holds what the user is typing, which may be a partial value
  // ("#b8") that is not a valid colour yet. It is synced back to the resolved
  // value whenever that value changes from outside (load, the picker or the
  // "Standard" reset) and commits only on blur / Enter. The sync is a render-time
  // state adjustment (React's documented pattern for state that a changed prop
  // invalidates), so the field never paints one frame with the stale text.
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }
  // Whether the custom picker is expanded below the row. A plain toggle — the
  // hex field beside it stays the precise/keyboard entry point.
  const [open, setOpen] = useState(false);

  const commit = (): void => {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === '') {
      onChange(undefined); // empty → back to the default
      setText(value);
      return;
    }
    if (isHexColor(trimmed)) {
      onChange(trimmed);
      setText(trimmed);
    } else {
      setText(value); // invalid → revert to the current value
    }
  };

  return (
    <div className="field">
      <div className="theme-color-head">
        <span className="field-label">
          {label}
          <span className="optional-mark">(optional)</span>
        </span>
        {overridden && (
          <button type="button" className="text-button" onClick={() => onChange(undefined)}>
            Standard
          </button>
        )}
      </div>
      <div className="theme-color-row">
        <button
          type="button"
          className="theme-swatch"
          style={{ backgroundColor: value }}
          title={`${label} auswählen`}
          aria-label={`${label} auswählen`}
          aria-expanded={open}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        />
        <input
          type="text"
          className="theme-hex-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
          aria-label={`${label} (Hex)`}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      {open && (
        <ThemeColorPicker
          value={value}
          label={label}
          onChange={(hex) => {
            onChange(hex);
            setText(hex);
          }}
        />
      )}
    </div>
  );
}

/**
 * Custom colour picker ("benutzerdefiniert" only, no preset suggestions): the
 * saturation/value plane plus a hue strip. Reports every change as a #rrggbb so
 * the parent keeps one source of truth (the resolved hex).
 */
function ThemeColorPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (hex: string) => void;
}) {
  const { h, s, v } = hexToHsv(value);
  return (
    <div className="theme-color-picker" role="group" aria-label={`${label} (benutzerdefiniert)`}>
      <SaturationValueArea
        hue={h}
        s={s}
        v={v}
        color={value}
        label={label}
        onChange={(nextS, nextV) => onChange(hsvToHex({ h, s: nextS, v: nextV }))}
      />
      <HueSlider
        hue={h}
        label={label}
        onChange={(nextH) => onChange(hsvToHex({ h: nextH, s, v }))}
      />
    </div>
  );
}

/**
 * The saturation/value plane: x = saturation (left → right), y = value
 * (bottom → top). The base hue is set inline; the white/black gradients in the
 * CSS paint the plane over it. Dragging (or the arrow keys) reports s/v.
 */
function SaturationValueArea({
  hue,
  s,
  v,
  color,
  label,
  onChange,
}: {
  hue: number;
  s: number;
  v: number;
  /** The current resolved colour, shown inside the thumb ring. */
  color: string;
  label: string;
  onChange: (s: number, v: number) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pick = (clientX: number, clientY: number): void => {
    const area = areaRef.current;
    if (area === null) return;
    const rect = area.getBoundingClientRect();
    onChange(
      clamp01((clientX - rect.left) / rect.width),
      1 - clamp01((clientY - rect.top) / rect.height),
    );
  };

  return (
    <div
      ref={areaRef}
      className="theme-sv-area"
      style={{ backgroundColor: `hsl(${hue}, 100%, 50%)` }}
      role="slider"
      tabIndex={0}
      aria-label={`${label}: Sättigung und Helligkeit`}
      aria-valuetext={`Sättigung ${Math.round(s * 100)} %, Helligkeit ${Math.round(v * 100)} %`}
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) pick(event.clientX, event.clientY);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onKeyDown={(event) => {
        const step = 0.01;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(clamp01(s - step), v);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(clamp01(s + step), v);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          onChange(s, clamp01(v + step));
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          onChange(s, clamp01(v - step));
        }
      }}
    >
      <span
        className="theme-sv-thumb"
        style={{
          left: `${s * 100}%`,
          top: `${(1 - v) * 100}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

/**
 * The hue strip (0–360° left → right). The rainbow is a fixed CSS gradient;
 * only the thumb moves. Dragging (or Left/Right) reports the hue.
 */
function HueSlider({
  hue,
  label,
  onChange,
}: {
  hue: number;
  label: string;
  onChange: (hue: number) => void;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pick = (clientX: number): void => {
    const slider = sliderRef.current;
    if (slider === null) return;
    const rect = slider.getBoundingClientRect();
    onChange(clamp01((clientX - rect.left) / rect.width) * 360);
  };

  return (
    <div
      ref={sliderRef}
      className="theme-hue-slider"
      role="slider"
      tabIndex={0}
      aria-label={`${label}: Farbton`}
      aria-valuetext={`${Math.round(hue)}°`}
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) pick(event.clientX);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange((hue - 1 + 360) % 360);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange((hue + 1) % 360);
        }
      }}
    >
      <span
        className="theme-hue-thumb"
        style={{ left: `${(hue / 360) * 100}%`, backgroundColor: `hsl(${hue}, 100%, 50%)` }}
      />
    </div>
  );
}

/** The recipe-theme editor: live preview, typeface chips and colour tokens. */
function ThemeEditor({
  title,
  theme,
  onChange,
}: {
  title: string;
  theme: RecipeTheme | undefined;
  onChange: (theme: RecipeTheme | undefined) => void;
}) {
  // Resolve the five tokens once; each falls back to the default independently.
  const resolved = resolveTheme(theme);
  const onAccent = onAccentColor(resolved.accent, resolved.ink, resolved.paper);
  // The preview mirrors the export's pairing: a Noto Serif Display theme sets
  // only the title in the display face and the body in Noto Serif (§4.8).
  const fonts = resolveThemeFonts(resolved.font);
  const headingStack = themeFontStack(fonts.heading);
  const bodyStack = themeFontStack(fonts.body);

  // Every change passes through the save-time normalization: defaults dropped,
  // hex lower-cased, an empty theme collapsing back to undefined.
  const patch = (next: Partial<RecipeTheme>): void => {
    onChange(normalizeTheme({ ...theme, ...next }));
  };

  // "Standard" (the reset) shows only for a token that is genuinely overridden
  // — a stored value that equals its default is not an override.
  const colorIsOverridden = (key: 'accent' | 'paper' | 'ink' | 'line'): boolean => {
    const value = theme?.[key];
    return value !== undefined && value.toLowerCase() !== DEFAULT_THEME[key].toLowerCase();
  };

  return (
    <>
      <div className="field">
        <span className="field-label">
          Schriftart<span className="optional-mark">(optional)</span>
        </span>
        <div className="theme-font-chips" role="group" aria-label="Schriftart">
          <button
            type="button"
            className={resolved.font === DEFAULT_THEME.font ? 'chip chip-active' : 'chip'}
            style={{ fontFamily: themeFontStack(DEFAULT_THEME.font) }}
            onClick={() => patch({ font: undefined })}
            title="Standard-Schriftart"
          >
            {themeFontLabel(DEFAULT_THEME.font)}
          </button>
          {THEME_FONT_SHORTLIST.filter((font) => font !== DEFAULT_THEME.font).map((font) => (
            <button
              key={font}
              type="button"
              className={resolved.font === font ? 'chip chip-active' : 'chip'}
              style={{ fontFamily: themeFontStack(font) }}
              onClick={() => patch({ font })}
            >
              {themeFontLabel(font)}
            </button>
          ))}
        </div>
      </div>

      <ThemeColorField
        label="Akzent"
        value={resolved.accent}
        overridden={colorIsOverridden('accent')}
        onChange={(hex) => patch({ accent: hex })}
      />
      <ThemeColorField
        label="Hintergrund"
        value={resolved.paper}
        overridden={colorIsOverridden('paper')}
        onChange={(hex) => patch({ paper: hex })}
      />
      <ThemeColorField
        label="Text"
        value={resolved.ink}
        overridden={colorIsOverridden('ink')}
        onChange={(hex) => patch({ ink: hex })}
      />
      <ThemeColorField
        label="Linie"
        value={resolved.line}
        overridden={colorIsOverridden('line')}
        onChange={(hex) => patch({ line: hex })}
      />

      <div className="field">
        <span className="field-label">Vorschau</span>
        <div
          className="theme-preview"
          style={{
            backgroundColor: resolved.paper,
            color: resolved.ink,
            fontFamily: bodyStack,
          }}
        >
          <span className="theme-preview-title" style={{ fontFamily: headingStack }}>
            {title.trim() !== '' ? title.trim() : 'Rezepttitel'}
          </span>
          <span className="theme-preview-line" style={{ backgroundColor: resolved.line }} />
          <span className="theme-preview-body" style={{ fontFamily: bodyStack }}>
            Zutaten vorbereiten, Schritt für Schritt.
          </span>
          <span
            className="theme-preview-accent"
            style={{ backgroundColor: resolved.accent, color: onAccent }}
          >
            Akzent
          </span>
        </div>
      </div>
    </>
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
  backLabel = 'Zurück',
  onSaved,
  onOpenRecipe,
  showSnackbar,
  visible = true,
  ref,
}: RecipeEditorProps) {
  /**
   * The working draft as it is known synchronously at mount: an AI revision
   * (`initialDraft`, e.g. "Mit KI bearbeiten"), or the target's cached text / the
   * empty draft. `null` = not cached, the load effect fetches it. Rendered on
   * the first paint so the editor never flashes a loading message for an
   * already-read recipe.
   */
  const [initialEditorDraft] = useState<EditorDraft | null>(() =>
    initialDraft !== undefined ? toDraft(initialDraft) : baselineDraftFor(target),
  );
  /**
   * The baseline the editor compares against — the target recipe as stored, or
   * the AI draft of a brand-new recipe. For an AI revision of an existing recipe
   * this is the file on Drive while the working draft is the revision, so the
   * dirty check and the save rollback keep pointing at what is actually stored.
   */
  const [initialBaseline] = useState<EditorDraft | null>(() =>
    baselineDraftFor(target, initialDraft),
  );
  /** The working draft; null while the target recipe is still loading. */
  const [draft, setDraft] = useState<EditorDraft | null>(initialEditorDraft);
  /** The recipe as loaded from Drive — rollback target and dirty check. */
  const [original, setOriginal] = useState<EditorDraft | null>(initialBaseline);
  /** Every other recipe of the collection (parse errors skipped). */
  const [collection, setCollection] = useState<Recipe[]>([]);
  /**
   * True once the collection load finished — gates the "neue Zutat"
   * highlighting, so a sub-recipe name is never flagged as new while its file
   * is still being read (the parse decides whether a title is an ingredient
   * recipe, which the file list alone cannot tell).
   */
  const [collectionReady, setCollectionReady] = useState(false);
  /** Issues from the last save attempt; shown inline + in the banner. */
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * The destructive action the confirmation sheet is asking about, if any:
   * deleting the recipe, removing the photo or removing one step. §6.4: an
   * irreversible action asks first, and the question is the same sheet the
   * discard question uses (§6.2). The discard question itself is not state here:
   * it belongs to the shared exit guard below, which every exit trigger
   * (button, Escape, browser Back) goes through.
   */
  const [pendingConfirm, setPendingConfirm] = useState<
    { kind: 'delete' } | { kind: 'photo' } | { kind: 'step'; stepIndex: number } | null
  >(null);

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
  /**
   * The ingredient whose master-data sheet is open above the quantity sheet.
   * The quantity sheet stays mounted underneath, so its values survive the
   * round trip instead of being reconstructed from a prefill.
   */
  const [masterEditName, setMasterEditName] = useState<string | null>(null);
  const [masterEditSaving, setMasterEditSaving] = useState(false);
  /** Synchronous mirror of masterEditSaving, for the Back/Escape guard. */
  const masterEditSavingRef = useRef(false);
  const [masterEditError, setMasterEditError] = useState<string | null>(null);
  /**
   * Bumped after the master-data write or its undo. The registry is
   * module-level state, so this is what makes the quantity sheet read it again.
   */
  const [, setMasterRevision] = useState(0);

  const photoUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Kopf text fields — Enter (the phone keyboard's "next") walks this chain. */
  const titleFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const stepEditorRefs = useRef<(StepEditorHandle | null)[]>([]);
  /**
   * The in-flight collection load. `handleSave` awaits it before validating,
   * so a valid sub-recipe name is never rejected just because its file was
   * still loading (the state update alone would not reach the save closure).
   */
  const collectionPromiseRef = useRef<Promise<Recipe[]> | null>(null);

  // Load the target recipe (or the empty/AI draft). The content cache makes
  // this a no-op read for a recipe that was read before (e.g. by the overview
  // sheet), so the form is already on screen via `initialEditorDraft` and this
  // effect only confirms it / fills it in on a cold open. An AI revision stays
  // the working draft while the loaded file becomes the baseline it is compared
  // against (dirty check, save rollback).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const baseline =
          target !== null
            ? toDraft(await readRecipe(token, target.fileId))
            : initialDraft !== undefined
              ? toDraft(initialDraft)
              : newRecipeDraft();
        if (cancelled) return;
        setOriginal(baseline);
        setDraft(initialDraft !== undefined ? toDraft(initialDraft) : baseline);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, target, initialDraft]);

  // Load the rest of the collection in parallel. It is only needed for the
  // sub-recipe link checks and the ingredient picker, so it must not block the
  // form: the editor is already usable while this fills in behind it. The
  // content cache makes repeat opens free and de-duplicates a read that
  // another screen already started.
  useEffect(() => {
    let cancelled = false;
    const entries = recipes.filter((entry) => entry.fileId !== target?.fileId);
    const load = Promise.all(
      entries.map(async (entry): Promise<Recipe | null> => {
        try {
          return await readRecipe(token, entry.fileId);
        } catch {
          // A broken file is the user's pre-existing problem, not this
          // editor's — skip it (it also never appears in the link picker).
          console.warn(`Rezept "${entry.title}" konnte nicht gelesen werden — wird übersprungen.`);
          return null;
        }
      }),
    ).then((loaded) => loaded.filter((recipe): recipe is Recipe => recipe !== null));
    collectionPromiseRef.current = load;
    void load.then((others) => {
      if (cancelled) return;
      setCollection(others);
      setCollectionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [token, recipes, target?.fileId]);

  // Load the photo preview (edit mode) through the shared photo cache, so a
  // photo already downloaded by the list card or the overview sheet does not
  // get fetched again. Object URLs are revoked on unmount (effect below).
  useEffect(() => {
    const imageFileId = target?.image?.fileId;
    if (imageFileId === undefined) return;
    let cancelled = false;
    void (async () => {
      const blob = await loadRecipePhoto(token, imageFileId);
      if (cancelled || blob === null) return;
      if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
      const url = URL.createObjectURL(blob);
      photoUrlRef.current = url;
      setPhotoUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, target?.image?.fileId]);

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

  // Any change cancels the "Schritt entfernen?" confirmation: an armed confirm
  // must never outlive the state it refers to — reordering or removing steps
  // shifts the armed step index. (The discard confirmation is invalidated by
  // the exit guard's work signature instead; see useLeaveGuard.) The comparison
  // runs during render, exactly like the guard's own invalidation: the question
  // is gone in the same commit as the edit, never a render later.
  const [confirmDraft, setConfirmDraft] = useState(draft);
  if (confirmDraft !== draft) {
    setConfirmDraft(draft);
    setPendingConfirm(null);
  }

  /**
   * Shared exit guard (useLeaveGuard): owns the armed discard question for
   * *every* way out of the editor — the header's Zurück button, Escape, the
   * browser Back button and the sub-recipe jump. The signature is the draft
   * content plus the queued photo change, so any edit disarms a standing
   * confirmation. Reset whenever a modal opens or closes: dismissing the
   * ingredient sheet is "keep working", and must not leave a stale discard arm
   * behind. The question itself renders as LeaveConfirmSheet over the screen
   * (see the render below).
   */
  const guard = useLeaveGuard({
    workSignature: `${draft === null ? '' : JSON.stringify(normalizeRecipe(draft))}\u0000${photoChange === null ? '' : photoChange.kind}`,
    needsConfirm: dirty,
  });

  /**
   * Leaves the editor for good (list, or back to the AI conversation when the
   * draft came from there). Every exit trigger ends here, so the guard state is
   * cleared exactly once, no matter which trigger confirmed.
   */
  const executeLeave = useCallback((): void => {
    guard.reset();
    onClose();
  }, [guard, onClose]);

  // Gesamtzeit must be larger than Vorbereitungszeit: a total time that is not
  // larger is dropped the moment the prep time changes. The check is a
  // render-time adjustment keyed on the previous prep time (React's "store
  // information from previous renders" pattern), like the guard's own
  // invalidation: it catches a typed prep time *and* a freshly loaded draft, and
  // the invalid pair is never painted. `null` means "no previous render yet", so
  // the first render checks too. Clearing from the field's own onChange handler
  // would miss the loaded draft; an effect would paint the invalid state once.
  const [lastPrepTime, setLastPrepTime] = useState<string | null>(null);
  if (draft !== null && draft.prep_time !== lastPrepTime) {
    setLastPrepTime(draft.prep_time);
    const prep = parseTimeValue(draft.prep_time);
    const total =
      draft.total_time === undefined || draft.total_time === ''
        ? null
        : parseTimeValue(draft.total_time);
    if (prep !== null && total !== null && total <= prep) {
      setDraft({ ...draft, total_time: undefined });
    }
  }

  /** The normalized recipe — what is written to Drive (derived list, §4). */
  const saved = useMemo(() => (draft === null ? null : normalizeRecipe(draft)), [draft]);

  /**
   * The derived master list: exactly the rows that will be saved. Memoized, so
   * the reference is stable for the memos that depend on it (the `?? []` would
   * otherwise hand out a fresh array on every render).
   */
  const computedIngredients = useMemo(() => saved?.ingredients ?? [], [saved]);

  /**
   * The display line of each master row. It is derived from the step uses
   * behind the row (`masterUsesFor`), not from the summed quantity alone, so the
   * constrained master optimizer can keep the row consistent with the step rows
   * (one-use identity, exact BQ sum, shared-unit AQ sum, inherited precision).
   * The index matches `computedIngredients`; both come from the same `saved`.
   */
  const masterDisplays = useMemo(
    () =>
      saved === null
        ? []
        : computedIngredients.map((ingredient) =>
            safeRenderMasterAQSDisplay(
              ingredient.name,
              masterUsesFor(saved.steps, ingredient),
              ingredient.unit,
            ),
          ),
    [computedIngredients, saved],
  );

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

  /**
   * A name a row or named inline mention may reference: it exists in the
   * ingredient master data (runtime registry, incl. entries created during
   * this session) or it is the title of an ingredient_recipe of the given
   * collection (implicit sub-recipe link). Read fresh on every call — the
   * registry updates when the create-master-data flow saves (see
   * ingredientRegistry.ts), and newly saved sub-recipes appear in
   * `ingredientRecipes`. The collection is passed in because the save path
   * awaits the load and must validate against what it resolved, not against
   * the (possibly not yet rendered) state.
   */
  const isKnownIngredientNameIn = (collectionNow: Recipe[], name: string): boolean =>
    masterIngredientNames().includes(name.trim()) ||
    collectionNow.some((recipe) => recipe.title === name.trim());

  /** Same check against the currently rendered collection. */
  const isKnownIngredientName = (name: string): boolean =>
    isKnownIngredientNameIn(collection, name);

  /**
   * Names used by the draft (rows + named inline mentions) that are not known
   * to the master data / collection — these rows carry the "NEU" tag
   * ingredients and block the save (see collectIssues). Computed on every
   * render (not memoized): the master registry is module state that updates
   * when the create-master-data flow saves, and only a fresh read reflects
   * that new ingredient immediately. While the collection is still loading the
   * set stays empty: whether a title is an ingredient recipe can only be told
   * once its file is parsed, so nothing may be flagged as new in the meantime.
   */
  const unknownUsedNames = collectionReady
    ? unknownIngredientNames(draft?.steps ?? [], (name) => isKnownIngredientName(name))
    : new Set<string>();

  /** All issues for the saved form (core per-file + editor + §7.2 cross checks). */
  const collectIssues = (savedRecipe: Recipe, collectionNow: Recipe[]): ValidationIssue[] => {
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
            'Der Schritt-Text darf nicht mit "- " beginnen (das ist Zutatenzeilen vorbehalten).',
        });
      }
      step.ingredients.forEach((ingredient, rowIndex) => {
        if (!isKnownIngredientNameIn(collectionNow, ingredient.name)) {
          list.push({
            path: `steps[${index}].ingredients[${rowIndex}]`,
            message: 'Bitte diese Zutat anlegen oder ersetzen.',
          });
        }
      });
      const unknownMentions = unknownMentionNames(step.text, (name) =>
        isKnownIngredientNameIn(collectionNow, name),
      );
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
    // §7.2: title unique across the collection. The file list already carries
    // every title, so this check does not depend on the parsed collection
    // (which may still be loading); it excludes the edited file itself.
    if (
      savedRecipe.title !== '' &&
      recipes.some((entry) => entry.fileId !== target?.fileId && entry.title === savedRecipe.title)
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
      // The steps are cards of their own now, so the „+ Schritt hinzufügen"
      // button is what answers a missing step.
      id = 'editor-step-add';
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
   * recipe text is written, and the export is then regenerated once more so it
   * embeds the new photo instead of the previous one. A failed save leaves the
   * photo change queued for a retry.
   */
  const handleSave = async (): Promise<void> => {
    if (draft === null || saving) return;
    const savedRecipe = normalizeRecipe(draft);
    // The name checks need the parsed collection (sub-recipe titles). It loads
    // in parallel with the form; a save started before it finished waits here,
    // so a valid sub-recipe name is never rejected just because its file was
    // still in flight. The awaited array is used directly — the state update
    // may not have rendered yet.
    const collectionNow =
      collectionPromiseRef.current !== null ? await collectionPromiseRef.current : collection;
    const list = collectIssues(savedRecipe, collectionNow);
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
          // The save above already wrote the export, but from the previous
          // photo state (the export embeds the photo). Regenerate it now so the
          // first save after adding, replacing or removing a photo is correct.
          await writeRecipeExportSafely(token, savedRecipe);
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
          // Same as above: re-bake the export with the freshly uploaded photo.
          await writeRecipeExportSafely(token, savedRecipe);
        }
      }
      setPhotoChange(null);
      onSaved(savedRecipe);
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
      onSaved(null);
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

  /**
   * Moves one counted ingredient row of a step by one position (`offset` −1 up,
   * +1 down). The row order is the order of use (recipe_structure.md
   * "Ingredients List"), and the derived master list follows it: an ingredient
   * moves only where this step holds its first use, and duplicates keep the
   * position of that first use. Out-of-range moves are no-ops — the two end
   * buttons are disabled, this guards the keyboard path too.
   */
  const moveStepRow = (stepIndex: number, rowIndex: number, offset: -1 | 1): void => {
    updateStep(stepIndex, (current) => {
      const target = rowIndex + offset;
      if (target < 0 || target >= current.ingredients.length) return current;
      const ingredients = [...current.ingredients];
      [ingredients[rowIndex], ingredients[target]] = [ingredients[target]!, ingredients[rowIndex]!];
      return { ...current, ingredients };
    });
  };

  /** Removes a step from the draft (the armed "remove" button's confirming tap,
   *  or an empty step's immediate tap). Called only when the step being removed is
   *  the one the armed state refers to. */
  const removeStep = (stepIndex: number): void => {
    setPendingConfirm(null);
    updateDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, i) => i !== stepIndex),
    }));
  };

  /**
   * Remove tap on a step (two-step confirm like the photo removal): a content-
   * bearing step (prose or rows) first swaps the remove symbol for a red
   * "Wirklich entfernen?" button; the second tap on it performs the removal. Any other
   * change (arrows, editing, adding) cancels the armed state — the question
   * goes away again (see the draft-change effect above). A truly empty step has
   * nothing to lose and is removed immediately.
   */
  const toggleRemoveStep = (stepIndex: number): void => {
    if (draft === null) return;
    const step = draft.steps[stepIndex];
    if (step === undefined) return;
    const hasContent = step.text.trim() !== '' || step.ingredients.length > 0;
    if (hasContent) {
      // An irreversible removal asks through the shared question sheet (§6.4).
      setPendingConfirm({ kind: 'step', stepIndex });
    } else {
      // An empty step has nothing to lose, so it goes without asking (§6.4).
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
   * The jump opens the sub-recipe as a new level above this one, which stays
   * mounted (hidden) with its draft — no discard confirmation, and Back lands
   * here again exactly as it was left.
   */
  const requestJump = (recipe: StoredRecipe): void => {
    guard.reset();
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
   *
   * The shopping data is written first: the assignment file's name set is a
   * superset of the ingredient list by design (docs/storage_format.md §10), so a
   * row without an ingredient is valid master data and a retry overwrites it,
   * while an ingredient without its row would be exactly the state the create
   * sheet's „Einkauf“ field exists to prevent. A failed assignment write
   * therefore stops the flow before anything is created (the error names the
   * cause, and the name is still free for a retry). When the name already exists
   * as a shopping item, its row is updated with the form's stop and synonyms
   * instead of creating a second route.
   *
   * `stop` is null while the shopping route holds no stops at all — decided with
   * the user: the ingredient is then created without a shopping stop.
   *
   * The folder is resolved and listed once and handed to the ingredient write;
   * the shopping write resolves its own snapshot because it may create the
   * `Stammdaten` folder first. Each write path still reads the content of the
   * files it is about to change, so the read-before-write guarantee is unchanged.
   */
  const handleCreateIngredient = async (
    name: string,
    bu: string,
    reorderPoint: number,
    entries: NewIngredientEntry[],
    precision: PrecisionLevel,
    stop: ShoppingStop | null,
    variants: readonly string[],
  ): Promise<void> => {
    setCreateSaving(true);
    setCreateError(null);
    try {
      const folder = await listCookbookFolder(token);
      if (stop !== null) {
        // The name may already exist as a shopping item (the create sheet
        // pre-fills its stop/synonyms in that case), and its stored spelling may
        // differ in case. Update that row instead of creating a second one.
        const itemKey = Object.keys(allShoppingItems()).find(
          (candidate) => shoppingNameKey(candidate) === shoppingNameKey(name),
        );
        if (itemKey !== undefined) {
          await saveShoppingItem(token, itemKey, stop, variants);
        } else {
          await createShoppingItem(token, name, stop, variants);
        }
      } else if (variants.length > 0) {
        throw new Error('Ohne Einkaufsort lassen sich keine Synonyme speichern.');
      }
      await appendIngredientMasterData(token, name, bu, reorderPoint, entries, precision, folder);
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

  /** Closes the ingredient sheet without applying it — the transient form
   *  fields are dropped (decided with the user: cancel means cancel). The exit
   *  guard is reset, so dismissing the sheet never leaves a standing discard
   *  confirmation behind. */
  const handleCloseSheet = useCallback((): void => {
    setSheet(null);
    setSheetPrefill(null);
    guard.reset();
  }, [guard]);

  /**
   * Opens the ingredient sheet. Opening disarms a standing discard question:
   * the user is working inside the editor again, so the next exit must ask fresh
   * instead of discarding (this is the leak the shared guard closes — the
   * confirmation used to survive a sheet).
   */
  const openSheet = useCallback(
    (next: SheetState): void => {
      guard.reset();
      setSheet(next);
    },
    [guard],
  );

  /** Closes the create sheet without saving — restore the ingredient sheet.
   *  Guarded against closing while a save runs: the backdrop stays disabled
   *  then (NewIngredientSheet), so a late error is never reported into an
   *  unmounted sheet (the restore would swallow it). */
  const handleCreateClose = useCallback((): void => {
    if (createSaving) return;
    setCreateError(null);
    setCreateSheet(null);
    if (sheetContext !== null) {
      setSheet(sheetContext.sheet);
      // Restore the typed name+quantity so nothing is lost on cancel.
      setSheetPrefill({ name: sheetContext.name, quantity: sheetContext.quantity });
    }
  }, [createSaving, sheetContext]);

  /**
   * Opens the selected master ingredient's sheet over the quantity sheet. The
   * quantity sheet stays mounted underneath, so its name, amount, precision and
   * unit choice are still there when the master sheet closes.
   */
  const handleEditIngredient = (name: string): void => {
    setMasterEditError(null);
    setMasterEditName(name);
  };

  /** Closes the master-data sheet without saving; a running write keeps it open. */
  const handleMasterEditClose = useCallback((): void => {
    if (masterEditSavingRef.current) return;
    setMasterEditName(null);
    setMasterEditError(null);
  }, []);

  /**
   * Persists the master-data sheet's values through the same path the „Zutaten“
   * screen uses: ingredient fields plus the name's shopping item, with the
   * app-root notice offering „Rückgängig“. On success the quantity sheet is
   * revealed again with its state untouched.
   */
  const handleMasterEditSave = async (input: IngredientMasterSheetUpdate): Promise<void> => {
    if (masterEditName === null || masterEditSavingRef.current) return;
    const name = masterEditName;
    masterEditSavingRef.current = true;
    setMasterEditSaving(true);
    setMasterEditError(null);
    try {
      await updateIngredientMasterAndShopping(
        {
          token,
          showSnackbar,
          onChanged: () => setMasterRevision((current) => current + 1),
        },
        name,
        input,
      );
      setMasterEditName(null);
    } catch (err) {
      setMasterEditError(err instanceof Error ? err.message : String(err));
    } finally {
      masterEditSavingRef.current = false;
      setMasterEditSaving(false);
    }
  };

  /**
   * The one exit hop every trigger uses (see useLeaveGuard). Layers inside the
   * editor consume the request first, in the order of the visible stack; only a
   * bare unsaved draft reaches the discard confirmation.
   */
  const requestLeave = useCallback(
    (reason: LeaveReason): boolean => {
      if (pendingConfirm !== null) {
        // The confirmation sheet is the topmost layer: the same trigger closes
        // it, and closing it is „Abbrechen" (§6.2) — never the action.
        setPendingConfirm(null);
        return true;
      }
      if (saving) {
        // A Drive write is in flight — do not unmount the editor mid-save
        // (a late error would be reported into a dead component).
        return true;
      }
      if (masterEditName !== null) {
        // The master-data sheet is the topmost layer; the shared helper guards
        // a running write, so a Back cannot discard the form.
        handleMasterEditClose();
        return true;
      }
      if (createSheet !== null) {
        // handleCreateClose guards against closing while a save runs.
        handleCreateClose();
        return true;
      }
      if (sheet !== null) {
        handleCloseSheet();
        return true;
      }
      return guard.request(reason, executeLeave);
    },
    [
      pendingConfirm,
      saving,
      masterEditName,
      createSheet,
      sheet,
      guard,
      executeLeave,
      handleCreateClose,
      handleCloseSheet,
      handleMasterEditClose,
    ],
  );

  // Escape is the keyboard equivalent of the browser Back button and follows
  // the same layer order as notifyBack below (master-data sheet, create sheet,
  // ingredient sheet, then the discard confirmation). Only the visible level listens: the levels
  // below stay mounted (hidden) and must not react.
  useEscapeTrigger(() => void requestLeave('escape'), visible);

  // Ctrl+S is the keyboard equivalent of the „Speichern" button. It belongs to
  // this editor only while it is the visible topmost layer AND no sheet is open
  // on top of it — the sheet that is open registers its own shortcut instead,
  // so exactly one save action reacts (see useSaveShortcut).
  useSaveShortcut(
    () => void handleSave(),
    visible && sheet === null && createSheet === null && masterEditName === null,
  );

  /** Toggles the reference role of a master-list row (§4; both recipe types). */
  const toggleReference = (name: string): void => {
    if (draft === null) return;
    const flagged = referenceNames.has(name);
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
    setPendingConfirm(null);
    if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    const url = URL.createObjectURL(blob);
    photoUrlRef.current = url;
    setPhotoUrl(url);
  };

  /**
   * Queues a photo replacement; the Drive write happens on Speichern. The
   * file is center-cropped to a 4:3 landscape first (recipe_structure.md,
   * "Image"), and the preview shows the cropped result — what you see is what
   * is saved.
   */
  const handlePhotoFile = async (file: File): Promise<void> => {
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : null;
    if (extension === null) {
      setPhotoError('Nur JPG- oder PNG-Bilder werden unterstützt.');
      return;
    }
    setPhotoError(null);
    try {
      const cropped = await landscapeCropPhoto(file, extension);
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
   * Browser-back consumer (see RecipeEditorHandle and App). Both the browser /
   * device Back button and the swipe-back gesture arrive here and are routed
   * through the same `requestLeave` as the header button and Escape, so all
   * four triggers share one layer order and one armed confirmation.
   */
  useImperativeHandle(ref, () => ({
    notifyBack: (): boolean => requestLeave('browser-back'),
  }));

  /**
   * The confirmation sheet's content (docs/DESIGN.md §6.2 and §6.4). One sheet
   * serves both the exit guard's discard question and every irreversible action
   * in the editor, so a confirmation always looks the same and is always
   * answered the same way.
   */
  const confirmOpen = guard.armed || pendingConfirm !== null;
  const confirmQuestion = guard.armed
    ? 'Änderungen am Rezept verwerfen?'
    : pendingConfirm?.kind === 'delete'
      ? `„${target?.title ?? ''}“ wirklich löschen?`
      : pendingConfirm?.kind === 'photo'
        ? 'Bild wirklich entfernen?'
        : 'Schritt wirklich entfernen?';
  const confirmLabel = guard.armed
    ? 'Verwerfen'
    : pendingConfirm?.kind === 'delete'
      ? 'Rezept löschen'
      : 'Entfernen';

  /** The sheet's confirmed answer: it leaves for real, or runs the pending action. */
  const runConfirm = (): void => {
    if (guard.armed) {
      guard.confirm(executeLeave);
      return;
    }
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (pending?.kind === 'delete') void handleDelete();
    else if (pending?.kind === 'photo') handleRemovePhoto();
    else if (pending?.kind === 'step') removeStep(pending.stepIndex);
  };

  // ---- Render -------------------------------------------------------------

  if (loadError !== null) {
    return (
      <main className="app app-narrow">
        <section className="editor" aria-label="Rezept-Editor">
          <div className="editor-header">
            <button
              type="button"
              className="text-button back-button"
              onClick={() => void requestLeave('button')}
            >
              {backLabel}
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
      <main className="app app-narrow">
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
              collectIssues(saved, collection).map(
                (issue) => `${issue.path}\u0000${issue.message}`,
              ),
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

  /** The entry behind the open master-data sheet, or undefined if the registry changed. */
  const masterEditEntry = masterEditName === null ? undefined : mappingsFor(masterEditName);

  return (
    <main className="app app-narrow">
      <section className="editor" aria-label="Rezept-Editor">
        <div className="editor-header">
          {/* One row: „Zurück" · „Speichern". Neither label ever changes:
              „Zurück" is navigation, and the discard question is a sheet over
              the screen (LeaveConfirmSheet, docs/DESIGN.md §6.2) — a layer, not
              a line in this header. */}
          <div className="editor-actions">
            <button
              type="button"
              className="text-button back-button"
              onClick={() => void requestLeave('button')}
            >
              {backLabel}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
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

        {/* Kopfdaten — Bild, Titel, Details, Typ, Portionen/Ergiebigkeit und
            Zeiten. Das Bild steht bewusst ganz oben, vor dem Titel. */}
        <section className="editor-card" aria-label="Kopfdaten">
          <h3 className="editor-card-title">Kopfdaten</h3>

          {/* Bild (§2, optional sibling file) — zuerst, vor dem Titel */}
          <div
            className="field"
            id="editor-field-photo"
            role="group"
            aria-describedby={photoError !== null ? 'editor-error-photo' : undefined}
            aria-invalid={photoError !== null}
          >
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
                {/* Auswählen/Ersetzen wears the action-button geometry of
                    „Entfernen“ beside it (outlined instead of filled) — the
                    photo row's two actions are peers, so the quiet text-button
                    look would have read as a mere aside (decided with the
                    user). */}
                <button
                  type="button"
                  className="outlined-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon className="button-icon" optical={20} />
                  <span>{photoUrl !== null ? 'Ersetzen' : 'Auswählen'}</span>
                </button>
                {photoUrl !== null && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => setPendingConfirm({ kind: 'photo' })}
                  >
                    <TrashIcon className="button-icon" optical={20} />
                    <span>Entfernen</span>
                  </button>
                )}
              </div>
            </div>
            {photoError !== null && (
              <div className="field-errors" id="editor-error-photo">
                <p className="field-error" role="alert">
                  {photoError}
                </p>
              </div>
            )}
          </div>

          <label className="field">
            <span className="field-label">Titel</span>
            <AutoGrowTextarea
              ref={titleFieldRef}
              id="editor-field-title"
              describedBy={fieldIssue('title').length > 0 ? 'editor-error-title' : undefined}
              invalid={fieldIssue('title').length > 0}
              value={draft.title}
              onChange={(title) => patchDraft({ title })}
              onEnter={() => focusEditorField(descriptionFieldRef.current)}
            />
          </label>
          {fieldIssue('title').length > 0 && (
            <div className="field-errors" id="editor-error-title">
              {fieldIssue('title').map((issue, index) => (
                <p className="field-error" key={`title-${index}`} role="alert">
                  {issue.message}
                </p>
              ))}
            </div>
          )}

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
                    // References are available on both types (§4): keep them.
                    // Defaults for a fresh ingredient recipe: g, 1000 (1 kg).
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
            <div
              className="field"
              id="editor-field-servings"
              role="group"
              aria-describedby={
                fieldIssue('servings').length > 0 || fieldIssue('yield').length > 0
                  ? 'editor-error-target'
                  : undefined
              }
              aria-invalid={fieldIssue('servings').length > 0}
            >
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
              <div
                className="field"
                id="editor-field-yield"
                role="group"
                aria-describedby={
                  fieldIssue('yield').length > 0 || fieldIssue('yield_unit').length > 0
                    ? 'editor-error-target'
                    : undefined
                }
                aria-invalid={fieldIssue('yield').length > 0 || fieldIssue('yield_unit').length > 0}
              >
                <span className="field-label">Menge</span>
                <div className="segmented" role="group" aria-label="Einheit der Menge">
                  <button
                    type="button"
                    className={draft.yield_unit !== 'ml' ? 'segmented-active' : ''}
                    onClick={() => patchDraft({ yield_unit: 'g' })}
                  >
                    g
                  </button>
                  <button
                    type="button"
                    className={draft.yield_unit === 'ml' ? 'segmented-active' : ''}
                    onClick={() => patchDraft({ yield_unit: 'ml' })}
                  >
                    ml
                  </button>
                </div>
                <QuantityInput
                  value={draft.yield}
                  onChange={(yieldValue) => patchDraft({ yield: yieldValue })}
                  family={draft.yield_unit === 'ml' ? 'ml' : 'g'}
                  // A yield has no ingredient: the adaptive row offers the
                  // clean metric targets near the current amount.
                  adaptive
                />
              </div>
            </>
          )}
          {fieldIssue('servings').concat(fieldIssue('yield'), fieldIssue('yield_unit')).length >
            0 && (
            <div className="field-errors" id="editor-error-target">
              {fieldIssue('servings')
                .concat(fieldIssue('yield'), fieldIssue('yield_unit'))
                .map((issue, index) => (
                  <p className="field-error" key={`target-${index}`} role="alert">
                    {issue.message}
                  </p>
                ))}
            </div>
          )}

          <div
            className="field"
            id="editor-field-prep_time"
            role="group"
            aria-describedby={
              fieldIssue('prep_time').length > 0 ? 'editor-error-prep_time' : undefined
            }
            aria-invalid={fieldIssue('prep_time').length > 0}
          >
            <span className="field-label">Arbeitszeit</span>
            <TimeChips
              value={draft.prep_time}
              onChange={(label) => patchDraft({ prep_time: label })}
            />
          </div>
          {fieldIssue('prep_time').length > 0 && (
            <div className="field-errors" id="editor-error-prep_time">
              {fieldIssue('prep_time').map((issue, index) => (
                <p className="field-error" key={`prep-${index}`} role="alert">
                  {issue.message}
                </p>
              ))}
            </div>
          )}

          <div
            className="field"
            id="editor-field-total_time"
            role="group"
            aria-describedby={
              fieldIssue('total_time').length > 0 ? 'editor-error-total_time' : undefined
            }
            aria-invalid={fieldIssue('total_time').length > 0}
          >
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
          {fieldIssue('total_time').length > 0 && (
            <div className="field-errors" id="editor-error-total_time">
              {fieldIssue('total_time').map((issue, index) => (
                <p className="field-error" key={`total-${index}`} role="alert">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* The steps — one top-level card each (§4.4: the card rung never nests,
            so a step is a card of its own beside the other cards, never a card
            inside a „Zubereitung" card). The step head names the card. */}
        {draft.steps.length === 0 &&
          sectionIssues('body').map((issue, index) => (
            <p className="field-error" key={`body-empty-${index}`} role="alert">
              {issue.message}
            </p>
          ))}
        {draft.steps.map((step, stepIndex) => {
          return (
            <section
              className="editor-card step-card"
              id={`editor-step-${stepIndex}`}
              key={stepIndex}
              aria-label={`Schritt ${stepIndex + 1}`}
            >
              <div className="step-head">
                <span className="step-number">Schritt {stepIndex + 1}</span>
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
                    <ArrowUpIcon className="button-icon" optical={20} />
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
                    <ArrowDownIcon className="button-icon" optical={20} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-text"
                    onClick={() => toggleRemoveStep(stepIndex)}
                    aria-label="Schritt entfernen"
                  >
                    <CloseIcon className="button-icon" optical={20} />
                  </button>
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
                        <li id={`editor-step-${stepIndex}-row-${rowIndex}`} className="step-row">
                          <button
                            type="button"
                            className="ingredient-row-button"
                            onClick={() =>
                              openSheet({
                                kind: 'row-edit',
                                stepIndex,
                                rowIndex,
                              })
                            }
                          >
                            <span className="ingredient-line">
                              <ArrangementLine
                                noteForm="bracketed"
                                display={safeRenderAQSDisplay(
                                  ingredient.name,
                                  ingredient.quantity,
                                  ingredient.unit,
                                  ingredient.precision !== undefined
                                    ? { quantity: ingredient.precision }
                                    : {},
                                )}
                              />
                              {isNewName && (
                                <span className="ingredient-tag tag-new">
                                  <NewReleasesIcon className="tag-icon" optical={20} />
                                  <span>Neu</span>
                                </span>
                              )}
                              {jumpTarget !== undefined && (
                                <button
                                  type="button"
                                  className="ingredient-tag tag-recipe"
                                  onClick={(event) => {
                                    // The row is one big button that opens the
                                    // ingredient sheet — the badge must
                                    // navigate without also triggering it.
                                    event.stopPropagation();
                                    requestJump(jumpTarget);
                                  }}
                                  title={`Zutaten-Rezept „${ingredient.name}“ öffnen`}
                                >
                                  <LinkIcon className="tag-icon" optical={20} />
                                  <span>Rezept</span>
                                </button>
                              )}
                            </span>
                            {/* A hint only where it says something the row
                                  does not: a normal row is identical to its
                                  master-list counterpart (no hint there
                                  either). */}
                            {isNewName && (
                              <span className="ingredient-hint">
                                Nicht in Stammdaten — antippen zum Anlegen
                              </span>
                            )}
                          </button>
                          <div className="step-row-actions">
                            {/* The reference role lives on the master
                                  list only (decided with the user): neither
                                  the toggle nor the "REFERENZ" badge appears
                                  on a step row. */}
                            {/* Row order = order of use. Same compact ↑ ↓ pair
                                as the step head; at the ends of the list the
                                direction has nowhere to go, and the row's
                                position is the visible cause of the disabled
                                look (DESIGN §5.1). */}
                            <button
                              type="button"
                              className="icon-button"
                              disabled={rowIndex === 0}
                              onClick={() => moveStepRow(stepIndex, rowIndex, -1)}
                              aria-label={`${ingredient.name} nach oben`}
                            >
                              <ArrowUpIcon className="button-icon" optical={20} />
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              disabled={rowIndex === step.ingredients.length - 1}
                              onClick={() => moveStepRow(stepIndex, rowIndex, 1)}
                              aria-label={`${ingredient.name} nach unten`}
                            >
                              <ArrowDownIcon className="button-icon" optical={20} />
                            </button>
                            <button
                              type="button"
                              className="icon-button danger-text"
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
                              <CloseIcon className="button-icon" optical={20} />
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
                  className="add-button"
                  onClick={() => openSheet({ kind: 'row-add', stepIndex })}
                >
                  <PlusIcon className="button-icon" optical={20} />
                  <span>Zutatenzeile hinzufügen</span>
                </button>
              </div>

              <StepEditor
                ref={(element) => {
                  stepEditorRefs.current[stepIndex] = element;
                }}
                value={step.text}
                describedBy={
                  stepIssues(stepIndex).length > 0 ? `editor-error-step-${stepIndex}` : undefined
                }
                invalid={stepIssues(stepIndex).length > 0}
                onChange={(next) =>
                  updateStep(stepIndex, (current) => ({ ...current, text: next }))
                }
                onArtifactEdit={(artifact, at) =>
                  openSheet({ kind: 'inline-edit', stepIndex, at, artifact })
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
              {stepIssues(stepIndex).length > 0 && (
                <div className="field-errors" id={`editor-error-step-${stepIndex}`}>
                  {stepIssues(stepIndex).map((issue, index) => (
                    <p className="field-error" key={`step-${stepIndex}-${index}`} role="alert">
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}
              {stepIndex === 0 &&
                sectionIssues('body').map((issue, index) => (
                  <p className="field-error" key={`body-${index}`} role="alert">
                    {issue.message}
                  </p>
                ))}
              <button
                type="button"
                className="add-button"
                onClick={() =>
                  openSheet({
                    kind: 'inline',
                    stepIndex,
                    insertAt: stepEditorRefs.current[stepIndex]?.caretOffset() ?? step.text.length,
                  })
                }
              >
                <PlusIcon className="button-icon" optical={20} />
                <span>Menge zum Text hinzufügen</span>
              </button>
            </section>
          );
        })}

        {/* „Schritt hinzufügen" — adds a new empty step after the last one. It
            is also the scroll target of the "no step" issue (focusFirstIssue). */}
        <button
          type="button"
          className="add-button"
          id="editor-step-add"
          onClick={() =>
            updateDraft((current) => ({
              ...current,
              steps: [...current.steps, { ingredients: [], text: '' }],
            }))
          }
        >
          <PlusIcon className="button-icon" optical={20} />
          <span>Schritt hinzufügen</span>
        </button>

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
              Zutatenzeilen über „Zutatenzeile hinzufügen“ in den Schritten hinzu.
            </p>
          ) : (
            <>
              {/* The &shy; (U+00AD soft hyphen) lets "zusammengesetzt" break as
                  "zusammen-gesetzt" on narrow widths; invisible when the line fits. */}
              <p className="empty-hint">
                Liste aus den Zubereitungsschritten zusammen&shy;gesetzt. Mit Stern markierte
                Referenz-Zutaten werden beim Skalieren mit angezeigt.
              </p>
              <ul className="ingredient-list">
                {computedIngredients.map((ingredient, index) => {
                  const jumpTarget = subRecipeTarget(ingredient.name);
                  const isReference = ingredient.reference === true;
                  const isNewName = unknownUsedNames.has(ingredient.name.trim());
                  return (
                    <li key={ingredient.name} className="ingredient-row">
                      <span className="ingredient-line">
                        <ArrangementLine
                          noteForm="bracketed"
                          display={
                            masterDisplays[index] ??
                            safeRenderAQSDisplay(
                              ingredient.name,
                              ingredient.quantity,
                              ingredient.unit,
                            )
                          }
                        />
                        {isNewName && (
                          <span className="ingredient-tag tag-new">
                            <NewReleasesIcon className="tag-icon" optical={20} />
                            <span>Neu</span>
                          </span>
                        )}
                        {jumpTarget !== undefined && (
                          <button
                            type="button"
                            className="ingredient-tag tag-recipe"
                            onClick={(event) => {
                              // Keep the badge a self-contained navigation
                              // control (no row handler here, but unchanged
                              // behaviour if one is ever added).
                              event.stopPropagation();
                              requestJump(jumpTarget);
                            }}
                            title={`Zutaten-Rezept „${ingredient.name}“ öffnen`}
                          >
                            <LinkIcon className="tag-icon" optical={20} />
                            <span>Rezept</span>
                          </button>
                        )}
                        {isReference && (
                          <span className="ingredient-tag tag-reference">
                            <StarIcon className="tag-icon" optical={20} />
                            <span>Referenz</span>
                            {/* The × mirrors the star toggle: it drops the
                                reference role (star unfills, badge vanishes). */}
                            <button
                              type="button"
                              className="tag-remove"
                              onClick={() => toggleReference(ingredient.name)}
                              aria-label={`„${ingredient.name}“ als Referenz-Menge entfernen`}
                              title="Referenz-Menge entfernen"
                            >
                              <CloseIcon className="tag-remove-icon" optical={20} />
                            </button>
                          </span>
                        )}
                      </span>
                      {/* The tappable star shows only while the ingredient is
                          not a reference: once the role is active, the
                          "REFERENZ" badge's × is the one way to clear it — a
                          second toggle next to an already-active marker would
                          be redundant. */}
                      {!isReference && (
                        <button
                          type="button"
                          className="ref-toggle"
                          aria-pressed={false}
                          title="Als Referenz-Menge markieren"
                          aria-label={`„${ingredient.name}“ als Referenz-Menge markieren`}
                          onClick={() => toggleReference(ingredient.name)}
                        >
                          <StarIcon className="star-icon" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Design — the recipe's visual skin for the export (DESIGN §4.8);
            every token is optional and falls back to the default independently. */}
        <section className="editor-card" aria-label="Design">
          <h3 className="editor-card-title">Design</h3>
          <p className="field-hint">
            Aussehen der Kochansicht anpassen. Alle Felder sind optional und fallen einzeln auf den
            Standard zurück.
          </p>
          <ThemeEditor
            title={draft.title}
            theme={draft.theme}
            onChange={(theme) => patchDraft({ theme })}
          />
        </section>

        {/* Danger zone (edit mode only) */}
        {target !== null && (
          <section className="editor-card danger-zone" aria-label="Rezept löschen">
            <button
              type="button"
              className="danger-button"
              onClick={() => setPendingConfirm({ kind: 'delete' })}
              disabled={saving}
            >
              <TrashIcon className="button-icon" optical={20} />
              <span>Rezept löschen</span>
            </button>
          </section>
        )}
      </section>

      {/* The quantity sheet stays mounted under a master-data sheet, so its
          values survive the round trip. `inert` takes it out of the tab order
          and the accessibility tree while the master sheet is on top; the
          top-layer wrapper below makes the master backdrop dim it. */}
      {sheet !== null && (
        <div inert={masterEditName !== null ? true : undefined}>
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
            onClose={handleCloseSheet}
            onEditIngredient={handleEditIngredient}
            shortcutEnabled={masterEditName === null}
            onCreateNewIngredient={(name, quantity) => {
              if (sheet === null) return;
              setSheetContext({ sheet, mode: sheetMode(sheet), name, quantity });
              handleCloseSheet();
              // A fresh create flow must not start with the stale Drive error of
              // a previous (failed or cancelled) attempt.
              setCreateError(null);
              setCreateSheet({ name });
            }}
          />
        </div>
      )}
      {createSheet !== null && (
        <NewIngredientSheet
          initialName={createSheet.name}
          saving={createSaving}
          error={createError}
          onSave={(name, bu, reorderPoint, entries, precision, stop, variants) =>
            void handleCreateIngredient(name, bu, reorderPoint, entries, precision, stop, variants)
          }
          onEdited={() => setCreateError(null)}
          onClose={handleCreateClose}
        />
      )}
      {masterEditName !== null && masterEditEntry !== undefined && (
        <div className="sheet-layer-top">
          <EditIngredientSheet
            key={masterEditName}
            name={masterEditName}
            entry={masterEditEntry}
            saving={masterEditSaving}
            error={masterEditError}
            onSave={(update) => void handleMasterEditSave(update)}
            onEdited={() => setMasterEditError(null)}
            onClose={handleMasterEditClose}
          />
        </div>
      )}
      {confirmOpen && (
        <LeaveConfirmSheet
          question={confirmQuestion}
          confirmLabel={confirmLabel}
          onCancel={() => {
            setPendingConfirm(null);
            guard.reset();
          }}
          onConfirm={runConfirm}
        />
      )}
    </main>
  );
}

export default RecipeEditor;
