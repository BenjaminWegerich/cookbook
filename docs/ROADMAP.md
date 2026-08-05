# Roadmap

Open tasks for the cookbook project. Completed tasks are removed from this file.

## How the tasks relate

Decisions on the technology stack and the recipe storage format are prerequisites for almost
everything else (foundation). Scaling logic and unit tables are core functionality used by the
web app. The integrations (Google Keep, Gemini for Home) and sharing build on the web app and
the storage format.

## Foundations (blocks: everything)

- [ ] Decide the technology stack (programming language, frameworks).
- [ ] Define the recipe storage format (AI-optimized for agents and voice preparation).

## Core functionality (depends on: foundations)

- [ ] Implement ingredient-specific unit tables (conversion of additional units to g / ml per ingredient).
- [ ] Implement the deterministic scaling logic using preferred-number tables.
- [ ] Implement the web app UI, optimized for smartphone and smart display, with custom typography.

## Integrations (depends on: web app, storage)

- [ ] Google Keep shopping list: backend module that updates the "shopping list" directly (e.g., Python `gkeepapi`).
- [ ] Intelligent shopping-list filtering: exclude always-in-stock ingredients, query may-be-in-stock ingredients.
- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.
- [ ] AI-agent support for recipe creation and editing.

## Sharing (depends on: web app, storage)

- [ ] Simple sharing of individual recipes or the whole collection with friends.
