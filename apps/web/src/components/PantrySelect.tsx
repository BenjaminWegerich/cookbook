/**
 * Pantry page, step 2 of the bundled shopping flow: the full-screen page
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
 * - the rows are filed by the **kitchen storage place** (decided with the user):
 *   core's `sortPantryNeeds` walks the current places (the Drive
 *   `lagerorte.csv`, seeded by docs/storage_places.csv)
 *   and, inside each place, puts the rows that still need a purchase before the
 *   covered ones, then sorts by name. An ingredient without a place sorts behind
 *   every sorted one. The page writes **no group headings** (decided with the
 *   user): the walk is implicit in the row order. Within a place the filing uses
 *   the *pre-filled* Vorrat only, so picking a chip updates its row's amounts in
 *   place instead of moving it under the user's finger; the amounts and the
 *   write always follow the *current* values — a row with nothing to buy is not
 *   written, wherever it stands.
 *
 * **A missing „Lagerort“ is entered here** (decided with the user): the row of
 * an ingredient with no place carries the same inline picker as „Einkaufsliste
 * sortieren“ — a „Lagerort“ caption, the current place chips below it, and the
 * dashed „Ignorieren“ chip beside them. Choosing a chip writes the master
 * data immediately (the shared `useStoragePlaceAssignment`); an **existing**
 * place is deliberately not editable here — the ingredient master-data sheet is
 * the place for that. „Ignorieren“ writes nothing and is remembered for this
 * visit only, so the same ingredient is asked about again next time.
 *
 * **One ingredient is three lines** (decided with the user):
 *
 * 1. the *need and the purchase*, side by side: left what the selected dishes
 *    need together, in the ingredient's familiar reading but always naming that
 *    exact amount (core's `needText`: an exact unit only when its count really
 *    brings the need home, an approximate unit as its count plus the
 *    authoritative base amount, otherwise the plain base form); right, smaller,
 *    the amount to buy behind a shopping-cart symbol — the amount in the
 *    ingredient's shopping unit while the unit can honestly name it (the number
 *    scheme allows the count, and an exact unit's count restates the amount),
 *    otherwise in the plain base form (core's `pantryReading`). Both sides derive
 *    their count from the same reading, so one amount carries one count: an
 *    approximate unit's count is a reading ("7 Stück (100 g)"), never a
 *    rounded-up purchase, and a count above an approximate unit's number scheme
 *    is not shown at all (800 g of cherry tomatoes stay "800 g");
 * 2. the *stock chips*: one row of the stock values where the bought amount
 *    changes — the package thresholds for an exact shopping unit, clean BQ
 *    values otherwise (core's `suggestedStocks`) — labelled with both units
 *    (core's `renderPantryChip`), led by a shelf symbol and shown in increasing
 *    order. The chip that covers the whole need carries a leading check and
 *    reads olive; its count is the need line's own count (core's `needAq`), so
 *    the chip that completes the need can never disagree with the need line
 *    above it. Only as many chips as fit on one row are shown; the rest hide
 *    behind the "andere" chip, which opens the keyboard on the Vorrat's
 *    base-quantity field. A typed value that is no suggestion then shows as an
 *    additional chip with an edit symbol (components/StockChips);
 * 3. the *storage-place picker*: the quiet „Lagerort“ caption, the place chips
 *    and the „Ignorieren“ action. It exists only while the ingredient has no
 *    place; an ingredient that is already sorted shows no picker at all.
 *
 * **Both quantities of the purchase line are tappable** (the count and the
 * grams/millilitres): each opens a keyboard, written as plain text rather than
 * a box. A typed amount must not be negative and is never rounded; the base
 * quantity is always typed in g / ml, the count in the shopping unit (converted
 * by its factor). Changing the Vorrat recomputes the "kaufen" default (to whole
 * packages for an exact shopping unit, to the missing base amount otherwise);
 * changing the "kaufen" amount back-computes the Vorrat and keeps the typed
 * amount exactly.
 *
 * **Rows fold and unfold** (decided with the user): an ingredient whose
 * pre-filled Vorrat already covers the need starts folded to its first line,
 * shown entirely at the purchase's smaller step; one that still needs a
 * purchase starts unfolded with its chips. A row **without a place** starts
 * unfolded and stays open until a place is chosen or „Ignorieren“ is tapped.
 * A row folds only when **both** conditions hold: its stock is confirmed (a
 * chip, a typed amount, the covering pre-fill, or a manual fold that accepts the
 * pre-fill) **and** its place is decided (an existing place, a chosen place, or
 * „Ignorieren“). Choosing a place therefore does not close a row whose stock is
 * still the unconfirmed pre-fill, and picking a stock does not close a row whose
 * place is still open. A folded row's first line reads the on-stock amount
 * behind a shelf symbol and the bought amount behind the cart symbol (a zero on
 * either side reads as an em dash); when everything is on stock, the on-stock
 * amount gives way to an olive check badge. A tap on a folded row's
 * non-interactive area opens it (a tap on its buy quantity also opens that
 * quantity's keyboard); a tap on an unfolded row's non-interactive area folds it
 * — confirming the pre-fill first when it is not confirmed yet, and only once
 * the place is decided; a tap outside a row does nothing. A committed change — a
 * chip, an "andere" value, or a buy quantity — folds its row too, under the same
 * two conditions. Only the user's own moves are stored (which rows they opened,
 * which they confirmed, which value they typed); the starting shape is derived
 * from the data, so the page holds no remembered defaults and a fresh visit
 * always starts from the data.
 *
 * "Liste schreiben" writes one line per row that currently has something
 * to buy, with the amount the row displays and the ingredient's name (core's
 * `renderPantryLine`: the sheet shows the unit in a count-form arrangement's
 * count position — "3 Stück (1 kg)" — and the written line names the ingredient
 * there — "3 Auberginen (1 kg)"), through App (which owns the Keep write, the
 * closing of the flow and the success notice with its undo). A failure is shown next to the button and
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
  auDisplayName,
  buyAmount,
  EN_SPACE,
  formatBQ,
  formatPantryAq,
  ingredientDisplayName,
  needAq,
  needText,
  NNBSP,
  pantryReading,
  renderPantryChipDisplay,
  renderPantryLine,
  shoppingUnitOf,
  splitArrangementNotes,
  sortPantryNeeds,
  stockPrefill,
  storagePlaceOf,
  suggestedStocks,
  type AdditionalUnit,
  type ShoppingNeed,
} from '@cookbook/core';

import { useStoragePlaceAssignment } from '../hooks/useStoragePlaceAssignment';
import { bottomLevelNeedsFor, type ShoppingInputs } from '../keep/shoppingBundle';
import ArrangementLine from './ArrangementLine';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import StoragePlacePicker from './StoragePlacePicker';
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
   * Drive access token, needed by the inline „Lagerort“ picker: assigning a
   * kitchen place writes the ingredient master data immediately.
   */
  token: string;
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
 * The count the need line names for this row, as `pantryReading` options, when
 * the row's amount **is** the need (stock 0, or a typed buy equal to it); an
 * empty options object otherwise. The cart, the stock chip at the need and the
 * written line all use it, so one amount carries the need line's own count. The
 * aggregate's shared-unit sum may name a count above the number scheme (several
 * dishes that each read "20 Stück" need "40 Stück"), which the per-amount
 * optimizer must not re-invent — so this is the one place the count is supplied.
 */
