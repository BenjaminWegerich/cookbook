/**
 * Pantry sheet, step 2 of the bundled shopping flow: the full-screen page
 * "Vorräte auswählen — Teil 2: Zutaten" (App's `pantry` layer).
 *
 * It closes the bundled shopping write. The previous steps chose *which dishes*
 * are shopped for and *how much of each sub-recipe is cooked*; this one decides
 * *what is already at home*, per ingredient — and it is the only step that buys.
 * Its rows are the **bottom level**: every ingredient of the selected dishes and
 * of the sub-recipes cooked for them, without the sub-recipes themselves, which
 * step 1 (components/SubRecipeSelect) owns.
 *
 * The rows and their needs are handed in by App (resolved once, see
 * ../keep/shoppingBundle) and the page derives the needs from them on every
 * render — the cooking decisions are part of that derivation, so an amount here
 * can never disagree with what is really cooked. The arithmetic is
 * `@cookbook/core`'s (`bottomLevelNeedsFor` → `stockPrefill`, `buyAmount`,
 * `pantryReading`, `renderPantryLine`, `suggestedStocks`, `renderPantryChip`):
 *
 * - the Vorrat starts on `min(need, reorder point)` — snapped **down** to the
 *   nearest chip for an exact shopping unit, kept as a custom ("andere") chip
 *   otherwise — the reorder point is the amount the master data says is on the
 *   shelf after a shopping trip;
 * - the amount to buy starts on `buyAmount` (the need minus the Vorrat, rounded
 *   **up** to whole shopping units, or to whole grams/millilitres without one),
 *   but a value typed into the "kaufen" side is used **exactly** — never
 *   rounded, and allowed to exceed the need (the Vorrat then reads zero);
 * - the rows are filed by the *pre-filled* Vorrat, the ones that still need a
 *   purchase first. That filing is stable — picking a chip updates its row's
 *   amounts in place instead of moving it under the user's finger — while the
 *   amounts and the write always follow the *current* values: a row with nothing
 *   to buy is not written, wherever it stands.
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
 *    `renderPantryChip`), led by a shelf symbol and shown in increasing order.
 *    The chip that covers the whole need carries a leading check and reads
 *    olive. Only as many
 *    chips as fit on one row are shown; the rest hide behind the "andere" chip,
 *    which opens the keyboard on the Vorrat's base-quantity field. A typed
 *    value that is no suggestion then shows as an additional chip with an edit
 *    symbol (components/StockChips).
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
 * purchase starts unfolded with its chips. A folded row's first line reads the
 * on-stock amount behind a shelf symbol and the bought amount behind the cart
 * symbol (a zero on either side reads as an em dash); when everything is on
 * stock, the on-stock amount gives way to an olive check badge. A tap on a
 * folded row's non-interactive area opens it (a tap on its buy quantity also
 * opens that
 * quantity's keyboard); a tap on an unfolded row's non-interactive area folds
 * it again; a tap outside a row does nothing. A committed change — a chip, an
 * "andere" value, or a buy quantity — folds its row too. Only the user's own
 * moves are stored (which rows they folded, which they opened, which value they
 * typed); the starting shape is derived from the prefill, so the page holds no
 * remembered defaults at all and a fresh visit always starts from the data.
 *
 * "Einkaufsliste schreiben" writes one line per row that currently has something
 * to buy, exactly as displayed (with the name, via core's `renderPantryLine`),
 * through App (which owns the Keep write, the closing of the flow and the
 * success notice with its undo). A failure is shown next to the button and
 * leaves the page as it is, so the work is not lost.
 *
 * **"Zurück" asks before discarding** — but only when step 1 exists, since that
 * is where the flow's amounts are entered and it starts from its prefills again
 * afterwards (the browser Back button arms the same question, see
 * `PantrySelectHandle`). Without a cooking step there is nothing to ask and the
 * header's button leaves for the dish selection as it always did.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { Fragment, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import type { ReactNode, Ref } from 'react';

import {
  buyAmount,
  formatBQ,
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

import { bottomLevelNeedsFor, type ShoppingInputs } from '../keep/shoppingBundle';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import { CheckIcon, ShelfIcon, ShoppingCartIcon } from './icons';
import StockChips, { type StockChip } from './StockChips';
import TappableQuantity from './TappableQuantity';
import { roundThousandths } from './pantryInput';

/**
 * The browser-Back consumer of this page (see App's popstate handler). The
 * amount of work behind "Zurück" is a decision, so Back arms the same question
 * the header's button does instead of discarding silently.
 */
export interface PantrySelectHandle {
  /**
   * Arms the discard question and reports whether the page handled the Back.
   * False means the caller may leave: the page holds nothing to discard.
   */
  notifyBack: () => boolean;
}

