/**
 * Cooking step, step 1 of the bundled shopping flow: the full-screen page
 * "Vorräte auswählen — Teil 1: Zutaten-Rezepte" (App's `pantrySub` layer).
 *
 * The step exists only when the selection reaches at least one sub-recipe. It
 * asks one question per sub-recipe — *how much of it is already made?* — and
 * derives the amount to cook from the answer. The rows are core's
 * `planSubRecipes` (through ../keep/shoppingBundle), the arithmetic is exact:
 *
 * ```
 *   required = Σ over every parent of its scaled use      (core: `required`)
 *   stock    = min(required, reorder point)               (core: `defaultStock`)
 *   cook     = required − stock                           (core: `cook`)
 * ```
 *
 * **The stock is the input, the cooking amount is the result.** The row reads
 * exactly like step 2's: left the requirement, right the amount to cook behind a
 * **skillet** instead of the shopping cart — this step never buys, it cooks. The
 * stock chips below the line are BQ-based amounts a shelf can hold
 * (`suggestedSubRecipeStocks`, deliberately *not* the package thresholds of a
 * shopping unit: a sub-recipe is cooked food, and even a sub-recipe whose name
 * happens to be registered with a shopping unit is not bought in packs). The
 * last chip covers the whole requirement and reads olive, "andere" opens the
 * keyboard on the stock, and both readings are tappable as plain text
 * (components/TappableQuantity).
 *
 * A typed **cooking** amount is kept exactly (to the sheet's thousandth
 * precision): a cooking amount is a scaled recipe size, and any positive amount
 * can be scaled down into the sub-recipe's own ingredients by `cook / yield`
 * (docs/quantity_scaling.md §7). There is no ladder rung to snap to any more.
 *
 * **A row whose requirement moves is invalidated** (decided with the user): the
 * rows below it need something else now, so the amount the user chose no longer
 * answers the question. Such a row
 *
 * - unfolds and is highlighted (an accent frame, a tinted surface and a quiet
 *   "Menge hat sich geändert – Vorrat prüfen" line),
 * - falls back to its prefill (`min(required, reorder point)`) — the earlier
 *   choice is dropped, not hidden, or it would reappear with the next change,
 * - and therefore has to be edited again before "Weiter" opens.
 *
 * Which rows those are comes from the requirement each row was *acknowledged*
 * at: folding a row acknowledges it at its current requirement. Since dropping a
 * row's stock changes what the rows below it need, the plan is recomputed until
 * no further row drops out (at most one round per sub-recipe — see `view`).
 *
 * **"Weiter" opens only when every row is folded**, so the amounts are decided
 * deliberately and none is left half-answered. It hands the resolved bundle and
 * the cooking decisions to App, which opens step 2 ("Teil 2: Zutaten", the
 * bottom level, and the only step that buys).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  formatBQ,
  suggestedSubRecipeStocks,
  type FamilyUnit,
  type ShoppingNeed,
  type SubRecipeNode,
} from '@cookbook/core';

import {
  resolveShoppingBundle,
  resolvedSubRecipePlanFor,
  subRecipePlanFor,
  type ShoppingInputs,
} from '../keep/shoppingBundle';
import type { MealPlanCard } from '../keep/mealPlanCards';
import type { StoredRecipe } from '../drive/recipeStorage';
import { CheckIcon, ShelfIcon, SkilletIcon } from './icons';
import StockChips, { type StockChip } from './StockChips';
import TappableQuantity from './TappableQuantity';
import { roundThousandths } from './pantryInput';

interface SubRecipeSelectProps {
  /**
   * The dishes the selection page handed over (the recognized meal-plan cards,
   * in Keep's order). Fixed for the page's lifetime: this is the bundle the user
   * confirmed there, not a live view of the plan.
   */
  cards: readonly MealPlanCard[];
  /** Drive access token, needed to read the selected recipes' ingredient lists. */
  token: string;
  /** The recipe list, which names the recipes a sub-recipe link can point at. */
  collection: readonly StoredRecipe[];
  /** Leaves the flow for the dish selection (header "Zurück", browser Back). */
  onBack: () => void;
  /**
   * Hands the resolved bundle and the cooking decisions over: App opens step 2
   * with them, or — when the bundle holds no sub-recipe at all, which the page
   * detects itself right after loading — skips this step entirely.
   */
  onNext: (inputs: ShoppingInputs, decisions: ReadonlyMap<string, number>) => void;
}

