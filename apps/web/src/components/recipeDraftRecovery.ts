/**
 * Local recovery copy of the recipe editor's working draft.
 *
 * Why this exists: the Drive access token is memory-only (../auth/googleAuth),
 * so any reload or closed tab starts logged out. The editor keeps its draft in
 * component state, which means the same reload also drops unsaved work. A 401
 * used to make that worse: the only way back to a login was to leave the editor
 * and answer „Änderungen verwerfen?" — which threw the draft away. The editor
 * now stays mounted through a re-login (see RecipeEditor's session banner), and
 * this module covers the exits that no mounted component can cover: a reload,
 * a closed tab, a crashed browser, a dead phone.
 *
 * One slot, on purpose (decided with the user): only the recipe that was open
 * when the work was lost is offered back, not an archive of every draft the app
 * has ever seen. The visible editor level writes the slot; a sub-recipe above
 * it replaces the slot while it is visible, and the parent writes again when it
 * comes back. Saving, deleting or confirming „Verwerfen" clears the slot.
 *
 * The payload is recipe text the user typed — no credential is stored.
 * localStorage is deliberate: the copy must survive a reload and a tab close,
 * which sessionStorage does not. Writing is best-effort: a full, disabled or
 * unavailable storage must never break editing.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md); this module carries no
 * copy except the timestamp the recovery sheet shows.
 */

import type { EditorDraft } from './recipeDrafts';

/** localStorage key of the single recovery slot. */
const STORAGE_KEY = 'cookbook.editorDraft.v1';

/** Shape version of the stored record; an incompatible change bumps the key. */
const RECORD_VERSION = 1;

/**
 * How long an unwritten draft stays recoverable. Thirty days outlives any
 * realistic interruption while still clearing out a draft that was forgotten
 * on a device for a long time.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** One local recovery copy, as stored in localStorage. */
export interface RecoverableDraft {
  /** The record shape version (see RECORD_VERSION). */
  version: typeof RECORD_VERSION;
  /** The Drive file being edited, or null for a new recipe. */
  targetFileId: string | null;
  /**
   * A file already created by a failed save of a new recipe. Restoring it makes
   * the next save update that file instead of creating a duplicate.
   */
  createdFileId: string | null;
  /** The in-memory editor draft at the moment of the write. */
  draft: EditorDraft;
  /** Epoch milliseconds of the last write. */
  savedAt: number;
}

/** A record ready to be written; the version is added by {@link writeRecoverableDraft}. */
export type RecoverableDraftInput = Omit<RecoverableDraft, 'version'>;

/** True when a parsed value has the fields the editor needs to render it. */
function isEditorDraft(value: unknown): value is EditorDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<EditorDraft>;
  return (
    typeof draft.title === 'string' &&
    (draft.type === 'finished_dish' || draft.type === 'ingredient_recipe') &&
    typeof draft.prep_time === 'string' &&
    Array.isArray(draft.steps)
  );
}

/** Parses one stored record, returning null for anything unusable. */
function parseRecord(raw: string): RecoverableDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== RECORD_VERSION) return null;

  const targetFileId =
    record.targetFileId === null
      ? null
      : typeof record.targetFileId === 'string'
        ? record.targetFileId
        : undefined;
  const createdFileId =
    record.createdFileId === null
      ? null
      : typeof record.createdFileId === 'string'
        ? record.createdFileId
        : undefined;
  if (targetFileId === undefined || createdFileId === undefined) return null;
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return null;
  if (!isEditorDraft(record.draft)) return null;

  return {
    version: RECORD_VERSION,
    targetFileId,
    createdFileId,
    draft: record.draft,
    savedAt: record.savedAt,
  };
}

/**
 * Reads the recovery copy, or null when there is none. An unreadable or expired
 * record is removed instead of being offered back.
 */
export function readRecoverableDraft(now = Date.now()): RecoverableDraft | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const record = parseRecord(raw);
  if (record === null || now - record.savedAt > MAX_AGE_MS) {
    clearRecoverableDraft();
    return null;
  }
  return record;
}

/**
 * Overwrites the recovery slot. Called by the editor's debounced autosave and
 * its pagehide/visibility flush; failures (quota, privacy mode) are swallowed.
 */
export function writeRecoverableDraft(record: RecoverableDraftInput): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...record, version: RECORD_VERSION } satisfies RecoverableDraft),
    );
  } catch {
    // Best effort. The editor stays usable without a recovery copy.
  }
}

/**
 * Removes the recovery slot.
 *
 * Called without an argument it clears unconditionally (a corrupt or expired
 * record). With a target it only clears the slot when it belongs to that recipe:
 * a sub-recipe level that is discarded must not delete the recovery copy of a
 * different level, and a hidden parent must not delete the visible child's.
 */
export function clearRecoverableDraft(targetFileId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (targetFileId === undefined) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const record = parseRecord(raw);
    if (record === null || record.targetFileId === targetFileId) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Best effort, like the write.
  }
}

/** True when the record belongs to the editor target being opened. */
export function recoverableDraftMatchesTarget(
  record: RecoverableDraft,
  targetFileId: string | null,
): boolean {
  return record.targetFileId === targetFileId;
}

/** Date formatter for the recovery sheet's "zuletzt bearbeitet am …" line. */
const SAVED_AT_FORMAT = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Formats a record's timestamp for the German UI. */
export function formatRecoverableDraftTime(savedAt: number): string {
  return SAVED_AT_FORMAT.format(new Date(savedAt));
}
