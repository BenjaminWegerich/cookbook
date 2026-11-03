/**
 * Shopping-list sort page — the full-screen page behind "Liste sortieren" in the
 * home screen's "Einkaufsliste" caption row (App's `sort` layer). The page itself
 * still titles the task in full ("Einkaufsliste sortieren").
 *
 * The page is where the shopping list's aisle sort gets the one thing the master
 * data cannot give it: a decision for every line that resolved to no item
 * (docs/shopping_item_identity.md §2/§4). It reads the current shopping list,
 * classifies each line against the item table (core's `matchShoppingItem`), and
 * lists **only the unchecked lines that name no item**. Per such line the user
 * either:
 *
 * - types (or confirms one of the offered **similar item names**) an existing
 *   item into the editable „Artikel“ field — the line then sorts as that item
 *   for this run, and App writes a **synonym** row, so the same variant is never
 *   asked again;
 * - **assigns a stop** with the „Markt“ store chips + „Bereich“ search field —
 *   App then writes a new item row under the name in „Artikel“ and, when that
 *   name was changed, the line's own name as a **synonym** of it; or
 * - **ignores** the line, which the sort places at the top of the list.
 *
 * **A decided line folds to one quiet summary line.** The folded line says what
 * was decided, so the page reads as a checklist of decisions once the work is
 * done:
 *
 * - „<line>“ = <item> — the „Artikel“ text names an existing item, so the line
 *   becomes a synonym of it („Markt“ and „Bereich“ are not needed and are hidden
 *   while the text names an item);
 * - „<line>“ = <item>: <store> > <section> — the „Artikel“ name was changed and
 *   the stop is set: the route is saved on the new item name, and the line's own
 *   name is saved as a synonym of it;
 * - „<line>“: <store> > <section> — the „Artikel“ name is unchanged and the stop
 *   is set, so the line becomes that item;
 * - „<line>“: ignoriert (oben einsortiert) — the line is ignored.
 *
 * The original line always sits between „“ in the folded summary, so it stays
 * distinguishable from the item name it was mapped to.
 *
 * The folded line is muted and one text step smaller, and tapping it unfolds the
 * row again so a decision can still be changed. Folding happens when the user
 * leaves the row after the exact name (never under the cursor while typing),
 * when a suggestion or a section is chosen, or on „Ignorieren“.
 *
 * **The decisions are unsaved until „Liste sortieren“ is pressed, so leaving
 * asks first.** The page keeps one exit guard (useLeaveGuard, docs/DESIGN.md
 * §6.2): the header's „Zurück“, Escape and the browser / device Back button all
 * open the same discard question as a sheet (LeaveConfirmSheet) instead of
 * dropping the decisions. Confirmed only by the sheet's own „Verwerfen“; closing
 * it stays. A page nobody has decided anything on leaves without asking, and the
 * browser's own `beforeunload` dialog covers a reload (registered by the guard
 * while decisions exist).
 *
 * A known item hides the stop fields, because the item's route already exists;
 * the picker is only offered while the text names no item. Changing the name
 * before setting the stop writes both rows — the item with the route, and the
 * line's own name field as its synonym, so the next run recognizes the same
 * line.
 *
 * On commit the page hands the decisions over to App, which persists them,
 * derives the target order (core's `shoppingSortOrder`), and lets the gateway
 * apply it. A failure is shown next to the button and the page stays open, so the
 * decisions are not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FocusEvent, ReactNode, Ref } from 'react';

import {
  matchShoppingItem,
  shoppingItemSuggestions,
  shoppingNameField,
  shoppingNameKey,
  shoppingSections,
  shoppingStores,
  type ShoppingStop,
} from '@cookbook/core';

import type { KeepItem } from '../keep/keepClient';
import { useEscapeTrigger, useLeaveGuard } from '../hooks/useLeaveGuard';
import LeaveConfirmSheet from './LeaveConfirmSheet';
import { VisibilityOffIcon } from './icons';

/**
 * The browser-Back consumer of this page (see App's popstate handler). The
 * decisions behind „Zurück“ are unsaved work, so Back arms the same discard
 * question the header's button does instead of dropping them silently.
 */
export interface ShoppingSortSelectHandle {
  /**
   * Asks before leaving and reports whether the page handled the Back. False
   * means the caller may leave: the page holds nothing to discard.
   */
  notifyBack: () => boolean;
}

