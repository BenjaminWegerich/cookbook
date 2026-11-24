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

- The collection is a folder (in the chosen cloud storage) with five subfolders:
  - `Rezepte/` — one `.md` file per recipe;
  - `Entwürfe/` — one JSON file per saved, unfinished draft (§11);
  - `Exporte/` — the generated `<title>.html` cooking views (§8);
  - `Bilder/` — the recipe photos (and a draft's photo, named by the draft id);
  - `Stammdaten/` — the CSV master data and `rezept-richtlinien.md` (§9, §10).

  Nothing lives directly in the collection folder: the app reads and writes one
  level below it. A file left in the collection root is not picked up (the app
  reports it instead of silently ignoring it). The five areas are separate on
  purpose: `Rezepte/` only ever contains canonical recipes, while a draft may
  hold states the canonical format rejects (§11).
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
| `source` | string | no | „Quelle“: absolute http(s) URL of the original recipe or the inspiration. One link; no free-text note. |
| `prep_time` | string | yes | Free-text display value, e.g. `25 min`, `1 h 30 min`. The editor offers the standard values 1/3/5/10/15/20/30/45 min and 1/1.5/2/3/6/12/24/48 h as chips. |
| `total_time` | string | no | Only if it is larger than `prep_time`. |
| `tips` | string | no | Recipe-level tips: plain text with paragraphs (blank lines). Shown collapsed as „Tipps“ in the editor and the cooking view. |

`source` (the „Quelle“) is the recipe's one back-link to where it came from: the original recipe
or the inspiration (e.g. a blog post or a TikTok video). It is a single absolute
`http(s)` URL and is allowed on both types. A bare domain, a relative path, an
empty value and every non-`http(s)` scheme are validation errors; the value is
trimmed on read. The app shows it as a „Quelle“ link in the recipe overview and
in the cooking view's intro.

`tips` is a plain-text block, not Markdown: blank lines separate paragraphs,
single line breaks stay line breaks. It never carries ingredient quantities, is not parsed
for `{{…}}` artifacts and does not affect any ingredient list. The editor and
the cooking view show it as a collapsed „Tipps“ disclosure; the recipe-level
block sits on the intro, each step's block under that step's prose.

### Type-specific fields

| `type` | Required fields | Forbidden | Notes |
|---|---|---|---|
| `finished_dish` | `servings` | `yield`, `yield_unit` | `servings`: one of the allowed serving counts `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30`. Example: `6` — not `11`. |
| `ingredient_recipe` | `yield`, `yield_unit` | `servings` | `yield`: any positive number (stored target `V0`); `yield_unit`: `g` or `ml`. Example: `yield: 500`, `yield_unit: ml`. |

Additional fields:

| Field | Type | Allowed on | Notes |
|---|---|---|---|
| `reference` | list of strings | both types | Names of any number of ingredients anchored to the recipe's size — the portion size (`finished_dish`) or the yield (`ingredient_recipe`), §4. Names must occur in the recipe rows. An inline artifact carries the same role on itself with a trailing `|reference` suffix instead of a list entry. |

### Theme (optional, both types)

`theme` is the recipe's visual skin for the HTML share export — a typeface and a
small palette. [DESIGN.md](DESIGN.md) §4.8 is authoritative for the theme; this
document only fixes its physical encoding. It is a mapping of up to five optional
tokens; each token may be omitted and then falls back to the default theme
independently:

| Token | Type | Default | Notes |
|---|---|---|---|
| `font` | string | `Noto Sans` | One typeface of the export font shortlist (DESIGN.md §4.8); no other typeface is allowed. `Noto Sans Condensed` and `Noto Sans Mono` are retired: existing files may still carry them, new recipes must not choose them; neither face is embedded any more, so such an export falls back. |
| `accent` | string | `#ad5632` | Active state, forward actions, links, sub-recipe name link. |
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
  - Any artifact may carry the **reference role** as its last suffix:
    `{{1500 ml Wasser|reference}}`, `{{1/2|reference}}`,
    `{{1 26 cm Backring|size|case:akk|reference}}`,
    `{{1/2|precision: high|reference}}`.
    The suffix order is fixed
    (`|size` / `|size|case:…` / `|precision` first, `|reference` last);
    a flag out of order or an unknown pipe suffix is a validation error.
  - An artifact that carries a unit is a base quantity: its `MENGE` is the
    unrounded target and its display uses the normal optimizer.
  - **Canonical values are g/ml with `.` decimals.** Hand-written files may use
    German comma decimals, fractions and `kg`/`l` (`{{1,5 l Wasser}}`,
    `- 0,2 kg Reis`); the parser normalizes them on read (comma → dot, kg/l →
    g/ml ×1000). Non-positive or malformed values remain validation errors.
  - A malformed `{{…}}` block is a validation error — never silently treated as prose.
- **Size markers** are display-only equipment mentions inside the step prose:
  ```
  Den Teig für {{1 26 cm Backring|size|case:akk}} ausrollen.
  ```
  - Grammar: `{{ COUNT SIZE UNIT MARKER|size|case:CASE }}`, e.g.
    `{{1 26 cm Backring|size|case:akk}}` or
    `{{2 20 cm Backring|size|case:dat}}`. The count is a positive integer and is
    **mandatory**. `CASE` is `nom`, `akk` or `dat` and describes the grammatical
    case of the sentence slot; it is optional only on a legacy artifact, whose
    prose keeps the old numeral form. The editor writes it from now on.
    The size uses a decimal with `.` or German `,`.
  - Display: prose inflects the phrase — a count of 1 becomes the indefinite
    article (`einen 26er Backring`), 2–12 are written out (`zwei … zwölf`),
    13+ stay numerals, and the noun follows the case (dative plural
    `Backringen`). The reference readout is a bare nominative label: it omits a
    count of 1 (`26er Backring`) and keeps numerals from 2
    (`2 22er Backringe`).
  - The marker key, unit and nominal size are validated against
    [size_markers.csv](size_markers.csv): the marker must exist, its written unit
    must equal the master unit, and its written size must be one of the allowed
    `Sizes`. Unknown markers and unavailable sizes are validation errors.
  - The written count and size describe the recipe's own equipment. The display
    for another serving count is derived by the marker's `Scale` (see
    [quantity_scaling.md](quantity_scaling.md) §7, “Size markers”); for `Backring`
    the diameter scales with the square root of the recipe factor, and above the
    largest available size the display splits into multiple molds.
  - A size marker is never counted toward an ingredient list, never enters the
    shopping list and never links a sub-recipe. It has **no precision**: an
    artifact carrying both `|size` and `|precision: …` is malformed.
