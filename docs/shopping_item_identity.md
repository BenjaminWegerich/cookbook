# Shopping Item Identity, Matching and Trip Markets

> Defines how a shopping-list line becomes an *item*: the master data that carries
> the item identity and its locations, the read-time resolution pipeline, the
> normalization rules, the suggestions that grow the synonym table, and the
> market selection that turns the resolved list into one trip's walking order.
> Related documents:
> [storage_format.md](storage_format.md) §9–§10 (the master-data files),
> [ARCHITECTURE.md](ARCHITECTURE.md) (component map).

## 1. The Identity Model

The identity of an item is its own master-data record, not the text of a
shopping-list line. Three name tables carry three identity responsibilities; a
fourth file carries the global market preference:

    einkaufs-artikel.csv      (the identity of everything that can be bought)
    Item;Store;Section
    Karotten;Lidl;Obst und Gemüse
    Karotten;REWE;Obst und Gemüse
    Küchenpapier;dm;Drogerie

    einkaufs-synonyme.csv     (the meaning: variant text → item)
    Variant;Item
    Möhren;Karotten
    Zewa;Küchenpapier

    zutaten.csv               (the ingredient view, storage_format.md §9)
    Ingredient;Singular;Plural;Base Unit;Reorder Point
    Karotten;Karotte;Karotten;g;0
    Küchenpapier              ← has no row here, and must not

- **`einkaufs-artikel.csv` is the identity of everything that can be bought** and
  the single place where a route is kept. It has one row per **location**: an item
  may be available at several markets, but at most once per market. `(Item, Store)`
  is therefore the key, `Store`/`Section` are mandatory, and the pair names a stop
  of the route (storage_format.md §10). Two sections inside the same market are
  rejected — the same item cannot be ambiguous within one market.
- **`zutaten.csv` holds the ingredient master data** and carries no route. It is a
  *view* of those items that happen to be ingredients: base unit and reorder point
  live there, shoppability lives in the item table.
- **`einkaufs-synonyme.csv` states meaning**: a variant text resolves to exactly
  one item. Rows are data, not code — visible, editable and correctable in the
  spreadsheet.
- **`einkaufsweg.csv` is the walking order of the stops.**
- **`einkaufs-maerkte.csv` is the global market preference** (`Store;Rank`,
  `1` = best). It belongs to the trip selection, not to an item's identity; the
  file is user data with no in-app editor (storage_format.md §10).
- **The locations of an item live in exactly one table**, so "the same item with
  two conflicting routes" cannot exist; several locations are not a conflict, a
  second section in one market is.

An ingredient that is never bought (e.g. water) has an ingredient row and no item
row; an item that is not an ingredient has an item row and no ingredient row.
Neither is an error.

The item and synonym tables are edited from the „Einkaufsartikel“ screen (`ShoppingPlaces`):
„Einkaufsartikel anlegen“ creates an item row with its initial synonyms,
„Einkaufsartikel verwalten“ changes the complete location list and synonym list,
and „Einkaufsartikel löschen“ removes both (undo restores them). Creating an
ingredient whose name already names an item pre-fills that item's locations and
synonyms in the same shared sheet and updates the item instead of forking a second
route.

## 2. The Resolution Pipeline

Terms, in the order the pipeline uses them:

- **Line** — one shopping-list entry, exactly as Google Keep holds it.
- **Decoration** — the shapes the app writes around its own lines: a leading
  quantity with its unit token (the `2 Becher` in `2 Becher Joghurt (800 g)`) and,
  in that shape, the trailing parenthetical (the `(800 g)`).
- **Name field** — the line with its decoration removed. This is the only part of
  a line that can name an item.
- **Item name** — the `Item` cell of `einkaufs-artikel.csv`.
- **Variant** — the `Variant` cell of `einkaufs-synonyme.csv`.

Resolving a line to an item happens **at read time**. A sort run does not normalize or rewrite
existing master-data rows and never changes a Keep line; it appends the rows its decisions
create — an **item** row set (one row per chosen location) for a line assigned locations under
a new name, a **synonym** row for a confirmed variant or a renamed assignment, or both for the
last case (§4). The item write still reads before it writes, so rows prepared in the
spreadsheet meanwhile are updated instead of duplicated (storage_format.md §10).