function needCountOptions(need: ShoppingNeed, buy: number): { aq?: number } {
  const count = needAq(need);
  if (count === null || buy !== roundThousandths(need.needed)) {
    return {};
  }
  return { aq: count };
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
 * unit stay inside a single tap target. `unitLabel` is the unit's singular or
 * plural display form for the shown count (`auDisplayName`); `infLabel` stands
 * where the arrangement's count-form placeholder `<INF>` sits.
 *
 * The arrangement's parenthesized note is split out exactly like the recipe
 * rows do (only the written shopping list keeps the brackets): it follows one en
 * space in the muted, italic `.arrangement-note` run. Its tappable base amount
 * stays inside that run and inherits the look.
 */
function renderArrangement(
  au: AdditionalUnit,
  unitLabel: string,
  infLabel: string,
  aqNode: ReactNode,
  bqNode: ReactNode,
  bu: string,
): ReactNode {
  const templateParts = splitArrangementNotes(au.arrangement);
  return templateParts.map((part, partIndex) => {
    const template = part.template
      .replaceAll('<BQ><NNBSP><BU>', '<BQBU>')
      .replaceAll('<BQ> <BU>', '<BQBU>')
      // The pantry shows the ingredient name elsewhere on the row, so the
      // canonical <IN> drops out; <INF> keeps its place and is rendered as
      // `infLabel` (the unit's form for a count-form arrangement, the
      // ingredient's count form inside a bracket that names the item).
      .replaceAll('<IN>', '')
      // A name-less arrangement drops the name placeholder and its leading space,
      // leaving a double space before the base quantity's parenthesis — collapse
      // it like core's own name-less renderer does.
      .replaceAll('  ', ' ');
    // The space before the bracket gives way to the display's en space.
    const next = templateParts[partIndex + 1];
    const pieces = (next?.kind === 'note' ? template.replace(/\s+$/, '') : template).split(
      /(<AQ>|<AU>|<INF>|<BQBU>|<BQ>|<BU>|<NNBSP>)/g,
    );
    const nodes = pieces.map((piece, index) => {
      switch (piece) {
        case '<AQ>':
          return <Fragment key={index}>{aqNode}</Fragment>;
        case '<AU>':
          return <Fragment key={index}>{unitLabel}</Fragment>;
        case '<INF>':
          return <Fragment key={index}>{infLabel}</Fragment>;
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
          return <Fragment key={index}>{piece}</Fragment>;
      }
    });
    return part.kind === 'note' ? (
      // The en space lives inside the note run: .pantry-amount is a flex row,
      // where a lone whitespace text node would become an empty flex item.
      <span className="arrangement-note" key={partIndex}>
        {EN_SPACE}
        {nodes}
      </span>
    ) : (
      <Fragment key={partIndex}>{nodes}</Fragment>
    );
  });
}

interface TappableAmountProps {
  /** The ingredient the amount belongs to (the `<INF>` count form). */
  ingredient: string;
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
  ingredient,
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
      unitName={auDisplayName(au, aqEdit)}
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
  const unitLabel = auDisplayName(au, aqEdit);
  // A count-form arrangement uses <INF> as its count marker ("3 Auberginen
  // (1 kg)"); the sheet shows the unit's own form instead ("3 Stück"), unless
  // the template names the ingredient elsewhere with <IN> — then <INF>
  // identifies the item ("1 Dose Kichererbsen") and keeps that form.
  const infLabel = au.arrangement.includes('<IN>')
    ? ingredientDisplayName(ingredient, aqEdit)
    : unitLabel;
  return (
    <span className="pantry-amount">
      {renderArrangement(au, unitLabel, infLabel, aqNode, bqNode, baseUnit)}
    </span>
  );
}

/**
 * The pantry page, step 2 (see the file header). It owns the chosen stocks and
 * the buy amounts; the resolved bundle, the cooking decisions, the Keep write
 * and the flow itself belong to App.
 */
function PantrySelect({
  token,
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
   * The rows the *user* opened. A row nobody touched follows the data — one
   * that still needs a purchase is unfolded, one whose pre-filled Vorrat already
   * covers the need is folded — plus the two new conditions below: a missing
   * „Lagerort“ keeps a row open, and a row can only be folded back when both its
   * stock and its place decision are settled.
   */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The rows whose stock the user confirmed by folding them without touching a
   * chip — the tap accepts the pre-filled amount. Chips and typed amounts are
   * confirmed through `stocks`; a pre-fill that covers the need is confirmed by
   * the data itself (see `stockConfirmedOf`).
   */
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The shared „Lagerort“ state of the page: missing places are entered inline
   * (chips + „Ignorieren“), immediately written as ingredient master data, and
   * skipped rows are remembered for this visit only.
   */
  const places = useStoragePlaceAssignment(token);

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
  }, []);

  /** Folds one row back to its first line (idempotent). */
  const fold = useCallback((key: string): void => {
    setOpened((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  }, []);

  /**
   * The rows in the pantry order (core's `sortPantryNeeds`): the kitchen walk
   * from the storage-place master data, the rows that still need a purchase
   * first *inside each place*, then German alphabetical. The order is implicit —
   * the page writes no group headings (decided with the user). It is derived on
   * every render: the place is registry state read through `storagePlaceOf`, so
   * a successful assignment re-files the page. Within a place the order uses the
   * *pre-filled* Vorrat only, so choosing a stock chip never moves a row under
   * the finger.
   */
  const orderedNeeds = sortPantryNeeds(needs);

  /**
   * The rows with the chosen stock and buy amount, in the displayed order. The
   * stock is rounded to the thousandth so the chip comparison and the tappable
   * fields never see the float noise a summed need can carry.
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
      renderPantryLine(
        entry.need.ingredient,
        entry.buy,
        entry.need.baseUnit,
        needCountOptions(entry.need, entry.buy),
      ),
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
    // The count the need line itself names (`needText`), used for the chip that
    // completes the need: the chip at the need's amount must read like the need
    // line above it.
    const needCount = needAq(need);
    const needed = roundThousandths(need.needed);
    const chipCountOf = (value: number) =>
      value === needed && needCount !== null ? { aq: needCount } : undefined;
    // The purchase side reads the buy amount exactly like the stock chips and
    // the Keep line do (`renderPantryLine`): one amount, one count, one unit. At
    // stock 0 the buy amount *is* the need, so it takes the need line's own count
    // (the aggregate's sum may name a count the per-amount optimizer would not
    // invent by itself); a smaller buy amount is read on its own.
    const kaufen = pantryReading(need.ingredient, buy, need.baseUnit, needCountOptions(need, buy));
    const key = rowKey(need.ingredient, need.baseUnit);
    const place = storagePlaceOf(need.ingredient);
    const ignored = places.ignored.has(need.ingredient);
    // A missing place keeps the row open (the inline picker is the decision);
    // „Ignorieren“ settles it for this visit without writing master data.
    const placeDecided = place !== null || ignored;
    // The first collapse condition: the stock is confirmed. A chip or a typed
    // amount confirms it through `stocks`; a manual fold confirms the pre-fill
    // through `confirmed`; a pre-fill that covers the need is confirmed by the
    // data itself.
    const stockConfirmed =
      stocks.has(key) || confirmed.has(key) || stockPrefill(need) >= need.needed;
    // Both conditions (plus the user's own open state) decide the first line.
    const collapsed = placeDecided && stockConfirmed && !opened.has(key);

    /**
     * A tap on the row's non-interactive area (or its need) confirms the
     * pre-filled stock and folds the row — but the fold waits until the place is
     * decided too. A row without a place therefore stays open with its picker,
     * even though the tap already settled the stock half.
     */
    function confirmAndFold(): void {
      if (!stockConfirmed) {
        setConfirmed((current) => new Set(current).add(key));
      }
      if (placeDecided) fold(key);
    }
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
            label: (
              <ArrangementLine
                display={renderPantryChipDisplay(
                  need.ingredient,
                  customValue,
                  need.baseUnit,
                  chipCountOf(customValue),
                )}
              />
            ),
          };
    // The suggested stock values as chips, each labelled with both units. The
    // custom value is left out so it never duplicates the edit chip below.
    const chips: StockChip[] = suggestedStocks(need)
      .filter((value) => value !== customValue)
      .map((value) => ({
        value,
        label: (
          <ArrangementLine
            display={renderPantryChipDisplay(
              need.ingredient,
              value,
              need.baseUnit,
              chipCountOf(value),
            )}
          />
        ),
        // The largest suggestion (core rounds the need to the thousandth) means
        // "I have the whole quantity on stock" — mark it complete so StockChips
        // leads that chip with a check. `value > 0` keeps the degenerate
        // zero-need row (whose only chip is "0") from reading as complete.
        complete: value === needed && value > 0,
      }));

    // The "kaufen" side: the tappable amount while there is something to buy,
    // and a quiet em dash otherwise ("nothing to buy"). Built once and shared
    // by the folded and the unfolded row, so a zero buy reads the same in both.
    const buyContent =
      buy > 0 ? (
        <TappableAmount
          ingredient={need.ingredient}
          au={kaufen.au}
          baseUnit={need.baseUnit}
          aqDisplay={kaufen.aq === null ? null : formatPantryAq(kaufen.aq)}
          aqEdit={kaufen.aq ?? 0}
          bqDisplay={formatBQ(buy, need.baseUnit)}
          bqEdit={buy}
          onCommitAq={(count) => {
            setBuy(need, count * kaufen.factor);
            if (placeDecided) fold(key);
          }}
          onCommitBq={(amount) => {
            setBuy(need, amount);
            if (placeDecided) fold(key);
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
            confirmAndFold();
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
                confirmAndFold();
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
                  <ArrangementLine
                    display={renderPantryChipDisplay(need.ingredient, stock, need.baseUnit)}
                  />
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
              // Without a shopping unit the suggestions are BQ amounts, not
              // package thresholds: the typed-value entry ("andere") must always
              // stay reachable, so it is kept visible instead of hiding behind an
              // overflow.
              alwaysShowAndere={kaufen.au === null}
              onChange={(next) => {
                setStock(need, next);
                if (placeDecided) fold(key);
              }}
              onCommitCustom={(value) => {
                commitCustom(need, value);
                if (placeDecided) fold(key);
              }}
              label={`Vorrat für ${need.ingredient}`}
            />
          </div>
        )}
        {/* Line 3: the „Lagerort“ decision, inline like the shopping-sort
            page's „Markt“ chips — only for an ingredient that has no place yet.
            Existing places are not edited here (decided with the user); the
            master-data sheet is the place for that. */}
        {!collapsed && place === null && (
          <StoragePlacePicker
            ingredient={need.ingredient}
            ignored={ignored}
            saving={places.saving.has(need.ingredient)}
            error={places.errors.get(need.ingredient) ?? null}
            onAssign={(zone) => void places.assign(need.ingredient, zone)}
            onToggleIgnore={() => places.toggleIgnore(need.ingredient)}
          />
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
            {busy ? 'Wird geschrieben …' : 'Liste schreiben'}
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
