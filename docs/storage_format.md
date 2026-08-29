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
    metadata (title, type, times, servings/yield);
  - **Markdown body** — the preparation steps, which carry the **ingredient
    markers** (see §4): the step text is the source of truth for the
    ingredient list, which is *derived* from the markers on read.
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

A front-matter `ingredients` field is **rejected**: the ingredient list is derived
from the body markers (§4). The editor's quantity pool is bounded to 1 … 10000
(g/ml); values are stored in the family unit, `kg`/`l` appear only in display
(see [additional_quantity_specifications.md](additional_quantity_specifications.md) §2).

## 4. Ingredients — Markers in the Body

Decided with the user: **the step text is the source of truth for the
ingredient list.** An ingredient is written inline into the step that uses it
as a machine-readable **marker**:

```
{{ingredient|Joghurt|400|g}}
{{ingredient|Joghurt|200|g|ref}}
{{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}}
```

- **Grammar:** `{{ingredient|NAME|MENGE|EINHEIT}}` with two optional flags:
  `|ref` (portion anchor, max 2 per finished-dish recipe) and
  `|recipe:TITEL` (linked ingredient recipe). Field names are English (code);
  `NAME` and `TITEL` are German (data).
- **Menge** is a standard number (ladder value); **Einheit** is the stored base
  unit — authored as `g` or `ml` (the ingredient's family unit). `kg`/`l`
  markers from hand-written files are accepted on read and normalized to the
  family unit (`×1000`) when the editor loads the file.
- A `|recipe:TITEL` marker links the ingredient to the ingredient recipe with
  that title. **The ingredient name equals the recipe title** (`NAME == TITEL`,
  decided with the user): the sub-recipe is chosen in the editor like any other
  ingredient by its name — there is no separate link field — and renaming the
  recipe updates `NAME` and `TITEL` of every reference together (§6). The HTML
  export renders sub-recipe ingredients as links to the sub-recipe's own export
  file (see the HTML share export in ARCHITECTURE.md).
- The **ingredient list is derived** from the markers on read (§7.1):
  - order = order of first appearance in the steps;
  - an ingredient used several times appears **once, with the total amount**
    (sum rounded to the nearest ladder rung — the sum of two standard numbers
    is not necessarily a standard number);
  - `reference` is kept when any marker of that ingredient carries `|ref`;
  - the `|recipe:` link is kept from the first marker that carries one.
- A malformed `{{…}}` block (wrong fields, non-standard quantity, unknown
  unit) is a validation error — never silently treated as prose.
- The additional-unit display ("1 Becher Joghurt (400 g)") is never stored; it
  is computed at display time from the master data.

## 5. Markdown Body — Preparation Steps

- After the front matter, the body contains exactly one structural heading and the
  ordered step list:

  ```markdown
  ## Zubereitung
  1. Erste Anweisung …
  2. Zweite Anweisung …
  ```

- **`## Zubereitung` is a fixed structural heading** (not a section the author may
  rename). No other headings or sub-sections may appear in the body; steps are a
  single ordered list.
- Step numbers are explicit in the file (Markdown ordered list); the order is
  authoritative, even where it does not matter.
- There is no summary section; the recipe ends with the last step, which may include
  serving suggestions.
- Steps are single-line prose (the editor collapses line breaks on save). They may
  contain arbitrary text plus the ingredient markers of §4; sub-recipe links are
  carried by the marker's `|recipe:` flag, not typed as prose.

## 6. Title as Identifier — Renames

- The `title` is the stable identifier: sub-recipe links (the markers' `|recipe:`
  flags) and the file name both reference it.
- **Renaming a recipe** therefore means, as one operation:
  1. change `title` in the file,
  2. rename the file (and its image),
  3. update every `|recipe:` marker to the old title in all other recipe files.
- The app provides a rename tool that performs all three steps; it must never leave a
  dangling `|recipe:` reference (see §7).
- The `subtitle` is display-only and plays no role in identification.

## 7. Validation

Validation runs on every read, before any logic (scaling, display, export) touches
the file. Two levels:

### 7.1 Schema validation (per file)

- Front matter parses as valid YAML and matches the schema of §3 (field names,
  types, required/forbidden fields per `type`); an `ingredients` field is rejected
  (it is derived from the markers, §4).
- `title` is non-empty and file-name-safe.
- `servings` / `yield` / every marker `Menge` is a standard number: `pos(v)` on the
  quantity ladder must succeed (see [quantity_scaling.md](quantity_scaling.md) §3);
  a non-ladder value is rejected.
- Marker units are `g`/`ml` (authored) or `kg`/`l` (legacy, accepted); marker
  syntax is validated per step (issue path `steps[i]`).
- At most 2 markers carry `|ref`, and only in `finished_dish` recipes.
- The body contains exactly one `## Zubereitung` heading followed by an ordered list.

### 7.2 Cross-recipe validation (per collection)

- `title` is unique across the collection (file names are unique by construction;
  the titles inside must be too).
- Every `|recipe:` marker points to an existing recipe whose `type` is
  `ingredient_recipe`.

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
---
## Zubereitung
1. {{ingredient|Tortillas|250|g|ref}} im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. {{ingredient|Joghurt|400|g}} mit {{ingredient|Zitronensaft|15|ml}} verrühren und würzen.
4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen. {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}} dazureichen.
```

Ingredient recipe:

```markdown
---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 15 min
---
## Zubereitung
1. {{ingredient|Butter|25|g}} schmelzen, Mehl anschwitzen und mit {{ingredient|Milch|300|ml}} aufgießen.
2. Unter Rühren köcheln, bis die Sauce bindet.
```

## 9. Relationship to Other Documents

- [recipe_structure.md](recipe_structure.md) — logical model this encoding implements.
- [quantity_scaling.md](quantity_scaling.md) — why quantities/servings/yields must be
  ladder values, and how scaling consumes the stored base quantities.
- [additional_quantity_specifications.md](additional_quantity_specifications.md) —
  what is *not* stored here (additional units are computed at display time).
- [user_stories.md](user_stories.md) — decision 8 (format choice) and the sharing
  format (HTML export derives from these files).