1. **Derive the name field:** Unicode NFC, trim and collapse whitespace, then drop
   the decoration. The field keeps the spelling as typed; the *comparison* is
   case-folded (§3). Deriving it has two parts:

   - **Undo the app's own line shape.** The app writes two shapes into the list
     (see `packages/core/src/shoppingList.ts`): the base form `850 g Mehl`, and a
     whole number of a shopping unit, `3 Becher Mehl (450 g)`. Undoing them means
     dropping the leading quantity together with the one unit token that follows
     it — and, as part of that same shape, the trailing parenthetical. The unit
     vocabulary is **derived from the mappings that flag a unit as their
     shopping unit** in `docs/ingredient_unit_mappings.csv` — in every display form,
     because a count above one writes the plural („2 Packungen Mehl“, see
     additional_quantity_specifications.md §3.2) — plus the base units the app
     writes (g/ml and their display steps kg/l) — never a hand-kept copy of it, so
     adding a unit to the master data cannot silently stop the app's own lines from
     resolving. A unit that is only ever a recipe measure (the clove of garlic,
     EL/TL) is not in the vocabulary.
   - **Fall back to the plain text.** A line whose shape the app did not write
     (`Klopapier`, `Wandfarbe weiß`) is its own name field; nothing is stripped.

   The name field therefore carries no knowledge of *what exists* — it only
   reverses a text shape. An app-written line yields its item name because the app
   spelled it that way when it wrote the line, not because a lookup decided it.
2. **Whole-name match against the item names.** A hit requires the name field to
   be *exactly* an item name — not merely to contain it or to start with it. A
   line therefore never resolves to an attribute of something else:
   `Muffins mit Blaubeeren` does **not** resolve to the item `Blaubeeren`, and
   `Mehl Type 405` does not resolve to `Mehl`. The comparison is case-folded
   (§3), so `joghurt` names the item `Joghurt`. A hit is unambiguous: two item
   names that differ only in case are rejected at load (§5).
3. **Whole-name match of a variant** from `einkaufs-synonyme.csv`, with the same
   exact rule; a hit resolves to the variant's item.
4. **Nothing matched** → the line is *unknown* and is shown on the sort page.
   Similar names are offered as suggestions (§4); the user either confirms one of
   them (which writes a synonym), assigns one or more locations under a new (or
   corrected) item name — which writes the item row set and, when the name was
   edited, the line's own name field as a synonym of it — or **ignores** the line
   for this run (`„Ignorieren“`). Ignoring writes nothing; the line goes to the end
   of the list, before the checked-off lines, and is asked about again on the next
   run. A new item's locations are collected directly on the sort page: one entry
   per market, at most one section per market.

Matching an item takes precedence over matching a variant. A variant equal to an
item name is rejected at load (§5), so the two rules can never disagree about the
same name field.

Undoing the decoration is all-or-nothing: only a line whose leading quantity is
followed by a token of the unit vocabulary is the app's own shape. A shape the
app writes but the pipeline does not undo stays unresolved and is answered by a
suggestion (§4) like any other unknown line — e.g. `1 Bund Petersilie`, whose
unit token is neither a base unit nor a shopping unit; the line keeps its text
(`1 Bund Petersilie`, not `Bund Petersilie`). A recipe measure such as `EL` or
`TL` is no shopping unit either, so the app never writes it onto a list and the
pipeline does not strip it. The strictness is deliberate: a false match costs
more than a question.

## 3. Normalization Rules

Two kinds, kept apart:

**Silent, deterministic rules (code, not master data).** Case folding (including
`ß` → `ss`), multiple and trailing spaces, Unicode normalization, and the
decoration stripping of §2. They are reproducible and need no maintenance, and
they practically never merge two different things.