- **Reference role** (size anchor, both recipe types): a counted ingredient is
  stored by name in the front-matter list, `reference: [Tortillas]` (any number
  of entries); an inline artifact carries the role on itself with the trailing
  `|reference` suffix. Both anchor the portion size on a `finished_dish` and the
  yield on an `ingredient_recipe`. The size readout shows the ingredient
  references first (master-list order), then the flagged artifacts in step order
  (each flagged occurrence). A name must match a merged ingredient of the recipe;
  an artifact flag needs no separate check — the artifact is the reference
  itself. A step row never carries the role; the master-list star is the only
  control for counted ingredients.
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
     > Der Teig ruht 30 Minuten besser.
     >
     > Zwischen den Lagen Backpapier verwenden.
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
    then exactly one prose line; optional tips may follow it. A row line is the
    only place `- ` may start a line.
  - **Without rows:** the step is a single prose line (`3. Mit frischen Kräutern
    servieren.`).
  - The prose may contain the inline artifacts of §4. The editor collapses line
    breaks on save; prose must not start with `- `.
  - **Tips (optional):** a step may end with consecutive blockquote lines (`> `)
    directly after the prose — one block per step, no blank line between prose
    and tips. Each `>` line is one text line; a bare `>` line is a paragraph
    break. The block is plain text: it carries no ingredient quantities, is never parsed
    for `{{…}}`, never enters an ingredient list and does not scale.
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
- `source` („Quelle“), when present, is a non-empty absolute `http(s)` URL without
  whitespace; a bare domain or any other scheme is rejected.
