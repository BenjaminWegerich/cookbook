# Recipe Storage Format (Markdown + YAML)

> **Status:** Decided as the canonical recipe format. This document specifies the physical
> encoding of a recipe file.
> [recipe_structure.md](recipe_structure.md) remains the authoritative logical model
> (fields, rules, examples); this document defines how that model is written to disk.

## 1. Purpose and Principles

- **One file per recipe.** Each recipe is a single Markdown file (`.md`, UTF-8).
  The file name equals the recipe title (see §2).
- **One source of truth.** The web app, the HTML share export, the speech-optimized
  read-aloud, and the shopping-list logic all read this file. There is no second,
  hand-maintained copy of the data.
- **Two parts in one file:**
  - **YAML front matter** (between the leading `---` lines) — the structured
    metadata (title, type, times, servings/yield, the `reference` name list);
  - **Markdown body** — the preparation steps (§5). Each step carries its own
    **ingredient rows** (§4), which are the source of truth for the ingredient
    list; the master list is *derived* from the rows on read.
- **What is NOT stored in the recipe file:**
  - additional quantity specifications (e.g., "1 Becher", "½ Zitrone") — these are
    computed at display time from the additional-unit master data
    (see [additional_quantity_specifications.md](additional_quantity_specifications.md));
  - scaling results — scaling is a view on top of the stored base quantities
    (see [quantity_scaling.md](quantity_scaling.md)).
- **Language:** field names and enum values are English (code), all content values
  (title, description, steps, notes) are German (data) — per
  [CODING_CONVENTIONS.md](CODING_CONVENTIONS.md).

## 2. File Layout and Naming

- The collection is a folder (in the chosen cloud storage) with four subfolders:
  - `Rezepte/` — one `.md` file per recipe;
  - `Exporte/` — the generated `<title>.html` cooking views (§8);
  - `Bilder/` — the recipe photos;
  - `Stammdaten/` — the CSV master data and `rezept-richtlinien.md` (§9, §10).

  Nothing lives directly in the collection folder: the app reads and writes one
  level below it. A file left in the collection root is not picked up (the app
  reports it instead of silently ignoring it).
