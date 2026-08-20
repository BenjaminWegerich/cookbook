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
  number (a rounded ladder value, see [quantity_scaling.md](quantity_scaling.md)).
- At **display time**, the app *may* additionally show an additional quantity
  specification (e.g. "1 Becher") in front of or around the base specification:
  "1 Becher Joghurt (400 g)".
- The additional quantity specification is **always computed from the stored base
  quantity** — it is never stored, never authored, and never scaled directly.
  After scaling, the display is simply recomputed from the scaled base quantity.
- Every computed additional quantity has a chance to apply: it is first rounded
  to the nearest standard number, then checked against the additional unit's
  **number scheme**. If several additional units pass that check, a **priority**
  decides which one is shown.

## 2. Terminology

| Term | Definition | Example |
|---|---|---|
| Ingredient name | The ingredient itself. | "Joghurt" |
| Base quantity specification (BQS) | The stored amount together with its base unit. | "400 g" |
| Base quantity (BQ) | The numeric amount of the BQS; always a standard number. | 400 |
| Base unit (BU) | The unit of the BQS: g / kg / ml / l. | g |
| Additional quantity specification (AQS) | The computed display form added to the BQS. | "1 Becher" |
| Additional quantity (AQ) | The numeric value of the AQS; always a standard number after rounding. | 1 |
| Additional unit (AU) | The unit the AQS is expressed in. Defines the display arrangement and the number scheme. | Becher |

The abbreviations (BQS, BQ, BU, AQS, AQ, AU) are conversational shorthand only;
the full English terms above are the canonical names. Concrete identifiers for
storage (table, column, or file names) are deliberately **not** defined here —
they belong to the implementation phase.

## 3. Master Data (Conceptual)

The logic is driven by three master-data entities. Their concrete storage design
(tables, columns, format) is out of scope for this document and decided in the
implementation phase.

1. **Additional units** — each AU has:
   - a **name** ("Becher"),
   - a **display arrangement** (see §4),
   - a **number scheme** (see §5).
2. **Ingredient–additional-unit mappings** — for each ingredient and each AU
   mapped to it:
   - a **conversion factor**: the amount of base unit per one additional unit
     (e.g. 400 g per Becher for Joghurt),
   - a **priority**: a positive integer, where **1 = most preferred** (see §7).
3. **Number schemes** — named subsets of the standard numbers (see §5).

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
  → "15 ml Zitronensaft (½ Zitrone)".
- If **no** AQS applies, the ingredient is rendered in the standard base form
  `<BQ> <BU> <IN>`: "200 g Joghurt", "800 ml Wasser".
- The base quantity is always shown with its **exact stored/scaled value**.
  The rounding described in §6 affects only the additional quantity, never the
  base quantity.

## 5. Number Schemes

- A **number scheme** is a named subset of the standard numbers. It answers the
  question: which additional quantities may be displayed for an AU?
- Example — `only_integers`: every standard number that is an integer is
  allowed; every other standard number is not.
- Further schemes (e.g. halves, quarters) are ordinary master data; the
  mechanism is identical for all of them.
- The number scheme is the **first gatekeeper** of AQS applicability: an AQS
  applies only if its (rounded) additional quantity is a member of the scheme.

## 6. Selection Algorithm

For every ingredient, at display time:

1. Take the stored base quantity BQ and base unit BU.
2. For every AU mapped to the ingredient (mapping: conversion factor c,
   priority p):
   1. compute `raw = BQ ÷ c`;
   2. **round `raw` to the nearest standard number** → AQ (see §6.1);
   3. if AQ is **not** allowed by the AU's number scheme, this AU does **not**
      apply.
3. If several AUs apply, select the one with the **lowest priority value**
   (1 = best; see §7). Priority ties must not occur in master data; if they do,
   the resolution is implementation-defined but must be deterministic.
4. Render the display line using the selected AU's arrangement (§4). If no AU
   applies, render the base form (§4).

### 6.1 Rounding to the Nearest Standard Number

- Every computed value is rounded to the nearest rounded ladder value, measured
  by absolute difference on the value scale.
- The ladder is infinite in both directions (periodic, see
  [quantity_scaling.md](quantity_scaling.md) §2), so a nearest value always
  exists.
- Example: 500 g Joghurt with 1 Becher = 400 g → `raw = 1.25` → the nearest
  standard numbers are 1.2 (difference 0.05) and 1.5 (difference 0.25)
  → AQ = **1.2** → the scheme `only_integers` rejects 1.2 → no AQS
  → "500 g Joghurt".
- If a computed value lies exactly between two neighboring ladder values, the
  **larger** value is chosen. (This tie is extremely rare in practice; the rule
  is deterministic.)

### 6.2 Worked Examples

| Ingredient | Stored BQ | AU (factor c) | raw | rounded AQ | scheme allows? | Displayed |
|---|---|---|---|---|---|---|
| Joghurt | 400 g | Becher (400) | 1 | 1 | `only_integers` ✓ | "1 Becher Joghurt (400 g)" |
| Joghurt | 200 g | Becher (400) | 0.5 | 0.5 | ✗ (not integer) | "200 g Joghurt" |
| Joghurt | 500 g | Becher (400) | 1.25 | 1.2 | ✗ (not integer) | "500 g Joghurt" |
| Joghurt | 600 g (scaled) | Becher (400) | 1.5 | 1.5 | ✗ (not integer) | "600 g Joghurt" |
| Öl | 50 ml | EL (10) | 5 | 5 | ✓ | "5 EL Öl (50 ml)" |
| Zitronensaft | 15 ml | Zitrone (30) | 0.5 | 0.5 | halves ✓ | "15 ml Zitronensaft (½ Zitrone)" |
| (e.g. a spice) | 15 ml | EL (15), TL (5) | 1, 3 | 1, 3 | both ✓ | priority decides (§7) |

## 7. Priority

- Every ingredient–AU mapping has a **priority**: a positive integer where
  **1 = most preferred**.
- Priority is used **only as a tiebreaker**: first the number scheme filters out
  inapplicable AUs, and only if several AUs remain does the lowest priority
  value win. Priority alone never makes an AQS apply.
- Example: 15 ml of an ingredient with mappings EL (priority 1, 15 ml) and
  TL (priority 2, 5 ml): both compute to integers (1 EL, 3 TL) and both pass the
  scheme, so the app shows "1 EL …" (priority 1 beats priority 2).

## 8. Consequences and Rules

- The AQS is recomputed after every scaling step; it never influences scaling
  (scaling operates on the base quantity only).
- The rules apply uniformly to every displayed ingredient: regular ingredients,
  sub-recipe ingredients, and reference ingredients alike.
- The conversion factor of a mapping is expressed in the ingredient's base unit
  (e.g. 400 g per Becher for Joghurt); an ingredient's base unit is fixed.
- The typography of the displayed additional quantity (fractions such as ½,
  decimal separators, number of digits) is a UI/design concern and is resolved
  in the UI phase. This spec fixes only the numeric value, which is always a
  standard number.

## 9. Relationship to Other Documents

- [quantity_scaling.md](quantity_scaling.md) — the quantity ladder and scaling;
  the AQS logic builds on the standard numbers and is applied after scaling.
- [standard_numbers.csv](standard_numbers.csv) — the ladder table; the rounded
  column is binding.
- [recipe_structure.md](recipe_structure.md) — recipe structure; its "Ingredients
  List" section specifies that only the base quantity is stored and that no
  second unit is ever authored. This document specifies how that base quantity
  is displayed.
- [README.md](../README.md) — feature overview ("Ingredient-specific additional
  units").
