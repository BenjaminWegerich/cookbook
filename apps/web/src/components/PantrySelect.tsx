/**
 * Pantry sheet — the full-screen page "Vorräte auswählen" behind the selection
 * page's forward button (App's `pantry` layer).
 *
 * It is the second half of the bundled shopping write. The previous page chose
 * *which dishes* are shopped for; this one decides *what is already at home*,
 * per ingredient: every row shows what all the selected dishes need together,
 * a stepper for the stock ("Vorrat"), and the amount that is therefore left to
 * buy ("Einkaufen"). Only that difference reaches the shopping list.
 *
 * The rows come from `../keep/shoppingBundle` (one read per selected recipe),
 * the arithmetic from `@cookbook/core` (`shoppingRow`, `steppedStock`):
 *
 * - the Vorrat starts on `min(need, reorder point)` — the reorder point is the
 *   amount the master data says is on the shelf after a shopping trip;
 * - "Einkaufen" is the need minus the Vorrat, rounded **up** to whole shopping
 *   units (or to whole grams/millilitres without one), so the list never buys
 *   less than the dishes need;
 * - the rows are filed once, when the page opens: the ingredients the pre-filled
 *   Vorrat already covers go below the ones that still need a purchase. That
 *   filing is a snapshot — a stepper updates its row's amounts in place instead
 *   of moving it under the user's finger (decided with the user after trying the
 *   live split) — while the amounts and the write always follow the *current*
 *   Vorrat: a row the user fills up shows a dash and is not written, wherever it
 *   stands.
 *
 * "Einkaufsliste schreiben" writes one line per row that currently has something
 * to buy, exactly as displayed, through App (which owns the Keep write, the
 * closing of the flow and the success notice with its undo). A failure is shown
 * next to the button and leaves the page as it is, so the work is not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { shoppingRow, stockPrefill, type ShoppingRow } from '@cookbook/core';

import { resolveShoppingBundle, type ShoppingBundle } from '../keep/shoppingBundle';
import type { MealPlanCard } from '../keep/mealPlanCards';
import StockStepper from './StockStepper';

interface PantrySelectProps {
  /**
   * The dishes the previous page selected (the recognized meal-plan cards, in
   * Keep's order). Fixed for the page's lifetime: this is the bundle the user
   * confirmed there, not a live view of the plan.
   */
  cards: readonly MealPlanCard[];
  /** Drive access token, needed to read the selected recipes' ingredient lists. */
  token: string;
  /** Leaves the page for the selection page (header "Zurück", browser Back). */
  onBack: () => void;
  /**
   * Writes the given lines to the Keep shopping list and closes the whole flow.
   * Resolves on success; a failure is thrown and shown next to the button (the
   * page stays open, so the chosen stocks are not lost).
   */
  onWrite: (lines: readonly string[], recipes: number) => Promise<void>;
}

/** One row's identity: the ingredient name plus the unit it is needed in. */
function rowKey(ingredient: string, baseUnit: string): string {
  return `${ingredient}\u0000${baseUnit}`;
}

/**
 * The pantry page (see the file header). It owns nothing but the chosen stocks:
 * the bundle, the Keep write and the flow belong to App.
 */
