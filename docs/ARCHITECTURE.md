# Architecture

> **Status:** Early planning phase. No code exists yet; this document describes the
> planned components and their dependencies. It will be updated as decisions are made.

## Components

### Web app (frontend)

- UI optimized for smartphone and smart display.
- Custom visual design, especially typography.
- Quantity scaling and unit display (base unit + additional unit).
- Entry point for the shopping-list transfer and recipe sharing.

### Recipe storage

- AI-optimized file format for recipes (format not yet decided).
- Single source of truth, read by the web app, the backend module, and the Gemini for Home preparation.

### Backend module

- Synchronizes ingredients to the Google Keep "shopping list" (e.g., via Python `gkeepapi`).
- Receives scaling requests from the web app (quantity for x people) and applies the
  intelligent filtering (always-in-stock vs. may-be-in-stock ingredients).

### Gemini for Home integration

- Speech-optimized preparation of recipe steps for read-aloud on smart speakers and smart displays.
- Consumes the AI-optimized recipe files.

### AI agents

- Support entering, capturing, supplementing, and revising recipes.

## Design decisions

- **Deterministic scaling:** scaling uses preferred-number tables, not AI — results must be
  reproducible and practical (e.g., 5 tbsp oil for 4 people → 6 tbsp for 5 people, not 6.25).
- **Additional-unit master data:** additional units (e.g., tbsp, pack, piece) are converted
  to g / ml per ingredient; measured values improve accuracy. Each additional unit also defines
  its display arrangement and number scheme; the selection logic is specified in
  [additional_quantity_specifications.md](additional_quantity_specifications.md).
- **AI-optimized storage:** recipe files are stored in a format that is easy for AI agents to
  read and edit.

## Open questions

- Technology stack (programming language, frameworks) — undecided.
- Recipe storage format — undecided.
- Backend implementation (Python `gkeepapi` is a candidate, not a decision).
- How sharing with friends should work technically.
