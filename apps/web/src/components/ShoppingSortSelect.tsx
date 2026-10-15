/**
 * Shopping-list sort page — the full-screen page behind "sortieren" in the home
 * screen's "Einkaufsliste" caption row (App's `sort` layer). The page itself
 * still titles the task in full ("Einkaufsliste sortieren").
 *
 * The page is where the shopping list's aisle sort gets the one thing the master
 * data cannot give it: a decision for every line that resolved to no item
 * (docs/shopping_item_identity.md §2/§4). It reads the current shopping list,
 * classifies each line against the item table (core's `matchShoppingItem`), and
 * lists the unchecked lines that name no item. Per such line the user either:
 *
 * - confirms one of the **similar item names** offered above the „Einkauf“ field
 *   (core's `shoppingItemSuggestions`) — the line then sorts as that item for
 *   this run, and App writes a **synonym** row, so the same variant is never
 *   asked again;
 * - **assigns a stop** in the same store-chips + section-search field the
 *   new-ingredient sheet uses — App then writes a new item row under the name in
 *   the editable „Artikel“ field; or
 * - **ignores** the line, which the sort places at the top of the list.
 *
 * The two first ways are mutually exclusive: confirming a candidate clears any
 * store/section choice and vice versa, so exactly one of them decides; tapping
 * the active candidate again takes the decision back. A line that resolved is
 * never shown here — the page does not display the silent resolution.
 *
 * On commit the page hands the decisions over to App, which persists them,
 * derives the target order (core's `shoppingSortOrder`), and lets the gateway
 * apply it. A failure is shown next to the button and the page stays open, so the
 * decisions are not lost.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  matchShoppingItem,
  shoppingItemSuggestions,
  shoppingNameField,
  shoppingSections,
  shoppingStores,
  type ShoppingStop,
} from '@cookbook/core';

import type { KeepItem } from '../keep/keepClient';

/**
 * How one unresolved line was decided:
 * - `item` — a new (or corrected) item row under `name` at `stop`;
 * - `synonym` — `variant` (the line's name field) means the existing `item`,
 *   which resolves the line without touching the item table (the only write the
 *   sort flow performs besides the new rows, docs/shopping_item_identity.md §4);
 * - `ignore` — placed at the top of the list.
 */
export type SortResolution =
  | { readonly kind: 'item'; readonly name: string; readonly stop: ShoppingStop }
  | { readonly kind: 'synonym'; readonly variant: string; readonly item: string }
  | 'ignore';

interface ShoppingSortSelectProps {
  /** The shopping-list items in Keep's display order (top first) — a snapshot. */
  items: readonly KeepItem[];
  /** Leaves the page for the home screen (header "Zurück", browser Back). */
  onClose: () => void;
  /**
   * Applies the decisions: persists the new item and synonym rows, reorders the
   * list through the gateway and closes the flow. Resolves on success; a failure
   * is thrown and shown next to the button (the page stays open).
   */
  onSort: (resolutions: ReadonlyMap<string, SortResolution>) => Promise<void>;
}

/** One unresolved line the page asks the user about. */
interface UnresolvedEntry {
  /** The exact Keep line text (the resolution map's key). */
  text: string;
  /** The line's name field — the initial „Artikel“ text and a synonym's variant. */
  nameField: string;
  /** Similar item names offered as candidates (empty when nothing is similar). */
  suggestions: readonly string[];
}

/**
 * The unchecked lines that name no item, deduplicated by text (two identical
 * lines are the same item and get one decision). A line that already resolved is
 * not listed: it is sorted silently.
 */
