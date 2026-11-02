# Ingredient Default Precision — Assignment

> **Status:** applied. `zutaten.csv` and the matching rows in `docs/ingredients.csv` carry these
> values; the core seed was regenerated. The copy in
> [`zutaten-precision-proposal.csv`](zutaten-precision-proposal.csv) remains as the review record.

This assignment covers all 153 ingredients in `zutaten.csv`. It uses the five levels from
[docs/recipe_scaling_algorithm.md](docs/recipe_scaling_algorithm.md) §4 and follows how each
ingredient is normally measured in a kitchen, not how important it is.

## 1. What the level means

Precision is a **display preference**, never a scale factor. A higher level tells the optimizer
to stay closer to the stored gram/millilitre amount; a lower level lets it choose a clean
household or package reading and accept a small culinary deviation. The stored amount never
changes, and a recipe row can still override the ingredient default.

The useful question for a default is therefore: _how would a cook measure this ingredient?_

## 2. Rules

| Level       | Culinary rule                                                                            | Typical scope                                                          | Rows |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---: |
| `very high` | Weigh to the gram. A 1–2 g error is a large share of the dose and changes the chemistry. | Leaveners                                                              |    3 |
| `high`      | Weigh. The recipe’s ratio and texture depend on it, and volume measures vary too much.   | Flour, sugar, fat, starch, cocoa, gluten                               |    7 |
| `medium`    | Measure. The amount matters, but a small deviation is tolerable or corrected in the pan. | Salt, pepper, potent spices, aromatics, dairy, protein, grains, doughs |   51 |
| `low`       | Spoon, splash or package. The amount is a guide; a 10–20 % deviation is normal.          | Produce, mild spices, herbs, oil, juice, stock, canned goods, nuts     |   79 |
| `very low`  | Count, handful or eye. The amount is bulk or garnish.                                    | Water, soft fresh herbs, tortillas                                     |   13 |

Examples of the reasoning behind the boundaries:

- **7 g baking powder** is about 2.3 % of 300 g flour. A 1 g error is already 14 % of the
  dose, and a teaspoon varies with the brand and humidity. Hence `very high`.
- **A 10 g deviation in 500 g flour** is 2 %. A scale is normal for baking, and the
  flour/sugar/fat ratio decides the texture. Hence `high`.
- **One onion** is 70–80 g when small and 150 g when large. A recipe’s `100 g` is a guide;
  `low` keeps the amount close without pretending the count is exact.
- **15 g parsley** is a handful. No cook weighs it, and the amount is adjusted at the end;
  `very low` is the honest default.

## 3. Proposed defaults

Counts: **3 very high · 7 high · 51 medium · 79 low · 13 very low**.

### Very high (3)

Backpulver, frische Hefe, Trockenbackhefe.

### High (7)

brauner Zucker, Butter, Gluten, Kakaopulver, Mehl, Speisestärke, Zucker.

### Medium (51)

Ahornsirup, Apfelessig, Aquafaba, Biskuit-Teig, Chiliflocken, Crème fraîche, Dijon-Senf, Feta, frische Chilis, frischer Ingwer, frischer Knoblauch, ganze Gewürznelken, gemahlene Gewürznelken, gemahlene Muskatnuss, gemahlener Kardamom, gemahlener Zimt, geriebener Käse, getrocknete Chilis, getrocknete Soja-Steaks, granulierter Knoblauch, Grapefruitschale, grobkörniges Salz, Hackfleisch, Joghurt, Kochsahne, Leinsamen, Limettenschale, Linsen, Milch, Mürbeteig mit Zucker, Naturtofu, Orangenschale, Penne rigate, Pfeffer, Räuchertofu, Reis, rote Linsen, Salz, scharfes Paprikapulver, Schlagsahne, Senf, Skyr, Sojasauce, Sojaschnetzel, Spätzle, Tahin, Tomatenmark, Umami-Paste, Vanilleextrakt, Zitronen, Zitronenschale.

### Low (79)

**Produce: vegetables and fruit (34):** Äpfel, Auberginen, Avocados, Birnen, Blumenkohl, Brokkoli, Eisbergsalat, Fenchel, Frühlingszwiebeln, Grapefruits, Hokkaido-Kürbis, Karotten, Kartoffeln, Kirschtomaten, Knollensellerie, Kopfsalat, Limetten, Mais, Orangen, Paprikas, Pfirsiche, rote Beete, rote Zwiebeln, Rotkohl, Sauerkraut, Schalotten, Spitzkohl, Stangensellerie, Süßkartoffeln, Tomaten, Weißkohl, Zucchini, Zwetschgen, Zwiebeln.

