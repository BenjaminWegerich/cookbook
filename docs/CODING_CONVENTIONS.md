# Coding Conventions for Cookbook

## Language

- **Write code in English.** This includes, but is not limited to variables, classes, files, comments.
- **Write documentation in English.** This includes comments, the `README.md`, as well as all files in docs/.
- **Write the UI in German.** An English version of the UI is not necessary, neither are other languages.
- **Actual recipe data will be in German.** This includes the recipes as well as ingredient units and other user-entered data.
- **Write Git commits in English.**

## Coding Conventions

- **Programming Languages:** TypeScript for the web app and the core logic module. The future
  Google Keep backend may use Python (isolated, see [ARCHITECTURE.md](ARCHITECTURE.md)).
  Recipe content is German data.
- **Naming Conventions and Casing:** camelCase for variables and functions, PascalCase for
  React components and types, kebab-case for file names, UPPER_SNAKE_CASE for constants.
- **Quantity-domain abbreviations:** identifiers for the quantity-domain terms use the
  abbreviations defined in [additional_quantity_specifications.md](additional_quantity_specifications.md)
  §2 — `aq` (additional quantity), `au` (additional unit), `bq` (base quantity), `bu` (base
  unit) — consistently in function names, parameters, and properties (e.g. `roundToAQ`,
  `selectAQ`, `renderAQS`). Entity/type names and master-data collections keep descriptive
  forms (`AdditionalUnit`, `INGREDIENT_MAPPINGS`). The full terms are used in prose and docs.
- **Indentation and Brace Placement:** 2 spaces, no tabs; braces on the same line (1TBS),
  matching Prettier defaults.
- **Git Activities**: *Document branch conventions here when decided.* Use conventional commits.

## Design Conventions

- **Smartphone + laptop/desktop:** the web app targets smartphones (portrait, thumb-reachable)
  and laptops/desktops with the same responsive layout — no separate desktop design. There
  is no smart display layout for the app; the cooking experience lives in the exported
  `.html` file, not the web app.
- **Pixel ladder:** every pixel value (spacing, radius, font size, icon/thumbnail size,
  shadow offset) must come from the preferred-number ladder
  `1 / 2 / 3 / 4 / 6 / 8 / 10 / 14 / 18 / 24 / 32 / 42 / 56 / 74 / 100`. No other pixel
  value may be introduced without revisiting this scale. The only structural exception is
  `100%` radii (circles, e.g. the floating action button).
- **Single source of truth:** design tokens live in `apps/web/src/styles/tokens.css` as CSS
  custom properties; components reference the tokens, never raw values.
- **Warm palette:** warm, appetizing colors ("kitchen / durable surfaces"); no cold or blue
  hues. Primary text is espresso ink, accents are clay/terracotta and olive.
- **Typography:** readability first; body text is `18px` (the ladder has no `16px`). One
  self-hosted typeface, Source Sans 3 (variable), bundled at build time via `@fontsource` —
  no runtime font fetch and no server.
