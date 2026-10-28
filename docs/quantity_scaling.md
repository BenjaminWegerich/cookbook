# Quantity Scaling and Display Optimization

> Defines how a recipe's ingredient amounts scale and how the app chooses the
> displayed BQ/AQ representation. The scoring model is specified in
> [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md); this document
> records the project-specific decisions, the master data and the integration
> with the recipe format. Related documents:
> [additional_quantity_specifications.md](additional_quantity_specifications.md)
> (display arrangements, exact/approximate units), [recipe_structure.md](recipe_structure.md)
> (recipe model), [storage_format.md](storage_format.md) (file format).

## 1. Core idea

- A **recipe stores the unrounded target amount `V0`** for every ingredient use,
  in the ingredient's metric family unit (`g` or `ml`). Any positive finite
  number is allowed; there is no ladder of standard values anymore.
- **BQ and AQ are display values.** For every render, the app runs the
  deterministic optimizer over `V0`, the ingredient's additional-unit mappings
  and the effective precision. The result is either:
  - a **BQ** from the allowed base-quantity table, optionally with an **AQ** from
    the allowed additional-quantity table (a household or packaging unit), or
  - the **plain base form** with `V0`, when no candidate fits.
- The optimizer never changes a stored amount. Scaling is
  `V0' = V0 × factor`, where the factor is the exact ratio between the requested
  and the written recipe size (servings or yield). Nothing is rounded to a
  ladder rung.
- The master ingredient list stores the **sum of the step rows' displayed BQs**,
  not the sum of their exact targets. Those are the amounts the cook reads on
  the rows; summing the targets would disagree with them. The sum is kept at
  millionth precision only to remove floating-point noise. The master row's own
  display is optimized under constraints that tie it to the step rows (see
  §6, “Master-list quantities”): a once-used ingredient keeps the step's
  arrangement, several uses keep the exact BQ sum and the master row inherits
  the highest precision of its uses.

This replaces the old quantity ladder. `docs/standard_numbers.csv` and the
`packages/core/src/ladder.ts` / `ladderData.ts` modules are no longer imported by
the app; they remain exported and tested until the cleanup task in
[ROADMAP.md](ROADMAP.md) removes them. The legacy `aqLadder.ts` bridge still
backs the nearest-AQ display helpers in `additionalUnits.ts`; the recipe and
shopping code use the BQ/AQ tables directly.

## 2. Master data

Four tables drive the optimizer:

| Table | Purpose |
|---|---|
| [BQs.csv](BQs.csv) | Allowed base quantities and their clumsiness penalties. |
| [AQs.csv](AQs.csv) | Allowed additional quantities, penalties, and the number-scheme columns. |
| [additional_units.csv](additional_units.csv) | Unit identity, display forms, arrangement, number scheme, exactness, shopping flag. |
| [ingredient_unit_mappings.csv](ingredient_unit_mappings.csv) | Ingredient → compatible additional unit and its conversion factor. |

`docs/ingredients.csv` holds the ingredient list (base unit, mandatory precision,
reorder point, display forms). `docs/additional_units.csv` and the ingredient
mappings are compiled into `packages/core/src/additionalUnitsData.ts`;
`BQs.csv` and `AQs.csv` are compiled into `packages/core/src/quantityData.ts`.

There is **no per-ingredient priority** anymore. The optimizer scores every
compatible unit. The shopping list needs exactly one unit to buy in, so an
ingredient may map to at most one unit flagged `Shopping Unit = yes`; the master
data validator enforces that.

## 3. Allowed base quantities (BQ)

[BQs.csv](BQs.csv) lists the values `1 … 95` explicitly, each with a penalty
`R_BQ ∈ [0, 1]` (`0` = clean, `1` = awkward).

Above 95 the table continues by the **decade rule**: the `10 … 95` block is
multiplied by powers of ten, and the penalty is copied from the base value.