- **File name = title**, e.g. `Rezepte/Shredded Tofu Wraps.md`.
  - Title characters that are invalid in file names (`/`, `\`, `:` etc.) are
    disallowed in titles; the schema validation enforces this.
- **Image:** optional single real photo. It lives in `Bilder/` with the same
  basename and a `.jpg` / `.png` extension, e.g. `Bilder/Shredded Tofu Wraps.jpg`.
  There is no `image` field in the front matter; the basename carries the link to
  the recipe.
- The canonical file, its image and its export move together; the app treats them
  as one unit (a title change renames all three).

## 3. YAML Front Matter — Schema

Style rules: two-space indentation, no tabs, field order as listed below.
The app writes YAML through a serializer; hand-written files are validated on read.

### Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Unique within the whole collection; the stable identifier (see §6). Example: `Shredded Tofu Wraps`. |
| `type` | enum | yes | `finished_dish` or `ingredient_recipe` — never derived, set by the author. |
| `description` | string | no | A single paragraph; may suggest side dishes or other uses, and may be phrased as a continuation of the title (e.g. `Bauernfrühstück / mit Kartoffeln, Karotten und Tofu`). |
| `prep_time` | string | yes | Free-text display value, e.g. `25 min`, `1 h 30 min`. The editor offers the standard values 1/3/5/10/15/20/30/45 min and 1/1.5/2/3/6/12/24/48 h as chips. |
| `total_time` | string | no | Only if it is larger than `prep_time`. |

### Type-specific fields

| `type` | Required fields | Forbidden | Notes |
|---|---|---|---|
| `finished_dish` | `servings` | `yield`, `yield_unit` | `servings`: one of the allowed serving counts `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30`. Example: `6` — not `11`. |
| `ingredient_recipe` | `yield`, `yield_unit` | `servings` | `yield`: any positive number (stored target `V0`); `yield_unit`: `g` or `ml`. Example: `yield: 500`, `yield_unit: ml`. |

Additional fields:

| Field | Type | Allowed on | Notes |
|---|---|---|---|
| `reference` | list of strings | both types | Names of any number of ingredients anchored to the recipe's size — the portion size (`finished_dish`) or the yield (`ingredient_recipe`), §4. Names must occur in the recipe rows. |

### Theme (optional, both types)

`theme` is the recipe's visual skin for the HTML share export — a typeface and a
small palette. [DESIGN.md](DESIGN.md) §4.8 is authoritative for the theme; this
document only fixes its physical encoding. It is a mapping of up to five optional
tokens; each token may be omitted and then falls back to the default theme
independently:

| Token | Type | Default | Notes |
|---|---|---|---|
| `font` | string | `Noto Sans` | One typeface of the export font shortlist (DESIGN.md §4.8); no other typeface is allowed. `Noto Sans Condensed` and `Noto Sans Mono` are retired: existing files may still carry them, new recipes must not choose them. |
| `accent` | string | `#ad5632` | Active state, forward actions, links, sub-recipe badge. |
| `paper` | string | `#faf5ec` | Page background. |
| `ink` | string | `#2b241d` | Primary text. |
| `line` | string | `#e6dbc8` | Hairlines, borders, dividers. |

Colours are canonical 6-digit hex (`#rrggbb`); the serializer quotes them because
a leading `#` would otherwise start a YAML comment. The derived colours of
DESIGN.md §4.8 (`muted`, `on-accent`) are never stored — the export computes them
at render time. A recipe without `theme` (or with an empty mapping) renders in
the app's look.

```markdown
theme:
  font: Noto Serif
  accent: "#ad5632"
  paper: "#faf5ec"
```

In the file, `theme` is written last, after `total_time`; only the tokens the
author set are written, never the defaults.

A front-matter `ingredients` field is **rejected**: the master list is derived
from the step rows (§4), never typed. The editor's quantity pool is bounded to
1 … 10000 (g/ml); values are stored in the family unit, `kg`/`l` appear only in
display (see [additional_quantity_specifications.md](additional_quantity_specifications.md) §2).

## 4. Ingredients — Step Rows and Inline Artifacts

Every step carries its own **counted ingredient list** (see §5 for the physical
layout). The rows are written in a natural, amount-first phrase:

```
1. - 250 g Tortillas
   - 15 ml Zitronensaft
   Tortillas im Ofen erwärmen.
```

- **Row grammar:** `- MENGE EINHEIT NAME` (e.g. `- 250 g Reis`,
  `- 400 ml Kokosmilch`). The quantity is the unrounded target `V0`: any positive
  finite number in the ingredient's family unit. A row may end with an optional
  precision tag: `- 250 g Reis {precision: high}`. The tag pins the level for
  that use: it survives later changes of the ingredient default and may
  deliberately repeat the current default; a row without the tag follows the
  default live. The row is the only way an ingredient enters the recipe's lists.
- The **master ingredient list is derived** from the rows of all steps (§7.1):
  - order = order of first use across the steps (each step's rows in their order);
  - an ingredient used several times appears **once, with the total of the rows'
    displayed BQs** (not the sum of their exact targets; the practical amounts
    the cook reads are what add up). The sum is kept at millionth precision to
    remove floating-point noise;
  - the master row's **display** follows the master-quantity rules
    ([quantity_scaling.md](quantity_scaling.md) §6): a once-used ingredient
    repeats the step arrangement, several uses keep the exact BQ sum, a shared
    AU keeps the exact AQ sum, and the row inherits the highest precision of its
    uses. The derived BQ total above is unchanged;
  - rows with the same name but different base units stay separate.
- **Inline artifacts** are display-only quantity mentions *inside the step text*
  (never counted toward any list, but scaled with the serving count at display
  time and rendered code-styled):
  ```
  Nudeln in {{1500 ml Wasser}} kochen.         ingredient mention
  {{100 g}} Teig flach ausrollen.              quantity-only mention
  {{1/2}} Zwiebel fein würfeln.                unitless count
  ```
  - Grammar: `{{ MENGE EINHEIT [NAME] }}`, where MENGE is an integer, a decimal
    (`.` or German `,`), a fraction (`1/3`) or a mixed number (`1+1/4`). With a
    name the artifact is an ingredient mention (name = everything after the unit,
    e.g. `Wasser`); without a name it is a quantity-only mention (`100 g`). A
    quantity-only mention may also omit the unit entirely (`{{1/2}}` — a unitless
    count, e.g. a number of pieces); an ingredient mention always carries a unit.
    All variants scale with the number of servings and render code-styled, with
    the l/kg display form where a unit is present.
  - **A unitless count is an unrounded target.** Any positive number is allowed
    (a decimal or a fraction). AQ values keep their canonical fraction notation
    (`{{1/3}}`, `{{1+1/4}}`, `{{3}}`); other counts are stored as decimals. The
    display uses the AQ table (BQ-only branch). A count has no ingredient, so
    only an optional artifact override applies; without one the internal neutral
    `medium` is used (docs/quantity_scaling.md §8). An artifact may carry a
    precision suffix: `{{1/2|precision: high}}`.
  - An artifact that carries a unit is a base quantity: its `MENGE` is the
    unrounded target and its display uses the normal optimizer.
  - **Canonical values are g/ml with `.` decimals.** Hand-written files may use
    German comma decimals, fractions and `kg`/`l` (`{{1,5 l Wasser}}`,
    `- 0,2 kg Reis`); the parser normalizes them on read (comma → dot, kg/l →
    g/ml ×1000). Non-positive or malformed values remain validation errors.
  - A malformed `{{…}}` block is a validation error — never silently treated as prose.
- **Reference role** (size anchor, both recipe types): stored as a front-matter
  list of ingredient names, `reference: [Tortillas]` (any number of entries). It
  anchors the portion size on a `finished_dish` and the yield on an
  `ingredient_recipe`. It is a property of the *master* list — the editor shows
  it only there; rows and artifacts never carry it. A name must match a merged
  ingredient of the recipe.
- **Sub-recipe links are implicit**: an ingredient use — step row, master row or
  inline artifact — whose name equals the title of an `ingredient_recipe` in the
  collection *is* that sub-recipe (there is no link field; the editor picks the
  title like any ingredient). The HTML export renders such uses as links to the
  sub-recipe's own export file (see the HTML share export in ARCHITECTURE.md);
  renaming the recipe updates them together (§6).
- The additional-unit display ("1 Becher Joghurt (500 g)") is never stored; it
  is computed at display time from the master data.

## 5. Markdown Body — Preparation Steps

- After the front matter, the body contains exactly one structural heading and the
  ordered step list:

  ```markdown
  ## Zubereitung
  1. - 250 g Tortillas
     Tortillas im Ofen erwärmen.
  2. - 400 g Joghurt
     - 15 ml Zitronensaft
     Joghurt mit Zitronensaft verrühren.
  3. Mit frischen Kräutern servieren.
  ```

- **`## Zubereitung` is a fixed structural heading** (not a section the author may
  rename). No other headings or sub-sections may appear in the body.
- Each step is a numbered block:
  - **With rows:** the numbered line starts with the first row (`1. - 250 g
    Tortillas`); further rows follow as `- ` lines (indented for readability), and
    then exactly one prose line ends the block. A row line is the only place
    `- ` may start a line.
  - **Without rows:** the step is a single prose line (`3. Mit frischen Kräutern
    servieren.`).
  - The prose may contain the inline artifacts of §4. The editor collapses line
    breaks on save; prose must not start with `- `.
- Blank lines separate steps. Step numbers are explicit in the file (Markdown
  ordered list); the order is authoritative, even where it does not matter.
- There is no summary section; the recipe ends with the last step, which may include
  serving suggestions.

## 6. Title as Identifier — Renames

- The `title` is the stable identifier: sub-recipe uses (step rows, inline
  artifacts and `reference` entries whose name is the title) and the file name
  both reference it.
- **Renaming a recipe** therefore means, as one operation:
  1. change `title` in the file,
  2. rename the file (and its image),
  3. update every implicit use of the old title in all other recipe files — only
     `ingredient_recipe` titles are referenced this way, and only those trigger
     updates (finished-dish titles never are),
  4. rename the recipe's row in the ingredient master data (§9) when it has one:
     an ingredient recipe's reorder point belongs to that row and would otherwise
     silently stop applying, because nothing looks an entry up under a title that
     no longer exists. A rename is rolled back as a whole when any of the four
     steps fails.
- The app provides a rename tool that performs all four steps.

## 7. Validation

Validation runs on every read, before any logic (scaling, display, export) touches
the file. Two levels:

### 7.1 Schema validation (per file)

- Front matter parses as valid YAML and matches the schema of §3 (field names,
  types, required/forbidden fields per `type`); an `ingredients` field is rejected
  (it is derived from the step rows, §4).
- `title` is non-empty and file-name-safe.
- `servings` must be one of the allowed serving counts; `yield` and every row /
  artifact `Menge` must be a positive finite number (`V0`). There is no ladder
  membership check anymore. A precision tag, when present, must be one of
  `very low`, `low`, `medium`, `high`, `very high`. A front-matter `tolerance`
  field is an unknown field and is rejected.
- Row syntax, step structure and the artifacts of each step are validated (issue
  paths `steps[i].ingredients[j]…` and `steps[i].text`). A row without a name or
  quantity, a step whose prose is missing, and prose starting with `- ` are errors.
- `reference` may list any number of names on both recipe types, and every name
  must occur among the recipe's merged ingredients.
- `theme`, when present, is a mapping whose keys must be `font`/`accent`/`paper`/
  `ink`/`line` (unknown sub-fields are errors); `font` must be one of the export
  font shortlist and the colours canonical `#rrggbb`.
- The body contains exactly one `## Zubereitung` heading followed by the numbered
  step blocks of §5.

### 7.2 Cross-recipe validation (per collection)

- `title` is unique across the collection (file names are unique by construction;
  the titles inside must be too).
- The implicit sub-recipe link graph is acyclic (a cycle would recurse forever in
  the scaling / shopping-list logic that walks the sub-recipe links); a
  `finished_dish` title is never a link target.

A file that fails validation is shown to the user with a precise error (never
silently ignored, never auto-corrected).

## 8. Full Example

Finished dish:

```markdown
---
title: Shredded Tofu Wraps
type: finished_dish
description: Knusprige Wraps mit mariniertem Tofu und frischem Gemüse.
servings: 6
prep_time: 25 min
total_time: 40 min
reference:
  - Tortillas
---
## Zubereitung
1. - 250 g Tortillas
   Tortillas im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. - 400 g Joghurt
   - 15 ml Zitronensaft
   Joghurt mit Zitronensaft verrühren und würzen.
4. - 500 ml Béchamelsauce
   Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und mit Béchamelsauce servieren.
```

Ingredient recipe (with an inline quantity-only artifact):

```markdown
---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. - 25 g Butter
   - 300 ml Milch
   Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.
2. In {{50 ml Milch}} auflösen und unter Rühren köcheln, bis die Sauce bindet.
```

## 9. Ingredient Master Data Files

The collection's ingredient master data (name → display forms → base unit → reorder point →
additional units with factors) lives in two CSV files inside the `Stammdaten` subfolder of the
collection folder, in the same canonical formats as the repo seeds (`docs/ingredients.csv` +
`docs/ingredient_unit_mappings.csv`):

    zutaten.csv                  (ingredient list)
    Ingredient;Singular;Plural;Base Unit;Precision;Reorder Point
    Joghurt;;;g;medium;0
    Cashews;Cashew;Cashews;g;medium;0

    zutaten-umrechnungen.csv     (AU mappings; an ingredient without additional
    Ingredient;Additional Unit;Conversion Factor   units has no rows here)
    Joghurt;Becher;500

The ingredient list is the authoritative source of ingredient names, their fixed base
unit, their mandatory precision, their reorder point and their display forms — one row per
ingredient, so further ingredient-level fields can be added as columns later. Where an
item is bought is deliberately not such a column: it is the separate shopping-route pair
of §10, whose name set also covers items that are not ingredients at all.

The `Precision` cell is **mandatory**: one of `very low`, `low`, `medium`, `high`,
`very high`. It is the ingredient level of the display preference
(docs/recipe_scaling_algorithm.md §4.1). A file under an older header (without the
`Precision` column) is rejected instead of silently inventing a value.

The reorder point is the base-unit (g/ml) quantity that is definitely on stock directly
after a shopping trip, independent of the meal plan. It is a mandatory cell and need not
be a table value: `0` = the ingredient is only ever bought for a recipe; a positive
number = that much is on stock even without a planned recipe (1000 g of flour means the
shopping list is refilled once the last pack is opened, outside the app); `inf` = infinite
stock (realistically only water). It is the last column, so a spreadsheet round-trip — which
may drop trailing empty cells — can never cut a meaningful cell.

`Singular` and `Plural` are the **display forms** of the name — what the app writes when it
names the ingredient with a count („1 Karotte“ / „2 Karotten“). They sit in columns B and C,
directly after the name they belong to; the canonical key and the two display cells of a row
stay together. The `Ingredient` cell stays the canonical key: recipes, the mappings file and
the item table (§10) always use it, never a display form, so adding or correcting a form
never touches a recipe. Both cells are empty for an **invariant** name (Zucker, Milch,
Butter): the name then serves for every count. A name whose canonical form is already the
plural states the pair in full („Haferflocken“ → `Haferflocke;Haferflocken`, „Karotten“ →
`Karotte;Karotten`). The pair is atomic — a row with only one of the two cells is rejected
with a German error, because the empty side would silently fall back to the canonical name.
Older headers are rejected because the `Precision` column is mandatory.

An **ingredient recipe** (a sub-recipe) has its row here too, like any other ingredient. Its
reorder point is the amount of the finished product that is on hand — cooked and kept, e.g.
sauce in the freezer. It prefills the cooking step „Vorräte auswählen, Teil 1:
Zutaten-Rezepte", which cooks `required − stock` of the sub-recipe (see
[quantity_scaling.md](quantity_scaling.md) §7 / §9); an ingredient recipe that is not registered
here simply starts from the neutral reorder point 0 and is cooked in full.

