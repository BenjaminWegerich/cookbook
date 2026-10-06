/**
 * Pantry sheet — the full-screen page "Vorräte auswählen" behind the selection
 * page's forward button (App's `pantry` layer).
 *
 * It is the second half of the bundled shopping write. The previous page chose
 * *which dishes* are shopped for; this one decides *what is already at home*,
 * per ingredient. The rows come from `../keep/shoppingBundle` (one read per
 * selected recipe), the arithmetic from `@cookbook/core` (`stockPrefill`,
 * `buyAmount`, `pantryReading`, `renderPantryLine`):
 *
 * - the Vorrat starts on `min(need, reorder point)` — the reorder point is the
 *   amount the master data says is on the shelf after a shopping trip;
 * - the amount to buy starts on `buyAmount` (the need minus the Vorrat, rounded
 *   **up** to whole shopping units, or to whole grams/millilitres without one),
 *   but a value typed into the "kaufen" side is used **exactly** — never
 *   rounded, and allowed to exceed the need (the Vorrat then reads zero);
 * - the rows are filed once, when the page opens: the ingredients the pre-filled
 *   Vorrat already covers go below the ones that still need a purchase. That
 *   filing is a snapshot — the slider updates its row's amounts in place instead
 *   of moving it under the user's finger — while the amounts and the write always
 *   follow the *current* values: a row with nothing to buy is not written,
 *   wherever it stands.
 *
 * **One ingredient is three lines** (decided with the user):
 *
 * 1. the *need*: what the selected dishes need together, in the ingredient's
 *    familiar arrangement, including the name and the exact, unrounded amount
 *    (core's `needText`), followed by "benötigt";
 * 2. the *stock and the purchase*, side by side: left "… auf Vorrat", right
 *    "… kaufen", each the amount in the ingredient's shopping unit with its
 *    count rounded to the nearest AQ ladder value regardless of the unit's
 *    number scheme, so the unit is always named (core's `pantryReading`);
 * 3. the *slider*: one discrete slider whose stops are the stock values at which
 *    the bought amount changes (core's `stockPool`), spaced evenly rather than by
 *    amount, so a small step is as easy to hit as a large one.
 *
 * **Both quantities of both lines are tappable** (the count and the
 * grams/millilitres, on the "auf Vorrat" side and on the "kaufen" side): each
 * opens a keyboard, written as plain text rather than a box. A typed amount need
 * not be a stop, must not be negative, and is never rounded; the base quantity
 * is always typed in g / ml, the count in the shopping unit (converted by its
 * factor). Changing the Vorrat recomputes the "kaufen" default (rounded up);
 * changing the "kaufen" amount back-computes the Vorrat and keeps the typed
 * amount exactly. The slider thumb marks the stop bucket the stock falls in.
 *
 * "Einkaufsliste schreiben" writes one line per row that currently has something
 * to buy, exactly as displayed (with the name, via core's `renderPantryLine`),
 * through App (which owns the Keep write, the closing of the flow and the
 * success notice with its undo). A failure is shown next to the button and
 * leaves the page as it is, so the work is not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import {
  buyAmount,
  formatBQ,
  formatDecimal,
  formatPantryAq,
  needText,
  NNBSP,
  pantryReading,
  renderPantryLine,
  stockPool,
  stockPrefill,
  type AdditionalUnit,
  type ShoppingNeed,
} from '@cookbook/core';

import { resolveShoppingBundle, type ShoppingBundle } from '../keep/shoppingBundle';
import type { MealPlanCard } from '../keep/mealPlanCards';
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
 * One rendered row: what the ingredient needs, the stock the user picked, the
 * amount they will buy (derived from the stock or typed directly), and the
 * stops its slider snaps to.
 */
interface PantryEntry {
  readonly need: ShoppingNeed;
  /** The chosen stock in the family unit (may exceed the need when typed). */
  readonly stock: number;
  /** The amount to buy in the family unit (may exceed the need when typed). */
  readonly buy: number;
  /** The slider's stops: every stock value that changes the bought amount. */
  readonly stops: readonly number[];
}

