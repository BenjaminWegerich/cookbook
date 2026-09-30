/**
 * Pantry sheet — the full-screen page "Vorräte auswählen" behind the selection
 * page's forward button (App's `pantry` layer).
 *
 * It is the second half of the bundled shopping write. The previous page chose
 * *which dishes* are shopped for; this one decides *what is already at home*,
 * per ingredient. The rows come from `../keep/shoppingBundle` (one read per
 * selected recipe), the arithmetic from `@cookbook/core` (`shoppingRow`,
 * `stockPrefill`):
 *
 * - the Vorrat starts on `min(need, reorder point)` — the reorder point is the
 *   amount the master data says is on the shelf after a shopping trip;
 * - the amount going on the list is the need minus the Vorrat, rounded **up** to
 *   whole shopping units (or to whole grams/millilitres without one), so the list
 *   never buys less than the dishes need;
 * - the rows are filed once, when the page opens: the ingredients the pre-filled
 *   Vorrat already covers go below the ones that still need a purchase. That
 *   filing is a snapshot — the slider updates its row's amounts in place instead
 *   of moving it under the user's finger (decided with the user after trying the
 *   live split) — while the amounts and the write always follow the *current*
 *   Vorrat: a row the user fills up shows a dash and is not written, wherever it
 *   stands.
 *
 * **One ingredient is three lines, each introduced by the symbol for what it
 * says** (decided with the user; the sheet's intro paragraph names the symbols):
 *
 * 1. the *recipe book*: what the selected dishes need together ("2 Becher Joghurt
 *    (600 g)", core's `needText`);
 * 2. the *shelves*: the stock picker, as described below;
 * 3. the *shopping list*: the line that will be written to Keep, word for word,
 *    including the ingredient name ("1 Packung Mehl (1 kg)") — decided with the
 *    user, so the row shows the exact wording the list will carry — or a dash
 *    when nothing is to buy. It is plain text like the other two lines, not a
 *    boxed field (decided with the user).
 *
 * **The picker is one discrete slider per row** (decided with the user): its
 * stops are exactly the stock values at which the bought amount changes (core's
 * `stockPool`), and it places them at equal distances rather than by their
 * amounts, so the 200 g step between "two packs" and "one pack" is as easy to
 * hit as the 1000 g step from there to "nothing to buy". Next to the slider
 * stand the chosen amount in the family base unit ("1,2 kg") and — where the
 * master data gives the ingredient a shopping unit — its whole count in that
 * unit ("2 Stück"), each a field of its own that opens a keyboard for a typed
 * amount (components/StockSlider). A typed amount need not be a stop; the thumb
 * then marks the bucket it falls in while the fields keep the exact number.
 *
 * A stop's amount means "at least this much is in the pantry" — the intro says
 * so — which is why neither the ticks nor the fields carry a comparison sign.
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

import {
  needText,
  shoppingRow,
  shoppingUnitOf,
  stockCountText,
  stockPool,
  stockPrefill,
  type AdditionalUnit,
  type ShoppingNeed,
  type ShoppingRow,
} from '@cookbook/core';

import { resolveShoppingBundle, type ShoppingBundle } from '../keep/shoppingBundle';
import type { MealPlanCard } from '../keep/mealPlanCards';
import { ListPlusIcon, MenuBookIcon, ShelvesIcon } from './icons';
import StockSlider from './StockSlider';

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
 * One rendered row: what the ingredient needs, the amount its current stock
 * leaves to buy, the stops its slider snaps to and the shopping unit its count
 * field reads.
 */
