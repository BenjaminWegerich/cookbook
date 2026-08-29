# User Stories

> **Status:** Early planning phase. This document lists the most important user stories,
> non-functional requirements, and decisions (scope, data, sharing, technology stack).
> Stories are written at "decision grade" — precise enough to judge scope and constraints,
> deliberately without UI mockups, data models, or implementation detail. They are
> decomposed into concrete tasks in [ROADMAP.md](ROADMAP.md).

## How to read this document

- Each story follows the template: **As a \<actor\>, I want \<capability\>, so that \<value\>.**
- Every story has a short **Context** (why it exists, what matters), **Acceptance criteria**
  (verifiable bullets), and — where relevant — a **Tech implication** (one line about what
  this means for the technology choice).
- The [Non-functional requirements](#non-functional-requirements) and
  [Decisions](#decisions) sections are as important as the stories themselves:
  they drive the technology decision at least as much as the feature descriptions do.

## Actors

| Actor | Description |
|---|---|
| **Cook** | Primary user (Ben), household members. Uses the app on smartphone, laptop, and smart display in the kitchen. |
| **Friend** | Receives shared recipes. Reads them on their own device without an account or app install. |
| *(AI agents / Gemini)* | Implementation and runtime assistants, not actors of the system. |

## A. Recipe collection & AI assistance

**Goal:** The collection grows quickly and stays accurate, with AI handling the tedious parts.

### A1. Add a recipe
As a cook, I want to add recipes by typing them, pasting them, or asking an AI assistant to
create them from a description, so that my collection grows with little effort.

- **Context:** Recipe data will be in German (per coding conventions). AI support is a
  convenience, not a requirement for the core to work.
- **Acceptance criteria:**
  - A recipe can be created manually, from pasted text, and from a natural-language description via AI.
  - The result is always a valid recipe in the storage format.
  - The user can review and edit the result before it is saved.
- **Tech implication:** The storage format must be easy for AI agents to read and write
  (AI-optimized, see ARCHITECTURE.md).

### A2. Find a recipe
As a cook, I want to search and filter my collection by name, ingredient, or category, so
that I quickly find the recipe I want to cook.

- **Acceptance criteria:**
  - Full-text search over recipe name and ingredients, plus filtering by category.
  - Results appear fast enough for interactive use on a smartphone.

### A3. Revise a recipe
As a cook, I want to revise a recipe manually or with AI help (fill gaps, correct units), so
that my collection stays accurate.

- **Context:** AI may suggest improvements (e.g., missing quantities, unit corrections); the
  user stays in control of every change.
- **Acceptance criteria:**
  - Any recipe field can be edited manually.
  - An AI-assisted revision can be previewed and accepted or rejected.

## B. Cooking (the kitchen moment)

**Goal:** The user can cook from the recipe with minimal screen contact and zero conversion
math. This is the highest-UX-priority group.

### B1. Display quantities in usable units
As a cook, I want quantities shown in the units I have at hand — base unit (g / kg / ml / l)
plus an automatically chosen additional unit (e.g., tbsp, cup, pack) — so that I never do
conversion math.

- **Context:** Selection logic and display rules are already specified in
  [additional_quantity_specifications.md](additional_quantity_specifications.md).
- **Acceptance criteria:**
  - Every ingredient shows base unit and, where applicable, the fitting additional unit.
  - The fitting additional unit is selected by priority and number scheme, deterministically.
- **Tech implication:** This logic must be deterministic and unit-testable, independent of
  the UI framework.

### B2. Scale a recipe to N servings
As a cook, I want to scale a recipe to the number of servings I need, with practically
rounded quantities, so that I cook for the right number of people with measurable amounts.

- **Context:** Scaling uses preferred-number tables, not AI — results must be reproducible.
  Specified in [quantity_scaling.md](quantity_scaling.md).
- **Acceptance criteria:**
  - Scaling to N servings is deterministic and reproducible.
  - Quantities are rounded to practical values (e.g., 5 tbsp oil for 4 people → 6 tbsp for 5 people).
  - The unscaled recipe is never modified; scaling is a view on top of it.
- **Tech implication:** Same as B1 — core logic lives outside the UI and is unit-testable.

### B3. Follow the steps while cooking
As a cook, I want to follow the preparation steps on my phone or smart display, readable at a
glance while cooking, so that I barely need to touch the screen.

- **Context:** This drives the responsive layout and typography requirements.
- **Acceptance criteria:**
  - Recipe steps are readable at arm's length on both smartphone and smart display.
  - Interaction during cooking (e.g., step navigation) requires minimal precision.
- **Tech implication:** Decided — one responsive web app serves both smartphone and smart
  display (see [Decisions](#decisions)).

### B4. Read-aloud via Gemini for Home
As a cook, I want Gemini for Home to read the preparation steps aloud step by step, so that
I can cook hands-free.

- **Context:** Requires speech-optimized preparation of the recipe steps (see ARCHITECTURE.md).
- **Acceptance criteria:**
  - Steps are prepared in a speech-optimized form (no tables, no abbreviations).
  - Works on smart speakers and smart displays.
- **Tech implication:** External dependency on Google (Gemini). Must be isolated so the core
  works without it (see NFR).

## C. Shopping list (Google Keep)

**Goal:** The scaled ingredient list lands in the Google Keep shopping list, realistic and short.

### C1. Transfer to the shopping list
As a cook, I want to send the scaled ingredient list of a recipe to my Google Keep shopping
list, so that I can shop with the list on my phone.

- **Context:** Scaling happens first (quantity for x people), then transfer.
- **Acceptance criteria:**
  - The list in Google Keep reflects the scaled quantities of the selected recipe.
  - Transfer is triggered from the web app.
- **Tech implication:** Requires a backend component talking to Google Keep (e.g., Python
  `gkeepapi`); involves Google authentication and secret handling.

### C2. Intelligent filtering
As a cook, I want always-in-stock ingredients excluded automatically and may-be-in-stock
ingredients queried, so that the shopping list is short and realistic.

- **Acceptance criteria:**
  - Always-in-stock ingredients are excluded without asking.
  - May-be-in-stock ingredients produce a single clear question per ingredient.
  - The user's answers shape the final list.

## D. Sharing

**Goal:** Friends can cook from shared recipes with zero friction.

### D1. Share a recipe or the collection
As a cook, I want to share a single recipe or my whole collection via a simple link, so that
friends can cook from it.

- **Acceptance criteria:**
  - A shareable link can be generated for one recipe or the whole collection.
  - The cook controls what is shared (individual recipe vs. collection).
- **Tech implication:** Sharing is an export step that generates a self-contained HTML file
  into Drive and regenerates it on every save; it needs no reachable server (see
  [Decisions](#decisions)).

### D2. Read a shared recipe
As a friend, I want to read a shared recipe on my phone without an account or app install, so
that I can use it immediately.

- **Acceptance criteria:**
  - The shared recipe opens in a normal mobile browser.
  - No registration or app installation is required.
  - The friend can scale the recipe to their own serving count (integer ladder values 1–30)
    — the shared artifact is a self-contained HTML file with pre-computed display values,
    shared as a Drive link and regenerated on every change (see [Decisions](#decisions)).

## E. Personal use, devices & data ownership

**Goal:** The app feels tailored, the data is available everywhere, and the user owns it.

### E1. Custom design on phone and smart display
As a user, I want custom typography and layout that work on my smartphone, laptop, and smart
display, so that reading recipes is pleasant and clear.

- **Context:** Design is a stated strong interest; the visual design is custom, especially typography.
- **Acceptance criteria:**
  - The design is consistent across smartphone, laptop, and smart display.
  - Typography is custom (not a stock theme).

### E2. Collection on all devices
As a cook, I want my collection available on all my devices without manual copying, so that
phone, laptop, smart display, and backend always agree.

- **Context:** This is the biggest technology driver in this document.
- **Acceptance criteria:**
  - A change made on one device is visible on the others.
  - The cook never copies files or data by hand.
- **Tech implication:** Decided — cloud storage accessed directly by the static web app (see
  [Decisions](#decisions)); the cloud service keeps devices in sync.

### E3. Open, durable recipe storage
As a cook, I want my recipes stored in an open, editable, durable format I own, so that my
collection is never locked into an app or cloud service.

- **Acceptance criteria:**
  - Recipes are stored in a format readable and editable outside the app (plain text based).
  - The user can back up and restore the collection independently of the app.

## Non-functional requirements

| # | Requirement | Why it matters |
|---|---|---|
| N1 | **Scale:** single user / household, not a public multi-user app. | Keeps architecture simple; no user management, roles, or multi-tenant concerns. |
| N2 | **Maintainability:** hobby project on one WSL2 machine, maintained by one person for years. | Prefer boring, stable, well-documented technology over trendy stacks. |
| N3 | **Offline capability:** no strict requirement — internet is normally available. The app should degrade gracefully (e.g., clear error states), but no offline-first engineering is planned. | Decided: see [Decisions](#decisions). |
| N4 | **Testability:** scaling and unit-selection logic must be deterministic and unit-testable, independent of UI/framework. | These are the most complex features; correctness must be provable. |
| N5 | **Isolation of external dependencies:** Gemini (AI, read-aloud) and Google Keep (shopping list) are optional add-ons; the core (view, scale, cook) must work without them. | Third-party services can change or break; the core must survive. |
| N6 | **Secrets:** Google credentials and API keys are never hardcoded; stored centrally (Google Passwords). | Security; follows project conventions. |
| N7 | **Language:** UI in German, documentation in English, recipe data in German. | Consistency per [CODING_CONVENTIONS.md](CODING_CONVENTIONS.md). |

## Decisions

The open questions from the planning phase have been answered; they are now binding
constraints.

1. **Data location & sync — cloud storage.** Recipe files live in a cloud service (e.g.,
   Google Drive); all devices access them there. Data leaves the home; availability anywhere
   is prioritized over local data residency.
2. **Smart display — same responsive web app.** One codebase with a responsive layout serves
   smartphone, laptop, and smart display. No separate frontend.
3. **Friends' capabilities — read + scale without an app.** A friend may read a shared recipe
   and scale it to their own serving count, provided this works in a normal mobile browser
   without registration or app install. If that is not feasible, read-only sharing is
   acceptable.
4. **Offline level — no strict requirement.** Internet is normally available; graceful
   degradation is sufficient. No offline-first engineering is planned.
5. **v1 scope — core cooking experience only.** v1 delivers: finding and manually entering
   recipes (A2, manual part of A1), displaying quantities (B1), scaling (B2), following the
   steps on phone and smart display (B3), and the personal-use requirements (E). Everything
   tied to external services comes later: AI-assisted creation and editing (A1/A3), Gemini
   read-aloud (B4), the Google Keep shopping list (C), and sharing (D). Extensibility is a
   hard constraint — v1 must not block any of these.
6. **Hosting — static web app with direct cloud access.** The app is a static bundle served
   from free static hosting; the browser reads and writes recipe files directly via the
   cloud-storage API. Nothing to run or maintain in v1. Later features (Gemini, Google Keep)
   add a thin server-side piece without a rewrite.
7. **Sharing format — pre-computed HTML export in Drive, regenerated automatically.**
   Sharing works by exporting a recipe as a self-contained HTML file stored in Google Drive.
   The file contains the recipe plus a pre-computed table: for each allowed serving option
   (integer ladder values 1–30, i.e. 18 options) and each ingredient, the final display
   strings — no master data is embedded and no scaling/display logic runs at runtime.
   A small embedded script is permitted for step-by-step navigation (serving picker, step
   forward/back), so the exported file also serves as the cooking view (ROADMAP, Phase 1).
   The app regenerates the export
   automatically whenever the canonical recipe is saved, updating the file in place (same
   Drive file ID), so a shared link always shows the current version and never breaks.
   Friends need no app install; they open the HTML in any browser and pick a serving count.
   No reachable server required.
8. **Canonical recipe format — Markdown + YAML front matter, one file per recipe.** Each
   recipe is a single Markdown file: YAML front matter holds the metadata and the ingredient
   list, the Markdown body holds the preparation steps. The format must support both
   app/AI editing and manual text-editor editing. A schema plus validation on read is part
   of the format definition (see the storage-format spec).
9. **Technology stack — TypeScript + React + Vite, static web app.** Language: TypeScript.
   Frontend framework: React. Build tool: Vite; unit tests: Vitest; styling: plain CSS with
   a custom typography system (no UI framework). Hosting: static site on GitHub Pages.
   Google Drive is accessed directly from the browser via OAuth. The core logic (scaling,
   unit selection, format parsing/validation) lives in a framework-free TypeScript module
   (`src/core/`), unit-tested with Vitest; the export generator uses it to pre-compute the
   share file (no logic embedded). The later Google Keep backend (possibly Python) stays
   isolated behind a clean HTTP boundary.

### Extensibility guardrails

These constraints keep the later features (AI, shopping list, sharing) from being blocked by
the v1 decisions:

1. Scaling and unit-selection logic live in a framework-independent, unit-testable module (N4).
2. Recipes are stored in the AI-editable Markdown + YAML format.
3. The frontend talks to any future backend over a clean HTTP boundary.
4. Secrets never end up in client bundles (N6).