/**
 * How one unresolved line was decided:
 * - `item` — a new (or corrected) item row under `name` at `stop`; when the
 *   line's own name differs from `name`, the line name is also stored as a
 *   synonym of that item;
 * - `synonym` — `variant` (the line's name field) means the existing `item`,
 *   which resolves the line without touching the item table
 *   (docs/shopping_item_identity.md §4);
 * - `ignore` — placed at the top of the list.
 */
export type SortResolution =
  | {
      readonly kind: 'item';
      readonly name: string;
      readonly stop: ShoppingStop;
      /**
       * The line's own name field, saved as a synonym of `name` when the
       * „Artikel“ name was changed (null/absent when the two names are equal).
       */
      readonly variant?: string;
    }
  | { readonly kind: 'synonym'; readonly variant: string; readonly item: string }
  | 'ignore';

interface ShoppingSortSelectProps {
  /** The shopping-list items in Keep's display order (top first) — a snapshot. */
  items: readonly KeepItem[];
  /**
   * Leaves the page for the home screen — the guard's confirmed exit (the
   * question's „Verwerfen“) or an exit with no decision to discard.
   */
  onClose: () => void;
  /**
   * Applies the decisions: persists the new item and synonym rows, reorders the
   * list through the gateway and closes the flow. Resolves on success; a failure
   * is thrown and shown next to the button (the page stays open).
   */
  onSort: (resolutions: ReadonlyMap<string, SortResolution>) => Promise<void>;
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

/** The stop the current picker state names, or null while it is incomplete. */
function chosenStop(
  store: string | undefined,
  sections: readonly string[],
  sectionQuery: string,
): ShoppingStop | null {
  if (store === undefined) return null;
  const section = sectionQuery.trim();
  return sections.includes(section) ? { store, section } : null;
}

/**
 * The sort page (see file header). It owns nothing but the decisions: the items,
 * the master data and the writes belong to App.
 */
function ShoppingSortSelect({ items, onClose, onSort, ref }: ShoppingSortSelectProps) {
  /** The unresolved lines, computed once from the snapshot. */
  const unresolved = useMemo(() => unresolvedEntries(items), [items]);
  /** The „Artikel“ text by line (the name field until the user edits it). */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Ignored lines by text (placed at the top of the list). */
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** Chosen store by text (level 1 of the „Markt“ field). */
  const [stores, setStores] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Section search text by text (level 2 of the „Markt“ field). */
  const [sections, setSections] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Lines the user has folded to their one-line summary (a decided line). */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>());
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

  /** The complete stop of one line, or null while the picker is incomplete. */
  function stopOf(entry: UnresolvedEntry): ShoppingStop | null {
    const store = stores.get(entry.text);
    return chosenStop(
      store,
      store === undefined ? [] : shoppingSections(store),
      sections.get(entry.text) ?? '',
    );
  }

  /**
   * The variant a stop decision writes next to its item row: the line's own
   * name field, but only when the edited „Artikel“ name is a different name.
   * The route belongs to the item name; the line name becomes a synonym of it so
   * the next run recognizes the line. A synonym equal to the item name is
   * rejected by the master-data rules (case-folded, docs/shopping_item_identity.md
   * §5), so an unchanged name — or a case-only edit — writes no synonym and the
   * route alone names the item.
   */
  function synonymVariantOf(entry: UnresolvedEntry, itemName: string): string | null {
    // A decorated line can derive an empty name field ("2 Becher"): there is no
    // variant to store, and an empty synonym would fail the table's rules.
    if (entry.nameField.trim() === '') return null;
    return shoppingNameKey(itemName) === shoppingNameKey(entry.nameField) ? null : entry.nameField;
  }