function unresolvedEntries(items: readonly KeepItem[]): UnresolvedEntry[] {
  const seen = new Set<string>();
  const entries: UnresolvedEntry[] = [];
  for (const item of items) {
    if (item.checked) continue;
    const text = item.text.trim();
    if (text === '' || seen.has(text) || matchShoppingItem(text) !== null) continue;
    seen.add(text);
    entries.push({
      text,
      nameField: shoppingNameField(text),
      suggestions: shoppingItemSuggestions(text),
    });
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
  /** The „Artikel“ text by line (the name field until the user edits it). */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** The confirmed similar item by line, if any. */
  const [candidates, setCandidates] = useState<ReadonlyMap<string, string>>(() => new Map());
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

  /** The „Artikel“ text of one line: what the user edited, else the name field. */
  function draftOf(entry: UnresolvedEntry): string {
    return drafts.get(entry.text) ?? entry.nameField;
  }

  /** Drops the picked stop of one line (used when a candidate takes over). */
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

  /** True when every unresolved line is decided (ignored, a candidate or a stop). */
  const complete = unresolved.every((entry) => {
    if (ignored.has(entry.text) || candidates.has(entry.text)) return true;
    // A new item row needs a name; the derived one is prefilled, but the user
    // can clear the field, and an empty item name must not be written.
    if (draftOf(entry).trim() === '') return false;
    if (storesOfRoute.length === 0) return false;
    const store = stores.get(entry.text);
    return (
      chosenStop(
        store,
        store === undefined ? [] : shoppingSections(store),
        sections.get(entry.text) ?? '',
      ) !== null
    );
  });

  /** True while the snapshot holds at least one unchecked line to sort. */
  const hasEntries = items.some((item) => !item.checked);

  /** Whether the forward action can run. */
  const canSort = complete && hasEntries && !busy;

  /** Types into one line's „Artikel“ field. */
  function typeDraft(text: string, value: string): void {
    setDrafts((current) => new Map(current).set(text, value));
  }

  /**
   * Confirms or takes back a similar item. Confirming clears the picked stop and
   * keeping the „Artikel“ draft out of the way: the candidate decides the line.
   */
  function toggleCandidate(text: string, candidate: string): void {
    setCandidates((current) => {
      const updated = new Map(current);
      if (updated.get(text) === candidate) {
        updated.delete(text);
      } else {
        updated.set(text, candidate);
      }
      return updated;
    });
    if (candidates.get(text) !== candidate) {
      clearStop(text);
    }
  }

  /** Toggles "ignored" for one line. Ignoring clears any picked stop and
   *  candidate, so re-opening the row starts clean instead of reviving a stale
   *  half-choice. */
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
    clearStop(text);
    setCandidates((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
  }

  /** Picks a store (level 1); a section belongs to exactly one store, so the
   *  previous section is cleared when the store changes (same rule as the
   *  new-ingredient sheet). A candidate is the other way to decide the line, so
   *  picking a store takes a candidate back. */
  function chooseStore(text: string, store: string): void {
    setStores((current) => new Map(current).set(text, store));
    setSections((current) => {
      const updated = new Map(current);
      updated.delete(text);
      return updated;
    });
    setCandidates((current) => {
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
    const resolutions = new Map<string, SortResolution>();
    for (const entry of unresolved) {
      if (ignored.has(entry.text)) {
        resolutions.set(entry.text, 'ignore');
        continue;
      }
      const candidate = candidates.get(entry.text);
      if (candidate !== undefined) {
        // The variant is the line's name field, never the edited „Artikel“ text:
        // the next run must recognize the same line, and what it derives is the
        // name field.
        resolutions.set(entry.text, {
          kind: 'synonym',
          variant: entry.nameField,
          item: candidate,
        });
        continue;
      }
      const store = stores.get(entry.text);
      const stop = chosenStop(
        store,
        store === undefined ? [] : shoppingSections(store),
        sections.get(entry.text) ?? '',
      );
      if (stop !== null) {
        resolutions.set(entry.text, { kind: 'item', name: draftOf(entry).trim(), stop });
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
   * The similar-item chips of one line, directly above the „Einkauf“ field: the
   * candidates core offers for the name field. Deliberately without a caption —
   * the chips sit between the „Artikel“ field and „Einkauf“ and read as "or this
   * one"; the aria-label carries the meaning for screen readers.
   */
  function renderCandidates(entry: UnresolvedEntry): ReactNode {
    if (entry.suggestions.length === 0 || ignored.has(entry.text)) {
      return null;
    }
    const chosen = candidates.get(entry.text);
    return (
      <ul className="suggestions sort-candidates" aria-label="Ähnliche Artikel">
        {entry.suggestions.map((candidate) => (
          <li key={candidate}>
            <button
              type="button"
              className={chosen === candidate ? 'chip chip-active' : 'chip'}
              aria-pressed={chosen === candidate}
              onClick={() => toggleCandidate(entry.text, candidate)}
            >
              {candidate}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  /** The „Artikel“ field: the name field, editable before a stop is assigned. */
  function renderDraftField(entry: UnresolvedEntry): ReactNode {
    return (
      <div className="field">
        <span className="field-label">Artikel</span>
        <input
          type="text"
          value={draftOf(entry)}
          onChange={(event) => typeDraft(entry.text, event.target.value)}
          aria-label={`Artikelname für ${entry.text}`}
        />
      </div>
    );
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
    const candidate = candidates.get(entry.text);
    if (candidate !== undefined) {
      return (
        <p className="sort-ignored-note" role="status">
          {`Wird als Synonym für „${candidate}“ gemerkt.`}
        </p>
      );
    }
    if (storesOfRoute.length === 0) {
      return (
        <p className="field-hint">
          Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — dieser Eintrag kann nur ignoriert werden.
        </p>
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
      <>
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
                    <button
                      type="button"
                      className="chip"
                      onClick={() => typeSection(entry.text, candidate)}
                    >
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

  /** One unresolved line: its text, the name field, the candidates, the picker
   *  and the ignore toggle. The „Artikel“ field is hidden while a candidate
   *  decides the line — the candidate is the whole decision then. */
  function renderEntry(entry: UnresolvedEntry): ReactNode {
    const isIgnored = ignored.has(entry.text);
    const hasCandidate = candidates.has(entry.text);
    return (
      <li key={entry.text} className="sort-entry">
        <p className="sort-entry-text">{entry.text}</p>

        {!isIgnored && !hasCandidate && renderDraftField(entry)}
        {renderCandidates(entry)}

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
    return <ul className="sort-list">{unresolved.map((entry) => renderEntry(entry))}</ul>;
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
        Einträge ohne Einkaufsort werden hier einem Artikel zugeordnet — einem ähnlichen, der dann
        als Synonym gemerkt wird, oder mit Markt und Bereich als neuer Artikel. Einträge, die du
        ignorierst, kommen an den Anfang der Liste; alle anderen werden nach dem Einkaufsweg
        sortiert.
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
          {busy ? 'Wird sortiert …' : 'Einkaufsliste sortieren'}
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
    </main>
  );
}

export default ShoppingSortSelect;