interface PantrySelectProps {
  /**
   * The resolved bundle: the selected dishes' ingredient lists scaled to the
   * size each is cooked at, plus the recipes of every sub-recipe they reach
   * (see ../keep/shoppingBundle). Fixed for the page's lifetime — App resolved
   * it before opening the page, and the page unmounts when the flow leaves.
   */
  inputs: ShoppingInputs;
  /**
   * The cooking decisions of the previous step ("Teil 1: Zutaten-Rezepte"): the
   * stock chosen per sub-recipe. They enter every bottom-level need, so the
   * amounts here are the ones the cooked sub-recipes really consume. Empty when
   * the bundle holds no sub-recipe.
   */
  decisions: ReadonlyMap<string, number>;
  /**
   * Whether the cooking step exists at all (the bundle holds at least one
   * sub-recipe). It decides the header's subtitle and whether "Zurück" leads to
   * that step — and therefore whether there is anything to ask before leaving.
   */
  hasSubRecipes: boolean;
  /** Leaves the flow for the dish selection (only without a cooking step). */
  onLeave: () => void;
  /**
   * Discards every amount and returns to the cooking step (only with one). App
   * drops the cooking decisions, so that step starts from its prefills again.
   */
  onRestartCooking: () => void;
  /**
   * Writes the given lines to the Keep shopping list and closes the whole flow.
   * Resolves on success; a failure is thrown and shown next to the button (the
   * page stays open, so the chosen stocks are not lost).
   */
  onWrite: (lines: readonly string[], recipes: number) => Promise<void>;
  /** See PantrySelectHandle — React 19 passes `ref` as an ordinary prop. */
  ref?: Ref<PantrySelectHandle>;
}

/** One row's identity: the ingredient name plus the unit it is needed in. */
function rowKey(ingredient: string, baseUnit: string): string {
  return `${ingredient}\u0000${baseUnit}`;
}

/**
 * The one stock value a row shows as its own editable chip instead of a
 * suggestion, or null when its suggestions cover the amount: a value the user
 * typed through "andere", or a pre-filled Vorrat that falls between two
 * suggestions (a reorder point need not be a suggestion). An *exact* shopping
 * unit never produces one — core's `stockPrefill` snaps it down to a package
 * threshold.
 *
 * Derived from the row's data and the typed value alone, so the page never has
 * to remember a default it computed once.
 */
