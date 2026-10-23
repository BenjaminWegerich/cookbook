# Additional Quantity Specifications (Unit Display)

> Defines how an ingredient's target amount is displayed: the optimizer chooses a
> **base quantity** (BQ, metric `g`/`ml`) and optionally an **additional quantity**
> (AQ, a household or packaging unit). Related documents:
> [quantity_scaling.md](quantity_scaling.md) (scaling, optimizer, precision),
> [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md) (the scoring model),
> [AQs.csv](AQs.csv) / [BQs.csv](BQs.csv) (the allowed values),
> [recipe_structure.md](recipe_structure.md) (recipe model).

## 1. Core idea

- A recipe stores only the **unrounded target `V0`** in the ingredient's family
  unit (`g` or `ml`). It never stores a second unit.
- At **display time** the app runs the deterministic optimizer. It may show:
  - a BQ alone (`"400 g Joghurt"`), or
  - a BQ plus an AQ (`"1 Becher Joghurt (500 g)"`).
- The BQ and AQ are **display values**. They are not written back to the recipe.
  The stored `V0` remains the target for scaling, shopping and export.
- An AQ is only considered when its value is allowed by the unit's **number
  scheme**. The scheme applies to exact and non-exact units alike.
- The optimizer can choose a BQ that differs from `V0` (for example `V0 = 450 g`
  may display as `1 Becher (500 g)`). That is deliberate: the display is the
  practical reading, while `V0` stays the exact target. If no candidate fits, the
  plain base form with `V0` is shown.
- The **precision** (five levels, `very low` … `very high`) shifts the balance
  between metric accuracy and practical measures; it never changes `V0` (see
  [quantity_scaling.md](quantity_scaling.md) §5).

## 2. Terminology

| Term | Definition | Example |
|---|---|---|
| Ingredient name | The ingredient itself. | "Joghurt" |
| Base quantity specification (BQS) | The displayed amount together with its base unit. | "500 g" |
| Base quantity (BQ) | The numeric amount of the BQS; an allowed BQ value or an exact unit's `q·c`. | 500 |
| Base unit (BU) | The unit of the BQS: g / ml (kg / l are display forms from 1000). | g |
| Additional quantity specification (AQS) | The displayed household/package part. | "1 Becher" |
| Additional quantity (AQ) | The numeric count of the AQS; an allowed AQ value. | 1 |
| Additional unit (AU) | The unit the AQS is expressed in; defines arrangement, scheme, display forms, exactness and shopping flag. | Becher |

The abbreviations (BQS, BQ, BU, AQS, AQ, AU) are conversational shorthand; the
full English terms are canonical. Concrete identifiers belong to the
implementation.

## 3. Master data

The display logic is driven by four repository tables, compiled into
`packages/core/src/additionalUnitsData.ts` / `quantityData.ts`:

1. **[BQs.csv](BQs.csv)** — the allowed metric values and their clumsiness
   penalties. `1 … 95` are explicit; above 95 the decade rule generates
   `10 … 95 × 10^k` (see [quantity_scaling.md](quantity_scaling.md) §3).
2. **[AQs.csv](AQs.csv)** — the allowed counts (`1/8 … 30`), their penalties and
   the number-scheme columns. A `1` marks the value as allowed by that scheme.
3. **[additional_units.csv](additional_units.csv)** — one row per unit:
   - canonical **name** (the key mappings reference),
   - **Singular** / **Plural** display forms (both empty for an invariant unit),
   - **Arrangement** (display template, §4),
   - **Number Scheme** (a column in `AQs.csv`, §5),
   - **Unit Exact** (`yes` / `no`, default `yes`, §6.3),
   - **Shopping Unit** (`yes` / `no`, mandatory, §3.1).
4. **[ingredient_unit_mappings.csv](ingredient_unit_mappings.csv)** — one row per
   ingredient–unit pair: `Ingredient;Additional Unit;Conversion Factor`
   (base-unit amount per one unit). There is **no priority column** anymore; the
   optimizer scores every compatible unit.

The ingredient list ([ingredients.csv](ingredients.csv) /
`zutaten.csv`) supplies the fixed base unit, the display forms, the optional
mandatory ingredient-level precision and the reorder point. An ingredient without mappings
(e.g. Cashews) has no AQ and always uses the base form.

### 3.1 Shopping unit

- The **Shopping Unit** flag states whether ingredients are bought in this unit:
  `yes` for a purchase unit (Becher, Packung), `no` for a pure recipe measure
  (TL, EL).
- The flag is a property of the **unit**, not of the mapping. It does not affect
  display selection; it only tells the shopping list which unit to buy in.
