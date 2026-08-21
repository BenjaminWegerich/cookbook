# Digital Cookbook & Recipe Collection

A personal, digital collection of cooking recipes with AI assistance, intelligent
quantity scaling, multi-unit support, optimization for smart displays and
smartphones, and integration with Google Keep and Gemini for Home.

> **Status:** Early planning phase. This repository currently contains the project
> documentation only; the technical setup is still being defined.

## Features

### 1. Automatic creation & editing by AI agents

Support for entering, capturing, supplementing, and revising recipes through AI.

### 2. Ingredient-specific additional units

- Fixed additional units per ingredient (e.g., tbsp, pack, piece) with conversion to g / ml.
- Accuracy improvements through measured values (e.g., how many grams of peel does a lemon have?).
- Automatic selection of the fitting unit in recipes depending on quantity
  (e.g., 50 g yogurt → 2 tbsp; 400 g yogurt → 1 cup), shown in addition to the
  base unit (g / kg / ml / l).

### 3. User-defined quantity scaling

- Scaling logic that rounds mathematically exact values to round numbers or whole packs.
- Deterministically implemented (via preferred-number tables), not AI-based.
- Example: 5 tbsp oil for 4 people → a practical 6 tbsp for 5 people, instead of the mathematical 6.25.

### 4. Layout & design

- Layout optimized for smartphone and smart display.
- Custom visual design, especially typography.

### 5. Read-aloud via Gemini for Home

- AI-optimized storage of recipe files.
- Speech-optimized preparation of recipe steps for easy read-aloud on smart speakers and smart displays.

### 6. Smart shopping list in Google Keep

- Automatic transfer of a recipe's ingredients to the shopping list.
- Scaling happens first (quantity for x people).
- Intelligent filtering: ingredients that are always in stock are excluded automatically;
  ingredients that may be in stock are queried.
- Transfer from the web app to a backend module (e.g., Python `gkeepapi`) that updates
  the "shopping list" in Google Keep directly.

### 7. Sharing recipes with friends

- A simple way to share individual recipes or the whole collection with friends.

## Getting Started

This repository forms the basis of the cookbook project. The concrete technical setup
(programming language, frameworks, interfaces) has not been decided yet — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the planned components and
[docs/ROADMAP.md](docs/ROADMAP.md) for the open tasks.

## Documentation

- [docs/user_stories.md](docs/user_stories.md) — user stories, non-functional requirements, and open questions (basis for the tech-stack decision)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — planned components, dependencies, and design decisions
- [docs/CODING_CONVENTIONS.md](docs/CODING_CONVENTIONS.md) — binding style guidelines
- [docs/ROADMAP.md](docs/ROADMAP.md) — open tasks and how they relate
- [docs/storage_format.md](docs/storage_format.md) — canonical recipe file format (Markdown + YAML)
- [docs/quantity_scaling.md](docs/quantity_scaling.md) — how quantities change when a recipe is scaled (ladder logic)
- [docs/additional_quantity_specifications.md](docs/additional_quantity_specifications.md) — how quantities are displayed (base + additional units)
- [docs/recipe_structure.md](docs/recipe_structure.md) — recipe structure
