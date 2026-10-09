/**
 * Pantry sheet — the full-screen page "Vorräte auswählen" behind the selection
 * page's forward button (App's `pantry` layer).
 *
 * It is the second half of the bundled shopping write. The previous page chose
 * *which dishes* are shopped for; this one decides *what is already at home*,
 * per ingredient. The rows come from `../keep/shoppingBundle` (one read per
 * selected recipe), the arithmetic from `@cookbook/core` (`stockPrefill`,
 * `buyAmount`, `pantryReading`, `renderPantryLine`, `suggestedStocks`,
 * `renderPantryChip`):
 *
 * - the Vorrat starts on `min(need, reorder point)` — snapped **down** to the
 *   nearest chip for an exact shopping unit, kept as a custom ("andere") chip
 *   otherwise — the reorder point is the amount the master data says is on the
 *   shelf after a shopping trip;
 * - the amount to buy starts on `buyAmount` (the need minus the Vorrat, rounded
 *   **up** to whole shopping units, or to whole grams/millilitres without one),
 *   but a value typed into the "kaufen" side is used **exactly** — never
 *   rounded, and allowed to exceed the need (the Vorrat then reads zero);
 * - the rows are filed once, when the page opens: the ingredients the pre-filled
 *   Vorrat already covers go below the ones that still need a purchase. That
 *   filing is a snapshot — picking a chip updates its row's amounts in place
 *   instead of moving it under the user's finger — while the amounts and the
 *   write always follow the *current* values: a row with nothing to buy is not
 *   written, wherever it stands.
 *
 * **One ingredient is two lines** (decided with the user):
 *
 * 1. the *need and the purchase*, side by side: left what the selected dishes
 *    need together, as its plain base form — the name and the exact, unrounded
 *    amount (core's `needText`); right, smaller, the amount to buy behind a
 *    shopping-cart symbol — the amount in the
 *    ingredient's shopping unit with its count rounded to the nearest AQ ladder
 *    value regardless of the unit's number scheme (core's `pantryReading`);
 * 2. the *stock chips*: one row of the stock values where the bought amount
 *    changes — the package thresholds for a shopping unit, ladder steps
 *    otherwise (core's `suggestedStocks`) — labelled with both units (core's
 *    `renderPantryChip`) and shown in increasing order. Only as many chips as
 *    fit on one row are shown; the rest hide behind the "andere" chip, which
 *    opens the keyboard on the Vorrat's base-quantity field. A typed value that
 *    is no suggestion then shows as an additional chip with an edit symbol
 *    (components/StockChips).
 *
 * **Both quantities of the purchase line are tappable** (the count and the
 * grams/millilitres): each opens a keyboard, written as plain text rather than
 * a box. A typed amount must not be negative and is never rounded; the base
 * quantity is always typed in g / ml, the count in the shopping unit (converted
 * by its factor). Changing the Vorrat recomputes the "kaufen" default (rounded
 * up); changing the "kaufen" amount back-computes the Vorrat and keeps the
 * typed amount exactly.
 *
 * **Rows fold and unfold** (decided with the user): an ingredient whose
 * pre-filled Vorrat already covers the need starts folded to its first line,
 * shown entirely at the purchase's smaller step; one that still needs a
 * purchase starts unfolded with its chips. A tap on a folded row's
 * non-interactive area opens it (a tap on its buy quantity also opens that
 * quantity's keyboard); a tap on an unfolded row's non-interactive area folds
 * it again; a tap outside a row does nothing. A committed change — a chip, an
 * "andere" value, or a buy quantity — folds its row too.
 *
 * "Einkaufsliste schreiben" writes one line per row that currently has something
 * to buy, exactly as displayed (with the name, via core's `renderPantryLine`),
 * through App (which owns the Keep write, the closing of the flow and the
 * success notice with its undo). A failure is shown next to the button and
 * leaves the page as it is, so the work is not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import {
  buyAmount,
  formatBQ,
  formatDecimal,
  formatPantryAq,
  needText,
  NNBSP,
  pantryReading,
  renderPantryChip,
  renderPantryLine,
  shoppingUnitOf,
  stockPrefill,
  suggestedStocks,
  type AdditionalUnit,
  type ShoppingNeed,
} from '@cookbook/core';

import { resolveShoppingBundle, type ShoppingBundle } from '../keep/shoppingBundle';
import type { MealPlanCard } from '../keep/mealPlanCards';
import { ShoppingCartIcon } from './icons';
import StockChips, { type StockChip } from './StockChips';
import { parseInput, roundThousandths } from './pantryInput';

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
 * One rendered row: what the ingredient needs, the stock the user picked and
 * the amount they will buy (derived from the stock or typed directly).
 */