- `100 = 10 × 10`, penalty `0`
- `110 = 11 × 10`, penalty `0.66`
- `950 = 95 × 10`, penalty `1`
- `1000 = 10 × 100`, penalty `0`
- `1100 = 11 × 100`, penalty `0.66`

Values that are not in the `10 … 95` block (for example `96 … 99`, `105`,
`111`) do not exist. The table starts at `1`. A `V0` below `1` can still reach
the `1 g` BQ when `1` lies in its factor-2 band (`V0 ≥ 0.5`); a smaller target
(e.g. `0.1 g`) has no BQ candidate and is shown in the plain base form unless an
exact unit fits.

`allowedBQValuesInRange(min, max)` in
[quantityValues.ts](../packages/core/src/quantityValues.ts) expands the table for
candidate generation; `isAllowedBQ` / `bqPenalty` answer membership and penalty.

## 4. Allowed additional quantities (AQ) and number schemes

[AQs.csv](AQs.csv) lists the allowed counts (`1/8 … 30`) with their penalties and
one column per number scheme. A `1` marks the value as allowed by that scheme.

The scheme is the **first gatekeeper** of an AQ candidate: only values allowed by
the unit's `Number Scheme` enter the optimizer, for `EXACT` and `NON_EXACT` units
alike. The clumsiness penalty of the surviving value still scores. This is what
prevents a quarter of an `unteilbar` pack: its scheme allows integers only.

The current schemes are:

| Scheme | Membership |
|---|---|
| `integers_up_to_10` | Whole AQ values 1 … 10. |
| `halves_and_integers_up_to_30` | Whole and half AQ values up to 30. |
| `all_fractions_and_integers_up_to_30` | Every AQ value up to 30. |
| `integers_up_to_30` | Whole AQ values up to 30 (as present in the table). |
| `quarters_halves_and_integers_up_to_30` | Quarter, half and whole AQ values up to 30. |

No scheme allows a count above `30`. The scheme matrix lives in `AQs.csv`, so a
new AQ value and its memberships are one edit, not two files.

## 5. Precision (Genauigkeit)

Precision is a **display preference**, not a scale factor. It has five stored
levels:

| Level | Meaning |
|---|---|
| `very low` | Prefer clean household/package measures; small culinary deviations are acceptable. |
| `low` | Lean practical. |
| `medium` | Balanced. |
| `high` | Lean exact. |
| `very high` | Prefer metric accuracy; awkward numbers and metric-only output are acceptable. |

A higher value therefore means **more precision** — the reverse of the old
tolerance scale, where `0` was exact. No level ever means that a target may be
doubled or halved: `V0` is unchanged.

The effective value is resolved through two levels:

```
quantity (row / artifact) ?? ingredient (mandatory)
```

The ingredient level does not apply to unitless artifacts (they have no
ingredient); an unregistered sub-recipe has no master-data row. Only these
values use the internal neutral level `medium`; it is never written to a file
and is not a user setting. There is **no recipe-level and no global default**.

Storage:

| Level | Where | Format |
|---|---|---|
| Quantity | ingredient row | trailing `{precision: high}`; artifacts use `{{1/2\|precision: high}}` |
| Ingredient | `zutaten.csv` / `docs/ingredients.csv` | mandatory `Precision` column before `Reorder Point` |

The quantity level pins that use: it keeps its value when the ingredient default
changes later, and it may deliberately repeat the current default — the tag, not
a difference in value, is what makes the pin. A quantity without a tag follows
the ingredient default live. The master data carries the ingredient's usual
setting; the quantity level is for exceptions.

## 6. Scoring and selection

The full formulas are in [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md)
§5–§6. The runtime parameters are fixed:

- `p = 0.5` (user proportion, `USER_PROPORTION_P`);
- candidate band `[V0 / 2, 2·V0]` (`CANDIDATE_BAND_FACTOR = 2`,
  `MAX_LOG_DISTANCE = 1`), with accuracy measured as `|log₂(x/V0)|`;
