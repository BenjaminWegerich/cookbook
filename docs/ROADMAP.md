# Roadmap

Open tasks for the cookbook project. Completed tasks are removed from this file.

## How the tasks relate

The foundations (technology stack, recipe storage format) are decided. Scaling logic and
unit tables are core functionality used by the web app. The integrations (Google Keep,
Gemini for Home) and sharing build on the web app and the storage format.

## Core functionality (depends on: foundations)

- [ ] Implement the additional-unit master data (conversion factors, priorities, number schemes, display arrangements) and the quantity-specification selection logic (see [docs/additional_quantity_specifications.md](additional_quantity_specifications.md)).
- [ ] Implement the web app UI, optimized for smartphone and smart display, with custom typography.

## Integrations (depends on: web app, storage)

- [ ] Google Keep shopping list: backend module that updates the "shopping list" directly (e.g., Python `gkeepapi`).
- [ ] Intelligent shopping-list filtering: exclude always-in-stock ingredients, query may-be-in-stock ingredients.
- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.
- [ ] AI-agent support for recipe creation and editing.

## Sharing (depends on: web app, storage)

- [ ] Simple sharing of individual recipes or the whole collection with friends.
