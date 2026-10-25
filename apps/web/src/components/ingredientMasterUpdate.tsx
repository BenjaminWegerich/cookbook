/**
 * Persisting one ingredient master-data edit together with the shopping item of
 * the same name.
 *
 * An ingredient and its shopping item are two views of one name: the ingredient
 * carries the base unit, precision, stock and mappings; the item carries the
 * store/section and synonyms. The shared master-data sheet edits both, so both
 * screens that open it — the „Zutaten“ place and a recipe's „Zutatenzeile“ —
 * must persist them the same way. This module is that one write path.
 *
 * The write is transactional in the practical sense: the two file pairs are
 * independent, so the ingredient is written first and rolled back when the
 * shopping write fails, leaving the form on screen consistent with the files.
 * On success the notice offers „Rückgängig“, which restores the ingredient and
 * the item state captured here.
 *
 * The module is framework-free apart from the snackbar icon it contributes: the
 * callers own their busy/error state, so a screen can guard its own Back/Escape
 * while the write runs.
 */

import {
  allShoppingItems,
  mappingsFor,
  shoppingNameKey,
  shoppingVariantsFor,
  type IngredientEntry,
  type ShoppingStop,
} from '@cookbook/core';

import {
  updateIngredientMasterData,
  type IngredientMasterEntryInput,
} from '../drive/ingredientMasterData';
import {
  createShoppingItem,
  deleteShoppingItem,
  restoreShoppingItem,
  saveShoppingItem,
  type ShoppingItemState,
} from '../drive/shoppingRouteMasterData';
import type { SnackbarMessage } from '../hooks/useSnackbar';
import { UndoIcon } from './icons';

/** The ingredient fields plus the shopping data one save must persist. */
export interface IngredientMasterSheetUpdate {
  /** The ingredient's own editable fields. */
  readonly update: IngredientMasterEntryInput;
  /** The chosen shopping stop, or null for an ingredient that is not bought. */
  readonly stop: ShoppingStop | null;
  /** The item's complete synonym list. */
  readonly variants: readonly string[];
}

/** True when the ingredient fields equal the entry as the registry holds it. */
export function isIngredientUnchanged(
  entry: IngredientEntry,
  update: IngredientMasterEntryInput,
): boolean {
  if ((entry.singular ?? null) !== update.singular) return false;
  if ((entry.plural ?? null) !== update.plural) return false;
  if (entry.reorderPoint !== update.reorderPoint) return false;
  if (entry.precision !== update.precision) return false;
  if (entry.entries.length !== update.entries.length) return false;
  return entry.entries.every((mapping, index) => {
    const next = update.entries[index];
    return next !== undefined && mapping.au === next.au && mapping.factor === next.factor;
  });
}

/** The entry as the edit write expects it — the undo's inverse input. */
export function toIngredientInput(entry: IngredientEntry): IngredientMasterEntryInput {
  return {
    singular: entry.singular ?? null,
    plural: entry.plural ?? null,
    reorderPoint: entry.reorderPoint,
    entries: entry.entries,
    precision: entry.precision,
  };
}

/** The stored item name a typed name points at, case-folded like the matching. */
export function findItemKey(name: string): string | undefined {
  const key = shoppingNameKey(name);
  return Object.keys(allShoppingItems()).find((candidate) => shoppingNameKey(candidate) === key);
}

/**
 * True when the shopping stop and synonym set equal the item as the registry
 * holds it. The synonym order carries no meaning, so set equality counts.
 */
export function isShoppingUnchanged(
  stop: ShoppingStop | null,
  variants: readonly string[],
  nextStop: ShoppingStop | null,
  nextVariants: readonly string[],
): boolean {
  if (stop === null || nextStop === null) {
    return stop === null && nextStop === null && nextVariants.length === 0;
  }
  if (stop.store !== nextStop.store || stop.section !== nextStop.section) return false;
  if (variants.length !== nextVariants.length) return false;
  return variants.every((variant) => nextVariants.includes(variant));
}

/** The reason of a failed undo part, as the snackbar reports it. */
function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Writes one shopping change and returns the previous state for the undo. A
 * missing item row is created; the caller has already validated that `stop` is
 * not null in that case.
 */