- `tips` (recipe-level and per step) must be non-empty when present; a step's
  tips block must follow its prose, and a blank tips block is rejected.
- `servings` must be one of the allowed serving counts; `yield` and every row /
  artifact `Menge` must be a positive finite number (`V0`). There is no ladder
  membership check anymore. A precision tag, when present, must be one of
  `very low`, `low`, `medium`, `high`, `very high`. A front-matter `tolerance`
  field is an unknown field and is rejected.
- A size marker's count must be a positive integer; its marker key, unit and
  nominal size must match `size_markers.csv` (§4), and its optional case must be
  one of `nom`, `akk`, `dat`. A `|case` suffix on a quantity artifact is
  rejected, as is a `|precision` suffix on a size marker.
- Row syntax, step structure and the artifacts of each step are validated (issue
  paths `steps[i].ingredients[j]…` and `steps[i].text`). A row without a name or
  quantity, a step whose prose is missing, and prose starting with `- ` are errors.
- `reference` may list any number of names on both recipe types, and every name
  must occur among the recipe's merged ingredients.
- A `|reference` suffix is valid on every artifact kind, including a size marker
  (unlike `|precision`); it only adds the artifact to the size readout and
  changes nothing about scaling or the ingredient lists.
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
source: https://example.com/rezept
servings: 6
prep_time: 25 min
total_time: 40 min
tips: |
  Die Tortillas warm halten, damit sie sich besser falten lassen.
reference:
  - Tortillas
---
## Zubereitung
1. - 250 g Tortillas
   Tortillas im Ofen erwärmen und warm halten.
   > Nach dem Erwärmen in ein sauberes Tuch wickeln.
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
additional units with factors and the per-mapping shopping flag) lives in three CSV files
inside the `Stammdaten` subfolder of the collection folder, in the same canonical formats as
the repo seeds (`docs/storage_places.csv` + `docs/ingredients.csv` +
`docs/ingredient_unit_mappings.csv`):

    lagerorte.csv                (kitchen storage places, in walking order)
    Place
    Kühlschrank
    Gefrierschrank
    Schublade 1

    zutaten.csv                  (ingredient list)
    Ingredient;Singular;Plural;Base Unit;Precision;Storage Place;Reorder Point
    Joghurt;;;g;medium;Kühlschrank;0
    Cashews;Cashew;Cashews;g;medium;;0

    zutaten-umrechnungen.csv     (AU mappings; an ingredient without additional
    Ingredient;Additional Unit;Conversion Factor;Shopping Unit   units has no rows here)
    Joghurt;Becher;500;yes

`lagerorte.csv` is the list of kitchen zones `zutaten.csv` may name: one `Place` per row,
and the row order is the kitchen walk the pantry pages file their ingredient rows in
(„Vorräte auswählen“). The list has no editor in the web app — it is edited in the
spreadsheet — so the app creates it on the first load, seeded with the built-in
`docs/storage_places.csv`; from then on the Drive file is authoritative and is re-read on
startup and when „Zutaten“ opens. Adding a zone is a new row, reordering the rows changes
the pantry order, and renaming or removing a zone requires the affected `zutaten.csv` cells
to be updated in the same edit: an unknown place is rejected with a German error that lists
the allowed places. Two rows that differ only in case or spacing are rejected as the same
place, and an empty list is rejected — otherwise every ingredient would fall outside the
kitchen walk.

The ingredient list is the authoritative source of ingredient names, their fixed base
unit, their mandatory precision, their reorder point, their display forms and their storage
place — one row per ingredient, so further ingredient-level fields can be added as columns
later. Where an item is bought on the route is deliberately not such a column: it is the
separate shopping-route pair of §10, whose name set also covers items that are not ingredients
at all. The unit an ingredient is *bought in* is the `Shopping Unit` flag on its mappings row
(see below), not a route.