  /** True when the line has one of the three decisions, so it can fold. */
  function isDecided(entry: UnresolvedEntry): boolean {
    if (ignored.has(entry.text) || knownItemOf(entry) !== null) return true;
    // A new item row needs a name; the derived one is prefilled, but the user
    // can clear the field, and an empty item name must not be written.
    if (draftOf(entry).trim() === '') return false;
    if (storesOfRoute.length === 0) return false;
    return stopOf(entry) !== null;
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

  /**
   * A field that regains focus cancels its pending fold: the user is back in
   * the row, so it must not collapse under the cursor.
   */
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

  /** Drops the picked stop of one line (used when a known item takes over). */
  function clearStop(text: string): void {
    setStores((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
    setSections((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
  }

  /** True when every unresolved line is decided (ignored, a known item or a stop). */
  const complete = unresolved.every(isDecided);

  /** True while the snapshot holds at least one unchecked line to sort. */
  const hasEntries = items.some((item) => !item.checked);

  /** Whether the forward action can run. */
  const canSort = complete && hasEntries && !busy;

  /**
   * The decisions the user has really made, one canonical string each: a typed
   * „Artikel“ name that differs from its prefill, a picked store, a typed
   * „Bereich“ and an ignored line. Values that end up at the prefill (typing then
   * reverting the name) or an emptied section field are not decisions — leaving
   * would lose nothing, so they must not make the page ask.
   *
   * Sorted, so the order in which the maps were filled in never produces a
   * different fingerprint for the same work.
   */
  const decisionList = useMemo(() => {
    const decisions: string[] = [];
    for (const [text, value] of drafts) {
      if (value !== shoppingNameField(text)) decisions.push(`artikel\u0000${text}\u0000${value}`);
    }
    for (const [text, value] of stores) decisions.push(`markt\u0000${text}\u0000${value}`);
    for (const [text, value] of sections) {
      if (value.trim() !== '') decisions.push(`bereich\u0000${text}\u0000${value}`);
    }
    for (const text of ignored) decisions.push(`ignoriert\u0000${text}`);
    return decisions.sort();
  }, [drafts, stores, sections, ignored]);

  /** True while leaving would throw away at least one decision. */
  const hasUnsavedDecisions = decisionList.length > 0;

  /**
   * The guard's work fingerprint (useLeaveGuard's `workSignature`): it arms its
   * question for exactly one work state, so any further edit changes the
   * fingerprint and an armed question can never be spent on a state it was not
   * asked about.
   */
  const decisionsSignature = decisionList.join('\n');

  /**
   * The page's one exit guard (useLeaveGuard, docs/DESIGN.md §6.2): the header's
   * „Zurück“, Escape and the browser / device Back button all open the same
   * discard question instead of dropping the decisions. The question renders as
   * LeaveConfirmSheet over the page, and only its „Verwerfen“ leaves — closing it
   * (scrim, Escape, a second Back) stays.
   */
  const guard = useLeaveGuard({
    workSignature: decisionsSignature,
    needsConfirm: hasUnsavedDecisions,
  });

  // Escape mirrors the header's „Zurück" (docs/DESIGN.md §6.2): it runs through
  // the same guard, so it asks before the decisions are dropped. The listener is
  // registered while the page is mounted — and the page only exists while it is
  // the visible one.
  useEscapeTrigger(() => {
    guard.request('escape', onClose);
  });

  // Browser / device Back is a decision here, not a silent discard (see
  // ShoppingSortSelectHandle): App's popstate listener asks this page first, and
  // only a `false` lets it leave. A Back while the question is open closes it —
  // „Abbrechen" — and keeps the entry, so a second Back never discards (§6.2).
  useImperativeHandle(
    ref,
    () => ({
      notifyBack: (): boolean => guard.request('browser-back', onClose),
    }),
    [guard, onClose],
  );

  /** The header's „Zurück“: it asks first while decisions would be lost. */
  function requestLeave(): void {
    guard.request('button', onClose);
  }

  /** Types into one line's „Artikel“ field. */
  function typeDraft(text: string, value: string): void {
    // The user is editing this row again, so a fold that waited for a click is
    // no longer wanted (the focus handler covers the common case; this covers a
    // browser that reports no related focus target).
    pendingFolds.current.delete(text);
    setDrafts((current) => new Map(current).set(text, value));
  }

  /**
   * Folds a line once focus leaves its whole row — but only when the line is
   * already decided. Folding is deliberately tied to leaving the row rather than
   * to every keystroke: a row must never disappear under the cursor while the
   * user is still typing. Moving focus inside the row (onto a chip, the section
   * input or the ignore action) is not leaving it; those controls fold
   * explicitly when they complete the decision. The Tab path is covered too:
   * tabbing through the row's controls and out of it folds the decided line.
   * A native blur that a removed summary button produces on unfolding is not a
   * decision to fold again, so it is ignored.
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
   * hides the stop fields and folds to the synonym summary. The picked stop is
   * dropped — the two ways to decide a line are mutually exclusive.
   */
  function chooseItem(text: string, item: string): void {
    typeDraft(text, item);
    clearStop(text);
    fold(text);
  }

  /**
   * Toggles "ignored" for one line. Ignoring clears any picked stop, so the
   * line's one decision is the ignore; taking the ignore back leaves the row
   * unfolded for a different decision.
   */
  function toggleIgnored(text: string): void {
    if (ignored.has(text)) {
      setIgnored((current) => {
        const updated = new Set(current);
        updated.delete(text);
        return updated;
      });
      return;
    }
    setIgnored((current) => new Set(current).add(text));
    clearStop(text);
    fold(text);
  }

  /**
   * Picks a store (level 1). A section belongs to exactly one store, so the
   * previous section is cleared when the store really changes (same rule as the
   * new-ingredient sheet). Picking a store is the other way to decide the line,
   * so it takes an ignore back; the row stays unfolded until a section is
   * chosen.
   */
  function chooseStore(text: string, store: string): void {
    setIgnored((current) => {
      if (!current.has(text)) return current;
      const updated = new Set(current);
      updated.delete(text);
      return updated;
    });
    if (stores.get(text) === store) return;
    // Changing the store clears the section, so a fold that was waiting for
    // the click must not fold the now-incomplete stop.
    pendingFolds.current.delete(text);
    setStores((current) => new Map(current).set(text, store));
    setSections((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
  }

  /** Types into one line's section search field. */
  function typeSection(text: string, query: string): void {
    // Same as `typeDraft`: the row is being edited, so it must stay open.
    pendingFolds.current.delete(text);
    setSections((current) => new Map(current).set(text, query));
  }

  /**
   * Picks a section from the search suggestions. The stop is complete only with
   * a non-empty „Artikel“ name: without one there is no item to write, so the
   * row stays unfolded (and the forward action stays unavailable).
   */
  function chooseSection(entry: UnresolvedEntry, section: string): void {
    setSections((current) => new Map(current).set(entry.text, section));
    if (draftOf(entry).trim() !== '') fold(entry.text);
  }

  /** Runs the sort: build the decision map and hand it to App. */
  async function handleSort(): Promise<void> {
    setBusy(true);
    setError(null);
    const resolutions = new Map<string, SortResolution>();
    for (const entry of unresolved) {
      if (ignored.has(entry.text)) {
        resolutions.set(entry.text, 'ignore');
        continue;
      }
      const item = knownItemOf(entry);
      if (item !== null) {
        // The variant is the line's name field, never the edited „Artikel“ text:
        // the next run must recognize the same line, and what it derives is the
        // name field.
        resolutions.set(entry.text, { kind: 'synonym', variant: entry.nameField, item });
        continue;
      }
      const stop = stopOf(entry);
      if (stop !== null) {
        const name = draftOf(entry).trim();
        const variant = synonymVariantOf(entry, name);
        // A changed name writes both rows: the item at the route, and the line's
        // own name as a synonym of it (so the same line is not asked again).
        resolutions.set(entry.text, {
          kind: 'item',
          name,
          stop,
          ...(variant === null ? {} : { variant }),
        });
      }
    }
    try {
      await onSort(resolutions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /**
   * The similar-item chips of one line: the item names core offers for the
   * current „Artikel“ text. Choosing one writes it into the field, so the field
   * is the single source of the decision. Deliberately without a caption — the
   * chips sit between the „Artikel“ field and the stop fields and read as "or
   * this one"; the aria-label carries the meaning for screen readers.
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
   * The row's exception answer: a quiet text button, deliberately not a pill, so
   * it can never be mistaken for one of the store chips. While the stop fields
   * are shown it sits in the „Markt“ chips row; when that field is hidden (a
   * known item, an ignored row or no route) it follows the note in the same slot.
   */
  function renderIgnoreAction(entry: UnresolvedEntry): ReactNode {
    const isIgnored = ignored.has(entry.text);
    return (
      <button
        type="button"
        className="text-button sort-ignore"
        aria-pressed={isIgnored}
        onClick={() => toggleIgnored(entry.text)}
      >
        <VisibilityOffIcon className="button-icon" optical={20} />
        {isIgnored ? 'Ignoriert' : 'Ignorieren'}
      </button>
    );
  }

  /**
   * What replaces the stop fields once a line is decided without them — or the
   * „Markt“/„Bereich“ picker while it is not. A text that names an existing
   * item hides the stop fields entirely (the line becomes a synonym); the note
   * names that consequence while the row is still unfolded. The ignore action
   * keeps its place beside the store chips, so it stays reachable in every
   * branch.
   */
  function renderPicker(entry: UnresolvedEntry): ReactNode {
    if (ignored.has(entry.text)) {
      return (
        <>
          <p className="sort-note" role="status">
            Wird oben in die Liste einsortiert.
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
    const store = stores.get(entry.text);
    const sectionOptions = store === undefined ? [] : shoppingSections(store);
    const section = (sections.get(entry.text) ?? '').trim();
    const suggestions = sectionOptions.includes(section)
      ? []
      : sectionOptions.filter((candidate) =>
          candidate.toLowerCase().includes(section.toLowerCase()),
        );
    return (
      <div className="field">
        <span className="field-label">Markt</span>
        <div className="sort-market-row">
          <div className="store-chips" role="group" aria-label={`Markt für ${entry.text}`}>
            {storesOfRoute.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={store === candidate ? 'chip chip-active' : 'chip'}
                aria-pressed={store === candidate}
                onClick={() => chooseStore(entry.text, candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
          {renderIgnoreAction(entry)}
        </div>

        {store !== undefined && (
          <>
            <p className="field-hint">Bereich</p>
            <input
              type="text"
              value={sections.get(entry.text) ?? ''}
              onChange={(event) => typeSection(entry.text, event.target.value)}
              onFocus={() => cancelPendingFold(entry.text)}
              aria-label={`Bereich in ${store}`}
              placeholder="Suchen oder wählen"
            />
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((candidate) => (
                  <li key={candidate}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => chooseSection(entry, candidate)}
                    >
                      {candidate}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  /**
   * The one line a decided entry folds to (see the file header). Ignore wins
   * over a known item and a known item over a stop, matching the order in which
   * `handleSort` reads the decisions. A stop whose „Artikel“ name differs from
   * the line's own name also writes the line name as a synonym; the summary
   * names that (`„<line>“ = <Artikel>: <Markt> > <Bereich>`). The line itself is
   * always quoted, the mapped item name never is.
   */
  function summaryOf(entry: UnresolvedEntry): string {
    if (ignored.has(entry.text)) {
      return `„${entry.text}“: ignoriert (oben einsortiert)`;
    }
    const item = knownItemOf(entry);
    if (item !== null) {
      return `„${entry.text}“ = ${item}`;
    }
    const stop = stopOf(entry);
    if (stop !== null) {
      const name = draftOf(entry).trim();
      const route = `${stop.store} > ${stop.section}`;
      return synonymVariantOf(entry, name) === null
        ? `„${entry.text}“: ${route}`
        : `„${entry.text}“ = ${name}: ${route}`;
    }
    // A folded row always has a decision; this keeps the type honest.
    return `„${entry.text}“`;
  }

  /**
   * One unresolved line. While the entry is unfolded it carries the whole form
   * (the name field, the similar-item chips, the stop fields and the quiet
   * ignore action). As soon as it is decided it collapses to one muted, small
   * line; a tap on that line unfolds it again (the pantry page's fold pattern).
   * The line itself stays the same button across both states, so the toggle
   * keeps the keyboard focus while it unfolds. A line that is not decided yet
   * has no summary to show: its label is plain text and there is nothing to
   * fold.
   */
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

  /** The list, or the state the plan is in instead. */
  function renderList(): ReactNode {
    if (unresolved.length === 0) {
      return (
        <p className="sort-empty" role="status">
          Alle Einträge haben bereits Stammdaten — die Liste kann direkt sortiert werden.
        </p>
      );
    }
    return <ul className="sort-list">{unresolved.map((entry) => renderEntry(entry))}</ul>;
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
        <h1>Einkaufsliste sortieren</h1>
      </header>

      <p className="sort-intro">
        Einträge ohne bekannten Einkaufsort werden angezeigt. Entweder einen bekannten Artikel als
        Synonym zuordnen oder einen Einkaufsort auswählen. Ignorierte Einträge werden ganz oben
        einsortiert und beim nächsten Mal wieder abgefragt.
      </p>

      {renderList()}

      {/* The forward action of this step: it hands the decisions to App, which
          persists the new rows and lets the gateway apply the order. Accent,
          content width, right-aligned — the same arrangement the pantry page's
          forward button uses. */}
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
        {(error !== null || !complete) && (
          <p
            className={error !== null ? 'sort-action-error' : 'sort-action-note'}
            role={error !== null ? 'alert' : 'status'}
          >
            {error ?? 'Bitte jeden Eintrag zuordnen oder ignorieren.'}
          </p>
        )}
      </div>

      {/* The discard question (docs/DESIGN.md §6.2): it stands only while a
          decision would be lost, and it is the same sheet every other exit guard
          uses. Its head carries the question, because the sheet explains nothing
          below it; the quiet answer keeps the focus, so a stray Enter stays. */}
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
