/**
 * Saved, unfinished drafts in the Drive `Entwürfe` area (docs/storage_format.md
 * §11, docs/DESIGN.md §5.7).
 *
 * A draft is deliberately *not* a canonical recipe. The editor's working state
 * may miss mandatory fields, carry a duplicate title, or contain a step with
 * rows but no prose — exactly the states `parseRecipe`/`serializeRecipe` reject.
 * The draft payload therefore keeps the editor's fields losslessly as JSON, and
 * only a normal save validates it and creates a canonical recipe.
 *
 * One draft is one app-owned JSON file, named by an internal id
 * (`draft-<id>.json`) rather than by its title: a draft may be untitled, and two
 * drafts may share a title until one of them is finished. The optional photo
 * lives in `Bilder/<draft-id>.jpg` / `.png`, so the same id, not the title, is
 * the file identity until promotion.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md); this module carries the
 * few German fallback titles/errors it needs.
 */

import type { Recipe, Unit } from '@cookbook/core';

import type { EditorDraft } from '../components/recipeDrafts';
import { isEditorDraft } from '../components/recipeDrafts';
import { ensureCookbookArea, listCookbookFolder, type CookbookFolder } from './cookbookFolder';
import {
  createFileWithContent,
  deleteFile,
  getFile,
  getFileContent,
  isDriveAuthError,
  renameFile,
  updateFileWithContent,
  type DriveFile,
} from './driveClient';
import { invalidateRecipePhoto } from './recipePhoto';
import {
  createRecipe,
  deleteRecipe,
  writeRecipeExportSafely,
  type RecipeImage,
  type StoredRecipe,
} from './recipeStorage';

/** Extension and MIME type of a saved draft. */
const DRAFT_EXTENSION = '.json';
const DRAFT_MIME_TYPE = 'application/json';

/** Shape version of the draft payload; an incompatible change bumps it. */
const DRAFT_VERSION = 1;

/** Label a draft shows when its title is empty. */
export const UNTITLED_DRAFT_TITLE = 'Unbenannt';

/**
 * One saved draft record, as written to Drive.
 *
 * `draft` is the editor's `EditorDraft` (every field except the derived
 * `ingredients` list). The version and timestamp are storage metadata only.
 */
export interface DraftRecord {
  version: typeof DRAFT_VERSION;
  /** Epoch milliseconds of the last write. */
  savedAt: number;
  draft: EditorDraft;
}

/**
 * Parses one draft file. Throws a German error for anything unusable; callers
 * that list drafts catch it and keep the rest of the collection usable.
 */
export function parseDraftRecord(raw: string): DraftRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Der Entwurf konnte nicht gelesen werden (kein gültiges JSON).');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Der Entwurf konnte nicht gelesen werden (kein Entwurfs-Objekt).');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== DRAFT_VERSION) {
    throw new Error(`Der Entwurf hat eine unbekannte Version (${JSON.stringify(record.version)}).`);
  }
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) {
    throw new Error('Der Entwurf hat keinen gültigen Zeitstempel.');
  }
  if (!isEditorDraft(record.draft)) {
    throw new Error('Der Entwurf enthält keine gültigen Editor-Felder.');
  }
  return {
    version: DRAFT_VERSION,
    savedAt: record.savedAt,
    draft: record.draft,
  };
}

/** Serializes the working draft into the stored record shape. */
export function serializeDraftRecord(draft: EditorDraft, savedAt = Date.now()): string {
  const record: DraftRecord = { version: DRAFT_VERSION, savedAt, draft };
  return JSON.stringify(record);
}

/** Raw draft content, keyed by Drive file id (page-session cache). */
const draftContentCache = new Map<string, string>();

/** Drops the cached content of a draft after a write/delete. */
function invalidateDraftContent(fileId: string): void {
  draftContentCache.delete(fileId);
}

/** Reads and caches one draft file's raw content. */
async function readDraftContent(token: string, fileId: string): Promise<string> {
  const cached = draftContentCache.get(fileId);
  if (cached !== undefined) return cached;
  const content = await getFileContent(token, fileId);
  draftContentCache.set(fileId, content);
  return content;
}

/** Reads and parses one saved draft. */
export async function readDraft(token: string, fileId: string): Promise<DraftRecord> {
  return parseDraftRecord(await readDraftContent(token, fileId));
}

/** The app-generated file base of a new draft. */
function newDraftId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `draft-${random}`;
}

/** The basename of a draft file, without its `.json` extension. */
function draftBaseFromFileName(name: string): string {
  return name.toLowerCase().endsWith(DRAFT_EXTENSION)
    ? name.slice(0, -DRAFT_EXTENSION.length)
    : name.replace(/\.[^.]*$/, '');
}

/** Finds a photo sibling for one basename in the `Bilder` listing. */
function findPhotoIn(files: readonly DriveFile[], base: string): RecipeImage | undefined {
  for (const extension of ['jpg', 'png'] as const) {
    const fileName = `${base}.${extension}`;
    const match = files.find((file) => file.name.toLowerCase() === fileName.toLowerCase());
    if (match !== undefined) {
      return { fileId: match.id, extension };
    }
  }
  return undefined;
}