function customStockOf(need: ShoppingNeed, typed: number | undefined): number | null {
  if (typed !== undefined) {
    return typed;
  }
  const stock = stockPrefill(need);
  // Covered (the need itself) or zero is a normal chip; a suggestion is already
  // a chip too. Only an in-between value becomes a custom chip.
  if (stock <= 0 || stock >= need.needed) {
    return null;
  }
  const target = shoppingUnitOf(need);
  if (target !== null && target.au.exact) {
    return null;
  }
  return suggestedStocks(need).includes(stock) ? null : stock;
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
 * The pantry page, step 2 (see the file header). It owns the chosen stocks and
 * the buy amounts; the resolved bundle, the cooking decisions, the Keep write
 * and the flow itself belong to App.
 */
function PantrySelect({
  inputs,
  decisions,
  hasSubRecipes,
  onLeave,
  onRestartCooking,
  onWrite,
  ref,
}: PantrySelectProps) {
  /**
   * The ingredient needs of the bottom level — the selected dishes *and* every
   * cooked sub-recipe, summed per ingredient (core's `planSubRecipes`, through
   * ../keep/shoppingBundle). Derived, never stored: the cooking decisions are
   * the only input, so the page cannot show an amount the cooked sub-recipes do
   * not really consume.
   */
  const needs = useMemo(() => bottomLevelNeedsFor(inputs, decisions), [inputs, decisions]);
  /** True while the discard question is open (header "Zurück" / browser Back). */
  const [confirmLeave, setConfirmLeave] = useState(false);
  /**
   * The stock and the amount to buy the user picked, keyed by row. Only
   * *changed* rows are stored: a row without an entry shows its pre-filled
   * values, so a prefill is never shadowed by a stale copy of itself.
   */
  const [stocks, setStocks] = useState<ReadonlyMap<string, PantryState>>(() => new Map());
  /**
   * The Vorrat the user typed through the "andere" chip's keyboard, keyed by row
   * (absent = none typed). The entry is dropped again as soon as the stock is
   * set any other way (a suggestion chip or the "kaufen" amount). A prefill that
   * is no chip is *not* stored here but derived (`customValueOf`), so the page
   * holds no remembered copy of a value that comes from the data.
   */
  const [typedStocks, setTypedStocks] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** True while the write runs — the button is unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the write failed, shown next to the button (null = no failure). */
  const [writeError, setWriteError] = useState<string | null>(null);
  /**
   * The two sets that decide a row's shape, and they only ever hold rows the
   * *user* moved: `folded` are the rows they closed, `opened` the ones they
   * opened. A row nobody touched follows its prefill — one that still needs a
   * purchase is unfolded, one whose pre-filled Vorrat already covers the need is
   * folded to its first line. Deriving that instead of snapshotting it when the
   * page opens is what lets the page own no remembered defaults at all.
   */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  // Browser Back is a decision here, not a silent discard (see PantrySelectHandle):
  // the popstate listener asks this page first, and only a `false` lets it leave.
  useImperativeHandle(
    ref,
    () => ({
      notifyBack: (): boolean => {
        if (!hasSubRecipes) return false;
        setConfirmLeave(true);
        return true;
      },
    }),
    [hasSubRecipes],
  );

  /** The header's "Zurück": with a cooking step behind it, it asks first. */
  function requestLeave(): void {
    if (hasSubRecipes) {
      setConfirmLeave(true);
    } else {
      onLeave();
    }
  }

  /** Unfolds one row (idempotent — an already-unfolded row is left alone). */
  const unfold = useCallback((key: string): void => {
    setOpened((current) => {
      if (current.has(key)) return current;
      const updated = new Set(current);
      updated.add(key);
      return updated;
    });
    setFolded((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  }, []);

  /** Folds one row back to its first line (idempotent). */
  const fold = useCallback((key: string): void => {
    setFolded((current) => {
      if (current.has(key)) return current;
      const updated = new Set(current);
      updated.add(key);
      return updated;
    });
    setOpened((current) => {
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
   * while its value is being used). Only the pre-fill decides that — it depends
   * on the need and the reorder point, never on the chosen stock — so the order
   * is stable across renders.
   */
  const orderedNeeds = [
    ...needs.filter((need) => stockPrefill(need) < need.needed),
    ...needs.filter((need) => stockPrefill(need) >= need.needed),
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
    setTypedStocks((current) => {
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
    setTypedStocks((current) => {
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
    setTypedStocks((current) => {
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
    const lines = toBuy.map((entry) =>
      renderPantryLine(entry.need.ingredient, entry.buy, entry.need.baseUnit),
    );
    try {
      await onWrite(lines, inputs.recipes);
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
    // Whether the row is folded to its first line: the user's own last move
    // wins, and a row nobody touched follows its prefill — one that still needs
    // a purchase is unfolded, one whose pre-filled Vorrat already covers the
    // need is folded. That derivation is why the page needs no snapshot of the
    // filing when it opens.
    const collapsed = !opened.has(key) && (folded.has(key) || stockPrefill(need) >= need.needed);
    // The value the user typed through the "andere" keyboard, or a prefill that
    // is no suggestion at all (null = the row's custom chip is not needed).
    const customValue = customStockOf(need, typedStocks.get(key));
    // The custom value as a chip, labelled with the ingredient's full arrangement
    // (shopping unit included when one exists).
    const customChip: StockChip | null =
      customValue === null
        ? null
        : {
            value: customValue,
            label: renderPantryChip(need.ingredient, customValue, need.baseUnit),
          };
    // The suggested stock values as chips, each labelled with both units. The
    // custom value is left out so it never duplicates the edit chip below.
    const chips: StockChip[] = suggestedStocks(need)
      .filter((value) => value !== customValue)
      .map((value) => ({
        value,
        label: renderPantryChip(need.ingredient, value, need.baseUnit),
        // The largest suggestion (core rounds the need to the thousandth) means
        // "I have the whole quantity on stock" — mark it complete so StockChips
        // leads that chip with a check. `value > 0` keeps the degenerate
        // zero-need row (whose only chip is "0") from reading as complete.
        complete: value === roundThousandths(need.needed) && value > 0,
      }));

    // The "kaufen" side: the tappable amount while there is something to buy,
    // and a quiet em dash otherwise ("nothing to buy"). Built once and shared
    // by the folded and the unfolded row, so a zero buy reads the same in both.
    const buyContent =
      buy > 0 ? (
        <TappableAmount
          au={kaufen.au}
          baseUnit={need.baseUnit}
          aqDisplay={kaufen.aq === null ? null : formatPantryAq(kaufen.aq)}
          aqEdit={kaufen.aq ?? 0}
          bqDisplay={formatBQ(buy, need.baseUnit)}
          bqEdit={buy}
          onCommitAq={(count) => {
            setBuy(need, count * kaufen.factor);
            fold(key);
          }}
          onCommitBq={(amount) => {
            setBuy(need, amount);
            fold(key);
          }}
          label={`Kaufen für ${need.ingredient}`}
        />
      ) : (
        <span className="pantry-dash">—</span>
      );

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
            unfold(key);
          } else if (!isControl) {
            fold(key);
          }
        }}
      >
        {/* Line 1: what the selected dishes need together (left), and on its
            right the two quantities — the on-stock amount (folded rows only,
            led by a shelf symbol) and the bought amount (led by a shopping-cart
            symbol). A zero quantity reads as an em dash. */}
        <div className="pantry-head">
          {/* The need is the row's toggle and therefore a real button (§8), so a
              keyboard user can open and close the row. The row's own tap handler
              stays for the rest of the line, which is why this one stops the
              event: without that, a tap on the text would toggle twice. */}
          <button
            type="button"
            className="pantry-need"
            aria-expanded={!collapsed}
            onClick={(event) => {
              event.stopPropagation();
              if (collapsed) {
                unfold(key);
              } else {
                fold(key);
              }
            }}
          >
            {needText(need)}
          </button>
          {collapsed && (
            <span className="pantry-stock">
              <ShelfIcon className="pantry-stock-icon" optical={20} />
              {buy === 0 ? (
                // Everything is on stock: the quantity gives way to an olive
                // check badge, the one unmistakable "nothing to buy" marker.
                <span className="pantry-complete-badge" role="img" aria-label="Alles auf Vorrat">
                  <CheckIcon className="pantry-complete-badge-icon" optical={20} />
                </span>
              ) : stock > 0 ? (
                <span className="pantry-amount">
                  {renderPantryChip(need.ingredient, stock, need.baseUnit)}
                </span>
              ) : (
                <span className="pantry-dash">—</span>
              )}
            </span>
          )}
          {/* The folded summary separates the Vorrat from the kaufen amount with
              an em space (matching the intro's legend separators). */}
          {collapsed && '\u2003'}
          <span className="pantry-buy">
            <ShoppingCartIcon className="pantry-buy-icon" optical={20} />
            {buyContent}
          </span>
        </div>
        {/* Line 2: the stock chips (suggestions + the custom/“andere” entry),
            led by the shelf symbol, only while the row is unfolded. */}
        {!collapsed && (
          <div className="pantry-stock-line">
            <ShelfIcon className="pantry-stock-icon" optical={20} />
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
                fold(key);
              }}
              onCommitCustom={(value) => {
                commitCustom(need, value);
                fold(key);
              }}
              label={`Vorrat für ${need.ingredient}`}
            />
          </div>
        )}
      </div>
    );
  }

  /** The list, or the state it is in instead. */
  function renderList(): ReactNode {
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
    <main className="app app-narrow pantry-select">
      {/* "Zurück" on its own line at the top left, the screen title below it —
          the shared stacked header (.app-header-stacked). With a cooking step
          behind this one, the title carries its "Teil 2" subtitle, so the two
          corners of the flow are told apart at a glance. */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={requestLeave}>
          Zurück
        </button>
        <div className="app-header-title">
          <h1>Vorräte auswählen</h1>
          {hasSubRecipes && <p className="app-header-subtitle">Teil 2: Zutaten</p>}
        </div>
      </header>

      {/* The instruction under the title: the pick-a-stock rule, then — after an
          em space — the legend of the three symbols (shelf = on stock, check =
          everything on stock, cart = buy). */}
      <p className="pantry-select-intro">
        Wähle die Menge, die <strong>mindestens</strong> auf Vorrat ist, oder gib direkt die zu
        kaufende Menge ein.{'\u2003'}
        <span className="pantry-intro-legend-group">
          <span className="pantry-intro-legend">
            <ShelfIcon className="pantry-intro-icon" optical={20} />
            auf Vorrat
          </span>
          {'\u2003'}
          <span className="pantry-intro-legend">
            <CheckIcon className="pantry-intro-icon" optical={20} />
            alles auf Vorrat
          </span>
          {'\u2003'}
          <span className="pantry-intro-legend">
            <ShoppingCartIcon className="pantry-intro-icon" optical={20} />
            kaufen
          </span>
        </span>
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

      {/* The discard question. It stands only with a cooking step behind this
          page: that step is where the whole flow's amounts are entered, and it
          starts from its prefills again after this answer (see the props). The
          question's head carries the consequence, because the sheet explains
          nothing below it (§6.2). */}
      {confirmLeave && (
        <LeaveConfirmSheet
          question="Zurück zu Teil 1? Alle Mengen müssen neu eingegeben werden."
          confirmLabel="Zurück"
          onCancel={() => setConfirmLeave(false)}
          onConfirm={onRestartCooking}
        />
      )}
    </main>
  );
}

export default PantrySelect;
