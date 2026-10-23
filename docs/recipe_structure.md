# Recipe Structure (Identical for All Recipes)

## Recipe Type (required)

- Every recipe has exactly one explicit type, set by the author when creating the recipe. It is never derived automatically.
- **Finished dish:** The recipe produces a dish that is served to people. Example: "Shredded Tofu Wraps".
- **Ingredient recipe:** The recipe produces an ingredient that is used in other recipes. Example: "Salatdressing" (used for salads).
- The type determines how "Servings" is specified (people vs. yield) and what a reference ingredient anchors (see below).

## Header Information

### Title (required)

- A short, concise description of the dish.
- Also used for the "Essen" list in Google Keep.
- Must be unique within the entire recipe collection.
- The title is the stable identifier of the recipe (e.g., used for linking sub-recipes, see "Ingredients List").
- Example: "Shredded Tofu Wraps".

### Description (optional)

- A single paragraph describing the dish and, if applicable, suggesting suitable side dishes or other uses.
  It may be phrased as a continuation of the title instead of a standalone sentence, e.g.
  "Bauernfrühstück / mit Kartoffeln, Karotten und Tofu".

### Servings (required)

- For finished-dish recipes (see "Recipe Type"): Number of people the portion serves. Example: "6 Personen".
- For ingredient recipes (see "Recipe Type"): The amount of the product the recipe yields, in base units. Example: "Salatdressing": "60 ml".
- A finished dish's **servings** is one of the fixed counts `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30` (the old integer standard numbers). Example: 6, 10 or 12 people — not 11. The HTML export pre-bakes one view per count.
- An ingredient recipe's **yield** is any positive number in its base unit (e.g. `500 ml`). The export bakes the allowed BQ values within ±1 decade of it; the app opens on the nearest BQ view when the written yield is not a BQ value. See [quantity scaling](quantity_scaling.md) §7.

### Precision (Genauigkeit)

- Precision is a **display preference**, not a scale factor; it never changes a target amount. A higher value prefers exact metric amounts, a lower value practical household/package measures.
- Every ingredient states its precision in the **ingredient master data** — the level is mandatory there. There is **no recipe-level value and no global default**; a recipe's front matter must not contain a precision field.
- A single ingredient row may override the ingredient's value with a trailing tag: `- 250 g Reis {precision: high}`. Use it only for exceptions.
- The five levels are `very low`, `low`, `medium`, `high`, `very high`.
- See [quantity_scaling.md](quantity_scaling.md) §5 for the cascade and the storage format.

### Total Time (optional)

- The time from the start of the first preparation step until serving. Includes passive time such as resting, simmering, or oven time.
- Only specify if it is larger than the preparation time, e.g., if the dish needs to rest or simmer.

### Prep Time (required)

- The amount of time spent actively preparing the dish.
- Assumption: one person is cooking alone.
- The editor offers only standard values (1/3/5/10/15/20/30/45 min, then 1/1.5/2/3/6/12/24/48 h), so hand-typed odd values like "25 min" are replaced over time — the stored value stays free text (see [storage_format.md](storage_format.md) §3).

### Image (optional)

- A single real photo per recipe, either self-taken or from the web. No illustrations, no AI-generated images.
- The photo lives with the recipe in the collection.
- Photos are stored as landscape images (aspect ratio 4:3). On upload, the app center-crops the photo to a 4:3 landscape before saving it — choose a photo that works in a landscape crop.

## Ingredients List

- Every preparation step has its **own ingredient list** — the rows of ingredients
  used in that step, in the order of their use (see "Preparation" and
  [storage_format.md](storage_format.md) §4/§5). The row is the only way an
  ingredient enters the recipe's lists.
- The **master list** of the recipe is *derived* from these per-step lists:
  - it lists the ingredients in the order in which they are first used;
  - an ingredient used in several steps appears **only once**, at the position of
    its first use and with the **total of the displayed BQs** of those uses —
    not the sum of their exact targets. The amounts the cook reads on the rows
    are what add up;
  - the master row's display follows the master-quantity rules (see
    [quantity_scaling.md](quantity_scaling.md) §6): one use repeats the step
    arrangement, several uses keep the exact BQ sum, a shared AU keeps the
    exact AQ sum, and the row takes the highest precision of its uses;
  - it is read-only in the editor, except for the reference role (see below).
- Each ingredient is stored with exactly two parts:
  - name (required),
  - base quantity specification (required): the amount in the family base unit (g or ml — kg/l exist only in display, see [storage_format.md](storage_format.md) §4).
- The base quantity is mandatory for every ingredient, without exception. Ingredients without a meaningful quantity (e.g., salt "to taste") are either given a fixed amount or omitted from the recipe.
- The base quantity is the **unrounded target `V0`**: any positive finite number is allowed (`250`, `400`, `433.33`, `0.5`). There is no ladder of standard numbers anymore.
- The author never types a second unit. All additional quantity specifications (e.g., Becher, EL, Packung, Stück) are computed automatically at display time from the ingredient–unit mappings, the number schemes and the precision (see [additional_quantity_specifications.md](additional_quantity_specifications.md)). The app chooses the best BQ/AQ; per-ingredient priorities do not exist.
- Display examples (new seed):
  - Target: "500 g Joghurt" → displayed as "1 Becher Joghurt (500 g)" (1 Becher = 500 g).
  - Target: "250 g Mehl" → displayed as "250 g Mehl" because the only pack is `Packung (unteilbar)` (integers only) and its ¼ is not allowed; the metric target wins.
  - Target: "1500 ml Wasser" → displayed as "1,5 l Wasser" (no fitting additional unit for water; the base form switches to l at 1000).
  - Target: "15 ml Zitronensaft" → displayed as "5 TL Zitronensaft (15 ml)" with the seed data (the spoons win over the approximate lemon mapping); a different mapping/scheme may show a fraction of a lemon instead.
