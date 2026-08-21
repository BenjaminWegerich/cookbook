# Quantity Scaling (Ladder Logic)

> Defines how ingredient quantities change when a recipe is scaled to a different
> number of servings / yield. Related documents:
> [standard_numbers.csv](standard_numbers.csv) (the ladder table),
> [recipe_structure.md](recipe_structure.md) (recipe structure), and
> [additional_quantity_specifications.md](additional_quantity_specifications.md)
> (display of quantities with additional units).

## 1. Core Idea

- Scaling a recipe **never multiplies ingredient quantities by a single factor**.
  Instead:
  1. The current target and the requested target (number of people for finished
     dishes, yield for ingredient recipes) are located on a fixed **ladder of
     standard numbers**.
  2. The difference of their ladder positions gives an integer **step count Δx**.
  3. **Every ingredient quantity moves by the same Δx steps** up or down the ladder.
- Example: 4 and 6 people are 2 rungs apart on the ladder (4 at rung x = 10,
  6 at rung x = 12). Scaling from 4 to 6 people therefore moves every quantity
  2 steps: 400 ml → 600 ml, and 5 tbsp → 7 tbsp — not 7.5, which a fixed factor
  of 1.5 would produce.
- The ladder values serve two purposes:
  - a **consistent relative increase** between neighboring rungs: each step
    multiplies the quantity by 10^(1/16) ≈ 1.155 (≈ +15.5 %);
  - **round, practical numbers** that coincide with common packaging sizes
    for ingredients.
- Every rung carries two practical forms — a decimal (for base quantities and
  serving counts) and a fraction (for additional-unit display); see §2.

## 2. The Ladder (Standard Numbers)

- For every integer step index x the ladder has:
  - **exact(x) = 10^(x/16)** (i.e. 1 · 10^(x/16)) — the geometric basis;
    x = 0 → 1, x = 16 → 10, x = 32 → 100, x = −16 → 0.1;
  - **rounded_BQ(x)** — a hand-picked round, practical decimal number per rung
    (chosen to match common packaging sizes); used for the base quantity
    (g / kg / ml / l) and for serving counts;
  - **rounded_AQ(x)** — a hand-picked fraction per rung; used only to display
    additional quantities (Becher, Packung, Stück, …).
- The **rounded BQ value is the value that is stored, scaled, and used as base
  quantity**; the rounded AQ value exists only for display (§7) and is never
  stored or scaled. The exact column exists solely to define the geometric
  spacing.
- The reference table (x = −16 … 48, i.e. 0.1 … 1000) lives in
  [docs/standard_numbers.csv](standard_numbers.csv), with columns
  `Exact Number; Rounded Number for BQ; Rounded Number for AQ`.
- The ladder is **scale-invariant** in its exact and rounded BQ forms: the same
  relative pattern repeats every 16 steps, scaled by 10:
  - exact(x + 16) = 10 · exact(x)
  - rounded_BQ(x + 16) = 10 · rounded_BQ(x)
  - rounded_BQ(x − 16) = rounded_BQ(x) / 10
- The table therefore defines the entire (infinite) ladder in both directions for
  the exact and BQ forms; any rung can be generated on demand (e.g. x = 49 →
  exact 1154.8 → rounded_BQ 1200; x = −17 → exact 0.0866 → rounded_BQ 0.09).
- **The AQ fraction forms are NOT scale-invariant.** They are hand-picked for the
  human scale (0.1 … 10) and defined only for x = −16 … 48; from x = 16 up they
  coincide with the BQ integers (10, 12, 15, …). AQ is therefore a pure table
  lookup (§8) — no decade rule applies to it.
- Rounded values of one decade (x = 0 … 16):

  | x  | exact | rounded BQ | rounded AQ |
  |----|-------|------------|------------|
  | 0  | 1     | 1          | 1          |
  | 1  | 1.15  | 1.2        | 1+1/4      |
  | 2  | 1.33  | 1.5        | 1+1/2      |
  | 3  | 1.54  | 1.8        | 1+3/4      |
  | 4  | 1.78  | 2          | 2          |
  | 5  | 2.05  | 2.2        | 2+1/4      |
  | 6  | 2.37  | 2.5        | 2+1/2      |
  | 7  | 2.74  | 2.8        | 2+3/4      |
  | 8  | 3.16  | 3          | 3          |
  | 9  | 3.65  | 3.5        | 3+1/2      |
  | 10 | 4.22  | 4          | 4          |
  | 11 | 4.87  | 5          | 5          |
  | 12 | 5.62  | 6          | 6          |
  | 13 | 6.49  | 7          | 7          |
  | 14 | 7.5   | 8          | 8          |
  | 15 | 8.66  | 9          | 9          |
  | 16 | 10    | 10         | 10         |

  Below 1 the AQ forms are proper fractions: 1/10, 1/9, 1/8, 1/6, 1/6, 1/5, 1/4,
  1/4, 1/3, 3/8, 2/5, 1/2, 3/5, 2/3, 3/4, 7/8 (see the CSV for all rungs).

  Each decade above or below multiplies / divides the exact and BQ values by 10
  (1, 1.2, 1.5, 1.8, 2, …, 10, 12, 15, 18, 20, …, 100, 120, 150, 180, 200, …).
  The AQ fractions do not repeat this way (see above).

## 3. Standard Numbers Only (Restriction)

- **Non-standard numbers do not exist in the app.** Every value that is authored
  or chosen must be a rounded BQ ladder value:
  - ingredient quantities: the author enters 400 or 500 ml — 450 is not allowed;
  - serving counts: the author / scaler chooses 10 or 12 servings — 11 is not allowed;
  - yields of ingredient recipes: same rule.