New ingredients are created in the web app („Neue Zutat anlegen“) with a stock picker
(suggested chips, stepper); the picked value is stored exactly as entered, without quantity
optimization or a preview line. The same applies when editing an ingredient („Zutat
bearbeiten“): the Vorrat field never snaps to an additional unit, so a 150 g entry stays
150 g even for a 160 g Becher (decided with the user; see
additional_quantity_specifications.md §6.3). „∞“ in the picker stores `inf`.

The mappings file is a pure overlay; an ingredient without additional units (e.g.
Cashews) exists only in the list and always renders in the base form (see
additional_quantity_specifications.md §4). There is no per-ingredient priority anymore:
the optimizer scores every compatible unit. The app allows **at most one shopping unit
per ingredient**; a second mapping whose unit is flagged `Shopping Unit = yes` is
rejected with a German error.

The allowed **base and additional quantities** and their number schemes are
repo-global master data ([BQs.csv](BQs.csv), [AQs.csv](AQs.csv)), not user Drive
data: they describe the app's display tables, not an ingredient.

The additional **units** themselves — display arrangement, number scheme, the
`Unit Exact` flag (see additional_quantity_specifications.md §6.3), the `Shopping Unit`
flag (see additional_quantity_specifications.md §3.1) and the `Singular`/`Plural` display
forms (see additional_quantity_specifications.md §3.2) — are not part of the
user's Drive files: they are built-in definitions compiled from `docs/additional_units.csv`
into the core package. Only the ingredient list and the mappings are user data.