- **Exactly one shopping unit per ingredient.** The app allows at most one
  mapping whose unit is flagged `Shopping Unit = yes`; the generator and the
  runtime CSV parser reject a second one. The shopping list therefore has one
  unambiguous purchase unit. An ingredient with no shopping unit is bought in
  its family unit.
- Because the flag belongs to the unit, two meanings need two units with
  distinct names (e.g. a shopping `Becher` and a non-shopping variant if one is
  ever needed). The seed does not need such a variant: every ingredient with
  multiple mappings has at most one shopping mapping.

### 3.2 Singular and plural forms

- A unit's **name** is canonical: the key the mappings reference and the
  registry uses. The **Singular** / **Plural** cells are display data only.
- Both cells are filled for a unit with a count form (`Packung` / `Packungen`),
  both empty for an **invariant** unit (its canonical name serves for every
  count). A half-filled pair is a master-data error.
- A qualifier in the canonical name (`Packung (teilbar)`) is a key, never the
  display; such a unit must state its display pair.
- `<AU>` renders the **plural** form when the count is above one and the unit
  has one, otherwise the **singular** form (or the canonical name for an
  invariant unit). A fraction below one stays singular (`½ Packung`); a mixed
  number above one is plural (`1 ½ Packungen`).

## 4. Display arrangement

Each unit defines an **arrangement**: the order of the parts and the punctuation.

| Placeholder | Component |
|---|---|
| `<AQ>` | additional quantity |
| `<AU>` | additional unit — singular or plural form for the count |
| `<IN>` | ingredient name — canonical |
| `<INF>` | ingredient name — singular/plural form for the count |
| `<BQ>` | base quantity |
| `<BU>` | base unit (kg / l from 1000 up) |
| `<NNBSP>` | narrow no-break space (U+202F) |

Everything that is not a placeholder is free text and passes through unchanged.
`<BQ>` and `<BU>` may stand apart; `<IN>` and `<INF>` are two name placeholders
(canonical vs. count form). `<INF>` falls back to the canonical name when the
pair is empty; the count above one selects the plural.

Examples:

- `<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)` → `1 Becher Joghurt (500 g)`
- `<BQ><NNBSP><BU> <IN> (<AQ><NNBSP><AU>)` → `15 ml Zitronensaft (½ Zitrone)` (for a mapping with a 30 ml lemon and a halves scheme; the seed uses a different factor)
- `<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU> Abtropfgewicht)` → `1 Dose Kichererbsen (240 g Abtropfgewicht)`

If no AQ candidate fits, the base form `<BQ> <BU> <IN>` is shown (`400 g Joghurt`).
The BQ/AQ values are selected by the optimizer, not read from a stored BQ; in the
fallback the BQ is `V0` itself.

A parenthesized group in an arrangement is a **note**. The app and the cooking
view render it without brackets, muted and italic, after one en space:
`1 Becher Joghurt␣500 g`. The written shopping list keeps the written form with
brackets (`1 Becher Joghurt (500 g)`). Step prose is the exception: it keeps a
regular space and the brackets, styled muted and italic together with their
content (`(500 g)`), because the sentence's punctuation must stay visible.

## 5. Number schemes

- A **number scheme** is a named subset of the AQ values. The columns live in
  [AQs.csv](AQs.csv); no separate scheme file exists.
- The scheme is the **first gatekeeper**: only scheme-allowed values enter the
  optimizer. It applies to exact and non-exact units.
- Current schemes: `integers_up_to_10`, `halves_and_integers_up_to_30`,
  `all_fractions_and_integers_up_to_30`, `integers_up_to_30`,
  `quarters_halves_and_integers_up_to_30`. No scheme allows a count above 30.
- The scheme names are referenced by `Number Scheme` in
  [additional_units.csv](additional_units.csv); the generator fails on an
  unknown name or a scheme cell other than `1` / `0` / empty.

## 6. Selection and exactness

The detailed formula is in
[recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md) §5–§6 and
[quantity_scaling.md](quantity_scaling.md) §6. In short, the optimizer evaluates
metric-only BQs, exact-unit AQs (where `BQ = q·c`) and non-exact BQ/AQ pairs,
scores each candidate and picks the best; ties use higher BQ, higher AQ, then the
unit name. Candidate values are limited to `V0·(1 ± 0.5)`.

### 6.1 Exact vs. approximate units

- **Exact (`Unit Exact = yes`)** — the physical package fixes the amount
  (`1 Becher = 500 g`, `1 Block = 200 g`). The AQ count is the source of truth:
  the displayed BQ is `AQ × factor`, even when that is not a BQ-table value.
  The BQ table is not consulted. When the AQ count is **non-integer**, the
  displayed BQ is rounded to whole grams/millilitres (`1/3` of a 1000 g pack →
  `333 g`); an integer count keeps the exact product (including a fractional
  factor, e.g. `1 × 7.5 g = 7.5 g`).
