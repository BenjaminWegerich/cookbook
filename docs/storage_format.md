# Recipe Storage Format (Markdown + YAML)

> **Status:** Decided as the canonical recipe format (see [user_stories.md](user_stories.md),
> decision 8). This document specifies the physical encoding of a recipe file.
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

- The collection is a folder (in the chosen cloud storage) containing one `.md` file
  per recipe.
- **File name = title**, e.g. `Shredded Tofu Wraps.md`.
  - Title characters that are invalid in file names (`/`, `\`, `:` etc.) are
    disallowed in titles; the schema validation enforces this.
- **Image:** optional single real photo. It lives as a sibling file with the same
  basename and a `.jpg` / `.png` extension, e.g. `Shredded Tofu Wraps.jpg`.
  There is no `image` field in the front matter; the sibling convention carries it.
- The canonical file and its image move together; the app treats them as one unit.

## 3. YAML Front Matter — Schema

Style rules: two-space indentation, no tabs, field order as listed below.
The app writes YAML through a serializer; hand-written files are validated on read.

### Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Unique within the whole collection; the stable identifier (see §6). Example: `Shredded Tofu Wraps`. |
| `type` | enum | yes | `finished_dish` or `ingredient_recipe` — never derived, set by the author. |
| `subtitle` | string | no | Display-only extension of the title. |
| `description` | string | no | A single paragraph; may suggest side dishes or other uses. |
| `prep_time` | string | yes | Free-text display value, e.g. `25 min`, `1 h 30 min`. The editor offers the standard values 1/3/5/10/15/20/30/45 min and 1/1.5/2/3/6/12/24/48 h as chips. |
| `total_time` | string | no | Only if it is larger than `prep_time`. |

### Type-specific fields

| `type` | Required fields | Forbidden | Notes |
|---|---|---|---|
| `finished_dish` | `servings` | `yield`, `yield_unit` | `servings`: integer, a standard number (ladder value). Example: `6` — not `11`. |
| `ingredient_recipe` | `yield`, `yield_unit` | `servings` | `yield`: number, a standard number; `yield_unit`: `g` or `ml` (the authorable family units). Example: `yield: 500`, `yield_unit: ml`. |

Additional fields:

| Field | Type | Allowed on | Notes |
|---|---|---|---|
| `reference` | list of strings | `finished_dish` only | Names of 0–2 ingredients anchored to the portion size (§4); names must occur in the recipe rows. |

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
  `- 400 ml Kokosmilch`). The quantity must be a standard number (ladder value)
  in the ingredient's family unit; the row is the only way an ingredient enters
  the recipe's lists.
- The **master ingredient list is derived** from the rows of all steps (§7.1):
  - order = order of first use across the steps (each step's rows in their order);
  - an ingredient used several times appears **once, with the total amount**
    (sum rounded to the nearest ladder rung — the sum of two standard numbers
    is not necessarily a standard number);
  - rows with the same name but different base units stay separate.
- **Inline artifacts** are display-only quantity mentions *inside the step text*
  (never counted toward any list, but scaled with the serving count at display
  time and rendered code-styled):
  ```
  Nudeln in {{1500 ml Wasser}} kochen.         ingredient mention
  {{100 g}} Teig flach ausrollen.              quantity-only mention
  ```
  - Grammar: `{{ MENGE EINHEIT [NAME] }}`. With a name the artifact is an
    ingredient mention (name = everything after the unit, e.g. `Wasser`); without
    a name it is a quantity-only mention (`100 g`). A quantity-only mention may
    also omit the unit entirely (`{{100}}` — a unitless count, e.g. a number of
    pieces); an ingredient mention always carries a unit. All variants scale with
    the number of servings and render code-styled, with the l/kg display form
    where a unit is present.
  - **Canonical values are g/ml with `.` decimals.** Hand-written files may use
    German comma decimals and `kg`/`l` (`{{1,5 l Wasser}}`, `- 0,2 kg Reis`); the
    parser normalizes them on read (comma → dot, kg/l → g/ml ×1000). Non-standard
    numbers remain validation errors.
  - A malformed `{{…}}` block is a validation error — never silently treated as prose.
- **Reference role** (portion anchor, `finished_dish` only): stored as a
  front-matter list of ingredient names, `reference: [Tortillas]` (0–2 entries).
  It is a property of the *master* list — the editor shows it only there; rows and
  artifacts never carry it. A name must match a merged ingredient of the recipe.
- **Sub-recipe links are implicit**: an ingredient use — step row, master row or
  inline artifact — whose name equals the title of an `ingredient_recipe` in the
  collection *is* that sub-recipe (there is no link field; the editor picks the
  title like any ingredient). The HTML export renders such uses as links to the
  sub-recipe's own export file (see the HTML share export in ARCHITECTURE.md);
  renaming the recipe updates them together (§6).
- The additional-unit display ("1 Becher Joghurt (400 g)") is never stored; it
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
     updates (finished-dish titles never are).
- The app provides a rename tool that performs all three steps.
- The `subtitle` is display-only and plays no role in identification.

## 7. Validation

Validation runs on every read, before any logic (scaling, display, export) touches
the file. Two levels:

### 7.1 Schema validation (per file)

- Front matter parses as valid YAML and matches the schema of §3 (field names,
  types, required/forbidden fields per `type`); an `ingredients` field is rejected
  (it is derived from the step rows, §4).
- `title` is non-empty and file-name-safe.
- `servings` / `yield` / every row and artifact `Menge` is a standard number:
  `pos(v)` on the quantity ladder must succeed
  (see [quantity_scaling.md](quantity_scaling.md) §3); a non-ladder value is rejected.
- Row syntax, step structure and the artifacts of each step are validated (issue
  paths `steps[i].ingredients[j]…` and `steps[i].text`). A row without a name or
  quantity, a step whose prose is missing, and prose starting with `- ` are errors.
- `reference` lists at most 2 names, only on `finished_dish`, and every name must
  occur among the recipe's merged ingredients.
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
subtitle: Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip
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

The collection's ingredient master data (name → base unit → additional units with
factors) lives in two CSV files inside the recipe folder, in the same canonical formats
as the repo seeds (`docs/ingredients.csv` + `docs/ingredient_unit_mappings.csv`):

    zutaten.csv                  (ingredient list)
    Ingredient;Base Unit
    Joghurt;g
    Cashews;g

    zutaten-umrechnungen.csv     (AU mappings; an ingredient without additional
    Ingredient;Additional Unit;Conversion Factor;Priority   units has no rows here)
    Joghurt;Becher;400;1

The ingredient list is the authoritative source of ingredient names and their fixed
base unit — one row per ingredient, so ingredient-level fields (e.g. a category) can be
added as further columns later. The mappings file is a pure overlay; an ingredient
without additional units (e.g. Cashews) exists only in the list and always renders in
the base form (see additional_quantity_specifications.md §4).

The files are created on the first user addition („Neue Zutat anlegen“ in the recipe
editor), seeded with the built-in repo data, and are the authoritative master data once
they exist: the app loads both into the runtime registry at startup and renders/exports
every ingredient through them. Dot decimals; the parser tolerates German commas from
spreadsheet edits. The files are user data like the recipes themselves — the repo CSVs
are only the seed.

## 10. Relationship to Other Documents

- [recipe_structure.md](recipe_structure.md) — logical model this encoding implements.
- [quantity_scaling.md](quantity_scaling.md) — why quantities/servings/yields must be
  ladder values, and how scaling consumes the stored base quantities.
- [additional_quantity_specifications.md](additional_quantity_specifications.md) —
  what is *not* stored here (additional units are computed at display time).
- [user_stories.md](user_stories.md) — decision 8 (format choice) and the sharing
  format (HTML export derives from these files).