The files are created on the first user addition („Neue Zutat anlegen“ in the recipe
editor or on the „Zutaten“ screen), seeded with the built-in repo data, and are the
authoritative master data once they exist: the app loads both into the runtime registry at
startup and renders/exports
every ingredient through them. Dot decimals; the parser tolerates German commas from
spreadsheet edits. The canonical delimiter is `;`; a file exported comma-separated
(spreadsheet apps do that in an English locale) still loads — the header row decides the
delimiter, quoted cells are honoured — and the next write restores the semicolon form.
The files are user data like the recipes themselves — the repo CSVs are only the seed.

## 10. Shopping Route, Item Table and Synonym Table

The order in which shopping-list items are bought — and therefore the order in which they
appear in the Google Keep „Einkaufsliste“ — comes from three master-data files in the
`Stammdaten` subfolder. A **stop** is the pair `(Store, Section)`: level 1 is the store, level 2
the section inside it.

    einkaufsweg.csv           (the route; the row order IS the route)
    Store;Section
    Lidl;Obst und Gemüse
    Lidl;Molkerei
    REWE;Obst und Gemüse
    REWE;TK-Obst
    dm;Drogerie

    einkaufs-artikel.csv      (the identity of everything buyable; row order irrelevant)
    Item;Store;Section
    Karotten;Lidl;Obst und Gemüse
    Joghurt;Lidl;Molkerei
    TK-Blaubeeren;REWE;TK-Obst
    Klopapier;dm;Drogerie

    einkaufs-synonyme.csv     (the meaning: variant text → item; row order irrelevant)
    Variant;Item
    Möhren;Karotten
    Zewa;Klopapier

