# Digital Cookbook & Recipe Collection

A personal, digital collection of cooking recipes with AI assistance, intelligent
quantity scaling, multi-unit support, optimization for smartphones, laptops
and smart displays, and integration with Google Keep and Gemini for Home.

> **Status:** v1 foundation in place. The web app (Vite + React + TypeScript) runs on
> GitHub Pages and is connected to Google Drive via OAuth. The quantity optimizer, tolerance
> model, additional-unit display, recipe storage and HTML export are implemented, and the
> shopping list, sub-recipe cooking and pantry/stock use the same exact quantity model.

## Features

### 1. Automatic creation & editing by AI agents

Support for entering, capturing, supplementing, and revising recipes through AI.

- On Android, share a TikTok video into Cookbook: the caption arrives in the AI screen's
  „Quelltext“ field, fetched by a small Cloudflare Worker (`apps/tiktok-extractor/`). Other
  recipe links can be pasted directly — the AI reads those pages itself.

### 2. Ingredient-specific additional units

- Fixed additional units per ingredient (e.g., tbsp, pack, piece) with conversion to g / ml.
- Accuracy improvements through measured values (e.g., how many grams of peel does a lemon have?).
- Automatic selection of the fitting unit in recipes depending on quantity
  (e.g., 250 g yogurt → ½ cup; 500 g yogurt → 1 cup), shown in addition to the
  base unit (g / kg / ml / l). The optimizer scores every compatible unit; there
  are no per-ingredient priorities.

### 3. User-defined quantity scaling and tolerance

- Recipes store the unrounded target amount; scaling uses the exact factor between the
  written and requested size. Nothing is snapped to a ladder rung.
- The deterministic optimizer chooses the displayed BQ/AQ from the allowed tables
  ([BQs.csv](docs/BQs.csv), [AQs.csv](docs/AQs.csv)) and the unit's number scheme.
- A five-chip tolerance setting (0 / 0.25 / 0.5 / 0.75 / 1) balances exact metric amounts
  against practical household/package measures. It never changes the target amount.
- Example: a recipe written for 4 people with 500 g yogurt, scaled to 6 people, has a
  750 g target and may display as `1 ½ Becher (750 g)`; the metric target stays 750 g.

### 4. Layout & design

- Layout optimized for smartphone, laptop, and smart display.
- Custom visual design, especially typography.

### 5. Read-aloud via Gemini for Home

- AI-optimized storage of recipe files.
- Speech-optimized preparation of recipe steps for easy read-aloud on smart speakers and smart displays.

### 6. Smart shopping list in Google Keep

- Automatic transfer of a recipe's ingredients to the shopping list.
- Scaling happens first (quantity for x people) with exact factors. The needs are
  summed exactly and only the buy amount is rounded up to whole shopping units
  (or whole grams/millilitres without one).
- Bundled writing from the home screen's "Einkaufsliste" caption row: the button
  "Einkaufsliste schreiben" beside that caption turns the meal plan into a selection
  view. All dishes selected there are added to the shopping list in one write, so an
  ingredient shared by several recipes is rounded to whole packs once instead of per
  recipe.
  Two recipes that each need 300 g of tofu, bought in 200 g blocks, would add two
  blocks each on their own (four in total); written together they add three. The
  bundling avoids this bullwhip effect — saving clicks is only a side benefit.
- Intelligent filtering: ingredients that are always in stock are excluded automatically;
  ingredients that may be in stock are queried.
- Transfer from the web app to a backend module (e.g., Python `gkeepapi`) that updates
  the "shopping list" in Google Keep directly.

### 7. Sharing recipes with friends

- Share a single recipe from the recipe overview („Mehr“ → „Link kopieren“ / „Teilen“): the
  recipe's name and the link to its HTML export go to the clipboard, or to the system's share
  sheet where the browser has one. The link is shortened through the Keep gateway (TinyURL)
  wherever that is connected and reachable — the same route a meal-plan entry takes — and stays
  the long export URL otherwise; it is fetched while the „Mehr“ menu is open, so neither action
  has to wait. The link always opens the current version, because the export is regenerated on
  every save.
- Sharing the whole collection is still open (see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Getting Started

The setup is decided: a Vite + React + TypeScript web app, a framework-free core
module, Google Drive for the collection, and a small Python gateway for Google Keep.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the components and
[docs/ROADMAP.md](docs/ROADMAP.md) for the open tasks.

## Example recipes

The `examples/` folder contains sample recipes in the canonical file format
(docs/storage_format.md). They are manual test data you can copy into the
`Rezepte` subfolder of the Google Drive "Cookbook" folder — useful while
developing features that act on a populated collection (e.g. the recipe-list
search). Every example is validated by the core module's test suite, so the
folder always stays in a loadable state.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — planned components, dependencies, and design decisions
- [docs/recipe_structure.md](docs/recipe_structure.md) — the recipe's logical model (fields, rules)
- [docs/CODING_CONVENTIONS.md](docs/CODING_CONVENTIONS.md) — binding style guidelines
- [docs/ROADMAP.md](docs/ROADMAP.md) — open tasks and how they relate
- [docs/storage_format.md](docs/storage_format.md) — canonical recipe file format (Markdown + YAML)
- [docs/quantity_scaling.md](docs/quantity_scaling.md) — scaling, the BQ/AQ optimizer, tolerance and yield views
- [docs/additional_quantity_specifications.md](docs/additional_quantity_specifications.md) — how quantities are displayed (base + additional units)
- [recipe_scaling_algorithm.md](recipe_scaling_algorithm.md) — the scoring model behind the optimizer
- [docs/ui_patterns.md](docs/ui_patterns.md) — reusable UI patterns (the snackbar)
