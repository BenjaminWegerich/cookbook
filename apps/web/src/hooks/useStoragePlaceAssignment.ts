/**
 * The „Lagerort“ decisions of the two pantry steps, as one shared piece of
 * state.
 *
 * Both pantry pages („Teil 1: Zutaten-Rezepte“ and „Teil 2: Zutaten“) ask the
 * same question for an ingredient that has no kitchen storage place yet: pick
 * one, or tap „Ignorieren“. The assignment is **master data**, so it is written
 * immediately through the ingredient write path (not with the shopping list and
 * not with the cooking decisions); ignoring writes nothing and is remembered for
 * this page visit only, so the same ingredient is asked about again next time.
 *
 * The hook is shared so the two pages cannot drift: the same per-ingredient
 * busy/error state, the same write, the same clear-on-assign rule. The pages own
 * only what a successful assignment means for their rows (the row may collapse
 * once its stock is confirmed too — see the pages).
 */

import { useCallback, useRef, useState } from 'react';

import { STORAGE_PLACES } from '@cookbook/core';

import { updateIngredientStoragePlace } from '../drive/ingredientMasterData';

/** The hook's state and actions, one instance per page. */
export interface StoragePlaceAssignment {
  /** Ingredients whose assignment write is running (chips are disabled). */
  readonly saving: ReadonlySet<string>;
  /** The German reason of a failed assignment, per ingredient. */
  readonly errors: ReadonlyMap<string, string>;
  /** Ingredients the user chose to skip for this visit (no master-data write). */
  readonly ignored: ReadonlySet<string>;
  /**
   * Writes one place and reports whether it succeeded. On success the
   * ingredient leaves the ignored set and the runtime registry holds the place,
   * so the page's next render reads it through `storagePlaceOf`.
   */
  assign: (ingredient: string, place: string) => Promise<boolean>;
  /** Toggles the visit-only „Ignorieren“ state of one ingredient. */
  toggleIgnore: (ingredient: string) => void;
}

/**
 * Creates the assignment state of one pantry page. The caller must keep the
 * returned object for the page's lifetime (it is not a cache; the state lives
 * here).
 */
export function useStoragePlaceAssignment(token: string): StoragePlaceAssignment {
  /** Ingredients with a running write. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  /** Last write error per ingredient; cleared on the next attempt. */
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Ingredients skipped for this visit (never written). */
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The tail of the assignment write queue. Two quick taps on different rows
   * would otherwise read the same `zutaten.csv` and overwrite each other's
   * place; chaining keeps every write on the file it follows. The queue only
   * serializes this page's assignments — other master-data writes go through
   * their own read-before-write paths.
   */
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const assign = useCallback(
    async (ingredient: string, place: string): Promise<boolean> => {
      if (!STORAGE_PLACES.includes(place)) {
        setErrors((current) => new Map(current).set(ingredient, 'Unbekannter Lagerort.'));
        return false;
      }
      setSaving((current) => new Set(current).add(ingredient));
      setErrors((current) => {
        if (!current.has(ingredient)) return current;
        const updated = new Map(current);
        updated.delete(ingredient);
        return updated;
      });
      let ok = false;
      /** The actual write; runs only after the queued predecessor finished. */
      const run = async (): Promise<void> => {
        try {
          if (token === '') {
            throw new Error(
              'Nicht mit Google Drive verbunden — der Lagerort kann nicht gespeichert werden.',
            );
          }
          await updateIngredientStoragePlace(token, ingredient, place);
          // A real place wins over the visit-only skip.
          setIgnored((current) => {
            if (!current.has(ingredient)) return current;
            const updated = new Set(current);
            updated.delete(ingredient);
            return updated;
          });
          ok = true;
        } catch (err) {
          setErrors((current) =>
            new Map(current).set(ingredient, err instanceof Error ? err.message : String(err)),
          );
        } finally {
          setSaving((current) => {
            const updated = new Set(current);
            updated.delete(ingredient);
            return updated;
          });
        }
      };
      // `then(run, run)` starts this write even when the previous one failed —
      // `run` catches its own errors, so the chain itself never rejects.
      const next = queueRef.current.then(run, run);
      queueRef.current = next;
      await next;
      return ok;
    },
    [token],
  );

  const toggleIgnore = useCallback(
    (ingredient: string): void => {
      // A running write owns the row; its chips and this action are disabled in
      // the UI, and this guard keeps a stale click from flipping the state.
      if (saving.has(ingredient)) return;
      // The skip is a valid answer to a failed assignment, so its old error must
      // not stay next to the pressed state.
      setErrors((current) => {
        if (!current.has(ingredient)) return current;
        const updated = new Map(current);
        updated.delete(ingredient);
        return updated;
      });
      setIgnored((current) => {
        const updated = new Set(current);
        if (updated.has(ingredient)) {
          updated.delete(ingredient);
        } else {
          updated.add(ingredient);
        }
        return updated;
      });
    },
    [saving],
  );

  return { saving, errors, ignored, assign, toggleIgnore };
}
