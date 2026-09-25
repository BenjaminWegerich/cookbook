# Additional Quantity Specifications (Unit Display)

> Defines how ingredient quantities are displayed: every ingredient is stored with
> a **base quantity specification** only ("400 g"), and the app may additionally
> render an **additional quantity specification** ("1 Becher") at display time.
> This is the authoritative spec for that logic. Related documents:
> [quantity_scaling.md](quantity_scaling.md) (the quantity ladder and scaling),
> [standard_numbers.csv](standard_numbers.csv) (the ladder table),
> [recipe_structure.md](recipe_structure.md) (recipe structure).

## 1. Core Idea

- An ingredient is **stored** with exactly two parts: its name and its base
  quantity specification (e.g. "400 g"). The base quantity is always a standard
  number (a rounded BQ ladder value, see [quantity_scaling.md](quantity_scaling.md)).
- At **display time**, the app *may* additionally show an additional quantity
  specification (e.g. "1 Becher") in front of or around the base specification:
  "1 Becher Joghurt (400 g)".
- The additional quantity specification is **always computed from the stored base
  quantity** — it is never stored, never authored, and never scaled directly.
  After scaling, the display is simply recomputed from the scaled base quantity.
  The shown base quantity in the same line is the stored value, except for an
  **exact** unit, where it is derived from the rounded additional quantity
  (§6.3) — again without storing anything.
- Every additional unit has a chance to apply: its additional quantity is
  computed from the base quantity, rounded to the nearest **AQ ladder value**
  (a fraction, see [quantity_scaling.md](quantity_scaling.md) §2), and checked
  against the **number scheme**. The mappings are evaluated in order of
  **priority** (1 = best first), and the first one that applies is used.
- Fractions replace decimals for additional units because counting units are
  more natural in fractions ("1/2 Apfel", "1+1/4 Becher") than in decimals
  ("0.5 Apfel", "1.25 Becher").

## 2. Terminology

| Term | Definition | Example |
|---|---|---|
| Ingredient name | The ingredient itself. | "Joghurt" |
| Base quantity specification (BQS) | The stored amount together with its base unit. | "400 g" |
| Base quantity (BQ) | The numeric amount of the BQS; always a rounded BQ ladder value. | 400 |
| Base unit (BU) | The unit of the BQS: g / kg / ml / l. | g |
| Additional quantity specification (AQS) | The computed display form added to the BQS. | "1 Becher" |
| Additional quantity (AQ) | The numeric value of the AQS; an AQ ladder value (fraction) after rounding. | 1+1/4 |
| Additional unit (AU) | The unit the AQS is expressed in. Defines the display arrangement, the number scheme, and whether it is a shopping unit. | Becher |

The abbreviations (BQS, BQ, BU, AQS, AQ, AU) are conversational shorthand only;
the full English terms above are the canonical names. Concrete identifiers for
storage (table, column, or file names) are deliberately **not** defined here —
they belong to the implementation phase.

## 3. Master Data (Conceptual)

The logic is driven by three master-data entities. Their concrete storage design is decided:
the master data lives in four CSV tables in the repository — `docs/number_schemes.csv` (scheme
matrix), `docs/additional_units.csv` (units with arrangement, scheme, exactness and the
shopping-unit flag), `docs/ingredients.csv` (ingredient list with base unit),
`docs/ingredient_unit_mappings.csv` (mappings with factor and priority) — and is compiled into a
TypeScript module by `scripts/generate-additional-data.mjs`, which validates cross-references and
guards the scheme matrix against drift from the ladder's AQ column (see
[ARCHITECTURE.md](ARCHITECTURE.md)).

1. **Additional units** — each AU has:
   - a **name** ("Becher"),
   - a **display arrangement** (see §4),
   - a **number scheme** (see §5),
   - an **exactness flag** (`Unit Exact`, see §6.3): `yes` when the unit fixes
     the base amount by definition (a 400 g Becher, a 200 g Block), `no` when
     the factor is only a measured average (a carrot of roughly 80 g),
   - a **shopping-unit flag** (`Shopping Unit`, see §3.1): `yes` when ingredients
     are bought in this unit (a Becher), `no` when the unit is only a recipe
     measure (TL, EL).
2. **Ingredient–additional-unit mappings** — for each ingredient and each AU
   mapped to it:
   - a **conversion factor**: the amount of base unit per one additional unit
     (e.g. 400 g per Becher for Joghurt),
   - a **priority**: a positive integer, where **1 = most preferred** (see §7).
   The ingredient list is the authoritative set of ingredient names and base
   units. An ingredient may have **no additional units** at all (e.g. Cashews)
   and then always renders in the base form (§4).