- Consequences:
  - `pos(v)` is a plain table lookup; no rounding, approximation, or tie-breaking
    is ever needed;
  - the ladder is **closed under scaling**: moving any ladder value by any integer
    number of steps always yields another ladder value.
- Implementation: restrict the UI to ladder values (e.g. a stepper that jumps rung
  by rung, or a picker of valid values) and/or validate input against the ladder,
  rejecting invalid values.

## 4. Scaling Algorithm

1. Determine the current target A and the requested target B:
   - finished-dish recipe: A = current number of people, B = requested number of
     people (both standard numbers);
   - ingredient recipe: A = yield in base units, B = requested yield
     (standard numbers).
2. Step count: **Δx = pos(B) − pos(A)** — an integer (negative for scaling down,
   0 for no change).
3. For every ingredient with base quantity q: **q′ = rounded(pos(q) + Δx)**.
4. The whole recipe uses one common Δx. The effective multiplier is 10^(Δx/16),
   i.e. the target ratio B/A quantized to a whole number of steps.

### Worked examples

- 4 → 6 people (pos(4) = 10, pos(6) = 12, Δx = +2):
  - 400 ml → rung 42 → +2 → rung 44 → **600 ml**;
  - 5 tbsp → 7 tbsp (stored as the base-unit equivalent, e.g. 50 ml → 70 ml).
- 4 → 5 people (Δx = +1): 5 tbsp → **6 tbsp** (replaces the mathematical 6.25;
  matches the README example).
- 6 → 9 people (pos(6) = 12, pos(9) = 15, Δx = +3): 700 g → rung 45 → +3 →
  rung 48 → **1000 g**.
- Scale down, 6 → 4 people (Δx = −2): 600 ml → **400 ml**.

## 5. Reference Ingredients

- A reference ingredient is an ordinary ingredient as far as scaling is concerned:
  it moves by the same common Δx and is displayed as a sanity check — e.g.
  "9 Personen (1000 g Nudeln)" when scaling "6 Personen (700 g Nudeln)" to 9 people.
- The step count is derived exclusively from the serving counts; the reference
  ingredient only visualizes the result.

## 6. Ingredient Recipes and Sub-Recipes

- An ingredient recipe scaled on its own follows the same rule with its yield:
  Δx = pos(requested yield) − pos(yield).
- A sub-recipe linked from a parent recipe (e.g. Béchamelsauce inside Lasagne):
  1. The parent's scaled amount q′ (a ladder value) is the **required amount**;
  2. the sub-recipe scales by Δx_sub = pos(required amount) − pos(sub-recipe yield);
  3. its ingredients move by Δx_sub, and the resulting amounts feed the shopping list.
- Example: Béchamelsauce yields 500 ml from 300 ml Milch. Lasagne scaled 6 → 9
  people (Δx = +3) requires 800 ml Béchamelsauce (500 ml → rung 43 → +3 → rung 46
  → 800 ml). The sub-recipe scales by Δx_sub = pos(800) − pos(500) = 46 − 43 = +3,
  so Milch moves 300 ml (rung 40) → rung 43 → **500 ml** on the shopping list.

## 7. Units and Display

- The ladder operates on the stored base quantity (g / kg / ml / l). Scaling never
  changes the unit or the base-unit semantics.
- Display conversions (kg ↔ g, l ↔ ml, and ingredient-specific additional units
  such as Becher, EL, Packung, Stück) happen afterwards at display time and are
  outside this specification (see
  [additional_quantity_specifications.md](additional_quantity_specifications.md)).
  Example: a scaled 1000 g may be displayed as "1 kg" or "1 Packung", depending
  on the ingredient's additional-unit mappings.
- When an additional unit applies, its quantity is displayed in the AQ fraction
  form of the scaled rung (e.g. "1+1/2 Becher"), never as a decimal.

## 8. Implementation Notes (Deterministic, Table-Driven)

- No AI and no floating-point rounding of results: the step count is an integer,
  positions are table lookups, and results are table values.
- Represent the ladder as a lookup keyed by x. Because of the periodicity rule
  (§2), the exact and BQ forms can be generated beyond the table; the AQ
  fraction forms exist only for x = −16 … 48 and are a plain table lookup.
  The CSV is the authoritative source for x = −16 … 48.

```
# exact(x)      = 10^(x/16)
# rounded_BQ(x) = table lookup; outside the table via rounded_BQ(x+16) = 10·rounded_BQ(x)
# rounded_AQ(x) = table lookup; defined only for x = −16 … 48

def pos(v):                       # v is a standard number (rounded BQ ladder value)
    return x such that rounded_BQ(x) == v   # normalize decades first if v < 0.1 or v > 1000

def scale(amount, delta_x):       # amount is a standard number
    return rounded(pos(amount) + delta_x)

def scale_recipe(recipe, new_target):
    delta_x = pos(new_target) - pos(recipe.target)   # target = servings or yield
    for each ingredient ing in recipe.ingredients:
        ing.amount = scale(ing.amount, delta_x)
```

- Validation (per §3): `pos(v)` must always succeed; an unknown v means invalid
  input and must be rejected before any scaling happens.

## 9. Relationship to Other Documents

- [standard_numbers.csv](standard_numbers.csv) — the ladder table; the rounded
  BQ column is binding for storage and scaling, the rounded AQ column for
  additional-unit display.
- [recipe_structure.md](recipe_structure.md) — recipe structure; its examples are
  ladder-consistent ("× 1.5 → 750 ml" is now "6 → 9 people → 800 ml";
  "1050 g Nudeln" is now "1000 g Nudeln").
- [README.md](../README.md) — feature description; its example
  (5 tbsp → 6 tbsp for 4 → 5 people) matches this spec.