The `Precision` cell is **mandatory**: one of `very low`, `low`, `medium`, `high`,
`very high`. It is the ingredient level of the display preference
(docs/recipe_scaling_algorithm.md §4.1). A file under an older header (without the
`Precision` column) is rejected instead of silently inventing a value. The header from before
`Storage Place` existed (`Ingredient;Singular;Plural;Base Unit;Precision;Reorder Point`) still
parses — its rows are unsorted — and is upgraded to the current header on the next write.

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

New ingredients are created in the web app („Neue Zutat anlegen“) with a stock picker — the
adaptive suggestion chips around the current amount, the pinned 0 and ∞, and a stepper. A typed
value is stored exactly as entered and never snaps to an additional unit; a tapped chip stores
the base-unit amount its label shows. There is no preview line. The same applies when editing an
ingredient („Stammdaten bearbeiten“), so a 150 g entry stays 150 g even for a 160 g Becher (decided
with the user; see additional_quantity_specifications.md §6.3). „∞“ in the picker stores `inf`.

The mappings file is a pure overlay; an ingredient without additional units (e.g.
Cashews) exists only in the list and always renders in the base form (see
additional_quantity_specifications.md §4). There is no per-ingredient priority anymore:
the optimizer scores every compatible unit. The `Shopping Unit` cell is **mandatory**
(`yes` / `no`) and belongs to the mapping: it says whether *this* ingredient is bought in
*that* unit. The same unit can therefore be a purchase unit for one ingredient and a
recipe measure for another (the `Stück` of a carrot vs. the clove of garlic); at most one
mapping per ingredient may say `yes`, and a second one is rejected with a German error.
A file under an older header — the flagless `Ingredient;Additional Unit;Conversion
Factor` or the older header with a trailing `Priority` column — still parses: its rows
inherit the retired unit-level flag, so an existing file keeps its behaviour until the
next write, which stores the per-mapping flags and the current header.

The allowed **base and additional quantities** and their number schemes are
repo-global master data ([BQs.csv](BQs.csv), [AQs.csv](AQs.csv)), not user Drive
data: they describe the app's display tables, not an ingredient.

The additional **units** themselves — display arrangement, number scheme, the
`Unit Exact` flag (see additional_quantity_specifications.md §6.3) and the
`Singular`/`Plural` display forms (see additional_quantity_specifications.md §3.2) —
are not part of the user's Drive files: they are built-in definitions compiled from
`docs/additional_units.csv` into the core package. Only the storage-place list, the
ingredient list and the mappings are user data; the mappings carry the shopping flag.

The ingredient files are created on the first user addition („Neue Zutat anlegen“ in the
recipe editor or on the „Zutaten“ screen), seeded with the built-in repo data; `lagerorte.csv`
is already created on the first load (see above). All three are the authoritative master data
once they exist: the app loads them into the runtime registries at startup and renders/exports
every ingredient through them. Dot decimals; the parser tolerates German commas from
spreadsheet edits. The canonical delimiter is `;`; a file exported comma-separated
(spreadsheet apps do that in an English locale) still loads — the header row decides the
delimiter, quoted cells are honoured — and the next write restores the semicolon form.
The files are user data like the recipes themselves — the repo CSVs are only the seed.

## 10. Shopping Route, Item Table, Synonym Table and Market Ranks

The order in which shopping-list items are bought — and therefore the order in which they
appear in the Google Keep „Einkaufsliste“ — comes from four master-data files in the
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
    Karotten;REWE;Obst und Gemüse
    Joghurt;Lidl;Molkerei
    TK-Blaubeeren;REWE;TK-Obst
    Klopapier;dm;Drogerie

    einkaufs-synonyme.csv     (the meaning: variant text → item; row order irrelevant)
    Variant;Item
    Möhren;Karotten
    Zewa;Klopapier

    einkaufs-maerkte.csv      (the preference rank; 1 = best; row order irrelevant)
    Store;Rank
    Lidl;1
    Rewe;2
    dm;3

