# Roadmap

Open tasks for the cookbook project. Completed tasks are removed from this file.

## How the tasks relate

The foundations (technology stack, recipe storage format) are decided. Scaling logic and
unit tables are core functionality used by the web app. The web-app milestone is split into
three phases: foundations (recipe format handling, Drive storage, HTML export), recipe
management (design, list, editor), and AI-assisted create/edit. The exported HTML file is
the cooking experience (scaling + step navigation); the web app manages recipes. The Google
Keep integration is a follow-up milestone. Sharing builds on the web app and the export.

## Web app — Phase 2: Recipe management (depends on: Phase 1)

- [x] Recipe editor: create and edit all fields, validation feedback per storage_format.md
      §7, save to Drive, rename flow (§6). UI in German.

### Open follow-ups (not urgent)

- [ ] Extend the built-in seed data (`docs/ingredients.csv` +
      `docs/ingredient_unit_mappings.csv`) with more ingredients. New ingredients are added
      through the web app („Neue Zutat anlegen“) and land in the Drive `zutaten.csv` +
      `zutaten-umrechnungen.csv`; the repo CSVs are the seed that initializes those files
      on first use.

## Web app — Phase 3: AI-assisted create/edit (depends on: Phase 2)

- [x] Provider-agnostic AI abstraction — provider decision: Google Gemini, called browser-direct
      via its REST API (no relay); the seam keeps DeepSeek possible later behind a CORS relay.
      Implemented in `apps/web/src/ai/` (types, Gemini adapter, factory, session key store).
- [x] AI key handling: pasted per session, never stored (N6).
- [ ] AI create: natural-language description → draft recipe in the canonical format,
      reviewable and editable before saving.
- [ ] AI edit: fill gaps / correct units, preview + accept or reject (user story A3).

## Google Keep — follow-up milestone (depends on: web app)

- [ ] Backend module (candidate: Python `gkeepapi`) behind a clean HTTP boundary, with its
      own Google auth and secret handling.
- [ ] Add a dish to the meal plan (the "Essen" list in Google Keep).
- [ ] Add the scaled ingredient list of a recipe to the shopping list, including linked
      Zutaten-Rezepte: a sub-recipe is scaled by the ladder-rung difference to its yield
      so its own ingredients join the list (recipe_structure.md "The link means…").
- [ ] Sort the shopping list by category/aisle (needs ingredient category master data).

## Integrations (depends on: web app, storage)

- [ ] Intelligent shopping-list filtering: exclude always-in-stock ingredients, query
      may-be-in-stock ingredients.
- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.

## Sharing (depends on: web app, storage)

- [ ] Share individual recipes or the whole collection with friends (link generation and
      collection export; the single-recipe HTML export itself is built in Phase 1 as the
      cooking view).
