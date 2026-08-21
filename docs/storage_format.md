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
  - **YAML front matter** (between the leading `---` lines) — the structured data:
    metadata and the ingredient list;
  - **Markdown body** — the preparation steps.
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
| `prep_time` | string | no | Free-text display value, e.g. `25 min`, `1 h 30 min`. |
| `total_time` | string | no | Only if it differs from `prep_time`. |
| `ingredients` | list | yes | See §4. |

### Type-specific fields

| `type` | Required fields | Forbidden | Notes |
|---|---|---|---|
| `finished_dish` | `servings` | `yield`, `yield_unit`, `yield_note` | `servings`: integer, a standard number (ladder value). Example: `6` — not `11`. |
| `ingredient_recipe` | `yield`, `yield_unit` | `servings` | `yield`: number, a standard number in the base unit; `yield_unit`: base unit (g / kg / ml / l). Example: `yield: 500`, `yield_unit: ml`. |
| any | `yield_note` (only for `ingredient_recipe`) | for `finished_dish` | Optional free text about the use, e.g. `für 2 Salatköpfe (700 g)`. |

## 4. Ingredient Entries

Each ingredient entry in the `ingredients` list has exactly these fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | German ingredient name. Example: `Joghurt`. |
| `quantity` | number | yes | The base quantity; must be a standard number (ladder value). Example: `400` — not `450`. |
| `unit` | enum | yes | The base unit: `g`, `kg`, `ml`, or `l`. Counted items are stored via their mass/volume equivalent (e.g., `240` `g` for 6 Tortillas); the "6 Stück" form is displayed via the additional-unit master data. |
| `reference` | boolean | no | `true` on 0–2 ingredients per finished-dish recipe (the portion anchor). Default `false`. |
| `recipe` | string | no | The title of a linked sub-recipe (ingredient recipe). Example: `recipe: Béchamelsauce`. |

- Ingredients are listed in the order of their first use in the preparation; an
  ingredient used in several places appears once, with the total amount.
- A linked ingredient (`recipe` set) still carries its own `quantity`/`unit` — the
  amount required by the parent recipe (e.g., `500` `ml` Béchamelsauce).
- The additional-unit selection, display arrangement, and punctuation are never
  stored here; they come from the master data at display time.

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
- Steps may contain arbitrary prose; links to sub-recipes are displayed as links by
  the app, not typed inline.

## 6. Title as Identifier — Renames

- The `title` is the stable identifier: sub-recipe links (`recipe:` fields) and the
  file name both reference it.
- **Renaming a recipe** therefore means, as one operation:
  1. change `title` in the file,
  2. rename the file (and its image),
  3. update every `recipe:` reference to the old title in all other recipe files.
- The app provides a rename tool that performs all three steps; it must never leave a
  dangling `recipe:` reference (see §7).
- The `subtitle` is display-only and plays no role in identification.

## 7. Validation

Validation runs on every read, before any logic (scaling, display, export) touches
the file. Two levels:

### 7.1 Schema validation (per file)

- Front matter parses as valid YAML and matches the schema of §3/§4 (field names,
  types, required/forbidden fields per `type`).
- `title` is non-empty and file-name-safe.
- `servings` / `yield` / `quantity` values are standard numbers: `pos(v)` on the
  quantity ladder must succeed (see [quantity_scaling.md](quantity_scaling.md) §3);
  a non-ladder value is rejected.
- `unit` is one of `g`, `kg`, `ml`, `l`.
- At most 2 ingredients have `reference: true`, and only in `finished_dish` recipes.
- The body contains exactly one `## Zubereitung` heading followed by an ordered list.

### 7.2 Cross-recipe validation (per collection)

- `title` is unique across the collection (file names are unique by construction;
  the titles inside must be too).
- Every `recipe:` reference points to an existing recipe whose `type` is
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
ingredients:
  - name: Joghurt
    quantity: 400
    unit: g
  - name: Tortillas
    quantity: 240
    unit: g
    reference: true
  - name: Zitronensaft
    quantity: 15
    unit: ml
  - name: Béchamelsauce
    quantity: 500
    unit: ml
    recipe: Béchamelsauce
---
## Zubereitung
1. Tortillas im Ofen erwärmen und warm halten.
2. Tofu marinieren und scharf anbraten.
3. Joghurt mit Zitronensaft verrühren und würzen.
4. Wraps mit Tofu, Joghurt-Dip und Gemüse füllen und servieren.
```

Ingredient recipe:

```markdown
---
title: Béchamelsauce
type: ingredient_recipe
yield: 500
yield_unit: ml
ingredients:
  - name: Milch
    quantity: 300
    unit: ml
  - name: Butter
    quantity: 25
    unit: g
---
## Zubereitung
1. Butter schmelzen, Mehl anschwitzen und mit Milch aufgießen.
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