The route's row order is the only ordering in this data: it is the order the shops are
visited and the sections are walked. There is no separate store order, and a section belongs
to exactly one store; the same section name may exist in several stores, the pair is the key.

The **item table** maps an item name to one or more stops — it is the identity of everything
that can be bought and the **only place a route is kept**. An item may name several stores,
because the same product is often available at more than one market; it may name **at most
one section per store**, because two sections inside one market would make the item ambiguous
for the trip selection. The pair `(Item, Store)` is therefore the key of a location row, and
the item name may repeat once per store. "The same item with two conflicting routes" cannot
exist: a second row for the same item and store is rejected. The row order carries no meaning;
the locations of one item are a set.

Its name set is **independent of the ingredient list**: it carries the recipe ingredients that
are bought on a route and items that are not ingredients at all, which have no base unit and
no reorder point and therefore cannot live in zutaten.csv. An item without a row here is not
an error — it is simply never bought; an ingredient without an item row is valid for exactly
that reason (Wasser), and the item row is what makes something buyable. The **synonym table**
states meaning instead: a variant text resolves to exactly one item and carries no locations
of its own. `zutaten.csv` (§9) keeps the ingredient master data and, like the item table,
carries no route; it is a *view* of those items that happen to be ingredients.

Validation: a stop is unique in the route and both cells are non-empty; every `(Item, Store)`
pair is unique, so an item has at most one section per market; all rows of one item use the
same spelling (case-folded, like the matching); every `(Store, Section)` an item names must
exist in the route — a typo fails loudly at load, like a mapping for an unknown ingredient. In
the synonym table a variant is unique, every `Item` it names must exist, and a variant equal
to an item name is rejected — a canonical item name must never be shadowed by a synonym. All
name uniqueness checks compare case-folded (docs/shopping_item_identity.md §2/§5). The route
parses into an ordered list, the item table into a name→location-list lookup and the synonym
table into a variant→item lookup. All four files follow §9's common CSV rules (one header
row, semicolons, CRLF and one trailing empty cell tolerated, leading BOM stripped) and are
user data like the ingredient files: the repo CSVs (docs/shopping_route.csv +
docs/shopping_items.csv + docs/shopping_synonyms.csv + docs/shopping_markets.csv) are the
seed, the Drive files are authoritative once they exist.

**Market preference ranks are the fourth user-data file.** The upcoming trip's
recommendation needs to know which market is preferred independently of the item. The
explicit order lives in `einkaufs-maerkte.csv` (`Store;Rank`, `1` = best), seeded by
`docs/shopping_markets.csv`. There is no in-app editor; the file is edited directly in the
`Stammdaten` folder like the other master data. A store missing from it ranks after the
explicitly ranked stores in route order, so a custom route never fails to load. Every rank
must be a positive integer and unique; every store must exist in the route. The
recommendation's priority threshold (`> 10` items) remains a named constant in
`shoppingMarketRanks.ts`. The rank decides **where an item is bought**; the route order
decides **in which order the list is walked**. The file is created together with the other
shopping master data on the first assignment, written with the **effective** ranks of every
route store (explicit ranks plus fallbacks), so the user has a complete file to edit.

The files are created on the first shopping assignment the user enters (the „Einkauf“ field
of „Neue Zutat anlegen“ or „Einkaufsartikel anlegen“), seeded with the built-in repo data, and
are authoritative once they exist (the synonym file empty at first and growing with every
confirmed suggestion or renamed assignment; the rank file written with the effective ranks). That field picks the store as chips and the section
from a searchable list of that store's sections, so a section can never be paired with the wrong
store. The „Einkaufsartikel anlegen“ form rejects a name that already has a row (case-folded); the
sort/assignment path still updates a row the user prepared in the spreadsheet — the name is
the key, and an item's location list may grow one row per additional market. The
item table was called `einkaufs-zuordnung.csv` before the item identity existed; the app reads
that file once, writes its rows unchanged into `einkaufs-artikel.csv`, creates the synonym
file next to it and deletes the old file afterwards.