/** The display title of a draft: its own title, or the German fallback. */
export function draftDisplayTitle(draft: EditorDraft): string {
  const trimmed = draft.title.trim();
  return trimmed === '' ? UNTITLED_DRAFT_TITLE : trimmed;
}

/** The base-unit family an ingredient recipe's yield resolves to. */
function draftYieldUnit(draft: EditorDraft): 'g' | 'ml' | undefined {
  if (draft.type !== 'ingredient_recipe') return undefined;
  return draft.yield_unit === 'ml' || draft.yield_unit === 'l' ? 'ml' : 'g';
}

/**
 * Lists every saved draft in the collection as a `StoredRecipe` with
 * `status: 'draft'`. A malformed draft is logged and skipped, exactly like a
 * broken canonical file stays visible but unreadable; one bad file must never
 * hide the rest.
 *
 * The snapshot can be passed in when a caller already listed the collection
 * (the startup load does), so the `Entwürfe` folder is not listed twice.
 */
export async function listDrafts(token: string, folder?: CookbookFolder): Promise<StoredRecipe[]> {
  const snapshot = folder ?? (await listCookbookFolder(token));
  const files = snapshot.drafts.files;

  const imagesByBase = new Map<string, RecipeImage>();
  for (const file of snapshot.images.files) {
    for (const extension of ['jpg', 'png'] as const) {
      const suffix = `.${extension}`;
      if (file.name.toLowerCase().endsWith(suffix)) {
        const base = file.name.slice(0, -suffix.length);
        if (!imagesByBase.has(base)) {
          imagesByBase.set(base, { fileId: file.id, extension });
        }
        break;
      }
    }
  }

  const drafts: StoredRecipe[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(DRAFT_EXTENSION)) continue;
    try {
      const record = await readDraft(token, file.id);
      const draft = record.draft;
      const base = draftBaseFromFileName(file.name);
      const image = imagesByBase.get(base);
      const yieldUnit = draftYieldUnit(draft);
      drafts.push({
        fileId: file.id,
        title: draftDisplayTitle(draft),
        type: draft.type,
        status: 'draft',
        ...(image !== undefined ? { image } : {}),
        ...(yieldUnit !== undefined ? { yieldUnit } : {}),
      });
    } catch (error) {
      if (isDriveAuthError(error)) throw error;
      console.warn(
        `Der Entwurf "${file.name}" konnte nicht gelesen werden und wird übersprungen: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  drafts.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return drafts;
}

/**
 * Creates a new draft file (the `Entwürfe` folder is created on first use).
 * The caller keeps the returned id so a failed photo upload can be retried as
 * an update instead of creating a second draft.
 */
export async function createDraft(token: string, draft: EditorDraft): Promise<DriveFile> {
  const folderId = await ensureCookbookArea(token, 'drafts');
  const content = serializeDraftRecord(draft);
  const file = await createFileWithContent(token, {
    name: `${newDraftId()}${DRAFT_EXTENSION}`,
    mimeType: DRAFT_MIME_TYPE,
    content,
    parents: [folderId],
  });
  draftContentCache.set(file.id, content);
  return file;
}

/** Overwrites an existing draft file with the current working draft. */
export async function updateDraft(
  token: string,
  fileId: string,
  draft: EditorDraft,
): Promise<DriveFile> {
  const current = await getFile(token, fileId);
  const content = serializeDraftRecord(draft);
  const file = await updateFileWithContent(token, fileId, {
    name: current.name,
    mimeType: DRAFT_MIME_TYPE,
    content,
  });
  draftContentCache.set(fileId, content);
  return file;
}

/**
 * Deletes one draft: its JSON file first (the unit's success), then its photo
 * sibling best-effort. A missing photo is not an error.
 */
export async function deleteDraft(token: string, fileId: string): Promise<void> {
  const folder = await listCookbookFolder(token);
  const file = await getFile(token, fileId);
  const photo = findPhotoIn(folder.images.files, draftBaseFromFileName(file.name));

  await deleteFile(token, fileId);
  invalidateDraftContent(fileId);
  if (photo !== undefined) {
    invalidateRecipePhoto(photo.fileId);
    try {
      await deleteFile(token, photo.fileId);
    } catch (error) {
      console.warn(
        `Das Bild des Entwurfs "${file.name}" konnte nicht gelöscht werden: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** The result of promoting a draft into the canonical collection. */
export interface PromoteDraftResult {
  /** The newly created canonical recipe file. */
  file: DriveFile;
  /**
   * False when the recipe was written but its draft file could not be deleted;
   * the caller should report the leftover instead of pretending it is gone.
   */
  draftDeleted: boolean;
}

/**
 * Turns a validated draft into a canonical recipe:
 *
 * 1. create the recipe file in `Rezepte/` (master-data registration included),
 * 2. rename the draft photo from `<draft-id>.<ext>` to `<title>.<ext>`,
 * 3. regenerate the export so it embeds the renamed photo,
 * 4. delete the draft JSON.
 *
 * The draft is only deleted after the recipe exists. If the recipe write or the
 * photo rename fails, the newly created recipe is removed again and the draft
 * stays untouched, so "Fertig speichern" never leaves a half-promoted unit.
 * A failure of step 4 is reported through `draftDeleted: false`; the saved
 * recipe is valid and must not be rolled back for a leftover draft.
 */
export async function promoteDraft(
  token: string,
  draftFileId: string,
  recipe: Recipe,
): Promise<PromoteDraftResult> {
  const folder = await listCookbookFolder(token);
  const draftFile = await getFile(token, draftFileId);
  const photo = findPhotoIn(folder.images.files, draftBaseFromFileName(draftFile.name));

  const created = await createRecipe(token, recipe, { regenerateExport: false });
  try {
    if (photo !== undefined) {
      await renameFile(token, photo.fileId, `${recipe.title}.${photo.extension}`);
    }
  } catch (error) {
    // The recipe file exists but the photo could not follow it. Remove the new
    // recipe again; the draft and its photo stay where they were. `deleteRecipe`
    // also drops the cached content of the file it removes.
    try {
      await deleteRecipe(token, created.id);
    } catch (cleanupError) {
      console.warn(
        `Das gerade angelegte Rezept "${recipe.title}" konnte nach dem fehlgeschlagenen Bild-Umbenennen nicht entfernt werden: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
    throw error;
  }

  // Best effort: the recipe file is the source of truth, so a failed export is
  // retried on the next save and must not undo the promotion.
  await writeRecipeExportSafely(token, recipe);

  let draftDeleted = true;
  try {
    await deleteFile(token, draftFileId);
    invalidateDraftContent(draftFileId);
  } catch (error) {
    draftDeleted = false;
    console.warn(
      `Der Entwurf "${draftFile.name}" konnte nach dem Speichern des Rezepts nicht gelöscht werden: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { file: created, draftDeleted };
}

/**
 * Reads a draft's details as the editor's field shape, for the AI-edit screen
 * and the overview. Kept next to `readDraft` so a caller cannot accidentally
 * run the canonical parser over a draft.
 */
export async function readDraftFields(token: string, fileId: string): Promise<EditorDraft> {
  return (await readDraft(token, fileId)).draft;
}

/**
 * A draft's fields as a plain-text block for the AI-edit prompt. Unlike
 * `serializeRecipe`, this tolerates missing fields and row-only steps: the AI
 * is told that the input is an unfinished draft and must fill only what is
 * needed to return a complete recipe.
 */
export function draftToEditText(draft: EditorDraft): string {
  const lines: string[] = ['# Unfertiger Entwurf', ''];
  lines.push(`Titel: ${draft.title.trim() === '' ? '(noch keiner)' : draft.title.trim()}`);
  lines.push(`Typ: ${draft.type === 'finished_dish' ? 'Gericht' : 'Zutaten-Rezept'}`);
  if (draft.description !== undefined && draft.description.trim() !== '') {
    lines.push(`Beschreibung: ${draft.description.trim()}`);
  }
  lines.push(
    `Arbeitszeit: ${draft.prep_time.trim() === '' ? '(noch keine)' : draft.prep_time.trim()}`,
  );
  if (draft.total_time !== undefined && draft.total_time.trim() !== '') {
    lines.push(`Gesamtzeit: ${draft.total_time.trim()}`);
  }
  if (draft.type === 'finished_dish') {
    lines.push(`Portionen: ${draft.servings === undefined ? '(noch keine)' : draft.servings}`);
  } else {
    const yieldText =
      draft.yield === undefined ? '(noch keine)' : `${draft.yield} ${draft.yield_unit ?? 'g'}`;
    lines.push(`Ergiebigkeit: ${yieldText}`);
  }
  if (draft.reference !== undefined && draft.reference.length > 0) {
    lines.push(`Referenz-Zutaten: ${draft.reference.join(', ')}`);
  }
  if (draft.theme !== undefined && Object.keys(draft.theme).length > 0) {
    lines.push(`Design: ${JSON.stringify(draft.theme)}`);
  }

  lines.push('', '## Schritte und Zutaten', '');
  if (draft.steps.length === 0) {
    lines.push('(noch keine Schritte)');
  } else {
    draft.steps.forEach((step, index) => {
      lines.push(`Schritt ${index + 1}:`);
      if (step.ingredients.length === 0) {
        lines.push('- (keine Zutatenzeilen)');
      } else {
        for (const ingredient of step.ingredients) {
          const unit: Unit = ingredient.unit;
          lines.push(`- ${ingredient.quantity} ${unit} ${ingredient.name}`);
        }
      }
      lines.push(`Text: ${step.text.trim() === '' ? '(noch kein Text)' : step.text.trim()}`);
      lines.push('');
    });
  }

  lines.push(
    '',
    'Dieser Entwurf ist absichtlich unvollständig. Übernimm alle vorhandenen Angaben,',
    'ergänze nur die fehlenden Pflichtfelder und liefere eine vollständige, gültige',
    'Rezeptdatei im kanonischen Format zurück.',
  );
  return lines.join('\n');
}