3. **Number schemes** — named subsets of the AQ ladder values (see §5).

### 3.1 Shopping Unit

- The **shopping-unit flag** (`Shopping Unit` in `docs/additional_units.csv`) states whether
  ingredients are bought in this unit: `yes` for a unit that names a purchase ("Becher",
  "Packung"), `no` for a unit that is only a recipe measure ("TL", "EL"). The cell is mandatory
  — a unit without the flag is a master-data error, so a new unit can never silently default
  into or out of the shopping list (unlike `Unit Exact`, which defaults to `yes`).
- The flag is a property of the **unit**, not of the ingredient or the mapping, and it drives
  the shopping-list flow. It does **not** affect the display in any way: AQS selection (§6),
  exactness (§6.3) and rendering (§4) ignore it, and a shopping unit is converted and displayed
  like any other AU.
- **One unit, one meaning — distinct names for variants.** A unit is identified by its **name**:
  the mappings reference it by name and the runtime registry keys units by name, so two rows
  sharing one name are ambiguous (and rejected by the generator). The rare unit that is a
  shopping unit for some ingredients but not for others is therefore modelled as **two units
  with distinct names**, one `yes` and one `no`. This mirrors the exact/approximate rule of §6.3:
  the flag belongs to the unit, so two meanings need two units.

## 4. Display Arrangement

- Each AU defines the **arrangement**: the order in which the components of the
  display line appear, plus the punctuation (spaces, parentheses).
- Arrangements are written as templates with the following placeholders:

  | Placeholder | Component |
  |---|---|
  | `<AQ>` | additional quantity |
  | `<AU>` | additional unit |
  | `<IN>` | ingredient name |
  | `<BQ>` | base quantity |
  | `<BU>` | base unit |

- Example — "Becher": `<AQ> <AU> <IN> (<BQ> <BU>)` → "1 Becher Joghurt (400 g)".
- Example — "Zitrone" (for Zitronensaft): `<BQ> <BU> <IN> (<AQ> <AU>)`
  → "15 ml Zitronensaft (1/2 Zitrone)".
- If **no** AQS applies, the ingredient is rendered in the standard base form
  `<BQ> <BU> <IN>`: "200 g Joghurt", "800 ml Wasser".
- The base quantity is shown with its **exact stored/scaled value** — except for
  an **exact** unit (§6.3), whose factor defines the base amount: there the shown
  base quantity is derived from the rounded additional quantity instead. The
  rounding described in §6 never changes the **stored** base quantity.

## 5. Number Schemes

- A **number scheme** is a named subset of the AQ ladder values (the fraction
  forms, see [quantity_scaling.md](quantity_scaling.md) §2). It answers the
  question: which additional quantities may be displayed for an AU?
- Example — `only_integers`: every AQ value that is a whole number (1, 2, 3, …)
  is allowed; every other AQ value is not.
- Further schemes are ordinary master data, e.g.:
  - `halves` — AQ values that are whole or half (1/2, 1, 1+1/2, 2, 2+1/2, …);
  - `quarters` — AQ values that are whole, quarter, or half (1/4, 1/2, 3/4, 1,
    1+1/4, …);
  - `fractions` — every AQ value (e.g. 2/5, 3/8, 2/3).
  The mechanism is identical for all of them.
- The number scheme is the **first gatekeeper** of AQS applicability: an AQS
  applies only if its (rounded) additional quantity is a member of the scheme.

## 6. Selection Algorithm

For every ingredient, at display time:

1. Take the stored base quantity BQ and base unit BU.
2. Iterate over the ingredient's AU mappings in **ascending order of priority
   value** (1 = best first; see §7). For each mapping (conversion factor c):
   1. compute `raw = BQ ÷ c`;
   2. **round `raw` to the nearest AQ ladder value** → AQ (see §6.1);
   3. if AQ **is allowed** by the AU's number scheme, **select this AU and
      stop**; otherwise continue with the next mapping.
   Priority ties must not occur in master data; if they do, the order between
   them is implementation-defined but must be deterministic.
3. Render the display line using the selected AU's arrangement (§4): the shown
   base quantity is the stored value, or — for an exact unit — the value derived
   from the rounded AQ (§6.3). If no AU applies, render the base form (§4).

### 6.1 Rounding to the Nearest AQ Ladder Value

- The additional quantity is rounded to the nearest **AQ ladder value** — the
  fraction column of [standard_numbers.csv](standard_numbers.csv) — measured by
  absolute difference on the value scale. The AQ values are the "standard
  numbers" for additional units.