function PantrySelect({ cards, token, onBack, onWrite }: PantrySelectProps) {
  /** The ingredient needs of the selected dishes, or null while they load. */
  const [bundle, setBundle] = useState<ShoppingBundle | null>(null);
  /** Why the bundle could not be built (a recipe file was unreadable). */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * The stocks the user picked, keyed by row. Only *changed* rows are stored: a
   * row without an entry shows its pre-filled Vorrat, so a bundle that arrives
   * late (or again) is never shadowed by a stale default.
   */
  const [stocks, setStocks] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** True while the write runs — the button is unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the button (null = no failure). */
  const [writeError, setWriteError] = useState<string | null>(null);

  // Load the bundle once the page is open. `cards` and `token` are fixed for its
  // lifetime (App sets the cards before opening the page and the page unmounts
  // when the flow leaves), so there is no state to reset here — only the result
  // of the request. State is updated in the promise callbacks, never
  // synchronously, so the "no state update in an effect" rule stays satisfied.
  useEffect(() => {
    let cancelled = false;
    void resolveShoppingBundle(cards, token)
      .then((resolved) => {
        if (!cancelled) setBundle(resolved);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cards, token]);

  /**
   * The rows in the order they keep for the page's lifetime: first the
   * ingredients whose *pre-filled* Vorrat does not cover the need, then the ones
   * it does (decided with the user: the filing is a snapshot, so no row moves
   * while a stepper is being used). Only the pre-fill decides that — it depends
   * on the need and the reorder point, never on the chosen stock — so the order
   * is stable across renders.
   */
  const orderedNeeds =
    bundle === null
      ? []
      : [
          ...bundle.needs.filter((need) => stockPrefill(need) < need.needed),
          ...bundle.needs.filter((need) => stockPrefill(need) >= need.needed),
        ];

  /** The rows with the amounts of the *current* Vorrat (see above). */
  const rows: ShoppingRow[] = orderedNeeds.map((need) => {
    const chosen = stocks.get(rowKey(need.ingredient, need.baseUnit));
    return shoppingRow(need, chosen === undefined ? stockPrefill(need) : chosen);
  });

  /**
   * The rows that currently have something to buy — the write's content, in the
   * list's own order. A row can join or leave this set while its stepper is used
   * without changing its place in the list.
   */
  const toBuy = rows.filter((row) => !row.covered);

  /** Remembers one stepper's new stock. */
  function setStock(row: ShoppingRow, next: number): void {
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(rowKey(row.ingredient, row.baseUnit), next);
      return updated;
    });
  }

  /**
   * Writes every row that currently has something to buy. The lines are exactly
   * what those rows display, in the list's order; the count of dishes rides
   * along for the success notice. A covered row's `text` is null by definition;
   * the filter states that for the type checker instead of writing a possible
   * empty line.
   */
  async function handleWrite(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    const lines = toBuy.map((row) => row.text).filter((text): text is string => text !== null);
    try {
      await onWrite(lines, bundle?.recipes ?? 0);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /** One ingredient row: name, Vorrat stepper, and the amount left to buy. */
  function renderRow(row: ShoppingRow): ReactNode {
    return (
      <div className="pantry-row" key={rowKey(row.ingredient, row.baseUnit)}>
        {/* The name and the amount sit in cells of their own: the wide layout
            stretches every cell over the row's height, so their content is
            centered inside the cell (see styles/pantry-select.css). */}
        <span className="pantry-name-cell">
          <span className="pantry-name">{row.ingredient}</span>
        </span>
        <StockStepper
          value={row.stock}
          needed={row.needed}
          baseUnit={row.baseUnit}
          onChange={(next) => setStock(row, next)}
          label={`Vorrat für ${row.ingredient}`}
        />
        {/* A covered row has nothing to buy: the dash says so where the amount
            would stand. It is a read-only field, not an input — the value is
            derived, never typed (the "Vorschau" look of the create-ingredient
            sheet). */}
        <span className="pantry-buy-cell">
          <span className={row.covered ? 'pantry-buy pantry-buy-empty' : 'pantry-buy'}>
            {row.covered ? '—' : row.text}
          </span>
        </span>
      </div>
    );
  }

  /** The list, or the state the bundle is in instead. */
  function renderList(): ReactNode {
    if (loadError !== null) {
      return (
        <p className="pantry-load-error" role="alert">
          Die Zutaten konnten nicht geladen werden. {loadError}
        </p>
      );
    }
    if (bundle === null) {
      return (
        <p className="loading-message" role="status">
          Zutaten werden geladen …
        </p>
      );
    }
    if (rows.length === 0) {
      return (
        <p className="pantry-empty" role="status">
          Die ausgewählten Gerichte haben keine Zutaten.
        </p>
      );
    }
    return (
      <div className="pantry-table" role="group" aria-label="Zutaten und Vorräte">
        <div className="pantry-head" aria-hidden="true">
          <span className="pantry-head-name">Zutat</span>
          <span className="pantry-head-stock">Vorrat</span>
          <span className="pantry-head-buy">Einkaufen</span>
        </div>
        {/* One list: the two parts the rows were filed into at the start (the
            ones to buy first) are not separated by a rule — the "Einkaufen"
            column already says which row currently needs something (decided with
            the user). */}
        {rows.map(renderRow)}
      </div>
    );
  }

  const canWrite = toBuy.length > 0 && !busy;

  return (
    <main className="app pantry-select">
      {/* "Zurück" on its own line at the top left, the screen title below it —
          the shared stacked header (.app-header-stacked). */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button" onClick={onBack}>
          Zurück
        </button>
        <h1>Vorräte auswählen</h1>
      </header>

      <p className="pantry-select-intro">
        Je Zutat die vorhandene Menge auswählen – nur die Differenz zur benötigten Menge wird auf
        die Einkaufsliste gesetzt.
      </p>

      {renderList()}

      {/* The forward action of this step: it writes the upper part to Keep and
          leaves for the home screen. Accent, content width, right-aligned — the
          same arrangement the previous page's forward button uses. It only
          exists while there is something to buy: with every ingredient covered,
          the write would add nothing (and the gateway refuses an empty write). */}
      {rows.length > 0 && (
        <div className="pantry-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleWrite()}
            disabled={!canWrite}
            aria-busy={busy}
          >
            {busy ? 'Wird geschrieben …' : 'Einkaufsliste schreiben'}
          </button>
          {(writeError !== null || (toBuy.length === 0 && !busy)) && (
            <p
              className={writeError !== null ? 'pantry-action-error' : 'pantry-action-note'}
              role={writeError !== null ? 'alert' : 'status'}
            >
              {writeError ?? 'Nichts zu kaufen – alle Zutaten sind im Vorrat.'}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

export default PantrySelect;
