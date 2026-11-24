/**
 * Shopping-list sort — a two-step flow (docs/DESIGN.md §5.14,
 * docs/shopping_item_identity.md §8).
 *
 * **Step 1 — „Einkaufsliste sortieren“.** Only unchecked lines that name no item
 * are listed. Per line the user either confirms a similar item (which writes a
 * synonym), assigns one or more locations under a new item name (one location
 * per market, at most one section per market), or ignores the line for this run.
 * A new item needs at least one location. The row stays open after the first
 * location so more can be added; it folds to a one-line summary only when focus
 * leaves it. „Weiter“ hands the decisions to step 2.
 *
 * **Step 2 — „Einkaufsweg wählen“.** The core recommendation
 * (`recommendShoppingMarkets`, docs/shopping_item_identity.md §7) preselects the
 * markets: mandatory markets, the smallest coverage set, then every market that
 * takes over more than 10 items. The user can toggle any market; the live
 * summary reports coverage, uncovered items, downgraded items and ignored lines.
 * „Liste sortieren“ is the only action that writes.
 *
 * **The decisions are unsaved until „Liste sortieren“ is pressed, so leaving
 * asks first.** The market step's „Zurück“ returns to step 1 with all decisions
 * intact; leaving the flow from step 1 uses the shared leave guard
 * (useLeaveGuard, DESIGN §6.2).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FocusEvent, ReactNode, Ref } from 'react';

import {
  allShoppingMarketRanks,
  allShoppingStops,
  assignShoppingDemand,
  matchShoppingItem,
  recommendShoppingMarkets,
  shoppingItemSuggestions,
  shoppingMarketRanksForRoute,
  shoppingMarketWouldTake,
  shoppingNameField,
  shoppingNameKey,
  shoppingSections,
  shoppingStopsFor,
  shoppingStores,
  type ShoppingItemDemand,
  type ShoppingMarketRecommendation,
  type ShoppingSortLine,
  type ShoppingStop,
} from '@cookbook/core';

import type { KeepItem } from '../keep/keepClient';
import { useEscapeTrigger, useLeaveGuard } from '../hooks/useLeaveGuard';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import { CloseIcon } from './icons';

/**
 * The browser-Back consumer of this flow (see App's popstate handler). The
 * decisions behind „Zurück“ are unsaved work, so Back arms the same discard
 * question the header's button does instead of dropping them silently.
 */
export interface ShoppingSortSelectHandle {
  /**
   * Asks before leaving and reports whether the flow handled the Back. False
   * means the caller may leave: the flow holds nothing to discard.
   */
  notifyBack: () => boolean;
}

/**
 * How one unresolved line was decided:
 * - `item` — a new (or corrected) item row set under `name` at `stops`; when the
 *   line's own name differs from `name`, the line name is also stored as a
 *   synonym of that item;
 * - `synonym` — `variant` (the line's name field) means the existing `item`,
 *   which resolves the line without touching the item table
 *   (docs/shopping_item_identity.md §4);
 * - `'ignored'` — no master data, end of the list, asked again next run.
 */
export type SortResolution =
  | {
      readonly kind: 'item';
      readonly name: string;
      readonly stops: readonly ShoppingStop[];
      /**
       * The line's own name field, saved as a synonym of `name` when the
       * „Artikel“ name was changed (null/absent when the two names are equal).
       */
      readonly variant?: string;
    }
  | { readonly kind: 'synonym'; readonly variant: string; readonly item: string }
  | 'ignored';

interface ShoppingSortSelectProps {
  /** The shopping-list items in Keep's display order (top first) — a snapshot. */
  items: readonly KeepItem[];
  /**
   * Leaves the page for the home screen — the guard's confirmed exit (the
   * question's „Verwerfen“) or an exit with no decision to discard.
   */
  onClose: () => void;
  /**
   * Applies the decisions: persists the new item rows and synonyms, reorders the
   * list through the gateway for the selected markets, and closes the flow.
   * Resolves on success; a failure is thrown and shown next to the button.
   */
  onSort: (
    resolutions: ReadonlyMap<string, SortResolution>,
    selectedMarkets: readonly string[],
    lines: readonly ShoppingSortLine[],
  ) => Promise<void>;
  /** See ShoppingSortSelectHandle — React 19 passes `ref` as an ordinary prop. */
  ref?: Ref<ShoppingSortSelectHandle>;
}

/** One unresolved line the page asks the user about. */
interface UnresolvedEntry {
  /** The exact Keep line text (the resolution map's key). */
  text: string;
  /** The line's name field — the initial „Artikel“ text and a synonym's variant. */
  nameField: string;
}

type Step = 'items' | 'markets';