interface PantryEntry {
  readonly need: ShoppingNeed;
  readonly row: ShoppingRow;
  /** The slider's stops: every stock value that changes the bought amount. */
  readonly stops: readonly number[];
  /** The ingredient's shopping unit, or null when the master data gives none. */
  readonly unit: { au: AdditionalUnit; factor: number } | null;
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
   * while its slider is being used). Only the pre-fill decides that — it depends
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

  /**
   * The rows with the amounts of the *current* Vorrat (see above), each with the
   * stops its slider snaps to and the shopping unit its count field reads. Built
   * from the needs rather than from the rows, because the stops need the need
   * the row was derived from.
   */
  const entries: PantryEntry[] = orderedNeeds.map((need) => {
    const chosen = stocks.get(rowKey(need.ingredient, need.baseUnit));
    return {
      need,
      row: shoppingRow(need, chosen === undefined ? stockPrefill(need) : chosen),
      stops: stockPool(need),
      unit: shoppingUnitOf(need),
    };
  });

  /**
   * The rows that currently have something to buy — the write's content, in the
   * list's own order. A row can join or leave this set while its slider is used
   * without changing its place in the list.
   */
  const toBuy = entries.map((entry) => entry.row).filter((row) => !row.covered);

  /** Remembers one row's new stock. */
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

  /** One ingredient row: its need, its stock picker and the line it puts on the
   *  shopping list, each on a line of its own with the symbol for what the line
   *  says (see the file header). */
  function renderRow(entry: PantryEntry): ReactNode {
    const { need, row, stops, unit } = entry;
    return (
      <div className="pantry-row" key={rowKey(row.ingredient, row.baseUnit)}>
        {/* What the selected dishes need together, in the ingredient's familiar
            arrangement. The symbol introduces the line; `title` spells it out for
            a hover and for assistive tech, which sees the symbol as decorative. */}
        <div className="pantry-line">
          <MenuBookIcon className="pantry-symbol" />
          <span className="pantry-line-text" title="Bedarf">
            {needText(need)}
          </span>
        </div>
        {/* What is at home: the slider over the pool's stock values and, beside
            it, the chosen amount in both readings. The picker names the
            ingredient itself (aria-label), so the symbol stays decorative. */}
        <div className="pantry-line">
          <ShelvesIcon className="pantry-symbol" />
          <StockSlider
            values={stops}
            value={row.stock}
            baseUnit={row.baseUnit}
            unit={unit}
            // Core answers null both without a shopping unit and for a stock that
            // is no whole unit; the dash is the sheet's wording for the latter,
            // and `unit` already filtered the former out.
            unitText={unit === null ? null : (stockCountText(need, row.stock) ?? '—')}
            onChange={(next) => setStock(row, next)}
            label={`Vorrat für ${row.ingredient}`}
          />
        </div>
        {/* The line this row writes to Keep, word for word — the same string the
            write sends (`ShoppingRow.text`), so the sheet can never show a
            different wording than the list gets. A covered row has nothing to
            buy, so it shows a dash. */}
        <div className="pantry-line">
          <ListPlusIcon className="pantry-symbol" />
          <span
            className={row.covered ? 'pantry-line-text pantry-line-text-empty' : 'pantry-line-text'}
            title="Einkaufsliste"
          >
            {row.text ?? '—'}
          </span>
        </div>
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
    if (entries.length === 0) {
      return (
        <p className="pantry-empty" role="status">
          Die ausgewählten Gerichte haben keine Zutaten.
        </p>
      );
    }
    return (
      <div className="pantry-table" role="group" aria-label="Zutaten und Vorräte">
        {/* No header row any more (decided with the user): the two lines of a
            row name everything they show, and a caption row only cost height on
            a phone. One list — the two parts the rows were filed into at the
            start (the ones to buy first) are not separated by a rule — the "Auf
            die Liste" field already says which row currently needs something. */}
        {entries.map(renderRow)}
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

      {/* The instruction under the title: it names the three symbols of a row (a
          row itself carries no captions), says where the stock is set, and gives
          the one reading the stop amounts cannot show by themselves. */}
      <p className="pantry-select-intro">
        Je Zutat drei Zeilen: <MenuBookIcon className="pantry-intro-icon" /> Bedarf,{' '}
        <ShelvesIcon className="pantry-intro-icon" /> Vorrat,{' '}
        <ListPlusIcon className="pantry-intro-icon" /> Einkaufsliste – die unterste Zeile steht
        genau so auf der Liste. Den Vorrat stellst du in der mittleren Zeile mit dem Regler ein:
        jede Raststufe heißt „so viel habe ich <strong>mindestens</strong> im Vorrat“. Die beiden
        Werte daneben kannst du antippen und einen genauen Wert eintippen.
      </p>

      {renderList()}

      {/* The forward action of this step: it writes the upper part to Keep and
          leaves for the home screen. Accent, content width, right-aligned — the
          same arrangement the previous page's forward button uses. It only
          exists while there is something to buy: with every ingredient covered,
          the write would add nothing (and the gateway refuses an empty write). */}
      {entries.length > 0 && (
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
