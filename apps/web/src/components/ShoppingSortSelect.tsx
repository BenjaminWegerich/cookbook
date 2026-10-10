/**
 * Shopping-list sort page — the full-screen page behind "sortieren" in the home
 * screen's "Einkaufsliste" caption row (App's `sort` layer). The page itself
 * still titles the task in full ("Einkaufsliste sortieren").
 *
 * The page is where the shopping list's aisle sort gets the one thing the
 * master data cannot give it: an Einkaufsort for every line that has none yet.
 * It reads the current shopping list, classifies each line against the
 * shopping-route assignment (core's `matchShoppingItem`), and lists the
 * unchecked lines that name no assigned item. Per such line the user either
 * picks the stop — the same store-chips + section-search „Einkauf“ field the
 * new-ingredient sheet uses — or ignores the line, which the sort places at the
 * top of the list. Lines that already have master data are not listed: they are
 * sorted silently.
 *
 * On commit the page hands the decisions over to App, which persists the newly
 * chosen stops to `einkaufs-zuordnung.csv`, derives the target order (core's
 * `shoppingSortOrder`), and lets the gateway apply it. A failure is shown next
 * to the button and the page stays open, so the decisions are not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  matchShoppingItem,
  shoppingItemName,
  shoppingSections,
  shoppingStores,
  type ShoppingStop,
} from '@cookbook/core';

import type { KeepItem } from '../keep/keepClient';

/** How one unresolved line was decided: a chosen stop, or "put it on top". */
type Resolution = ShoppingStop | 'ignore';

interface ShoppingSortSelectProps {
  /** The shopping-list items in Keep's display order (top first) — a snapshot. */
  items: readonly KeepItem[];
  /** Leaves the page for the home screen (header "Zurück", browser Back). */
  onClose: () => void;
  /**
   * Applies the decisions: persists the new stops, reorders the list through
   * the gateway and closes the flow. Resolves on success; a failure is thrown
   * and shown next to the button (the page stays open).
   */
  onSort: (resolutions: ReadonlyMap<string, Resolution>) => Promise<void>;
}

/** One unresolved line the page asks the user about. */
interface UnresolvedEntry {
  /** The exact Keep line text (the resolution map's key). */
  text: string;
  /** The item name the sort will persist when a stop is chosen. */
  item: string;
}

/**
 * The unchecked lines that name no assigned item, deduplicated by text (two
 * identical lines are the same item and get one decision). The page is about
 * *which stop an item gets*, so a line already on the assignment does not
 * appear here — the sort handles it without asking.
 */