**Equivalences that carry meaning (synonym rows, not rules).** „TK-“ vs.
„Tiefkühl-“, „Zewa“ vs. „Küchenpapier“: these live in `einkaufs-synonyme.csv`,
because a rule would merge silently what may differ — „Sahne“ and „Schlagsahne“,
„Blaubeeren“ and „TK-Blaubeeren“ are deliberately different items. A prefix rule
such as „TK-“ acts only as a *suggestion* generator (§4), never as an automatic
merge.

## 4. Suggestions

Similarity matching ("fuzzy") is a guess, not knowledge, and is **never applied
automatically**. For an unresolved line the sort page offers similar item names
as candidates on the same field that carries the section suggestions; confirming
one:

1. resolves the line for this run, and
2. appends a row to `einkaufs-synonyme.csv`, so the same variant is never asked
   again.

The same synonym is written when a stop is assigned under a **changed** item
name: the route is stored on the item name taken from „Artikel“, and the line's
own name field is appended as a variant of that item, so the next run recognizes
the line. An unchanged name needs no synonym — the item name alone resolves the
line — and a case-only edit needs none either: the comparison is case-folded, and
a variant must differ from its item name (§5).

The candidate set is the **item names**, never the variants — otherwise it would
grow with every confirmed synonym. The engine is deliberately simple (containment
on the case-folded names, ranked: an item name the field is a prefix of, an item
name inside the field, the field inside an item name) and stayed swappable behind
one function; an edit-distance or phonetic engine can replace it without touching
the flow around it.

A confirmed or renamed variant is matched silently from then on (step 3 of §2).
The synonym table grows out of the user's real list instead of having to be
complete up front. The variant cell keeps the spelling the user typed; only its
comparison key is folded, and a variant that already exists under another spelling
replaces that row instead of doubling it.

## 5. Validation

The master-data loaders fail loudly (storage_format.md §9–§10); that is kept:

- `(Item, Store)` is unique in `einkaufs-artikel.csv`, so an item has at most one
  section per market; all rows of one item use the same spelling (case-folded);
  `Store` and `Section` are non-empty and name a stop of the route.
- `Variant` is unique in `einkaufs-synonyme.csv`; every `Item` it names exists; a
  variant that equals an item name is rejected — a canonical item name must never
  be shadowed by a synonym. All name uniqueness checks compare case-folded, like
  the matching itself.
- An ingredient of `zutaten.csv` without an item row is **not** an error: it is
  never bought (the Wasser case of §1). Only the item row makes an item buyable,
  so a row there needs at least one `Store`/`Section` location, while an
  ingredient without one has no route at all.

## 6. What Is Deliberately Not Done

- **No write-back normalization** of the item tables during a sort run: existing
  rows stay as they are.
- **No rewriting of Keep texts.** The app never changes a line the user typed.
- **No display of the silent resolution.** A line that already resolved before
  the page opened is simply sorted and never appears on the page, not even as a
  summary; only unresolved lines are listed. The folded summary shows the
  decision the user has just made („Möhren“ = Karotten), never a resolution the
  pipeline applied on its own.
- **No automatic similarity merge.** A similar name is a candidate the user
  confirms, never a match the pipeline applies on its own (§4).

## 7. Trip Market Selection

A sort is always a sort **for one upcoming trip**. The list does not ask the user to
pick a single market per item; it asks which markets the trip will visit, and then
allocates every item to the best market among that selection. The selection is a
recommendation, not a lock: the user may deselect a recommended market or add
another one, and the screen shows the consequence before the list is written.

**The rank is global and item-independent.** The `Store → Rank` table in
`einkaufs-maerkte.csv` (`1` = best) decides where an item is bought. It is a Drive
master-data file with no in-app editor (storage_format.md §10); a store missing from
it ranks after the explicitly ranked stores in route order. The route order is a
different thing: it is the walking order and decides the final list order. The two
may disagree — the trip may visit Lidl first while Rewe is the preferred market for
the items both carry.

**Terms.**

- **Relevant item** — a distinct, unchecked, non-ignored item with at least one
  location. Duplicate Keep lines of the same item count once.
- **Mandatory market** — a market that is the only location of at least one
  relevant item.
