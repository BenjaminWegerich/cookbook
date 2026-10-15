# Shopping Item Identity and Matching

> Defines how a shopping-list line becomes an *item*: the master data that carries
> the item identity, the read-time resolution pipeline, the normalization rules and
> the suggestions that grow the synonym table. Related documents:
> [storage_format.md](storage_format.md) §9–§10 (the master-data files),
> [ARCHITECTURE.md](ARCHITECTURE.md) (component map).

## 1. The Identity Model

The identity of an item is its own master-data record, not the text of a
shopping-list line. Three tables carry three responsibilities:

    einkaufs-artikel.csv      (the identity of everything that can be bought)
    Item;Store;Section
    Karotten;Lidl;Obst und Gemüse
    Küchenpapier;dm;Drogerie

    einkaufs-synonyme.csv     (the meaning: variant text → item)
    Variant;Item
    Möhren;Karotten
    Zewa;Küchenpapier

    zutaten.csv               (the ingredient view, storage_format.md §9)
    Ingredient;Base Unit;Reorder Point
    Karotten;g;0
    Küchenpapier              ← has no row here, and must not

- **`einkaufs-artikel.csv` is the identity of everything that can be bought** and
  the single place where a route is kept. One row per item, the `Item` cell is the
  key; `Store`/`Section` are mandatory and name a stop of the route
  (storage_format.md §10).
- **`zutaten.csv` holds the ingredient master data** and carries no route. It is a
  *view* of those items that happen to be ingredients: base unit and reorder point
  live there, shoppability lives in the item table.
- **`einkaufs-synonyme.csv` states meaning**: a variant text resolves to exactly
  one item. Rows are data, not code — visible, editable and correctable in the
  spreadsheet.
- **`einkaufsweg.csv` is the walking order of the stops.**
- **The route of an item lives in exactly one table**, so "the same item with two
  conflicting routes" cannot exist.

An ingredient that is never bought (e.g. water) has an ingredient row and no item
row; an item that is not an ingredient has an item row and no ingredient row.
Neither is an error.

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

Resolving a line to an item happens **at read time**. No table is rewritten by a
sort run, with the single exception of a confirmed suggestion (§4).

1. **Derive the name field:** Unicode NFC, trim and collapse whitespace, then drop
   the decoration. The field keeps the spelling as typed; the *comparison* is
   case-folded (§3). Deriving it has two parts:

   - **Undo the app's own line shape.** The app writes two shapes into the list
     (see `packages/core/src/shoppingList.ts`): the base form `850 g Mehl`, and a
     whole number of a shopping unit, `3 Becher Mehl (450 g)`. Undoing them means
     dropping the leading quantity together with the one unit token that follows
     it — and, as part of that same shape, the trailing parenthetical. The unit
     vocabulary is **derived from the additional units flagged `Shopping Unit`**
     in `docs/additional_units.csv` plus the base units the app writes
     (g/ml and their display steps kg/l) — never a hand-kept copy of it, so adding
     a unit to the master data cannot silently stop the app's own lines from
     resolving.
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
   them (which writes a synonym), assigns a stop under a new item name, or ignores
   the line.

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

The candidate set is the **item names**, never the variants — otherwise it would
grow with every confirmed synonym. The engine is deliberately simple (containment
on the case-folded names, ranked: an item name the field is a prefix of, an item
name inside the field, the field inside an item name) and stayed swappable behind
one function; an edit-distance or phonetic engine can replace it without touching
the flow around it.

A confirmed variant is matched silently from then on (step 3 of §2). The synonym
table grows out of the user's real list instead of having to be complete up
front. The variant cell keeps the spelling the user typed; only its comparison
key is folded, and a variant that already exists under another spelling replaces
that row instead of doubling it.

## 5. Validation

The master-data loaders fail loudly (storage_format.md §9–§10); that is kept:

- `Item` is unique in `einkaufs-artikel.csv`; `Store` and `Section` are non-empty
  and name a stop of the route.
- `Variant` is unique in `einkaufs-synonyme.csv`; every `Item` it names exists; a
  variant that equals an item name is rejected — a canonical item name must never
  be shadowed by a synonym. All three uniqueness checks compare case-folded, like
  the matching itself.
- An ingredient of `zutaten.csv` without an item row is **not** an error: it is
  never bought (the Wasser case of §1). Only the item row makes an item buyable,
  so a row there needs `Store` and `Section`, while an ingredient without one has
  no route at all.

## 6. What Is Deliberately Not Done

- **No write-back normalization** of the item tables during a sort run: existing
  rows stay as they are.
- **No rewriting of Keep texts.** The app never changes a line the user typed.
- **No display of the silent resolution.** The sort page does not print
  „Möhren → Karotten“ next to a line: a line that resolved is simply sorted, and
  only an unresolved line is shown and asked about.
- **No automatic similarity merge.** A similar name is a candidate the user
  confirms, never a match the pipeline applies on its own (§4).