The route's row order is the only ordering in this data: it is the order the shops are
visited and the sections are walked. There is no separate store order, and a section belongs
to exactly one store; the same section name may exist in several stores, the pair is the key.

The **item table** maps an item name to exactly one stop — it is the identity of everything
that can be bought and the **only place a route is kept**, so "the same item with two
conflicting routes" cannot exist. Its name set is a **superset of the ingredient list**: it
carries recipe ingredients and items that are not ingredients at all („Klopapier“, „Seife“,
„Blumen“), which have no base unit and no reorder point and therefore cannot live in
zutaten.csv. An item without a row here is not an error — it is simply never bought; an
ingredient without an item row is valid for exactly that reason (Wasser), and the item row is
what makes something buyable. The **synonym table** states meaning instead: a variant text
resolves to exactly one item and carries no route of its own. `zutaten.csv` (§9) keeps the
ingredient master data and, like the item table, carries no route; it is a *view* of those
items that happen to be ingredients.

Validation: a stop is unique in the route and both cells are non-empty; an item name is
unique in the item table; every `(Store, Section)` an item names must exist in the route — a
typo fails loudly at load, like a mapping for an unknown ingredient. In the synonym table a
variant is unique, every `Item` it names must exist, and a variant equal to an item name is
rejected — a canonical item name must never be shadowed by a synonym. All name uniqueness
checks compare case-folded (docs/shopping_item_identity.md §2/§5). The route parses into an
ordered list, the item table into a name→stop lookup and the synonym table into a
variant→item lookup. All three files follow §9's common CSV rules (one header row,
semicolons, CRLF and one trailing empty cell tolerated, leading BOM stripped) and are user
data like the ingredient files: the repo CSVs (docs/shopping_route.csv +
docs/shopping_items.csv + docs/shopping_synonyms.csv) are the seed, the Drive files are
authoritative once they exist.