The „Einkauf“ field of both sheets edits a **location list**, not one stop: the chosen stores
are listed one row each (`Markt > Bereich`), a store already in the list is updated when its
section is changed, and removing the last location clears the item's route. An item row
therefore needs at least one location; an ingredient may have none and is then not bought.

Deliberately not in this data: how a Keep line is matched to an item name (that is read-time
work, docs/shopping_item_identity.md §2), where unassigned items are placed, and Keep's sort
ids.

## 11. Drafts (`Entwürfe/`)

A saved, unfinished recipe is a **draft**, not a canonical recipe. It lives in the
`Entwürfe` subfolder as one JSON file per draft, named by an app-generated id
(`draft-<id>.json`). The canonical `Rezepte/` folder never contains a draft, and a draft is
not a recipe for cooking, scaling, meal planning, shopping or exporting.

Why this is a separate format: the editor's working draft may not satisfy §3 or §5 at all —
no title, no servings/yield, a step with counted rows but no prose, a duplicate title, or an
unknown ingredient. Those are exactly the states a draft must preserve, and the canonical
format deliberately rejects them. The draft payload therefore keeps the editor's working
fields losslessly:

```json
{
  "version": 1,
  "savedAt": 1762112345678,
  "draft": {
    "title": "",
    "type": "finished_dish",
    "prep_time": "",
    "steps": [{ "ingredients": [], "text": "" }]
  }
}
```

- `version` is the payload shape version; an incompatible change bumps it, and an unknown
  version is not read.
- `savedAt` is the client's epoch milliseconds at the last write.
- `draft` holds the editor fields: `title`, `type`, `description?`, `source?` („Quelle“), `prep_time`,
  `total_time?`, `tips?`, `servings?` or `yield?` + `yield_unit?`, `reference?`, `theme?`, and
  `steps` (each with `ingredients`, `text` and optional `tips`). Every field is optional except `type` and
  `steps`; a draft may be empty. The derived `ingredients` list is never stored.
- A draft's optional photo is `Bilder/<draft-id>.jpg` / `.png`, where `<draft-id>` is the
  draft file's basename without `.json`. The id, not the title, names the file, so an empty
  or duplicate title is allowed and no filename-safety rule applies yet.
- A quiet draft save („Als Entwurf speichern“) keeps the editor open: the saved payload
  becomes the new baseline and a snackbar confirms the write. Further edits save to the same
  draft file.
- A draft becomes a recipe only on a normal save: the editor validates the draft against
  §7, writes the canonical file to `Rezepte/`, renames the photo to the recipe title,
  generates the export and deletes the draft. If validation fails, the draft stays a draft
  and the editor reports the issues. The normal save of a draft therefore uses the canonical
  checks, not the draft payload.
- A canonical recipe can be turned back into a draft from the editor („Als Entwurf
  speichern“). The current editor fields become the draft, the photo is renamed from
  `<Titel>.<ext>` to `<draft-id>.<ext>`, and the canonical `.md` and its export are deleted.
  The operation asks first because the dish leaves cooking, planning and sharing; the editor
  stays open after the conversion and a snackbar confirms it. An
  ingredient recipe’s master-data row stays untouched: it is the user’s master data, and the
  name may still be used as an ordinary ingredient.
- Drafts are outside the collection for §7.2 validation, sub-recipe links, meal-plan
  recognition, shopping and ingredient-master registration. The app lists them in the
  collection and marks them with the „Entwurf“ badge (docs/DESIGN.md §5.7).
- Deleting a draft deletes its JSON file and its photo sibling.

## 12. Relationship to Other Documents

- [recipe_structure.md](recipe_structure.md) — logical model this encoding implements.
- [quantity_scaling.md](quantity_scaling.md) — how the stored target `V0` is scaled and
  how the optimizer chooses the displayed BQ/AQ; precision, yields and export views.
- [additional_quantity_specifications.md](additional_quantity_specifications.md) —
  what is *not* stored here (additional units are computed at display time).
- [recipe_structure.md](recipe_structure.md) — the authoritative logical model these files
  encode, and the sharing format (HTML export derives from these files).