- **Approximate (`Unit Exact = no`)** — the factor is a measured average (a
  carrot, a spoon). The optimizer selects a BQ from the BQ table and an AQ from
  the scheme; the conflict penalty keeps them close. Both are display values;
  the stored `V0` is unchanged.

The old rule “the stored base quantity is always shown” no longer applies: the
display shows the selected BQ (or `V0` in the fallback). Storage and scaling are
untouched either way.

### 6.2 Worked examples

Seed data: Joghurt has a 500 g Becher (exact, halves scheme), 23.71 g EL and
7.50 g TL (approximate, integers up to 10).

| Ingredient | `V0` | Result | Why |
|---|---|---|---|
| Joghurt | 500 g | `1 Becher Joghurt (500 g)` | exact count 1, perfect |
| Joghurt | 250 g | `½ Becher Joghurt (250 g)` | exact count ½, perfect |
| Joghurt | 750 g | `1 ½ Becher Joghurt (750 g)` | exact count 1½, perfect |
| Joghurt | 400 g | `400 g Joghurt` | metric BQ 400 beats 1 Becher (500 g) on the balanced weights |
| Mehl | 250 g | `250 g Mehl` | `Packung (unteilbar)` allows integers only; ¼ is rejected |
| Mehl | 1000 g | `1 Packung Mehl (1 kg)` | exact count 1 |
| Joghurt | 25 g | `1 EL Joghurt (25 g)` | Becher count 0.05 is below the AQ floor; EL count ≈1 passes |
| Joghurt | 8 g | `1 TL Joghurt (8 g)` | EL count ≈0.34 fails the integer scheme; TL count ≈1 passes |

The last two rows show an approximate unit: the count is a convenience; the
shown BQ is the optimizer's selected BQ. The stored `V0` stays 25 g / 8 g.

### 6.3 Exactness and the shopping list

The exact flag affects display only. The stored `V0` is never rewritten by
display selection. The one historical exception — snapping the **reorder point**
to a whole package in the ingredient master data — is a stock-state rule and
remains in the master-data form; it is not part of recipe scaling.

## 7. No priority; one shopping unit

- Per-ingredient priorities are gone. The optimizer is the only selection rule;
  a higher-priority unit is not tried first.
- The shopping list still needs one purchase unit, so the master data allows at
  most one mapping to a `Shopping Unit = yes` unit. This is the only remaining
  “preference” between units.
- The shopping list uses the purchase unit and rounds *up* to whole packages; it
  does not use the optimizer's display AQ. The shopping code is migrated to the
  new quantity model (see [quantity_scaling.md](quantity_scaling.md) §9): exact
  targets and sums, no ladder rung rounding, and BQ-based stock suggestions
  without an exact unit.

## 8. Consequences and rules

- The AQS is recomputed after every scaling step; it never influences scaling.
  Scaling changes `V0`; the optimizer is a display layer on top.
- The rules apply uniformly to step rows, the master list, reference ingredients
  and inline artifacts. A unitless artifact uses only the BQ-only branch (no
  ingredient, no AU); see [quantity_scaling.md](quantity_scaling.md) §8.
- A mapping's factor is expressed in the ingredient's fixed base unit (`g` or
  `ml`); an ingredient's base unit never changes.
- Base quantities display in the family unit, switching to `kg` / `l` at 1000.
  Number and unit are joined by U+202F.
- AQ notation: proper fractions use the Unicode glyphs (`⅒ ⅑ ⅛ ⅙ ¼ ⅓ ⅜ ⅖ ½ ⅗ ⅔ ¾ ⅝ ⅚ ⅞`);
  a mixed number is integer + U+202F + glyph (`1 ¼`); whole counts stay as they
  are. The cooking view uses the slash form (`1/2`, `1 1/4`).
- Precision can be set per quantity (optional) and per ingredient (mandatory);
  there is no recipe-level or global default. See
  [quantity_scaling.md](quantity_scaling.md) §5 for the cascade and the storage
  format.

## 9. Relationship to other documents

- [quantity_scaling.md](quantity_scaling.md) — scaling, the optimizer, precision,
  BQ decade rule, yields and export views.
- [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md) — the scoring
  formulas and candidate rules.
- [AQs.csv](AQs.csv) / [BQs.csv](BQs.csv) — the allowed values and schemes.
- [recipe_structure.md](recipe_structure.md) — the recipe model and the stored
  target `V0`.
- [storage_format.md](storage_format.md) — the canonical fields and the precision
  annotations.