/**
 * The unchecked lines that name no item, deduplicated by text (two identical
 * lines are the same item and get one decision). A line that already resolved is
 * not listed: it is sorted silently (docs/shopping_item_identity.md §6).
 */
function unresolvedEntries(items: readonly KeepItem[]): UnresolvedEntry[] {
  const seen = new Set<string>();
  const entries: UnresolvedEntry[] = [];
  for (const item of items) {
    if (item.checked) continue;
    const text = item.text.trim();
    if (text === '' || seen.has(text) || matchShoppingItem(text) !== null) continue;
    seen.add(text);
    entries.push({ text, nameField: shoppingNameField(text) });
  }
  return entries;
}

/** The distinct relevant items of the current decisions, for the recommendation. */
function buildMarketDemand(
  items: readonly KeepItem[],
  resolutions: ReadonlyMap<string, SortResolution>,
): ShoppingItemDemand[] {
  const byItem = new Map<string, { item: string; locations: Map<string, ShoppingStop> }>();
  for (const line of items) {
    if (line.checked) continue;
    const text = line.text.trim();
    if (text === '') continue;
    const resolution = resolutions.get(text);
    if (resolution === 'ignored') continue;
    let item: string | null;
    let locations: readonly ShoppingStop[];
    if (resolution !== undefined) {
      if (resolution.kind === 'synonym') {
        item = resolution.item;
        locations = shoppingStopsFor(resolution.item) ?? [];
      } else {
        item = resolution.name;
        locations = resolution.stops;
      }
    } else {
      item = matchShoppingItem(text);
      locations = item === null ? [] : (shoppingStopsFor(item) ?? []);
    }
    if (item === null || locations.length === 0) continue;
    const key = shoppingNameKey(item);
    const entry = byItem.get(key) ?? { item, locations: new Map<string, ShoppingStop>() };
    for (const stop of locations) {
      if (!entry.locations.has(stop.store)) entry.locations.set(stop.store, stop);
    }
    byItem.set(key, entry);
  }
  return [...byItem.values()].map((entry) => ({
    item: entry.item,
    locations: [...entry.locations.values()],
  }));
}

/** The lines the final sort needs, with the step-1 decisions applied. */
function buildResolvedLines(
  items: readonly KeepItem[],
  resolutions: ReadonlyMap<string, SortResolution>,
): ShoppingSortLine[] {
  return items.map((line) => {
    const text = line.text.trim();
    const resolution = resolutions.get(text);
    if (resolution === 'ignored') {
      return { text: line.text, checked: line.checked, item: null, ignored: true };
    }
    if (resolution !== undefined) {
      if (resolution.kind === 'synonym') {
        return { text: line.text, checked: line.checked, item: resolution.item };
      }
      return {
        text: line.text,
        checked: line.checked,
        item: resolution.name,
        locations: resolution.stops,
      };
    }
    return {
      text: line.text,
      checked: line.checked,
      item: matchShoppingItem(line.text),
    };
  });
}

/** The empty selection, shared so a render without a selection keeps a stable identity. */
const NO_MARKETS: ReadonlySet<string> = new Set<string>();

/** True when two string sets contain the same stores. */
function sameStoreSet(left: ReadonlySet<string>, right: readonly string[]): boolean {
  if (left.size !== right.length) return false;
  return right.every((store) => left.has(store));
}

/**
 * The sort flow (see file header). It owns the step-1 decisions, the step-2
 * market selection and the unsaved-work guard; the items, the master data and
 * the writes belong to App.
 */