export async function writeShoppingChange(
  token: string,
  name: string,
  itemKey: string | undefined,
  stop: ShoppingStop | null,
  variants: readonly string[],
): Promise<{ previous: ShoppingItemState | null; created: boolean }> {
  if (itemKey !== undefined) {
    if (stop === null) {
      throw new Error('Einkaufsartikel: Der Einkaufsort darf nicht leer sein.');
    }
    const { previous } = await saveShoppingItem(token, itemKey, stop, variants);
    return { previous, created: false };
  }
  if (stop === null) {
    if (variants.length > 0) {
      throw new Error('Ohne Einkaufsort lassen sich keine Synonyme speichern.');
    }
    return { previous: null, created: false };
  }
  await createShoppingItem(token, name, stop, variants);
  return { previous: null, created: true };
}

/** What one caller provides: the Drive token, the notice host and a re-read hook. */
export interface IngredientMasterUpdateDeps {
  token: string;
  showSnackbar: (message: SnackbarMessage) => void;
  /** Called after a successful write and after an undo, so a registry reader re-renders. */
  onChanged?: () => void;
}

/**
 * Persists one ingredient edit and its shopping data. Returns false when the
 * form equals the registry (the caller then closes the sheet without a write or
 * a notice, DESIGN §5.1); throws a German error when a write fails, after
 * rolling back a half-applied ingredient write.
 */
export async function updateIngredientMasterAndShopping(
  { token, showSnackbar, onChanged }: IngredientMasterUpdateDeps,
  name: string,
  input: IngredientMasterSheetUpdate,
): Promise<boolean> {
  const current = mappingsFor(name);
  if (current === undefined) {
    throw new Error(`Die Zutat „${name}“ steht nicht in den Stammdaten.`);
  }
  const itemKey = findItemKey(name);
  const currentStop = itemKey === undefined ? null : allShoppingItems()[itemKey]!;
  const currentVariants = itemKey === undefined ? [] : shoppingVariantsFor(itemKey);
  const ingredientChanged = !isIngredientUnchanged(current, input.update);
  const shoppingChanged = !isShoppingUnchanged(
    currentStop,
    currentVariants,
    input.stop,
    input.variants,
  );

  if (!ingredientChanged && !shoppingChanged) return false;

  let previousIngredient: IngredientEntry | null = null;
  let previousItem: ShoppingItemState | null = null;
  let createdItem = false;
  try {
    if (ingredientChanged) {
      const result = await updateIngredientMasterData(token, name, input.update);
      previousIngredient = result.previous;
    }
    if (shoppingChanged) {
      const result = await writeShoppingChange(token, name, itemKey, input.stop, input.variants);
      previousItem = result.previous;
      createdItem = result.created;
    }
  } catch (err) {
    // The ingredient write may already have landed before the shopping write
    // failed. Put it back so the form the user still sees matches the files.
    if (previousIngredient !== null) {
      try {
        await updateIngredientMasterData(token, name, toIngredientInput(previousIngredient));
      } catch {
        // The save error is the actionable one; a failed rollback would only
        // replace it with a second, less actionable message.
      }
    }
    throw err;
  }

  onChanged?.();
  showSnackbar({
    text: `„${name}“ gespeichert.`,
    action: {
      label: 'Rückgängig',
      busyLabel: 'Wird rückgängig gemacht …',
      icon: <UndoIcon className="button-icon" optical={20} />,
      run: async (): Promise<void> => {
        const problems: string[] = [];
        if (previousIngredient !== null) {
          try {
            await updateIngredientMasterData(token, name, toIngredientInput(previousIngredient));
          } catch (err) {
            problems.push(reasonOf(err));
          }
        }
        try {
          if (createdItem) {
            await deleteShoppingItem(token, name);
          } else if (itemKey !== undefined && previousItem !== null) {
            await restoreShoppingItem(token, itemKey, previousItem);
          }
        } catch (err) {
          problems.push(reasonOf(err));
        }
        onChanged?.();
        if (problems.length > 0) {
          showSnackbar({
            tone: 'error',
            text: `„${name}“ konnte nicht zurückgesetzt werden. ${problems.join(' ')}`,
          });
        }
      },
    },
  });
  return true;
}