- The AQ values are defined for x = −16 … 48 (0.1 … 1000, see
  [quantity_scaling.md](quantity_scaling.md) §2). A computed `raw` **below the
  smallest AQ value (1/10) or above the largest (1000)** yields **no additional
  quantity** — the ingredient is rendered in its base form (§4). (Example:
  20 g Joghurt with 1 Becher = 400 g → `raw = 0.05` → "20 g Joghurt".)
- Example: 500 g Joghurt with 1 Becher = 400 g → `raw = 1.25` → the nearest
  AQ values are 1+1/4 (difference 0) and 1+1/2 (difference 0.25) → AQ = **1+1/4**
  → the scheme `only_integers` rejects 1+1/4 → no AQS → "500 g Joghurt".
- If a computed value lies exactly between two neighboring AQ values, the
  **larger** value is chosen. (This tie is extremely rare in practice; the rule
  is deterministic.)

### 6.2 Worked Examples

The examples use the seed master data that ships with the implementation (see the CSV tables
in §3); further examples arrive with more ingredient mappings. In that seed, Becher is
**exact** (`Unit Exact = yes`) while EL and TL are **approximate** (`no`) — a spoon is heaped
or level depending on the ingredient, so its average factor must not overrule the weighed
amount (§6.3).

| Ingredient | Stored BQ | AU (factor) | raw | rounded AQ | scheme allows? | Displayed |
|---|---|---|---|---|---|---|
| Joghurt | 400 g | Becher (400 g), p1 | 1 | 1 | `halves_and_integers_up_to_30` ✓ | "1 Becher Joghurt (400 g)" |
| Joghurt | 200 g | Becher (400 g), p1 | 0.5 | 1/2 | ✓ (half) | "1/2 Becher Joghurt (200 g)" |
| Joghurt | 600 g (scaled) | Becher (400 g), p1 | 1.5 | 1+1/2 | ✓ (half) | "1+1/2 Becher Joghurt (600 g)" |
| Joghurt | 500 g | Becher p1 → EL (24 g) p2 → TL (7.5 g) p3 | 1.25 → 20.83 → 66.67 | 1+1/4 → 20 → 70 | ✗ (not half/integer) → ✗ (20 > 10) → ✗ (70 > 10) | "500 g Joghurt" |
| Joghurt | 25 g | Becher p1 → EL p2 → TL p3 | 0.0625 → 1.04 | — → 1 | ✗ (< 1/10) → ✓ | "1 EL Joghurt (25 g)" (§6.3, EL approximate) |
| Joghurt | 8 g | Becher p1 → EL p2 → TL p3 | 0.02 → 0.33 → 1.07 | — → 1/3 → 1 | ✗ (< 1/10) → ✗ (not integer) → ✓ | "1 TL Joghurt (8 g)" (§6.3, TL approximate) |

The last two rows show the approximate case of §6.3: the count is rounded ("1 EL" instead of
1.04 EL), but the stored weight stays the authoritative reading, so the shown amount remains
25 g / 8 g rather than 1 × 24 g / 1 × 7.5 g.

### 6.3 Exact vs. Approximate Units

- The selection algorithm derives the AQ from the stored base quantity, so the
  two can **contradict each other** whenever the rounding moves the AQ: a
  ladder value of 1500 g with 1 Block = 200 g gives "7+1/2 Blöcke" → rounded to
  "8 Blöcke", but the displayed base quantity stayed "1500 g" → "8 Blöcke Tofu
  (1,5 kg)", although 8 blocks weigh 1.6 kg.
- Whether that contradiction is acceptable depends on the **unit**, not on the
  ingredient or the mapping — which is why the master data carries the flag on
  the unit (`docs/additional_units.csv`, `Unit Exact`; default `yes`):
  - **exact (`yes`)** — the unit *defines* the base amount: a physical package
    (1 Becher = 400 g, 1 Block = 200 g). Here the **shown count is the source of
    truth**: the shown base quantity is recomputed as `AQ × factor`, even when
    the result is **not a ladder value** ("8 Blöcke Tofu (1,6 kg)").
  - **approximate (`no`)** — the factor is a measured average: a carrot weighs
    roughly 80 g but varies. Here the **stored/scaled base quantity stays the
    source of truth** and keeps being displayed; the rounded count is the
    convenience reading ("250 g Karotte (3 Karotten)").
- The flag affects the **display only**. The stored base quantity is never
  rewritten, so it stays a ladder value, scaling stays closed over the ladder
  (quantity_scaling.md §3), and the merge/summing rules are untouched. The exact
  derivation happens after selection and outside scaling.