/**
 * The requirement of a sub-recipe in the shape core's stock helpers take
 * (`ShoppingNeed`): the BQ-based stock suggestions and the prefill only read
 * these four fields, so the cooking rows can share every helper step 2 uses.
 */
function needOf(node: SubRecipeNode): ShoppingNeed {
  return {
    ingredient: node.name,
    baseUnit: node.baseUnit,
    needed: node.required,
    reorderPoint: node.reorderPoint,
  };
}

/** A stock or cooking amount as plain text ("600 g"); an empty one reads 0. */
function baseLabel(value: number, unit: FamilyUnit): string {
  return value > 0 ? formatBQ(value, unit) : '0';
}

/** The requirement of a sub-recipe as its line: amount and name ("600 g Pesto"). */
function requirementText(node: SubRecipeNode): string {
  return `${formatBQ(node.required, node.baseUnit)} ${node.name}`;
}

/**
 * The one stock value a row shows as its own editable chip instead of a
 * suggestion, or null when its suggestions cover the amount: a value the user
 * typed through "andere", or a prefill that falls between two suggestions (a
 * reorder point need not be a suggestion).
 */
function customStockOf(node: SubRecipeNode, typed: number | undefined): number | null {
  if (typed !== undefined) {
    return typed;
  }
  const stock = node.defaultStock;
  if (stock <= 0 || stock >= node.required) {
    return null;
  }
  return suggestedSubRecipeStocks(needOf(node)).includes(stock) ? null : stock;
}

/** One rendered row: the sub-recipe, its invalidation and its shape. */
interface CookRow {
  readonly node: SubRecipeNode;
  /** True when the requirement moved away from the acknowledged one. */
  readonly stale: boolean;
  /** True while the row shows its chips (folded = acknowledged). */
  readonly expanded: boolean;
}

/**
 * The cooking page (see the file header). It owns the cooking decisions and the
 * acknowledgement state; the bundle comes from Drive, the flow from App.
 */