- Display conventions:
  - The additional quantity specification is shown only if a scheme-allowed AQ candidate and a BQ candidate fit the candidate search window; otherwise the metric base form alone is shown (see [additional_quantity_specifications.md](additional_quantity_specifications.md)).
  - The order, as well as punctuation (e.g., parentheses), is defined by each additional unit's display arrangement.
  - The BQ and AQ are display values chosen by the optimizer; the stored target `V0` is not rewritten. If no candidate fits, the display shows `V0` in the plain base form.
- Ingredients can be recipes in their own right (example: "Béchamelsauce" as an ingredient for "Lasagne").
- Such an ingredient is linked to the sub-recipe by its unique title (see "Title"): **sub-recipe links are implicit** — whenever an ingredient use (a step row, a master-list entry, or an inline artifact in the step text) has the name of an `ingredient_recipe`, it *is* that sub-recipe. There is no separate link field; the editor picks the title like any other ingredient, and the use is displayed as a clickable link wherever it appears.
- The amount is authored in the parent recipe like any other ingredient, as a base quantity. Example: "500 ml Béchamelsauce" as an ingredient of "Lasagne" for "6 Personen".
- Ingredient recipes have no portion or serving-size specification; their "Servings" field states the yield in base units, e.g. "500 ml" (see "Servings").
- The link means:
  - When the parent recipe is scaled, the sub-recipe's required amount scales by the **exact factor** between the requested and written sizes (see [quantity scaling](quantity_scaling.md)). Example: Lasagne scaled from 6 to 9 people (factor 1.5): "500 ml Béchamelsauce" → "750 ml Béchamelsauce". The display optimizer then chooses how to show it.
  - When the sub-recipe's ingredients are needed (e.g., for the shopping list), the app scales the sub-recipe so that its yield matches the amount **cooked** of it. The *required* amount is the exact sum over all parents. The shopping flow asks per sub-recipe how much of it is already made („Vorräte auswählen, Teil 1: Zutaten-Rezepte"), starts that stock on `min(required, reorder point)` and cooks the exact rest (`required − stock`); its ingredients scale by `cook / yield`. A sub-recipe the stock covers completely is not cooked and demands nothing from its own ingredients. Only ingredients that are no sub-recipe reach the list that is bought („Vorräte auswählen, Teil 2: Zutaten") — a sub-recipe is cooked, never bought. Example: "Béchamelsauce" yields 500 ml from 300 ml Milch; Lasagne requiring "500 ml Béchamelsauce" therefore adds "300 ml Milch" to the shopping list. If the parent requires "750 ml Béchamelsauce" (factor 1.5), the milk's target scales to "450 ml" before the display optimizer chooses its form.
  - A sub-recipe's reorder point lives in the ingredient master data like any other ingredient's ([storage_format.md](storage_format.md) §9); renaming the recipe carries that entry along (§6).
  - The sub-recipe is displayed as a link so the reader can view its preparation.
- **Step text quantities are not ingredients.** The prose may contain display-only
  inline artifacts (`{{1500 ml Wasser}}`, `{{100 g}}`) that scale with the number
  of servings and render code-styled; they never count toward the step's or the
  master ingredient list (an author writing "500 g Nudeln" as prose only, without
  a step row, keeps the noodle amount out of the list on purpose — e.g. water that
  is always in stock).
- Recipes may define any number of reference ingredients — 0, 1, or all of them. Example (finished dish): "6 Personen (700 g Nudeln)"; example (ingredient recipe): "500 ml (300 ml Milch)".
- A reference ingredient anchors the recipe's size: for a finished dish, how much of a key ingredient belongs to the specified number of servings; for an ingredient recipe, how much of a key ingredient the stated yield contains. When the recipe is scaled, the reference ingredient's amount moves by the same exact factor and the result is displayed as a sanity check for the user. Example: scaling the finished dish above from 6 to 9 people (factor 1.5) makes the noodle target 1050 g; the display optimizer shows its practical reading (e.g. "1 kg Nudeln").
- The reference role is a property of the **master list** only: it is set by name in the read-only master view (★ toggle, available for both recipe types), never on a step row or artifact (see [storage_format.md](storage_format.md) §4).
- The reference ingredient is a display aid for verification only; the portion size (finished dish) or the yield (ingredient recipe) is authored independently and never derived from the reference ingredient.
- The author chooses the ingredients that best represent the portion size (finished dish) or the yield (ingredient recipe) — e.g., the main starch or protein. If no ingredient represents it well, none is defined.

## Preparation

- List the steps in the correct order.
- The order is specified, even if it doesn’t matter (e.g., because two components are prepared separately).
- Each step consists of **its own ingredient list followed by a prose instruction**:
  - the list holds the step's counted ingredients (editable per step — add, edit,
    reorder or remove rows; quantities are changed there, never in the master
    list);
  - the prose is free text that may reference ingredients by name as plain words
    and may contain display-only inline artifacts for scaled quantities.
- There is no summary; the recipe ends with the last step. However, this step may include serving suggestions.