- conflict guard `log₂(1.5) ≈ 0.585` (`MAX_LOG_CONFLICT`), with the non-exact
  BQ/AQ conflict measured as `|log₂(BQ/AQ)|`;
- exact boundary (`very high`) weights `W_exact = (0.70, 0.20, 0.05, 0.05)`;
- practical boundary (`very low`) weights `W_practical = (0.20, 0.30, 0.35, 0.15)`.

The optimizer evaluates three branches:

1. **EXACT unit** — the package count fixes the BQ: `BQ = q_AQ × c_u`. The BQ
   table is not consulted; `P_conflict = 0` and `R_BQ = 0`. When the AQ is
   **non-integer**, the derived BQ is rounded to whole grams/millilitres for
   display (`1/3` of a 1000 g pack → `333 g`, not `333,33 g`). The unrounded
   `q_AQ × c_u` stays the accuracy reference for the score.
2. **NON_EXACT unit** — BQ and AQ are selected independently; a log conflict
   penalty applies when they disagree.
3. **Metric-only** — a BQ from the table, no AQ. The missing-AQ penalty applies.

Candidates are limited to the factor-2 band `[V0 / 2, 2·V0]`; accuracy and the
non-exact BQ/AQ conflict are symmetric log distances. A non-exact pair is skipped
when `|log₂(BQ/AQ)| > log₂(1.5)`. If **no** candidate exists, the renderer uses
the plain base form with `V0` and no AQ; it never throws.

Ties within `1e-5` are broken by the strict hierarchy: higher BQ, then higher AQ
(`None = −1`), then the alphabetically first unit name (`None = ""`, German
collation).

Examples:

- `250 g` with a `1000 g` `Packung (unteilbar)` (scheme: integers) cannot be
  `1/4 Packung`; the metric BQ `250 g` wins.
- The same amount with `Packung (teilbar)` (all fractions) may be
  `1/4 Packung (250 g)`.
- `250 g` Joghurt with a `500 g` Becher may be `1/2 Becher (250 g)`.
- `0.5 g` has no BQ below `1 g`; the nearest allowed BQ `1 g` sits on the `2×`
  band edge, so it is shown as `1 g`. A target with no BQ in `[V0/2, 2·V0]`
  (e.g. `0.1 g`) keeps its plain base form.

### Master-list quantities

A master row is not an independent target: `optimizeMasterQuantity`
([quantityOptimizer.ts](../packages/core/src/quantityOptimizer.ts)) derives it
from the step uses that `masterUsesFor`
([masterQuantity.ts](../packages/core/src/recipe/masterQuantity.ts)) recovers.
The rules:

- **One use:** the step result is reused unchanged, so step and master
  arrangement are identical.
- **Several uses:** the master BQ is the exact sum of the step BQs. It need not
  be a BQ table value and is never charged BQ clumsiness.
- **Same AU everywhere:** if every step uses the same AU and the master uses it
  too, the master AQ is the exact sum of the step AQs. A sum outside the AQ
  table is written as a reduced mixed fraction (`1+1/2`, displayed as
  `1 1/2`), and its clumsiness is not scored.
- **Shared AU:** any master AQ that uses an AU some step also uses must be
  strictly larger than that step's AQ. Without this rule a master could repeat
  `1 Packung` above a step that already reads `1 Packung` and show a
  contradictory `1 Packung (1,02 kg)`.
- **Exact units:** outside the shared-AU sum, an exact unit is only a candidate
  when its count reaches the master BQ exactly; otherwise the line would
  contradict itself (`2 Becher (900 g)`).
- **Precision:** the master row takes the highest effective precision among its
  step rows.

The constraints hold at every baked export size: the export scales the step
uses before it optimizes the master row, so the master BQ is always the sum of
the *displayed* step BQs of that size.

## 7. Scaling a recipe