**Herbs (12):** Dill, frischer Rosmarin, frischer Salbei, frischer Thymian, gemahlener Rosmarin, gerebelter Kerbel, gerebelter Majoran, gerebelter Oregano, gerebelter Salbei, gerebelter Thymian, getrockneter Dill, getrockneter Liebstöckel.

**Mild ground spices (7):** Currypulver, gemahlene Kurkuma, gemahlener Ingwer, gemahlener Koriander, gemahlener Kreuzkümmel, geräuchertes Paprikapulver, süßes Paprikapulver.

**Oils, juices, stock, spirits (10):** Ananassaft, Gemüsebrühe, Gemüsebrühe-Pulver, Grapefruitsaft, Limettensaft, Öl, Olivenöl, Orangensaft, Wodka, Zitronensaft.

**Canned and packaged goods (7):** gehackte Tomaten, Kichererbsen, Kichererbsen mit Aquafaba, Kidneybohnen, Kokosmilch, passierte Tomaten, weiße Bohnen.

**Nuts, seeds, dried fruit (6):** Cashewkerne, Kürbiskerne, Rosinen, schwarzer Sesam, Walnusskerne, weißer Sesam.

**Bulk condiments and prepared components (3):** Hefeflocken, Mayonnaise, Pico de gallo.

### Very low (13)

frische Petersilie, frischer Dill, frischer Kerbel, frischer Liebstöckel, frischer Majoran, frischer Oregano, frischer Schnittlauch, frisches Basilikum, frisches Koriandergrün, Kräuter, Maistortillas, Tortillas, Wasser.

## 4. What changed

98 of the 153 values changed. The substantive corrections are:

- **Baking chemistry stops being `medium`.** `Backpulver`, `frische Hefe` and
  `Trockenbackhefe` become `very high`; `Mehl`, `Zucker`, `brauner Zucker`, `Kakaopulver`,
  `Speisestärke`, `Gluten` and `Butter` become `high`.
- **Fresh herbs become consistent.** Soft herbs (parsley, dill, chervil, lovage, marjoram,
  oregano, basil, coriander, chives) are `very low`; woody herbs (rosemary, sage, thyme) are
  `low` because they can overpower. `Kräuter` remains `very low`.
- **The current outliers are normalized.** `Karotten` moves from `very low` to `low` (a
  vegetable is forgiving, but a 20–30 % swing is not a default); `Dijon-Senf` moves from
  `high` to `medium` (a strong condiment, not a baking chemical); `Pico de gallo` moves from
  `very low` to `low` (a prepared condiment, but not a garnish).
- **Produce becomes `low`.** Vegetables and fruit are bought and cooked by count or by eye;
  the gram amount is a guide, not a formula. This is the largest single group.
- **Mild spices become `low`, potent spices stay `medium`.** Cumin, coriander, turmeric,
  paprika and curry are spooned and adjusted; cloves, cardamom, nutmeg, cinnamon, chilli,
  salt and pepper are potent enough that a 20 % swing is noticed.
- **Package goods become `low`.** Canned tomatoes, beans, coconut milk and stock are bought in
  whole packages; the package is the practical measure. Tortillas and maize tortillas are
  count-only and become `very low`.

## 5. Application record

- `zutaten.csv`: 98 of 153 `Precision` cells changed; every other column is untouched.
- [docs/ingredients.csv](docs/ingredients.csv): 97 of 144 seed rows changed. Ten older names
  were mapped to their current counterparts so the seed stays consistent with the authoritative
  list: `Cashews` → `Cashewkerne`, `Chilis` → `getrocknete Chilis`, `gekochte Kichererbsen` →
  `Kichererbsen`, `gekochte Kichererbsen mit Aquafaba` → `Kichererbsen mit Aquafaba`,
  `gekochte Kidneybohnen` → `Kidneybohnen`, `gekochte weiße Bohnen` → `weiße Bohnen`,
  `gemahlene Koriandersamen` → `gemahlener Koriander`, `gemahlener Pfeffer` → `Pfeffer`,
  `getrockneter Rosmarin` → `gemahlener Rosmarin`, `Strauchtomaten` → `Tomaten`.
- `packages/core/src/additionalUnitsData.ts`: regenerated with `npm run generate:additional`.
  The pre-existing `Block` unit addition in `docs/additional_units.csv` was preserved.
- `npm test` in `packages/core`: 577 tests pass.

Two caveats:

- This assignment changes only the `Precision` column. Some names in the copied list do not
  match the current seed mappings (for example `Pfeffer` vs `gemahlener Pfeffer`,
  `Kichererbsen` vs `gekochte Kichererbsen`); those ingredients still have no additional
  units until the mappings are aligned. That is a separate cleanup.
- The defaults are deliberately opinionated. If one feels wrong in use, the cleanest fix is a
  different ingredient default; a single recipe can still pin its own level with the
  `{precision: …}` tag.