- **One exception: the ingredient master data's reorder point**
  (storage_format.md §9). It names a stock state, not a recipe amount, and stock
  comes in whole packages — so when an exact unit applies, the create form stores
  the exact amount (a 160 g Becher turns a picked 150 g into a stored 160 g). The
  reorder point is not part of a recipe, so scaling and the merge rules are
  unaffected.
- Reference table for an exact unit with factor 200 (1 Block = 200 g), showing
  the stored amount, the rounded count and the shown amount:

  | Stored BQ | raw | rounded AQ | shown BQ (AQ × 200 g) | Displayed |
  |---|---|---|---|---|
  | 200 g | 1 | 1 | 200 g | "1 Block Tofu (200 g)" |
  | 600 g | 3 | 3 | 600 g | "3 Block Tofu (600 g)" |
  | 900 g | 4.5 | 5 | 1000 g | "5 Block Tofu (1 kg)" |
  | 1500 g (scaled) | 7.5 | 8 | 1600 g | "8 Block Tofu (1,6 kg)" |

  With an exact unit the shown amount can therefore differ from the stored one by
  at most half an AQ step. That is the deliberate trade-off: the display never
  contradicts itself, at the price of showing a weight that the recipe does not
  store.

- If an ingredient's factor is only approximate, mark the unit `no` — or, when
  the same unit name would otherwise have to be both, define a **separate unit**
  for the exact case (e.g. "EL" vs. "EL gestrichen"): the flag is a property of
  the unit, so two different meanings need two units. The same reading applies to
  the shopping-unit flag, and the variants there need distinct names too (§3.1).
- The seed follows that reading: **Becher is exact**, **EL and TL are
  approximate** (a spoon is heaped or level depending on the ingredient). An
  empty `Unit Exact` cell means `yes`, so a newly added unit is exact unless the
  master data says otherwise — deliberate, because a new unit is usually a
  package or container whose amount is fixed; a measured average must be marked
  `no`.

## 7. Priority

- Every ingredient–AU mapping has a **priority**: a positive integer where
  **1 = most preferred**.
- Priority defines the **evaluation order**: the mappings are tried in ascending
  order of priority value, and the first one whose additional quantity passes
  its number scheme is used. Mappings with a higher priority value are therefore
  never evaluated once a better one has applied — no separate selection step is
  needed.
- Example: 15 ml of an ingredient with mappings EL (priority 1, 15 ml) and
  TL (priority 2, 5 ml): EL is tried first, its AQ (1) passes the scheme, so the
  app shows "1 EL …" and TL is never evaluated.

## 8. Consequences and Rules

- The AQS is recomputed after every scaling step; it never influences scaling
  (scaling operates on the base quantity only).
- The rules apply uniformly to every displayed ingredient: regular ingredients,
  sub-recipe ingredients, and reference ingredients alike.
- The conversion factor of a mapping is expressed in the ingredient's base unit
  (e.g. 400 g per Becher for Joghurt); an ingredient's base unit is fixed.
- **Display conversion of the base quantity (decided with the user):** quantities
  are *stored* in the ingredient's family unit `g` or `ml` (see
  [storage_format.md](storage_format.md) §4); from 1000 up, the display switches
  to `kg` / `l` ("1 kg", "1.2 kg") — also inside the AQS arrangement
  ("3 Becher Joghurt (1.2 kg)"). The stored value is never changed by this.
- This spec fixes only the canonical AQ value (e.g. 1+1/4; the "+" marks a mixed
  number — one and a quarter). The display typography is implemented in core
  (`formatAQ` / `formatAQValue`): a proper fraction uses the Unicode fraction
  glyphs (⅒ ⅑ ⅛ ⅙ ⅕ ¼ ⅓ ⅜ ⅖ ½ ⅗ ⅔ ¾ ⅞), a mixed number is written as integer +
  narrow no-break space (U+202F) + glyph ("1 ¼"), and whole AQ values stay as
  they are. `renderAQS` applies it to the additional quantity; unitless inline
  counts use it for their own display.
- For an **exact** unit (§6.3), the AQS is the authoritative part of the line:
  its base quantity is derived from the AQ, not read from the recipe. The stored
  value stays untouched and is unchanged by the flag.

## 9. Relationship to Other Documents

- [quantity_scaling.md](quantity_scaling.md) — the quantity ladder and scaling;
  the AQS logic builds on the standard numbers and is applied after scaling.
- [standard_numbers.csv](standard_numbers.csv) — the ladder table; the rounded
  AQ column is binding for the additional quantity.
- [recipe_structure.md](recipe_structure.md) — recipe structure; its "Ingredients
  List" section specifies that only the base quantity is stored and that no
  second unit is ever authored. This document specifies how that base quantity
  is displayed.
- [README.md](../README.md) — feature overview ("Ingredient-specific additional
  units").