A recipe's written size is either its serving count (`finished_dish`) or its
yield (`ingredient_recipe`). For a requested size `T`:

```
factor = T / writtenSize
V0'    = V0 × factor          // exact, no ladder step
```

Every ingredient use and every inline artifact is scaled with the same factor.
The optimizer runs on `V0'`; the stored recipe is never rewritten by viewing or
exporting it.

### Servings

A finished dish may have one of the fixed serving counts
`1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30` (the old integer
standard numbers). The HTML export pre-bakes one view per count.

### Yields and export views

An ingredient recipe's written yield may be **any positive number** (it is
stored as `V0`), but only BQ values are baked into the export. The export views
are all allowed BQ values in the band `writtenYield / 10 … writtenYield × 10`
(±1 decade), plus the nearest allowed BQ if that band contains none. For a
500 ml yield this gives 65 views (50 ml … 5 l), including 500 ml.

The view the export opens on is the written yield when it is a BQ value,
otherwise the allowed BQ nearest to it. The meal plan accepts only a baked view,
so its link can always open exactly the size it promised.

## 8. Unitless inline artifacts

A unitless artifact (`{{1/2}}`) has no base unit and no ingredient. It uses the
same scoring idea with only the **BQ-only branch**, applied to the AQ table as
the primary number table: the count is chosen by accuracy and roundness, with no
additional unit. A count has no ingredient, so the only applicable level is the
optional artifact override; without one, the internal neutral `medium` is used.

If no AQ value fits the factor-2 band, the artifact keeps its unrounded count.
AQ values keep their canonical notation (`{{1/2}}`, `{{1+1/4}}`); other positive
counts are stored as decimals.

## 9. Shopping list, cooking and stock (migrated)

The shopping list, sub-recipe cooking and pantry/stock use the same exact model
as the recipe paths (see `packages/core/src/shoppingList.ts` and
`packages/core/src/subRecipePlan.ts`):

- a planned recipe scales by the exact factor between the requested and written
  size; a sub-recipe's ingredients scale by `cook / yield`;
- a dish's need is the exact sum over its recipes, and a sub-recipe's
  requirement is the exact sum over its parents — no ladder rung rounding;
- only the amount to **buy** is rounded up: to whole shopping units when the
  ingredient has one, otherwise to whole grams/millilitres;
- an exact shopping unit offers the package thresholds as stock suggestions; an
  approximate unit or no unit offers clean **BQ table** values instead of old
  ladder rungs;
- the need is shown as its exact amount in the ingredient's familiar reading,
  while the shopping unit names the purchase side.

The legacy ladder modules (`ladder.ts`, `ladderData.ts`,
`standard_numbers.csv`) are no longer imported by this code. Removing them is
the cleanup task in [ROADMAP.md](ROADMAP.md).

## 10. Implementation map

| Concern | Module |
|---|---|
| BQ/AQ tables and schemes | `packages/core/src/quantityData.ts` (generated from `docs/BQs.csv` + `docs/AQs.csv`) |
| Membership, decade rule, formatting | `packages/core/src/quantityValues.ts` |
| Optimizer | `packages/core/src/quantityOptimizer.ts` |
| Master-row uses and display | `packages/core/src/recipe/masterQuantity.ts` |
| Precision | `packages/core/src/precision.ts` |
| Serving counts | `packages/core/src/servingSizes.ts` |
| Display arrangements | `packages/core/src/additionalUnits.ts` |
| Shopping list arithmetic | `packages/core/src/shoppingList.ts` |
| Sub-recipe cooking plan | `packages/core/src/subRecipePlan.ts` |
| Export views | `packages/core/src/recipe/exportHtml.ts`, `yieldViews.ts` |
| Data generators | `packages/core/scripts/generate-quantity-data.mjs`, `generate-additional-data.mjs` |

Run `npm run generate:quantity` and `npm run generate:additional` from
`packages/core` after changing the corresponding CSVs.
