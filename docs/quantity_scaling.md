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
  and the effective tolerance. The result is either:
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
  millionth precision only to remove floating-point noise, then optimized for
  display like any other target.

This replaces the old quantity ladder. The old `docs/standard_numbers.csv`, the
`packages/core/src/ladder.ts` / `ladderData.ts` modules and the legacy
`aqLadder.ts` bridge remain only for the shopping/pantry code until its
migration; the recipe, editor, export and meal plan use the optimizer.

## 2. Master data

Four tables drive the optimizer:

| Table | Purpose |
|---|---|
| [BQs.csv](BQs.csv) | Allowed base quantities and their clumsiness penalties. |
| [AQs.csv](AQs.csv) | Allowed additional quantities, penalties, and the number-scheme columns. |
| [additional_units.csv](additional_units.csv) | Unit identity, display forms, arrangement, number scheme, exactness, shopping flag. |
| [ingredient_unit_mappings.csv](ingredient_unit_mappings.csv) | Ingredient → compatible additional unit and its conversion factor. |

`docs/ingredients.csv` holds the ingredient list (base unit, optional tolerance,
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
`111`) do not exist. The table starts at `1`; a `V0` below `1` has no BQ
candidate and is shown in the plain base form unless an exact unit fits.

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

## 5. Tolerance

Tolerance `λ ∈ [0, 1]` is a **display preference**, not a scale factor:

- `λ = 0` (“Sehr genau”): prefer metric accuracy; awkward numbers and metric-only
  output are acceptable.
- `λ = 1` (“Sehr praktisch”): prefer clean household/package measures; small
  culinary deviations are acceptable.
- `λ = 1` **never** means that a target may be doubled or halved. `V0` is
  unchanged.

The effective value is resolved through the cascade:

```
quantity (row / artifact) ?? ingredient ?? recipe ?? global default (0.5)
```

The ingredient level does not apply to unitless artifacts (they have no
ingredient). The UI offers five chips: `0`, `0.25`, `0.5`, `0.75`, `1`; an
unset level inherits. The global default is the code constant
`DEFAULT_TOLERANCE = 0.5` in
[tolerance.ts](../packages/core/src/tolerance.ts).

Storage:

| Level | Where | Format |
|---|---|---|
| Quantity | ingredient row | trailing `{tolerance: 0.8}`; artifacts use `{{1/2\|t=0.8}}` |
| Ingredient | `zutaten.csv` / `docs/ingredients.csv` | `Tolerance` column before `Reorder Point` |
| Recipe | YAML front matter | `tolerance: 0.7` |
| Global | code | `DEFAULT_TOLERANCE = 0.5` |

Recipe- and especially quantity-level overrides are meant for exceptions; the
ingredient master data can carry the ingredient's usual setting.

## 6. Scoring and selection

The full formulas are in [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md)
§5–§6. The runtime parameters are fixed:

- `p = 0.5` (user proportion, `USER_PROPORTION_P`);
- `ε_max = 0.5` (candidate search cutoff, `EPSILON_MAX`);
- exact weights `W_exact = (0.70, 0.20, 0.05, 0.05)`;
- practical weights `W_practical = (0.20, 0.30, 0.35, 0.15)`.

The optimizer evaluates three branches:

1. **EXACT unit** — the package count fixes the BQ: `BQ = q_AQ × c_u`. The BQ
   table is not consulted; `P_conflict = 0` and `R_BQ = 0`. When the AQ is
   **non-integer**, the derived BQ is rounded to whole grams/millilitres for
   display (`1/3` of a 1000 g pack → `333 g`, not `333,33 g`). The unrounded
   `q_AQ × c_u` stays the accuracy reference for the score.
2. **NON_EXACT unit** — BQ and AQ are selected independently; a conflict penalty
   applies when they disagree.
3. **Metric-only** — a BQ from the table, no AQ. The missing-AQ penalty applies.

Candidates are limited to `V0 × (1 ± ε_max)`. A non-exact pair is skipped when
its BQ/AQ conflict exceeds `ε_max`. If **no** candidate exists, the renderer uses
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
- `0.5 g` has no BQ candidate; it is shown as `0,5 g`.

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
additional unit. The tolerance cascade is `artifact ?? recipe ?? global`; there
is no ingredient level.

If no AQ value fits `ε_max`, the artifact keeps its unrounded count. AQ values
keep their canonical notation (`{{1/2}}`, `{{1+1/4}}`); other positive counts are
stored as decimals.

## 9. Legacy shopping code (migration status)

The shopping list, sub-recipe cooking and pantry/stock code still use the old
ladder (`ladder.ts`, `ladderData.ts`, `standard_numbers.csv`). They are being
migrated separately; until then, their internal amounts may still be snapped to
ladder rungs. The recipe/editor/export/meal-plan path does not use those
modules.

## 10. Implementation map

| Concern | Module |
|---|---|
| BQ/AQ tables and schemes | `packages/core/src/quantityData.ts` (generated from `docs/BQs.csv` + `docs/AQs.csv`) |
| Membership, decade rule, formatting | `packages/core/src/quantityValues.ts` |
| Optimizer | `packages/core/src/quantityOptimizer.ts` |
| Tolerance | `packages/core/src/tolerance.ts` |
| Serving counts | `packages/core/src/servingSizes.ts` |
| Display arrangements | `packages/core/src/additionalUnits.ts` |
| Export views | `packages/core/src/recipe/exportHtml.ts`, `yieldViews.ts` |
| Data generators | `packages/core/scripts/generate-quantity-data.mjs`, `generate-additional-data.mjs` |

Run `npm run generate:quantity` and `npm run generate:additional` from
`packages/core` after changing the corresponding CSVs.