function SubRecipeSelect({ cards, token, collection, onBack, onNext }: SubRecipeSelectProps) {
  /** The resolved bundle, or null while it loads. */
  const [inputs, setInputs] = useState<ShoppingInputs | null>(null);
  /** Why the bundle could not be built (a recipe file was unreadable). */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * The chosen stock per sub-recipe name. Only rows the user actually decided
   * are stored; every other row follows its prefill, so the page never holds a
   * remembered copy of a value that comes from the data.
   */
  const [decisions, setDecisions] = useState<ReadonlyMap<string, number>>(() => new Map());
  /**
   * The stock the user typed through the "andere" keyboard, per name (absent =
   * none typed). A prefill that is no chip at all is derived instead (see
   * `customStockOf`).
   */
  const [typedStocks, setTypedStocks] = useState<ReadonlyMap<string, number>>(() => new Map());
  /**
   * The requirement each row was *acknowledged* at, per name. A row nobody
   * acknowledged is not in here and stays unfolded; a row whose requirement has
   * moved away from its entry is invalidated (see the file header).
   */
  const [acknowledged, setAcknowledged] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** The rows the user opened although they were acknowledged. */
  const [openedRows, setOpenedRows] = useState<ReadonlySet<string>>(() => new Set());

  // Load and walk the bundle once the page is open. `cards`, `token` and the
  // collection are fixed for its lifetime (App resolves them before opening the
  // page, and the page unmounts when the flow leaves it), so there is no state to
  // reset here — only the result of the request. State is updated in the promise
  // callbacks, never synchronously, so the "no state update in an effect" rule
  // stays satisfied.
  useEffect(() => {
    let cancelled = false;
    void resolveShoppingBundle(cards, token, collection)
      .then((resolved) => {
        if (cancelled) return;
        // No sub-recipe in this bundle: the cooking step has nothing to ask, so
        // the flow goes straight to the bottom level — which then shows no
        // "Teil 2" subtitle either, because Teil 1 does not exist.
        if (resolved.recipesByTitle.size === 0) {
          onNext(resolved, new Map());
          return;
        }
        // A row whose prefill already covers its requirement needs no decision
        // and starts folded, i.e. acknowledged at that requirement. Every other
        // row starts unfolded and has to be acknowledged before "Weiter" opens.
        const plan = subRecipePlanFor(resolved);
        setAcknowledged(
          new Map(
            plan.nodes.filter((node) => node.cook === 0).map((node) => [node.name, node.required]),
          ),
        );
        setInputs(resolved);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cards, token, collection, onNext]);

  /**
   * The rows the page renders: core's `resolveSubRecipePlan` applied to the
   * bundle, the chosen stocks and the acknowledged requirements. It owns the
   * invalidation rule and its downward cascade (a row whose requirement moved
   * loses its stock and marks the rows below it in turn), so this page only
   * turns the result into rows: invalidated and never-acknowledged ones are
   * unfolded, everything else is folded. `effective` is what "Weiter" hands
   * over — exactly the decisions that survived.
   */
  const view = useMemo(() => {
    if (inputs === null) {
      return null;
    }
    const { plan, invalidated, effective } = resolvedSubRecipePlanFor(
      inputs,
      decisions,
      acknowledged,
    );
    const rows: CookRow[] = plan.nodes.map((node) => ({
      node,
      stale: invalidated.has(node.name),
      expanded:
        invalidated.has(node.name) ||
        acknowledged.get(node.name) === undefined ||
        openedRows.has(node.name),
    }));
    return { rows, effective };
  }, [inputs, decisions, acknowledged, openedRows]);

  /** Opens one row (idempotent — an already-open row is left alone). */
  function openRow(name: string): void {
    setOpenedRows((current) => {
      if (current.has(name)) return current;
      const updated = new Set(current);
      updated.add(name);
      return updated;
    });
  }

  /**
   * Folds one row, i.e. acknowledges it at its current requirement, and closes
   * it. An invalidated row loses its old choice here for good: falling back to
   * the prefill is the point of the invalidation, so keeping the value would
   * bring it back with the next change of the requirement.
   */
  function acknowledge(name: string, required: number, stale: boolean): void {
    setAcknowledged((current) => new Map(current).set(name, required));
    setOpenedRows((current) => {
      if (!current.has(name)) return current;
      const updated = new Set(current);
      updated.delete(name);
      return updated;
    });
    if (stale) {
      setDecisions((current) => {
        const updated = new Map(current);
        updated.delete(name);
        return updated;
      });
      setTypedStocks((current) => {
        const updated = new Map(current);
        updated.delete(name);
        return updated;
      });
    }
  }

  /** Remembers a stock picked on a chip; it acknowledges the row and folds it. */
  function setStock(name: string, required: number, next: number): void {
    const stock = Math.max(0, roundThousandths(next));
    setDecisions((current) => new Map(current).set(name, stock));
    setTypedStocks((current) => {
      const updated = new Map(current);
      updated.delete(name);
      return updated;
    });
    acknowledge(name, required, false);
  }

  /** Remembers a stock typed through "andere" as the row's stock *and* its
   *  custom chip; it acknowledges the row and folds it too. */
  function commitCustom(name: string, required: number, next: number): void {
    const stock = Math.max(0, roundThousandths(next));
    setDecisions((current) => new Map(current).set(name, stock));
    setTypedStocks((current) => new Map(current).set(name, stock));
    acknowledge(name, required, false);
  }

  /**
   * Types the amount to cook: it is kept exactly (to the sheet's thousandth
   * precision) and the stock is back-computed from it, so the two readings can
   * never disagree. No ladder rung is involved (see the file header).
   */
  function setCook(name: string, required: number, typed: number): void {
    const cooked = typed > 0 ? roundThousandths(typed) : 0;
    setStock(name, required, Math.max(0, roundThousandths(required - cooked)));
  }

  /** One sub-recipe row: the requirement with the cooking amount on its right,
   *  and the stock chips below (only while the row is unfolded). */
  function renderRow(row: CookRow): ReactNode {
    const { node, stale, expanded } = row;
    const key = node.name;
    // The value the user typed through "andere", or a prefill that is no
    // suggestion at all (null = the row needs no custom chip). A stale row shows
    // neither: its decision fell back to the prefill, so a chip standing for the
    // dropped value would contradict the amount the row displays.
    const customValue = customStockOf(node, stale ? undefined : typedStocks.get(key));
    // The suggested stock values as chips, each labelled in the base form. The
    // custom value is left out so it never duplicates the edit chip below.
    const chips: StockChip[] = suggestedSubRecipeStocks(needOf(node))
      .filter((value) => value !== customValue)
      .map((value) => ({
        value,
        label: baseLabel(value, node.baseUnit),
        // The largest suggestion (core rounds the requirement to the thousandth)
        // means "I have the whole amount on stock" — mark it complete so
        // StockChips leads that chip with a check. `value > 0` keeps a degenerate
        // zero-requirement row from reading as complete.
        complete: value === roundThousandths(node.required) && value > 0,
      }));
    const customChip: StockChip | null =
      customValue === null
        ? null
        : { value: customValue, label: baseLabel(customValue, node.baseUnit) };

    // The cooking side: the tappable amount while something is to cook, and a
    // quiet em dash otherwise ("nothing to cook"). Shared by the folded and the
    // unfolded row, so a zero reads the same in both.
    const cookContent =
      node.cook > 0 ? (
        <TappableQuantity
          display={formatBQ(node.cook, node.baseUnit)}
          editValue={node.cook}
          unitName={node.baseUnit}
          onCommit={(typed) => setCook(key, node.required, typed)}
          label={`Kochen für ${node.name}`}
        />
      ) : (
        <span className="pantry-dash">—</span>
      );

    return (
      <div
        className={`pantry-row${expanded ? '' : ' pantry-row--collapsed'}${
          stale ? ' pantry-row--attention' : ''
        }`}
        key={key}
        onClick={(event) => {
          // The row toggles on a tap to its non-interactive area: a folded row
          // opens, an unfolded row folds (i.e. acknowledges itself). A folded row
          // opens on *any* tap — the cooking amount's own onClick additionally
          // opens its keyboard (it runs first, and both compose). An unfolded row
          // folds only when the tap did not land on an input field or a chip.
          const target = event.target;
          const isControl = target instanceof Element && target.closest('button, input') !== null;
          if (!expanded) {
            openRow(key);
          } else if (!isControl) {
            acknowledge(key, node.required, stale);
          }
        }}
      >
        {/* Line 1: what the sub-recipes above require (left), and on its right
            the two amounts — the on-stock amount (folded rows only, led by a
            shelf symbol) and the amount to cook (led by a skillet). A zero
            amount reads as an em dash. */}
        <div className="pantry-head">
          {/* The requirement is the row's toggle and therefore a real button
              (§8), so a keyboard user can open and close the row. The row's own
              tap handler stays for the rest of the line, which is why this one
              stops the event: without that, a tap on the text would toggle
              twice. */}
          <button
            type="button"
            className="pantry-need"
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              if (expanded) {
                acknowledge(key, node.required, stale);
              } else {
                openRow(key);
              }
            }}
          >
            {requirementText(node)}
          </button>
          {!expanded && (
            <span className="pantry-stock">
              <ShelfIcon className="pantry-stock-icon" optical={20} />
              {node.cook === 0 ? (
                // Everything is on stock: the amount gives way to an olive check
                // badge, the one unmistakable "nothing to cook" marker.
                <span className="pantry-complete-badge" role="img" aria-label="Alles auf Vorrat">
                  <CheckIcon className="pantry-complete-badge-icon" optical={20} />
                </span>
              ) : node.stock > 0 ? (
                <span className="pantry-amount">{baseLabel(node.stock, node.baseUnit)}</span>
              ) : (
                <span className="pantry-dash">—</span>
              )}
            </span>
          )}
          {/* The folded summary separates the Vorrat from the cooking amount with
              an em space (matching the intro's legend separators). */}
          {!expanded && '\u2003'}
          <span className="pantry-buy">
            <SkilletIcon className="pantry-buy-icon" optical={20} />
            {cookContent}
          </span>
        </div>
        {/* The invalidation note, right under the line it belongs to: the
            requirement moved, so the amount below has to be looked at again. */}
        {stale && <p className="pantry-attention-note">Menge hat sich geändert – Vorrat prüfen.</p>}
        {/* Line 2: the stock chips (suggestions + the custom/“andere” entry), led
            by the shelf symbol, only while the row is unfolded. */}
        {expanded && (
          <div className="pantry-stock-line">
            <ShelfIcon className="pantry-stock-icon" optical={20} />
            <StockChips
              chips={chips}
              value={node.stock}
              baseUnit={node.baseUnit}
              customChip={customChip}
              // The suggestions are BQ-based amounts, never package thresholds: the
              // typed-value entry ("andere") must always stay reachable.
              alwaysShowAndere
              onChange={(next) => setStock(key, node.required, next)}
              onCommitCustom={(value) => commitCustom(key, node.required, value)}
              label={`Vorrat für ${node.name}`}
            />
          </div>
        )}
      </div>
    );
  }

  /** True when every row is folded, i.e. acknowledged and not invalidated. */
  const ready = view !== null && view.rows.every((row) => !row.expanded);

  return (
    <main className="app app-narrow pantry-select">
      {/* "Zurück" on its own line at the top left, the screen title below it.
          The subtitle only appears once the page knows it really has rows: if
          the bundle turns out to hold no sub-recipe, this page leaves for step 2
          right away and never claims to be a step of its own. */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={onBack}>
          Zurück
        </button>
        <div className="app-header-title">
          <h1>Vorräte auswählen</h1>
          {inputs !== null && <p className="app-header-subtitle">Teil 1: Zutaten-Rezepte</p>}
        </div>
      </header>

      {/* The instruction under the title: the pick-a-stock rule, then — after an
          em space — the legend of the three symbols (shelf = on stock, check =
          everything on stock, skillet = cook). */}
      <p className="pantry-select-intro">
        Wähle die Menge, die <strong>mindestens</strong> auf Vorrat ist, oder gib direkt die zu
        kochende Menge ein.{'\u2003'}
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
            <SkilletIcon className="pantry-intro-icon" optical={20} />
            kochen
          </span>
        </span>
      </p>

      {loadError !== null ? (
        <p className="pantry-load-error" role="alert">
          Die Zutaten konnten nicht geladen werden. {loadError}
        </p>
      ) : view === null ? (
        <p className="loading-message" role="status">
          Zutaten werden geladen …
        </p>
      ) : (
        <div className="pantry-table" role="group" aria-label="Zutaten-Rezepte und Vorräte">
          {view.rows.map(renderRow)}
        </div>
      )}

      {/* The forward action of this step: it asks for nothing itself, it hands
          the cooking decisions to the bottom level. It stays unavailable while a
          row is unfolded — folding a row is how the user acknowledges it, and
          that is what makes the amounts deliberate. */}
      {view !== null && inputs !== null && (
        <div className="pantry-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onNext(inputs, view.effective)}
            disabled={!ready}
          >
            Weiter
          </button>
          {!ready && (
            <p className="pantry-action-note" role="status">
              Klappe jede Zeile ein, um sie zu bestätigen.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

export default SubRecipeSelect;