/** One row's saved choices: the stock and the amount to buy, both in g / ml. */
interface PantryState {
  readonly stock: number;
  readonly buy: number;
}

/**
 * Parses a typed number with German typography: the comma is the decimal
 * separator and a dot may separate thousands ("1.200" is 1200, "1,2" is 1.2).
 * Anything else is ignored, so a typed unit or a stray space does not spoil the
 * input ("1200 g"). NaN for an input without a number — the caller keeps the
 * stock then.
 */
function parseInput(text: string): number {
  return Number(
    text
      .replace(/[^\d.,]/g, '')
      .replaceAll('.', '')
      .replace(',', '.'),
  );
}

/** One thousandth — the precision the sheet rounds a stock to. */
function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Renders an additional unit's arrangement with the additional quantity and the
 * base quantity as tappable React nodes (the name is empty — the pantry's lines
 * carry the ingredient name elsewhere). The arrangement template is split on its
 * placeholders; `<BQ><NNBSP><BU>` is grouped into one node so the number and its
 * unit stay inside a single tap target.
 */
function renderArrangement(
  au: AdditionalUnit,
  aqNode: ReactNode,
  bqNode: ReactNode,
  bu: string,
): ReactNode {
  const template = au.arrangement
    .replaceAll('<BQ><NNBSP><BU>', '<BQBU>')
    .replaceAll('<BQ> <BU>', '<BQBU>')
    .replaceAll('<IN>', '')
    // A name-less arrangement drops the "<IN>" and its leading space, leaving a
    // double space before the base quantity's parenthesis — collapse it like
    // core's own name-less renderer does.
    .replaceAll('  ', ' ');
  const parts = template.split(/(<AQ>|<AU>|<BQBU>|<BQ>|<BU>|<NNBSP>)/g);
  return parts.map((part, index) => {
    switch (part) {
      case '<AQ>':
        return <Fragment key={index}>{aqNode}</Fragment>;
      case '<AU>':
        return <Fragment key={index}>{au.name}</Fragment>;
      case '<BQBU>':
      case '<BQ>':
        return <Fragment key={index}>{bqNode}</Fragment>;
      // A base unit not adjacent to its quantity (no arrangement in the seed
      // separates them): the family unit alone is the honest fallback.
      case '<BU>':
        return <Fragment key={index}>{bu}</Fragment>;
      case '<NNBSP>':
        return <Fragment key={index}>{NNBSP}</Fragment>;
      default:
        return <Fragment key={index}>{part}</Fragment>;
    }
  });
}

interface TappableQuantityProps {
  /** The closed reading, written as plain text (the value it shows). */
  display: string;
  /** The number behind `display`: the prefill and the "unchanged" reference. */
  editValue: number;
  /** The unit the open input is typed in ("g" / "ml" / the shopping unit). */
  unitName: string;
  /** Reports a committed number (already clamped to ≥ 0 by the caller). */
  onCommit: (typed: number) => void;
  /** Accessible name of the reading, e.g. "Vorrat für Mehl". */
  label: string;
}

/**
 * One tappable quantity (a count or a base amount): plain text when closed, an
 * inline keyboard input when tapped. Committing the unchanged value is a no-op,
 * so a tap that merely opens the keyboard can never alter the stock.
 */
function TappableQuantity({ display, editValue, unitName, onCommit, label }: TappableQuantityProps) {
  /** True while the keyboard is open; `draft` holds what is being typed. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function beginEdit(): void {
    setEditing(true);
    setDraft(formatDecimal(roundThousandths(editValue)));
  }

  function commitTyped(): void {
    setEditing(false);
    const parsed = parseInput(draft);
    if (!Number.isFinite(parsed)) return;
    const rounded = roundThousandths(parsed);
    // Unchanged (within the sheet's thousandth precision): nothing to do.
    if (rounded === roundThousandths(editValue)) return;
    onCommit(rounded);
  }

  if (editing) {
    return (
      <span className="pantry-value-edit">
        <input
          className="pantry-value-input"
          // The phone's number keypad, not the full keyboard. The value may carry
          // a decimal comma, hence "decimal" rather than "numeric".
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitTyped}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitTyped();
            if (event.key === 'Escape') setEditing(false);
          }}
          aria-label={`${label} in ${unitName}`}
        />
        {/* The field's unit while it is open: g / ml for a base amount, the
            shopping unit's name for a count. */}
        <span className="pantry-value-unit">{unitName}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="pantry-value"
      onClick={beginEdit}
      aria-label={`${label} eintippen (${unitName})`}
    >
      {display}
    </button>
  );
}

