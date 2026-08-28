# Architecture

> **Status:** v1 foundation implemented. The web app (React + TypeScript on Vite, hosted on
> GitHub Pages) and the core logic module (deterministic scaling, additional-unit display) exist;
> the Google Drive OAuth connection works. The web app UI and integrations follow in the
> upcoming roadmap tasks.

## Components

### Web app (frontend)

- React + TypeScript, built with Vite, styled with plain CSS (custom typography system).
- Static site, hosted on GitHub Pages.
- Smartphone-only UI (portrait, thumb-reachable); the exported `.html` file is the
  cooking experience.
- Talks to Google Drive directly from the browser (OAuth): reads and writes recipe files,
  regenerates HTML exports in place.
- Entry point for the shopping-list transfer and recipe sharing.

### Core logic module (framework-free TypeScript)

- Quantity-scaling logic on the ladder of standard numbers
  (see [quantity_scaling.md](quantity_scaling.md)); the ladder master data in
  [standard_numbers.csv](standard_numbers.csv) is the single source of truth and
  is compiled into a generated TypeScript module
  (`packages/core/src/ladderData.ts`) via `npm run generate:ladder`
  (packages/core/scripts/generate-ladder.mjs).
- Additional-unit selection and display logic
  (see [additional_quantity_specifications.md](additional_quantity_specifications.md)); the
  master data (number schemes, additional units, ingredient mappings) lives in
  `docs/number_schemes.csv`, `docs/additional_units.csv` and
  `docs/ingredient_unit_mappings.csv`, is validated against the ladder's AQ column and
  compiled into a generated TypeScript module (`packages/core/src/additionalUnitsData.ts`)
  via `npm run generate:additional` (packages/core/scripts/generate-additional-data.mjs).
- Recipe format parsing and validation
  (see [storage_format.md](storage_format.md)).
- No React, no DOM — a plain TypeScript module, unit-tested with Vitest.
- Consumed by the web app and by the export generator (which pre-computes the display values
  for the share file).

### Recipe storage

- Markdown + YAML files, one per recipe, in Google Drive
  (see [storage_format.md](storage_format.md)).
- Sample recipes live in the repository's `examples/` folder (canonical
  format, validated by the core test suite); they can be copied into the
  Drive "Cookbook" folder to develop against a populated collection.
- Single source of truth, read by the web app, the HTML export, and (later) the backend
  module and the Gemini for Home preparation.

### HTML share export

- Self-contained HTML file with the recipe and pre-computed display values for each allowed
  serving option (integer ladder values 1–30); no logic or master data embedded.
- Generated from the core logic and a recipe file.
- Stored in Drive, regenerated automatically on every recipe save (updated in place, so
  shared links stay valid).
- Friends open it in any browser and pick a serving count — no app, no server.

### Backend module (later)

- Synchronizes ingredients to the Google Keep "shopping list" (e.g., via Python `gkeepapi`).
- Isolated behind a clean HTTP boundary; language decided when it is built.
- Applies the intelligent shopping-list filtering (always-in-stock vs. may-be-in-stock).

### Gemini for Home integration (later)

- Speech-optimized preparation of recipe steps for read-aloud on smart speakers and smart
  displays.
- Consumes the AI-optimized recipe files.

### AI agents

- Support entering, capturing, supplementing, and revising recipes.
- Read and write the canonical Markdown + YAML files.

## Design decisions

- **Static architecture:** the app is a static site; the browser reads and writes the recipe
  files in Google Drive directly. Nothing to run or maintain in v1; later server-side pieces
  (Google Keep, Gemini) are added behind a clean HTTP boundary.
- **One source of truth, derived presentations:** the canonical recipe files are the only
  data; the web app is a live renderer, and the HTML export and the speech preparation are
  generated artifacts.
- **Deterministic scaling:** scaling uses preferred-number tables, not AI — results must be
  reproducible and practical (e.g., 5 tbsp oil for 4 people → 6 tbsp for 5 people, not 6.25).
- **Additional-unit master data:** additional units (e.g., tbsp, pack, piece) are converted
  to g / ml per ingredient; measured values improve accuracy. Each additional unit also defines
  its display arrangement and number scheme; the selection logic is specified in
  [additional_quantity_specifications.md](additional_quantity_specifications.md).
- **AI-optimized storage:** recipe files are stored in a format that is easy for AI agents to
  read and edit (Markdown + YAML, see [storage_format.md](storage_format.md)).
- **Framework-free core:** all deterministic logic lives outside the UI framework so it can be
  unit-tested and reused (web app, HTML export, future backend).

## Open questions

- Backend implementation for Google Keep (Python `gkeepapi` is a candidate, not a decision);
  language and hosting decided when it is built.
- Gemini integration details (which API/product for recipe editing vs. read-aloud).
