# Recipe Structure (Identical for All Recipes)

## Recipe Type (required)

- Every recipe has exactly one explicit type, set by the author when creating the recipe. It is never derived automatically.
- **Finished dish:** The recipe produces a dish that is served to people. Example: "Shredded Tofu Wraps".
- **Ingredient recipe:** The recipe produces an ingredient that is used in other recipes. Example: "Salatdressing" (used for salads).
- The type determines how "Servings" is specified and whether reference ingredients are defined (see below).

## Header Information

### Title (required)

- A short, concise description of the dish.
- Also used for the "Essen" list in Google Keep.
- Must be unique within the entire recipe collection.
- The title is the stable identifier of the recipe (e.g., used for linking sub-recipes, see "Ingredients List").
- Example: "Shredded Tofu Wraps".

### Subtitle (optional)

- An extension of the title to further specify the dish.
- Display-only; it does not affect the title's uniqueness or the recipe's identification.
- Example: "Tortilla Wraps mit Shredded Tofu, Pico de Gallo und Joghurt-Dip."

### Description (optional)

- A single paragraph describing the dish and, if applicable, suggesting suitable side dishes or other uses.

### Servings (required)

- For finished-dish recipes (see "Recipe Type"): Number of people the portion serves. Example: "6 Personen".
- For ingredient recipes (see "Recipe Type"): The amount of the product the recipe yields, in base units. Example: "Salatdressing": "60 ml".
- The number of servings (finished dishes) and the yield (ingredient recipes) must be a standard number (a rounded value on the quantity ladder, see [quantity scaling](quantity_scaling.md)). Example: 6, 10 or 12 people — not 11. This restriction is what makes the ladder-based scaling logic work.

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

## Ingredients List

- Every preparation step has its **own ingredient list** — the rows of ingredients
  used in that step, in the order of their use (see "Preparation" and
  [storage_format.md](storage_format.md) §4/§5). The row is the only way an
  ingredient enters the recipe's lists.
- The **master list** of the recipe is *derived* from these per-step lists:
  - it lists the ingredients in the order in which they are first used;
  - an ingredient used in several steps appears **only once**, at the position of
    its first use and with the **total amount** (the sum of the per-step
    quantities, rounded to the nearest standard number — the sum of two standard
    numbers is not necessarily standard);
  - it is read-only in the editor, except for the reference role (see below).
- Each ingredient is stored with exactly two parts:
  - name (required),
  - base quantity specification (required): the amount in the family base unit (g or ml — kg/l exist only in display, see [storage_format.md](storage_format.md) §4).
- The base quantity is mandatory for every ingredient, without exception. Ingredients without a meaningful quantity (e.g., salt "to taste") are either given a fixed amount or omitted from the recipe.
- The base quantity must be a standard number (a rounded value on the quantity ladder, see [quantity scaling](quantity_scaling.md)). The author enters 400 or 500 ml, not 450. This restriction is what makes the ladder-based scaling logic work.
- The author never types a second unit. All additional quantity specifications (e.g., Becher, EL, Packung, Stück) are computed automatically by the app at display time from the additional-unit master data (conversion factors, number schemes, priorities, and arrangements — see [additional_quantity_specifications.md](additional_quantity_specifications.md)).
- Display examples:
  - Stored: "400 g Joghurt" → displayed as "1 Becher Joghurt (400 g)", if the additional-unit master data maps Joghurt to Becher with 1 Becher = 400 g.
  - Stored: "1500 ml Wasser" → displayed as "1,5 l Wasser" (no fitting additional unit for water; the base form switches to l at 1000).
  - Stored: "15 ml Zitronensaft" → displayed as "15 ml Zitronensaft (1/2 Zitrone)", if the additional-unit master data maps Zitronensaft to Zitrone with 1 Zitrone = 30 ml and a number scheme that allows halves.
- Display conventions:
  - The additional quantity specification is shown only if it passes the number-scheme check for that ingredient and quantity; otherwise the base amount alone is shown (see [additional_quantity_specifications.md](additional_quantity_specifications.md)).
  - The order, as well as punctuation (e.g., parentheses), is defined by each additional unit's display arrangement.
- Ingredients can be recipes in their own right (example: "Béchamelsauce" as an ingredient for "Lasagne").
- Such an ingredient is linked to the sub-recipe by its unique title (see "Title"): **sub-recipe links are implicit** — whenever an ingredient use (a step row, a master-list entry, or an inline artifact in the step text) has the name of an `ingredient_recipe`, it *is* that sub-recipe. There is no separate link field; the editor picks the title like any other ingredient, and the use is displayed as a clickable link wherever it appears.
- The amount is authored in the parent recipe like any other ingredient, as a base quantity. Example: "500 ml Béchamelsauce" as an ingredient of "Lasagne" for "6 Personen".
- Ingredient recipes have no portion or serving-size specification; their "Servings" field states the yield in base units, e.g. "500 ml" (see "Servings").
- The link means:
  - When the parent recipe is scaled, the sub-recipe's required amount scales with the same number of ladder steps (see [quantity scaling](quantity_scaling.md)). Example: Lasagne scaled from 6 to 9 people (3 steps) → "800 ml Béchamelsauce".
  - When the sub-recipe's ingredients are needed (e.g., for the shopping list), the app scales the sub-recipe so that its yield matches the amount required by the parent. Example: "Béchamelsauce" yields 500 ml from 300 ml Milch; Lasagne requiring "500 ml Béchamelsauce" therefore adds "300 ml Milch" to the shopping list. If the parent requires "800 ml Béchamelsauce" (3 steps up from 500 ml), the sub-recipe moves up the same 3 steps: "300 ml Milch" becomes "500 ml Milch".
  - The sub-recipe is displayed as a link so the reader can view its preparation.
- **Step text quantities are not ingredients.** The prose may contain display-only
  inline artifacts (`{{1500 ml Wasser}}`, `{{100 g}}`) that scale with the number
  of servings and render code-styled; they never count toward the step's or the
  master ingredient list (an author writing "500 g Nudeln" as prose only, without
  a step row, keeps the noodle amount out of the list on purpose — e.g. water that
  is always in stock).
- For finished-dish recipes, 0 to 2 ingredients are defined as reference ingredients. Example: "6 Personen (700 g Nudeln)."
- A reference ingredient anchors the portion size: it states how much of a key ingredient belongs to the specified number of servings. When the user scales the recipe to a different number of people, the app scales the reference ingredient's amount accordingly and displays the result as a sanity check for the user. Example: scaling the recipe above from 6 to 9 people shows "9 Personen (1000 g Nudeln)".
- The reference role is a property of the **master list** only: it is set by name in the read-only master view (max 2 per `finished_dish`), never on a step row or artifact (see [storage_format.md](storage_format.md) §4).
- The reference ingredient is a display aid for verification only; the step count itself is derived from the serving count (number of people), not from the reference ingredient.
- The author chooses 0, 1, or 2 ingredients that best represent the portion size (e.g., the main starch or protein). If no ingredient represents the portion well, none is defined.

## Preparation

- List the steps in the correct order.
- The order is specified, even if it doesn’t matter (e.g., because two components are prepared separately).
- Each step consists of **its own ingredient list followed by a prose instruction**:
  - the list holds the step's counted ingredients (editable per step — add, edit or
    remove rows; quantities are changed there, never in the master list);
  - the prose is free text that may reference ingredients by name as plain words
    and may contain display-only inline artifacts for scaled quantities.
- There is no summary; the recipe ends with the last step. However, this step may include serving suggestions.