interface TappableAmountProps {
  /** The shopping unit the amount is named in, or null (the base form). */
  au: AdditionalUnit | null;
  /** Family base unit (g / ml): the unit of the base amount and of its input. */
  baseUnit: 'g' | 'ml';
  /** The closed count text, or null without an AU. */
  aqDisplay: string | null;
  /** The count behind `aqDisplay` (the prefill and "unchanged" reference). */
  aqEdit: number;
  /** The closed base-amount text ("500 g", "1 kg"). */
  bqDisplay: string;
  /** The base amount behind `bqDisplay`. */
  bqEdit: number;
  /** Reports a committed count (converted to a stock by the caller). */
  onCommitAq: (count: number) => void;
  /** Reports a committed base amount (converted to a stock by the caller). */
  onCommitBq: (amount: number) => void;
  /** Accessible name of the amount, e.g. "Vorrat für Mehl" / "Kaufen für Mehl". */
  label: string;
}

/**
 * One amount written as an arrangement with two tappable quantities (the count
 * and the base amount), or one tappable base amount without a shopping unit.
 */
function TappableAmount({
  au,
  baseUnit,
  aqDisplay,
  aqEdit,
  bqDisplay,
  bqEdit,
  onCommitAq,
  onCommitBq,
  label,
}: TappableAmountProps) {
  if (au === null || aqDisplay === null) {
    return (
      <span className="pantry-amount">
        <TappableQuantity
          display={bqDisplay}
          editValue={bqEdit}
          unitName={baseUnit}
          onCommit={onCommitBq}
          label={label}
        />
      </span>
    );
  }
  const aqNode = (
    <TappableQuantity
      display={aqDisplay}
      editValue={aqEdit}
      unitName={au.name}
      onCommit={onCommitAq}
      label={label}
    />
  );
  const bqNode = (
    <TappableQuantity
      display={bqDisplay}
      editValue={bqEdit}
      unitName={baseUnit}
      onCommit={onCommitBq}
      label={label}
    />
  );
  return <span className="pantry-amount">{renderArrangement(au, aqNode, bqNode, baseUnit)}</span>;
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
   * The stock and the amount to buy the user picked, keyed by row. Only
   * *changed* rows are stored: a row without an entry shows its pre-filled
   * values, so a bundle that arrives late (or again) is never shadowed by a
   * stale default.
   */
  const [stocks, setStocks] = useState<ReadonlyMap<string, PantryState>>(() => new Map());
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
   * The rows with the chosen stock and buy amount, and the stops their slider
   * snaps to. Built from the needs rather than from the rows, because the stops
   * need the need the row was derived from.
   */
  const entries: PantryEntry[] = orderedNeeds.map((need) => {
    const saved = stocks.get(rowKey(need.ingredient, need.baseUnit));
    const stock = saved === undefined ? stockPrefill(need) : saved.stock;
    const buy = saved === undefined ? buyAmount(need, stock) : saved.buy;
    return { need, stock, buy, stops: stockPool(need) };
  });

  /**
   * The rows that currently have something to buy — the write's content, in the
   * list's own order. A row can join or leave this set while its slider is used
   * without changing its place in the list.
   */
  const toBuy = entries.filter((entry) => entry.buy > 0);

  /** Remembers one row's new stock; the buy amount follows it (rounded up). */
  function setStock(need: ShoppingNeed, next: number): void {
    const stock = Math.max(0, roundThousandths(next));
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(rowKey(need.ingredient, need.baseUnit), {
        stock,
        buy: buyAmount(need, stock),
      });
      return updated;
    });
  }

  /** Remembers one row's new buy amount exactly as typed; the stock follows it. */
  function setBuy(need: ShoppingNeed, next: number): void {
    const buy = Math.max(0, roundThousandths(next));
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(rowKey(need.ingredient, need.baseUnit), {
        stock: Math.max(0, roundThousandths(need.needed - buy)),
        buy,
      });
      return updated;
    });
  }

  /**
   * Writes every row that currently has something to buy. The lines are exactly
   * what those rows' "kaufen" side displays plus the name, in the list's order;
   * the count of dishes rides along for the success notice.
   */
  async function handleWrite(): Promise<void> {
    setBusy(true);
    setWriteError(null);
    const lines = toBuy.map((entry) => renderPantryLine(entry.need.ingredient, entry.buy, entry.need.baseUnit));
    try {
      await onWrite(lines, bundle?.recipes ?? 0);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /** One ingredient row: the need, the stock and the purchase side by side, and
   *  the slider. */
  function renderRow(entry: PantryEntry): ReactNode {
    const { need, stock, buy, stops } = entry;
    const vorrat = pantryReading(need.ingredient, stock, need.baseUnit);
    const kaufen = pantryReading(need.ingredient, buy, need.baseUnit);
    return (
      <div className="pantry-row" key={rowKey(need.ingredient, need.baseUnit)}>
        {/* What the selected dishes need together, in the ingredient's familiar
            arrangement (exact, unrounded amount). */}
        <div className="pantry-need">
          {needText(need)} <span className="pantry-label">benötigt</span>
        </div>
        {/* The stock and the purchase, side by side — each an arrangement whose
            count and base amount are tappable. */}
        <div className="pantry-line-two">
          <span className="pantry-side">
            <TappableAmount
              au={vorrat.au}
              baseUnit={need.baseUnit}
              aqDisplay={vorrat.aq === null ? null : formatPantryAq(vorrat.aq)}
              aqEdit={vorrat.aq ?? 0}
              bqDisplay={formatBQ(stock, need.baseUnit)}
              bqEdit={stock}
              onCommitAq={(count) => setStock(need, count * vorrat.factor)}
              onCommitBq={(amount) => setStock(need, amount)}
              label={`Vorrat für ${need.ingredient}`}
            />
            <span className="pantry-label">auf Vorrat</span>
          </span>
          <span className="pantry-side pantry-side-buy">
            <TappableAmount
              au={kaufen.au}
              baseUnit={need.baseUnit}
              aqDisplay={kaufen.aq === null ? null : formatPantryAq(kaufen.aq)}
              aqEdit={kaufen.aq ?? 0}
              bqDisplay={formatBQ(buy, need.baseUnit)}
              bqEdit={buy}
              onCommitAq={(count) => setBuy(need, count * kaufen.factor)}
              onCommitBq={(amount) => setBuy(need, amount)}
              label={`Kaufen für ${need.ingredient}`}
            />
            <span className="pantry-label">kaufen</span>
          </span>
        </div>
        {/* The discrete slider: the row's stock, snapped to the stops. */}
        <StockSlider
          values={stops}
          value={stock}
          baseUnit={need.baseUnit}
          onChange={(next) => setStock(need, next)}
          label={`Vorrat für ${need.ingredient}`}
        />
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

      {/* The instruction under the title: it names the three lines of a row,
          says where the stock is set, and gives the one reading the stop amounts
          cannot show by themselves. */}
      <p className="pantry-select-intro">
        Je Zutat drei Zeilen: oben der Bedarf, in der mittleren Zeile links der Vorrat und
        rechts, was gekauft wird – diese Menge steht so auf der Einkaufsliste. Den Vorrat stellst
        du mit dem Regler ein: jede Raststufe heißt „so viel habe ich <strong>mindestens</strong>{' '}
        im Vorrat“. Die Zahlen links und rechts (in der Zusatzeinheit und in Gramm-/Milliliter)
        kannst du antippen und einen genauen Wert eintippen.
      </p>

      {renderList()}

      {/* The forward action of this step: it writes the "kaufen" lines to Keep
          and leaves for the home screen. Accent, content width, right-aligned —
          the same arrangement the previous page's forward button uses. It only
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