interface PantryEntry {
  readonly need: ShoppingNeed;
  /** The chosen stock in the family unit (may exceed the need when typed). */
  readonly stock: number;
  /** The amount to buy in the family unit (may exceed the need when typed). */
  readonly buy: number;
}

/** One row's saved choices: the stock and the amount to buy, both in g / ml. */
interface PantryState {
  readonly stock: number;
  readonly buy: number;
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
  /**
   * Whether the open input shows its unit beside it. The count hides it: the
   * arrangement's <AU> already names that unit right after the input, so the
   * label would double it. Defaults to true — a base amount's "g"/"ml" is only
   * shown here.
   */
  showEditUnit?: boolean;
  /** Reports a committed number (already clamped to ≥ 0 by the caller). */
  onCommit: (typed: number) => void;
  /** Accessible name of the reading, e.g. "Kaufen für Mehl". */
  label: string;
}

/**
 * One tappable quantity (a count or a base amount): plain text when closed, an
 * inline keyboard input when tapped. Committing the unchanged value is a no-op,
 * so a tap that merely opens the keyboard can never alter the value.
 */
function TappableQuantity({
  display,
  editValue,
  unitName,
  showEditUnit = true,
  onCommit,
  label,
}: TappableQuantityProps) {
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
            shopping unit's name for a count. A count hides it — that unit is
            already the arrangement's <AU> right beside the input. The unit's
            leading margin is the space between the number and its unit. */}
        {showEditUnit && <span className="pantry-value-unit">{unitName}</span>}
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
  /** Accessible name of the amount, e.g. "Kaufen für Mehl". */
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
      showEditUnit={false}
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
  /**
   * The custom Vorrat value the user typed through the "andere" chip's keyboard,
   * keyed by row. Only rows the user actually typed a value for are stored; the
   * entry is dropped again as soon as the stock is set any other way (a
   * suggestion chip or the "kaufen" amount).
   */
  const [customStocks, setCustomStocks] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** True while the write runs — the button is unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the button (null = no failure). */
  const [writeError, setWriteError] = useState<string | null>(null);
  /**
   * The rows currently unfolded (showing their stock chips), keyed by row. A
   * row that still needs a purchase starts unfolded; a row whose pre-filled
   * Vorrat already covers the need starts folded to its first line. The set
   * only ever holds the *unfolded* keys: folding on an outside tap just empties
   * it, so the covered rows need no per-row bookkeeping of their own.
   */
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());

  // Load the bundle once the page is open. `cards` and `token` are fixed for its
  // lifetime (App sets the cards before opening the page and the page unmounts
  // when the flow leaves), so there is no state to reset here — only the result
  // of the request. State is updated in the promise callbacks, never
  // synchronously, so the "no state update in an effect" rule stays satisfied.
  useEffect(() => {
    let cancelled = false;
    void resolveShoppingBundle(cards, token)
      .then((resolved) => {
        if (!cancelled) {
          setBundle(resolved);
          // The rows that still need a purchase start unfolded; the rows whose
          // pre-filled Vorrat already covers the need start folded to one line.
          setExpandedRows(
            new Set(
              resolved.needs
                .filter((need) => stockPrefill(need) < need.needed)
                .map((need) => rowKey(need.ingredient, need.baseUnit)),
            ),
          );
          // An ingredient without an *exact* shopping unit keeps a reorder point
          // that falls between two chips as its own stock, shown as a custom chip
          // — exactly as if the user had typed it through "andere". Exact units
          // are snapped down by core's `stockPrefill`, so they never get one.
          const custom = new Map<string, number>();
          for (const need of resolved.needs) {
            const target = shoppingUnitOf(need);
            if (target !== null && target.au.exact) continue;
            const stock = stockPrefill(need);
            // Covered (the need itself) or zero is a normal chip; a suggestion is
            // already a chip too. Only an in-between value becomes a custom chip.
            if (stock <= 0 || stock >= need.needed) continue;
            if (suggestedStocks(need).includes(stock)) continue;
            custom.set(rowKey(need.ingredient, need.baseUnit), stock);
          }
          if (custom.size > 0) setCustomStocks(custom);
        }
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

  /** Unfolds one row (idempotent — an already-unfolded row is left alone). */
  const expand = useCallback((key: string): void => {
    setExpandedRows((current) => {
      if (current.has(key)) return current;
      const updated = new Set(current);
      updated.add(key);
      return updated;
    });
  }, []);

  /** Folds one row back to its first line (idempotent). */
  const collapse = useCallback((key: string): void => {
    setExpandedRows((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  }, []);

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
   * The rows with the chosen stock and buy amount. The stock is rounded to the
   * thousandth so the chip comparison and the tappable fields never see the
   * float noise a summed need can carry.
   */
  const entries: PantryEntry[] = orderedNeeds.map((need) => {
    const saved = stocks.get(rowKey(need.ingredient, need.baseUnit));
    const stock = roundThousandths(saved === undefined ? stockPrefill(need) : saved.stock);
    const buy = saved === undefined ? buyAmount(need, stock) : saved.buy;
    return { need, stock, buy };
  });

  /**
   * The rows that currently have something to buy — the write's content, in the
   * list's own order. A row can join or leave this set while its slider is used
   * without changing its place in the list.
   */
  const toBuy = entries.filter((entry) => entry.buy > 0);

  /** Remembers one row's new stock (a suggestion chip); the buy amount follows
   *  it (rounded up), and any custom value is dropped. */
  function setStock(need: ShoppingNeed, next: number): void {
    const stock = Math.max(0, roundThousandths(next));
    const key = rowKey(need.ingredient, need.baseUnit);
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(key, {
        stock,
        buy: buyAmount(need, stock),
      });
      return updated;
    });
    setCustomStocks((current) => {
      const updated = new Map(current);
      updated.delete(key);
      return updated;
    });
  }

  /** Remembers one row's new buy amount exactly as typed; the stock follows it,
   *  and any custom value is dropped (the Vorrat is now derived from the buy). */
  function setBuy(need: ShoppingNeed, next: number): void {
    const buy = Math.max(0, roundThousandths(next));
    const key = rowKey(need.ingredient, need.baseUnit);
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(key, {
        stock: Math.max(0, roundThousandths(need.needed - buy)),
        buy,
      });
      return updated;
    });
    setCustomStocks((current) => {
      const updated = new Map(current);
      updated.delete(key);
      return updated;
    });
  }

  /** Remembers a value the user typed through the "andere" keyboard as the
   *  row's stock *and* its custom value (it stays visible as the edit chip). */
  function commitCustom(need: ShoppingNeed, next: number): void {
    const stock = Math.max(0, roundThousandths(next));
    const key = rowKey(need.ingredient, need.baseUnit);
    setStocks((current) => {
      const updated = new Map(current);
      updated.set(key, {
        stock,
        buy: buyAmount(need, stock),
      });
      return updated;
    });
    setCustomStocks((current) => {
      const updated = new Map(current);
      updated.set(key, stock);
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

  /** One ingredient row: the need with the purchase on its right, and the stock
   *  chips below (only while the row is unfolded). */
  function renderRow(entry: PantryEntry): ReactNode {
    const { need, stock, buy } = entry;
    const kaufen = pantryReading(need.ingredient, buy, need.baseUnit);
    const key = rowKey(need.ingredient, need.baseUnit);
    // Whether the row is folded to its first line. The covered rows start
    // folded; a folded row opens on a tap and folds again after a change.
    const collapsed = !expandedRows.has(key);
    // The value the user typed through the "andere" keyboard (null = none yet).
    const customValue = customStocks.get(key) ?? null;
    // The custom value as a chip, labelled with the ingredient's full arrangement
    // (shopping unit included when one exists).
    const customChip: StockChip | null =
      customValue === null
        ? null
        : { value: customValue, label: renderPantryChip(need.ingredient, customValue, need.baseUnit) };
    // The suggested stock values as chips, each labelled with both units. The
    // custom value is left out so it never duplicates the edit chip below.
    const chips: StockChip[] = suggestedStocks(need)
      .filter((value) => value !== customValue)
      .map((value) => ({
        value,
        label: renderPantryChip(need.ingredient, value, need.baseUnit),
      }));

    return (
      <div
        className={collapsed ? 'pantry-row pantry-row--collapsed' : 'pantry-row'}
        key={key}
        onClick={(event) => {
          // The row toggles on a tap to its non-interactive area: a folded row
          // opens, an unfolded row folds. A folded row opens on *any* tap — the
          // buy quantity's own onClick additionally opens its keyboard (it runs
          // first, and both compose). An unfolded row folds only when the tap
          // did not land on an input field or a chip (those keep their own
          // behaviour); tapping outside the list has no handler at all.
          const target = event.target;
          const isControl = target instanceof Element && target.closest('button, input') !== null;
          if (collapsed) {
            expand(key);
          } else if (!isControl) {
            collapse(key);
          }
        }}
      >
        {/* Line 1: what the selected dishes need together (left) and what is
            bought (right, smaller, led by a shopping-cart symbol). */}
        <div className="pantry-head">
          <div className="pantry-need">{needText(need)}</div>
          <span className="pantry-buy">
            <ShoppingCartIcon className="pantry-buy-icon" />
            <TappableAmount
              au={kaufen.au}
              baseUnit={need.baseUnit}
              aqDisplay={kaufen.aq === null ? null : formatPantryAq(kaufen.aq)}
              aqEdit={kaufen.aq ?? 0}
              bqDisplay={formatBQ(buy, need.baseUnit)}
              bqEdit={buy}
              onCommitAq={(count) => {
                setBuy(need, count * kaufen.factor);
                collapse(key);
              }}
              onCommitBq={(amount) => {
                setBuy(need, amount);
                collapse(key);
              }}
              label={`Kaufen für ${need.ingredient}`}
            />
          </span>
        </div>
        {/* Line 2: the stock chips (suggestions + the custom/“andere” entry),
            only while the row is unfolded. */}
        {!collapsed && (
          <StockChips
            chips={chips}
            value={stock}
            baseUnit={need.baseUnit}
            customChip={customChip}
            // Without a shopping unit the suggestions are ladder stops, not
            // package thresholds: the typed-value entry ("andere") must always
            // stay reachable, so it is kept visible instead of hiding behind an
            // overflow.
            alwaysShowAndere={kaufen.au === null}
            onChange={(next) => {
              setStock(need, next);
              collapse(key);
            }}
            onCommitCustom={(value) => {
              commitCustom(need, value);
              collapse(key);
            }}
            label={`Vorrat für ${need.ingredient}`}
          />
        )}
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

      {/* The instruction under the title: pick a stock of at least this amount
          (the chips), or type the amount to buy directly. */}
      <p className="pantry-select-intro">
        Wähle die Menge, die <strong>mindestens</strong> auf Vorrat ist, oder gib direkt die zu
        kaufende Menge ein.
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