function unresolvedEntries(items: readonly KeepItem[]): UnresolvedEntry[] {
  const seen = new Set<string>();
  const entries: UnresolvedEntry[] = [];
  for (const item of items) {
    if (item.checked) continue;
    const text = item.text.trim();
    if (text === '' || seen.has(text) || matchShoppingItem(text) !== null) continue;
    seen.add(text);
    entries.push({ text, item: shoppingItemName(text) });
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
function ShoppingSortSelect({ items, onClose, onSort }: ShoppingSortSelectProps) {
  /** The unresolved lines, computed once from the snapshot. */
  const unresolved = useMemo(() => unresolvedEntries(items), [items]);
  /** Ignored lines by text (placed at the top of the list). */
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** Chosen store by text (level 1 of the „Einkauf“ field). */
  const [stores, setStores] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Section search text by text (level 2 of the „Einkauf“ field). */
  const [sections, setSections] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** True while the sort runs — the button is unavailable then. */
  const [busy, setBusy] = useState(false);
  /** Reason the sort failed, shown next to the button (null = no failure). */
  const [error, setError] = useState<string | null>(null);

  const storesOfRoute = shoppingStores();

  /** True when every unresolved line is decided (ignored or a valid stop). */
  const complete = unresolved.every((entry) => {
    if (ignored.has(entry.text)) return true;
    if (storesOfRoute.length === 0) return false;
    const store = stores.get(entry.text);
    return chosenStop(store, store === undefined ? [] : shoppingSections(store), sections.get(entry.text) ?? '') !== null;
  });

  /** True while the snapshot holds at least one unchecked line to sort. */
  const hasEntries = items.some((item) => !item.checked);

  /** Whether the forward action can run. */
  const canSort = complete && hasEntries && !busy;

  /** Toggles "ignored" for one line. Ignoring clears any picked stop, so
   *  re-opening the picker starts clean instead of reviving a stale half-choice. */
  function toggleIgnored(text: string): void {
    if (ignored.has(text)) {
      setIgnored((current) => {
        const next = new Set(current);
        next.delete(text);
        return next;
      });
      return;
    }
    setIgnored((current) => new Set(current).add(text));
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

  /** Picks a store (level 1); a section belongs to exactly one store, so the
   *  previous section is cleared when the store changes (same rule as the
   *  new-ingredient sheet). */
  function chooseStore(text: string, store: string): void {
    setStores((current) => new Map(current).set(text, store));
    setSections((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
  }

  /** Types into one line's section search field. */
  function typeSection(text: string, query: string): void {
    setSections((current) => new Map(current).set(text, query));
  }

  /** Runs the sort: build the decision map and hand it to App. */
  async function handleSort(): Promise<void> {
    setBusy(true);
    setError(null);
    const resolutions = new Map<string, Resolution>();
    for (const entry of unresolved) {
      if (ignored.has(entry.text)) {
        resolutions.set(entry.text, 'ignore');
        continue;
      }
      const store = stores.get(entry.text);
      const stop = chosenStop(store, store === undefined ? [] : shoppingSections(store), sections.get(entry.text) ?? '');
      if (stop !== null) {
        resolutions.set(entry.text, stop);
      }
    }
    try {
      await onSort(resolutions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  /** The „Einkauf“ picker of one line (the new-ingredient sheet's field shape). */
  function renderPicker(entry: UnresolvedEntry): ReactNode {
    if (ignored.has(entry.text)) {
      return (
        <p className="sort-ignored-note" role="status">
          Wird oben in die Liste einsortiert.
        </p>
      );
    }
    if (storesOfRoute.length === 0) {
      return (
        <p className="field-hint">
          Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — dieser Eintrag kann nur ignoriert
          werden.
        </p>
      );
    }
    const store = stores.get(entry.text);
    const sectionOptions = store === undefined ? [] : shoppingSections(store);
    const section = (sections.get(entry.text) ?? '').trim();
    const suggestions = sectionOptions.includes(section)
      ? []
      : sectionOptions.filter((candidate) => candidate.toLowerCase().includes(section.toLowerCase()));
    return (
      <>
        <div className="store-chips" role="group" aria-label={`Markt für ${entry.item}`}>
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

        {store !== undefined && (
          <>
            <p className="field-hint">Bereich</p>
            <input
              type="text"
              value={sections.get(entry.text) ?? ''}
              onChange={(event) => typeSection(entry.text, event.target.value)}
              aria-label={`Bereich in ${store}`}
              placeholder="Suchen oder wählen"
            />
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((candidate) => (
                  <li key={candidate}>
                    <button type="button" onClick={() => typeSection(entry.text, candidate)}>
                      {candidate}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </>
    );
  }

  /** One unresolved line: its text, its item name, the picker and the ignore toggle. */
  function renderEntry(entry: UnresolvedEntry): ReactNode {
    const isIgnored = ignored.has(entry.text);
    return (
      <li key={entry.text} className="sort-entry">
        <p className="sort-entry-text">{entry.text}</p>
        <p className="sort-entry-item">
          <span className="field-label">Artikel</span>
          <span>{entry.item}</span>
        </p>

        <div className="field">
          <span className="field-label">Einkauf</span>
          {renderPicker(entry)}
        </div>

        <button
          type="button"
          className={isIgnored ? 'chip chip-active sort-ignore' : 'chip sort-ignore'}
          aria-pressed={isIgnored}
          onClick={() => toggleIgnored(entry.text)}
        >
          {isIgnored ? 'Ignoriert' : 'Ignorieren'}
        </button>
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
    return (
      <ul className="sort-list">{unresolved.map((entry) => renderEntry(entry))}</ul>
    );
  }

  return (
    <main className="app app-narrow sort-select">
      {/* "Zurück" on its own line at the top left, the screen title below it —
          the shared stacked header (.app-header-stacked). */}
      <header className="app-header app-header-stacked">
        <button type="button" className="text-button back-button" onClick={onClose}>
          Zurück
        </button>
        <h1>Einkaufsliste sortieren</h1>
      </header>

      <p className="sort-intro">
        Einträge ohne Einkaufsort werden hier zugeordnet. Einträge, die du ignorierst, kommen an
        den Anfang der Liste; alle anderen werden nach dem Einkaufsweg sortiert.
      </p>

      {renderList()}

      {/* The forward action of this step: it hands the decisions to App, which
          persists the new stops and lets the gateway apply the order. Accent,
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
          {busy ? 'Wird sortiert …' : 'Einkaufsliste sortieren'}
        </button>
        {(error !== null || !complete) && (
          <p className={error !== null ? 'sort-action-error' : 'sort-action-note'} role={error !== null ? 'alert' : 'status'}>
            {error ?? 'Bitte jeden Eintrag zuordnen oder ignorieren.'}
          </p>
        )}
      </div>
    </main>
  );
}

export default ShoppingSortSelect;