- **Coverage market** — a non-mandatory market selected so that every relevant item
  has at least one selected market.
- **Priority market** — a non-coverage market that would take over more than
  `SHOPPING_MARKET_PRIORITY_THRESHOLD` (10) relevant items if selected.
- **`wouldTake(m)`** — the number of items that would be bought at `m` if `m` were
  added to the current selection: every one of them moves from no selected market,
  or from a worse-ranked selected market, to `m`.

**The recommendation is built in three stages.**

1. **Mandatory markets are always selected.** An item with exactly one location
   cannot be bought anywhere else, so its market is non-negotiable.
2. **Coverage is a hard constraint.** Add the smallest set of further markets that
   covers every remaining relevant item. The tie-break among equally small sets is
   the priority profile: more items at rank 1 first, then more at rank 2, and so on;
   the remaining tie is broken by a deterministic store order. A minimum cover may include a
   market that only covers one item — that is the price of the guarantee that no
   buyable item silently disappears from the route. Coverage markets are marked
   „Pflicht“ or „Empfohlen“ on the screen; a market needed only for coverage is
   still selected even if it takes fewer than 10 items.
3. **Priority markets are an optional improvement.** Walk the remaining relevant
   markets in rank order. A market is preselected if `wouldTake(m) > 10`. Because
   the walk is best-rank first and coverage is already complete, every later market
   is worse-ranked and cannot take those items back: each preselected priority
   market keeps more than 10 items in the final preselection. The threshold is
   deliberately a constant, not a setting.

The result is a selected set that **covers all relevant items** and, in addition,
adds markets that meaningfully improve their priority. A user selection that
deselects a coverage market is allowed; the screen then reports the items that lose
their market and the items that fall back to a worse-ranked market. Items with no
location at all (unknown and ignored, or an item row that was never created) are not
relevant; they always go to the end.

**Allocation.** For each line, the chosen stop is the item's location at the
best-ranked **selected** market. If the item has no location at a selected market,
the line is unmapped. The final order is then the route order of the chosen stops:
assigned lines first in walking order, then the unmapped lines in Keep order
(ignored and no-selected-market together), then the checked-off lines last. Rank
decides *where* an item is bought; route order decides *when in the list* it appears.

## 8. The Sort Flow

The sort is a two-step flow. Both steps share one unsaved work state; closing the
flow asks before discarding it, and nothing is written to Drive until the final
„Liste sortieren“.

**Step 1 — „Einkaufsliste sortieren“.** Only unchecked lines that name no item are
listed. Per line the user can choose a known item as a synonym, ignore the line for
this run, or create a new item with **one or more locations**. The location editor
uses the store chips and the section chips of that store; choosing a section for a
store already in the list updates its section — a second section for the same market
is impossible. The row stays open after the first location so more can be added, and
folds to a summary only when focus leaves it. A new item needs at least one
location; a line whose „Artikel“ text names an existing item remains a synonym
decision and hides the location editor. The forward action is „Weiter“.

**Step 2 — „Einkaufsweg wählen“.** The page lists the relevant markets by rank and
preselects the recommendation of §7. Each row shows its rank, whether it is
mandatory/coverage/priority, and how many items it takes over under the current
selection. A live summary reports how many relevant items are covered, how many are
uncovered, how many would be bought at a worse-ranked market, and how many lines
were ignored. The user can toggle any market; „Empfehlung wiederherstellen“ resets
the selection. The final action is „Liste sortieren“; it persists the step-1
decisions (item location rows and synonyms) and reorders the list for the chosen
markets. A failed write leaves the page open with the reason.

The market screen shows an empty state when there is no market that supplies any
relevant item. If there is no unresolved line, step 1 shows its empty state and its „Weiter“
opens the market step directly. „Ignorieren“ is per run:
it writes no master data, places the line at the end of the not-yet-bought lines,
and asks about the line again next time. The former „Oben einsortieren“ /
„Unten einsortieren“ pair is gone: after the trip selection, an item either belongs
to a selected market or has no market, and both placement answers would be the same
end position.