function ShoppingSortSelect({ items, onClose, onSort, ref }: ShoppingSortSelectProps) {
  /** The unresolved lines, computed once from the snapshot. */
  const unresolved = useMemo(() => unresolvedEntries(items), [items]);
  /** The „Artikel“ text by line (the name field until the user edits it). */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Chosen locations by line, one per market. */
  const [locations, setLocations] = useState<ReadonlyMap<string, readonly ShoppingStop[]>>(
    () => new Map(),
  );
  /** The market whose section chips are shown, by line. */
  const [activeStores, setActiveStores] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Lines ignored for this run. */
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** Lines the user has folded to their one-line summary (a decided line). */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** The current step of the flow. */
  const [step, setStep] = useState<Step>('items');
  /** The step-1 decisions handed to step 2. */
  const [resolutions, setResolutions] = useState<ReadonlyMap<string, SortResolution> | null>(null);
  /** The distinct relevant items of step 2. */
  const [marketDemand, setMarketDemand] = useState<readonly ShoppingItemDemand[]>([]);
  /** The core recommendation for step 2. */
  const [recommendation, setRecommendation] = useState<ShoppingMarketRecommendation | null>(null);
  /** The user's current market selection. */
  const [selectedMarkets, setSelectedMarkets] = useState<ReadonlySet<string> | null>(null);
  /** The step-1 decision signature the current market selection was built from. */
  const [lastDecisionSignature, setLastDecisionSignature] = useState('');
  /** True while the sort runs — the button is unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the sort failed, shown next to the button (null = no failure). */
  const [error, setError] = useState<string | null>(null);
  /**
   * True between a pointer press and its release. A fold during that window is
   * deferred (see `foldOnLeave`): collapsing a row on mousedown would shorten
   * the page under the finger and could eat the click of the button being
   * pressed.
   */
  const pointerPressed = useRef(false);
  /** Lines whose fold waits for the current pointer press to end. */
  const pendingFolds = useRef<Set<string>>(new Set());

  // A press that ends anywhere (including outside the page) must not leave the
  // flag armed: a later keyboard blur would then wait for a click that never
  // comes. The page's own pointer handlers set the flag on pointerdown.
  useEffect(() => {
    const release = (): void => {
      pointerPressed.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const storesOfRoute = shoppingStores();
  const rankTable = allShoppingMarketRanks();
  const ranks = useMemo(
    () => shoppingMarketRanksForRoute(allShoppingStops(), rankTable),
    [rankTable],
  );
  const selectedSet = selectedMarkets ?? NO_MARKETS;
  const assignment = useMemo(
    () => assignShoppingDemand(marketDemand, selectedSet, ranks),
    [marketDemand, selectedSet, ranks],
  );

  /** The „Artikel“ text of one line: what the user edited, else the name field. */
  function draftOf(entry: UnresolvedEntry): string {
    return drafts.get(entry.text) ?? entry.nameField;
  }

  /**
   * The existing item the „Artikel“ text names, or null while the text names
   * none. Uses the same whole-name resolution as the read-time pipeline, so a
   * line that becomes a synonym is recognized exactly as a Keep line would be.
   */
  function knownItemOf(entry: UnresolvedEntry): string | null {
    return matchShoppingItem(draftOf(entry));
  }

  /** The locations chosen for one line. */
  function locationsOf(entry: UnresolvedEntry): readonly ShoppingStop[] {
    return locations.get(entry.text) ?? [];
  }

  /** The active store of one line's location picker. */
  function activeStoreOf(entry: UnresolvedEntry): string | undefined {
    return activeStores.get(entry.text);
  }

  /**
   * The variant a location decision writes next to its item rows: the line's own
   * name field, but only when the edited „Artikel“ name is a different name.
   * The locations belong to the item name; the line name becomes a synonym of it
   * so the next run recognizes the line. A synonym equal to the item name is
   * rejected by the master-data rules (case-folded, docs/shopping_item_identity.md
   * §5), so an unchanged name — or a case-only edit — writes no synonym.
   */
  function synonymVariantOf(entry: UnresolvedEntry, itemName: string): string | null {
    if (entry.nameField.trim() === '') return null;
    return shoppingNameKey(itemName) === shoppingNameKey(entry.nameField) ? null : entry.nameField;
  }

  /** True when the line has one of the three decisions, so it can fold. */
  function isDecided(entry: UnresolvedEntry): boolean {
    if (ignored.has(entry.text) || knownItemOf(entry) !== null) return true;
    if (draftOf(entry).trim() === '') return false;
    if (storesOfRoute.length === 0) return false;
    return locationsOf(entry).length > 0;
  }

  /** Folds a decided line to its one-line summary. */
  function fold(text: string): void {
    setFolded((current) => new Set(current).add(text));
  }

  /**
   * Folds a line that the user just left — but only once the current pointer
   * press has produced its click. The row is much taller unfolded than folded,
   * so collapsing it on mousedown would move the button under the finger and
   * the browser's click would land on a different element. During a keyboard
   * focus change there is no press to protect, so the fold is immediate.
   */
  function foldOnLeave(text: string): void {
    if (pointerPressed.current) {
      pendingFolds.current.add(text);
      return;
    }
    fold(text);
  }

  /**
   * Folds the lines whose fold waited for a pointer press. The click that ends
   * the press runs first (this handler is on the page and runs after the
   * button's own click), so the pressed control keeps its click.
   */
  function flushPendingFolds(): void {
    if (pendingFolds.current.size === 0) return;
    const texts = [...pendingFolds.current];
    pendingFolds.current.clear();
    setFolded((current) => {
      const updated = new Set(current);
      for (const text of texts) updated.add(text);
      return updated;
    });
  }

  /** A field that regains focus cancels its pending fold. */
  function cancelPendingFold(text: string): void {
    pendingFolds.current.delete(text);
  }

  /** Unfolds a summary line again so the user can change its decision. */
  function unfold(text: string): void {
    setFolded((current) => {
      const updated = new Set(current);
      updated.delete(text);
      return updated;
    });
  }

  /** Drops the locations and active store of one line. */
  function clearLocations(text: string): void {
    setLocations((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
    setActiveStores((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
  }

  /** True when every unresolved line is decided (ignored, a known item or locations). */
  const complete = unresolved.every(isDecided);

  /** True while the snapshot holds at least one unchecked line to sort. */
  const hasEntries = items.some((item) => !item.checked);

  /** Whether the step-1 forward action can run. */
  const canContinue = complete && hasEntries && !busy;

  /** Whether the step-2 forward action can run. */
  const canSort = !busy && (marketDemand.length === 0 || selectedSet.size > 0);

  /**
   * The decisions the user has really made, one canonical string each: a typed
   * „Artikel“ name that differs from its prefill, a chosen location list, an
   * ignored line. Values that end up at the prefill are not decisions.
   */
  const decisionList = useMemo(() => {
    const decisions: string[] = [];
    for (const [text, value] of drafts) {
      if (value !== shoppingNameField(text)) decisions.push(`artikel\u0000${text}\u0000${value}`);
    }
    for (const [text, stops] of locations) {
      const sorted = [...stops]
        .sort((a, b) => a.store.localeCompare(b.store, 'de'))
        .map((stop) => `${stop.store}>${stop.section}`)
        .join(';');
      decisions.push(`orte\u0000${text}\u0000${sorted}`);
    }
    for (const text of ignored) decisions.push(`ignoriert\u0000${text}`);
    return decisions.sort();
  }, [drafts, locations, ignored]);

  /** True when the market selection differs from the recommendation. */
  const marketSelectionChanged =
    selectedMarkets !== null &&
    recommendation !== null &&
    !sameStoreSet(selectedMarkets, recommendation.selected);

  /** The guard's work fingerprint (useLeaveGuard's `workSignature`). */
  const decisionsSignature = useMemo(() => {
    const market = marketSelectionChanged
      ? [...selectedSet].sort((a, b) => a.localeCompare(b, 'de')).join('\u0000')
      : '';
    return [step, ...decisionList, market].join('\n');
  }, [step, decisionList, marketSelectionChanged, selectedSet]);

  /** True while leaving would throw away at least one decision. */
  const hasUnsavedDecisions = decisionList.length > 0 || marketSelectionChanged;

  /**
   * The flow's one exit guard (useLeaveGuard, docs/DESIGN.md §6.2): the header's
   * „Zurück“, Escape and the browser / device Back button all open the same
   * discard question instead of dropping the decisions. The question renders as
   * LeaveConfirmSheet over the page, and only its „Verwerfen“ leaves — closing it
   * (scrim, Escape, a second Back) stays.
   */
  const guard = useLeaveGuard({
    workSignature: decisionsSignature,
    needsConfirm: hasUnsavedDecisions,
  });

  /** Leaves the whole flow (the guard asks first while decisions exist). */
  function requestClose(): void {
    guard.request('button', onClose);
  }

  /** The header's „Zurück“: step 2 returns to step 1, step 1 leaves the flow. */
  function requestLeave(): void {
    if (step === 'markets') {
      setStep('items');
      setError(null);
      return;
    }
    requestClose();
  }

  // Escape mirrors the header's „Zurück": from the market step it returns to
  // step 1 (decisions stay), from step 1 it runs through the guard.
  useEscapeTrigger(() => {
    if (step === 'markets') {
      setStep('items');
      setError(null);
      return;
    }
    guard.request('escape', onClose);
  });

  // Browser / device Back is a decision here, not a silent discard: step 2
  // returns to step 1; step 1 lets the guard ask.
  useImperativeHandle(
    ref,
    () => ({
      notifyBack: (): boolean => {
        if (step === 'markets') {
          setStep('items');
          setError(null);
          return true;
        }
        return guard.request('browser-back', onClose);
      },
    }),
    [guard, onClose, step],
  );

  /** Types into one line's „Artikel“ field. */
  function typeDraft(text: string, value: string): void {
    pendingFolds.current.delete(text);
    setDrafts((current) => new Map(current).set(text, value));
    // Editing the name after an ignore takes the ignore back: the line is being
    // decided again.
    setIgnored((current) => {
      if (!current.has(text)) return current;
      const updated = new Set(current);
      updated.delete(text);
      return updated;
    });
  }

  /**
   * Folds a line once focus leaves its whole row — but only when the line is
   * already decided. Moving focus inside the row is not leaving it; those
   * controls decide whether to fold explicitly.
   */
  function blurRow(entry: UnresolvedEntry, event: FocusEvent<HTMLLIElement>): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('.sort-summary') !== null) {
      return;
    }
    if (isDecided(entry)) foldOnLeave(entry.text);
  }

  /**
   * Confirms a similar item: its name becomes the „Artikel“ text, so the row
   * hides the location fields and folds to the synonym summary. The picked
   * locations and an ignore are dropped — the two ways to decide a line are
   * mutually exclusive.
   */
  function chooseItem(text: string, item: string): void {
    typeDraft(text, item);
    clearLocations(text);
    setIgnored((current) => {
      if (!current.has(text)) return current;
      const updated = new Set(current);
      updated.delete(text);
      return updated;
    });
    fold(text);
  }

  /** Ignores a line for this run (or takes the answer back). */
  function toggleIgnored(text: string): void {
    if (ignored.has(text)) {
      setIgnored((current) => {
        const updated = new Set(current);
        updated.delete(text);
        return updated;
      });
      unfold(text);
      return;
    }
    setIgnored((current) => new Set(current).add(text));
    clearLocations(text);
    fold(text);
  }

  /**
   * Picks the market whose section chips are shown. The location list itself is
   * unchanged until a section is chosen; switching markets never drops an
   * existing location.
   */
  function chooseStore(text: string, store: string): void {
    setActiveStores((current) => new Map(current).set(text, store));
    setIgnored((current) => {
      if (!current.has(text)) return current;
      const updated = new Set(current);
      updated.delete(text);
      return updated;
    });
    pendingFolds.current.delete(text);
  }

  /**
   * Picks a section for the active market. A market already in the line's list
   * has its section updated; a new market is appended. The store-keyed update is
   * what enforces "at most one section per market".
   */
  function chooseSection(entry: UnresolvedEntry, section: string): void {
    const store = activeStoreOf(entry);
    if (store === undefined) return;
    pendingFolds.current.delete(entry.text);
    setLocations((current) => {
      const existing = current.get(entry.text) ?? [];
      const index = existing.findIndex((stop) => stop.store === store);
      const updated =
        index === -1
          ? [...existing, { store, section }]
          : existing.map((stop, position) => (position === index ? { store, section } : stop));
      return new Map(current).set(entry.text, updated);
    });
    setIgnored((current) => {
      if (!current.has(entry.text)) return current;
      const updated = new Set(current);
      updated.delete(entry.text);
      return updated;
    });
  }

  /** Removes one location from a line. */
  function removeLocation(entry: UnresolvedEntry, store: string): void {
    setLocations((current) => {
      const existing = current.get(entry.text) ?? [];
      const updated = existing.filter((stop) => stop.store !== store);
      const next = new Map(current);
      if (updated.length === 0) next.delete(entry.text);
      else next.set(entry.text, updated);
      return next;
    });
    setActiveStores((current) => {
      if (current.get(entry.text) !== store) return current;
      const next = new Map(current);
      next.delete(entry.text);
      return next;
    });
    pendingFolds.current.delete(entry.text);
  }

  /**
   * Builds the step-1 decision map, enters step 2 and preselects the
   * recommendation. The demand uses the decisions before they are persisted, so a
   * new item's locations are part of the recommendation.
   */
  function handleNext(): void {
    setError(null);
    const next = new Map<string, SortResolution>();
    for (const entry of unresolved) {
      if (ignored.has(entry.text)) {
        next.set(entry.text, 'ignored');
        continue;
      }
      const item = knownItemOf(entry);
      if (item !== null) {
        next.set(entry.text, { kind: 'synonym', variant: entry.nameField, item });
        continue;
      }
      const stops = locationsOf(entry);
      if (stops.length > 0) {
        const name = draftOf(entry).trim();
        const variant = synonymVariantOf(entry, name);
        next.set(entry.text, {
          kind: 'item',
          name,
          stops,
          ...(variant === null ? {} : { variant }),
        });
      }
    }
    const demand = buildMarketDemand(items, next);
    const recommended = recommendShoppingMarkets(demand, ranks);
    const itemSignature = decisionList.join('\n');
    // Going back to step 1 and returning without changing a decision keeps the
    // user's market toggles. A changed decision rebuilds the recommendation and
    // starts from its preselection. Stores that no longer supply an item are
    // dropped from a preserved selection.
    const preserve = selectedMarkets !== null && itemSignature === lastDecisionSignature;
    const options = new Set(recommended.options.map((option) => option.store));
    const nextSelection = preserve
      ? new Set([...selectedMarkets!].filter((store) => options.has(store)))
      : new Set(recommended.selected);
    setResolutions(next);
    setMarketDemand(demand);
    setRecommendation(recommended);
    setSelectedMarkets(nextSelection);
    setLastDecisionSignature(itemSignature);
    setStep('markets');
  }

  /** Runs the sort: build the resolved lines and hand everything to App. */
  async function handleSort(): Promise<void> {
    if (resolutions === null || selectedMarkets === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSort(resolutions, [...selectedMarkets], buildResolvedLines(items, resolutions));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /** Toggles one market in step 2. */
  function toggleMarket(store: string): void {
    setSelectedMarkets((current) => {
      const next = new Set(current ?? []);
      if (next.has(store)) next.delete(store);
      else next.add(store);
      return next;
    });
  }

  /** Restores the core recommendation after a manual change. */
  function restoreRecommendation(): void {
    if (recommendation === null) return;
    setSelectedMarkets(new Set(recommendation.selected));
  }

  /**
   * The similar-item chips of one line: the item names core offers for the
   * current „Artikel“ text. Choosing one writes it into the field, so the field
   * is the single source of the decision.
   */
  function renderCandidates(entry: UnresolvedEntry): ReactNode {
    if (ignored.has(entry.text) || knownItemOf(entry) !== null) {
      return null;
    }
    const suggestions = shoppingItemSuggestions(draftOf(entry));
    if (suggestions.length === 0) {
      return null;
    }
    return (
      <ul className="suggestions sort-candidates" aria-label="Ähnliche Artikel">
        {suggestions.map((candidate) => (
          <li key={candidate}>
            <button
              type="button"
              className="chip"
              onClick={() => chooseItem(entry.text, candidate)}
            >
              {candidate}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  /** The „Artikel“ field: the name field, editable until the line is decided. */
  function renderDraftField(entry: UnresolvedEntry): ReactNode {
    return (
      <div className="field">
        <span className="field-label">Artikel</span>
        <input
          type="text"
          value={draftOf(entry)}
          onChange={(event) => typeDraft(entry.text, event.target.value)}
          onFocus={() => cancelPendingFold(entry.text)}
          aria-label={`Artikelname für ${entry.text}`}
        />
      </div>
    );
  }

  /**
   * The single quiet exception answer — „Ignorieren“ in place of the former
   * „Oben einsortieren“ / „Unten einsortieren“ pair. Ignoring is per run: no
   * master-data write, end of the list, asked again next time.
   */
  function renderIgnoreAction(entry: UnresolvedEntry): ReactNode {
    const isIgnored = ignored.has(entry.text);
    return (
      <div className="sort-parking" role="group" aria-label={`Ignorieren für ${entry.text}`}>
        <button
          type="button"
          className="chip chip-clear sort-parking-action"
          aria-pressed={isIgnored}
          onClick={() => toggleIgnored(entry.text)}
        >
          <CloseIcon className="chip-icon" optical={20} />
          {isIgnored ? 'Ignoriert' : 'Ignorieren'}
        </button>
      </div>
    );
  }

  /**
   * The location editor of one line: the chosen locations, the store chips, the
   * section chips of the active store and the single ignore action. A known item
   * hides the editor (the line becomes a synonym); a line with no route shows the
   * explanation and only the ignore action.
   */
  function renderPicker(entry: UnresolvedEntry): ReactNode {
    if (ignored.has(entry.text)) {
      return (
        <>
          <p className="sort-note" role="status">
            Wird ignoriert und beim nächsten Mal wieder abgefragt.
          </p>
          {renderIgnoreAction(entry)}
        </>
      );
    }
    const item = knownItemOf(entry);
    if (item !== null) {
      return (
        <>
          <p className="sort-note" role="status">
            {`Wird als Synonym für „${item}“ gemerkt.`}
          </p>
          {renderIgnoreAction(entry)}
        </>
      );
    }
    if (storesOfRoute.length === 0) {
      return (
        <>
          <p className="field-hint">
            Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — dieser Eintrag kann nur ignoriert
            werden.
          </p>
          {renderIgnoreAction(entry)}
        </>
      );
    }
    const chosen = locationsOf(entry);
    const activeStore = activeStoreOf(entry);
    const sections = activeStore === undefined ? [] : shoppingSections(activeStore);
    const activeSection = chosen.find((stop) => stop.store === activeStore)?.section;
    return (
      <div className="field">
        <span className="field-label">Einkaufsorte</span>
        {chosen.length === 0 ? (
          <p className="field-hint">Noch keine Einkaufsorte.</p>
        ) : (
          <ul className="sort-location-list" aria-label={`Einkaufsorte für ${entry.text}`}>
            {chosen.map((stop) => (
              <li key={stop.store}>
                <span className="sort-location-text">
                  {stop.store} &gt; {stop.section}
                </span>
                <button
                  type="button"
                  className="chip chip-clear"
                  onClick={() => removeLocation(entry, stop.store)}
                  aria-label={`Einkaufsort „${stop.store} > ${stop.section}“ entfernen`}
                >
                  <CloseIcon className="chip-icon" optical={20} />
                  <span>Entfernen</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sort-market-row">
          <div className="store-chips" role="group" aria-label={`Markt für ${entry.text}`}>
            {storesOfRoute.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={activeStore === candidate ? 'chip chip-active' : 'chip'}
                aria-pressed={activeStore === candidate}
                onClick={() => chooseStore(entry.text, candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
          {renderIgnoreAction(entry)}
        </div>

        {activeStore !== undefined && (
          <>
            <p className="field-hint">Bereich</p>
            <div className="store-chips" role="group" aria-label={`Bereich in ${activeStore}`}>
              {sections.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={activeSection === candidate ? 'chip chip-active' : 'chip'}
                  aria-pressed={activeSection === candidate}
                  onClick={() => chooseSection(entry, candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="field-hint">Ein Artikel kann pro Markt nur einen Bereich haben.</p>
      </div>
    );
  }

  /**
   * The one line a decided entry folds to. A known item wins over locations and
   * an ignore wins over everything, matching the order in which `handleNext`
   * reads the decisions.
   */
  function summaryOf(entry: UnresolvedEntry): string {
    if (ignored.has(entry.text)) {
      return `„${entry.text}“: ignoriert`;
    }
    const item = knownItemOf(entry);
    if (item !== null) {
      return `„${entry.text}“ = ${item}`;
    }
    const chosen = locationsOf(entry);
    if (chosen.length > 0) {
      const name = draftOf(entry).trim();
      const route = chosen.map((stop) => `${stop.store} > ${stop.section}`).join('; ');
      return synonymVariantOf(entry, name) === null
        ? `„${entry.text}“: ${route}`
        : `„${entry.text}“ = ${name}: ${route}`;
    }
    // A folded row always has a decision; this keeps the type honest.
    return `„${entry.text}“`;
  }

  /** One unresolved line (step 1). */
  function renderEntry(entry: UnresolvedEntry): ReactNode {
    const isFolded = folded.has(entry.text);
    if (isFolded) {
      return (
        <li key={entry.text} className="sort-entry sort-entry--folded">
          <button
            type="button"
            className="sort-summary"
            aria-expanded={false}
            onClick={() => unfold(entry.text)}
          >
            {summaryOf(entry)}
          </button>
        </li>
      );
    }
    return (
      <li key={entry.text} className="sort-entry" onBlur={(event) => blurRow(entry, event)}>
        {isDecided(entry) ? (
          <button
            type="button"
            className="sort-entry-text sort-entry-toggle"
            aria-expanded={true}
            onClick={() => fold(entry.text)}
          >
            {entry.text}
          </button>
        ) : (
          <p className="sort-entry-text">{entry.text}</p>
        )}

        {renderDraftField(entry)}
        {renderCandidates(entry)}
        {renderPicker(entry)}
      </li>
    );
  }

  /** The step-1 list, or the state the list is in. */
  function renderItemList(): ReactNode {
    if (unresolved.length === 0) {
      return (
        <p className="sort-empty" role="status">
          Alle Einträge haben bereits Stammdaten — die Liste kann direkt sortiert werden.
        </p>
      );
    }
    return <ul className="sort-list">{unresolved.map((entry) => renderEntry(entry))}</ul>;
  }

  /** The names of the uncovered items, at most three, then a count. */
  function uncoveredSummary(): string {
    const names = assignment.uncovered;
    if (names.length === 0) return '';
    const shown = names
      .slice(0, 3)
      .map((name) => `„${name}“`)
      .join(', ');
    return names.length > 3 ? `${shown} und ${names.length - 3} weitere` : shown;
  }

  /** One market row of step 2. */
  function renderMarket(option: ShoppingMarketRecommendation['options'][number]): ReactNode {
    const selected = selectedSet.has(option.store);
    const count = selected
      ? (assignment.marketCounts.get(option.store) ?? 0)
      : shoppingMarketWouldTake(marketDemand, selectedSet, option.store, ranks);
    const tag = option.mandatory
      ? 'Pflicht'
      : option.selected
        ? 'Empfohlen'
        : selected
          ? 'Gewählt'
          : 'Ausweichmarkt';
    return (
      <li key={option.store}>
        <button
          type="button"
          className={selected ? 'market-row market-row--selected' : 'market-row'}
          aria-pressed={selected}
          onClick={() => toggleMarket(option.store)}
        >
          <span className="market-rank" aria-hidden="true">
            {option.rank}
          </span>
          <span className="market-body">
            <span className="market-title">
              <span className="market-name">{option.store}</span>
              <span className={selected ? 'market-tag market-tag--active' : 'market-tag'}>
                {tag}
              </span>
            </span>
            <span className="market-meta">
              {option.mandatory
                ? `nur hier: ${option.onlyHereCount} Artikel`
                : selected
                  ? `übernimmt ${count} Artikel`
                  : `würde ${count} Artikel übernehmen`}
            </span>
          </span>
          <span className="market-count" aria-hidden="true">
            {count}
          </span>
        </button>
      </li>
    );
  }

  /** Step 2: the recommendation, the market rows and the live summary. */
  function renderMarketStep(): ReactNode {
    if (recommendation === null) return null;
    if (marketDemand.length === 0) {
      return (
        <p className="sort-empty" role="status">
          Keine Artikel mit Einkaufsort — die Liste wird ohne Marktzuordnung sortiert.
        </p>
      );
    }
    return (
      <>
        <p className="sort-intro">
          Pflichtmärkte sichern Artikel, die es nur dort gibt. Weitere Märkte werden empfohlen, wenn
          sie mehr als 10 Artikel übernehmen würden.
        </p>
        <ul className="market-list">
          {recommendation.options.map((option) => renderMarket(option))}
        </ul>

        <div className="market-summary" role="status">
          <p className="market-summary-line">
            <strong>
              {marketDemand.length - assignment.uncovered.length} von {marketDemand.length} Artikeln
              versorgt.
            </strong>
          </p>
          {assignment.uncovered.length > 0 && (
            <p className="market-summary-detail">Ohne Markt: {uncoveredSummary()}.</p>
          )}
          {assignment.downgraded.length > 0 && (
            <p className="market-summary-detail">
              {assignment.downgraded.length} Artikel bei einem schlechteren Markt.
            </p>
          )}
          {ignored.size > 0 && (
            <p className="market-summary-detail">
              {ignored.size} {ignored.size === 1 ? 'Eintrag' : 'Einträge'} ignoriert.
            </p>
          )}
        </div>

        {marketSelectionChanged && (
          <button
            type="button"
            className="text-button market-restore"
            onClick={restoreRecommendation}
          >
            Empfehlung wiederherstellen
          </button>
        )}
      </>
    );
  }

  /** The action row of the current step. */
  function renderActions(): ReactNode {
    if (step === 'items') {
      return (
        <div className="sort-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleNext}
            disabled={!canContinue}
            aria-busy={busy}
          >
            {busy ? 'Wird geprüft …' : 'Weiter'}
          </button>
          {!complete && (
            <p className="sort-action-note" role="status">
              Bitte jeden Eintrag zuordnen oder ignorieren.
            </p>
          )}
          {error !== null && (
            <p className="sort-action-error" role="alert">
              {error}
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="sort-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleSort()}
          disabled={!canSort}
          aria-busy={busy}
        >
          {busy ? 'Wird sortiert …' : 'Liste sortieren'}
        </button>
        {(error !== null || (!canSort && !busy)) && (
          <p
            className={error !== null ? 'sort-action-error' : 'sort-action-note'}
            role={error !== null ? 'alert' : 'status'}
          >
            {error ?? 'Bitte mindestens einen Markt auswählen.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <main
      className="app app-narrow sort-select"
      // Track a pointer press so a blur caused by tapping a control can defer
      // its fold until the click has run (see `foldOnLeave`), and flush those
      // deferred folds in the bubble phase — after a pressed button's own
      // click handler. The matching release listener lives on `window`, so a
      // press that ends outside the page cannot leave the flag armed.
      onPointerDownCapture={() => {
        pointerPressed.current = true;
      }}
      onClick={flushPendingFolds}
    >
      {/* "Zurück" on its own line at the top left, the screen title below it —
          the shared stacked header (.app-header-stacked). */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={requestLeave}>
          Zurück
        </button>
        <h1>{step === 'items' ? 'Einkaufsliste sortieren' : 'Einkaufsweg wählen'}</h1>
      </header>

      {step === 'items' ? (
        <>
          <p className="sort-intro">
            Einträge ohne bekannten Einkaufsort werden angezeigt. Entweder einen bekannten Artikel
            als Synonym zuordnen oder einen oder mehrere Einkaufsorte wählen. Einträge ohne
            Zuordnung lassen sich ignorieren — sie werden ans Ende sortiert und beim nächsten Mal
            wieder abgefragt.
          </p>
          {renderItemList()}
        </>
      ) : (
        renderMarketStep()
      )}

      {renderActions()}

      {/* The discard question (docs/DESIGN.md §6.2): it stands only while a
          decision would be lost, and it is the same sheet every other exit guard
          uses. */}
      {guard.armed && (
        <LeaveConfirmSheet
          question="Zuordnungen verwerfen?"
          confirmLabel="Verwerfen"
          onCancel={guard.reset}
          onConfirm={() => guard.confirm(onClose)}
        />
      )}
    </main>
  );
}

export default ShoppingSortSelect;