The files are created on the first shopping assignment the user enters (the „Einkauf“ field
of „Neue Zutat anlegen“ or „Einkaufsartikel anlegen“), seeded with the built-in repo data, and
are authoritative once they exist (the synonym file empty at first and growing with every
confirmed suggestion). That field picks the store as chips and the section from a searchable
list of that store's sections, so a section can never be paired with the wrong store. The
„Einkaufsartikel anlegen“ form rejects a name that already has a row (case-folded); the
sort/assignment path still updates a row the user prepared in the spreadsheet — the name is
the key, and the file holds exactly one stop per item. The
item table was called `einkaufs-zuordnung.csv` before the item identity existed; the app reads
that file once, writes its rows unchanged into `einkaufs-artikel.csv`, creates the synonym
file next to it and deletes the old file afterwards.

Deliberately not in this data: how a Keep line is matched to an item name (that is read-time
work, docs/shopping_item_identity.md §2), where unassigned items are placed, and Keep's sort
ids.

## 11. Relationship to Other Documents

- [recipe_structure.md](recipe_structure.md) — logical model this encoding implements.
- [quantity_scaling.md](quantity_scaling.md) — how the stored target `V0` is scaled and
  how the optimizer chooses the displayed BQ/AQ; precision, yields and export views.
- [additional_quantity_specifications.md](additional_quantity_specifications.md) —
  what is *not* stored here (additional units are computed at display time).
- [recipe_structure.md](recipe_structure.md) — the authoritative logical model these files
  encode, and the sharing format (HTML export derives from these files).
