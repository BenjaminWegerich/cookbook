# Architecture

> **Status:** v1 foundation and the recipe-management UI (Phase 2) implemented. The web app
> (React + TypeScript on Vite, hosted on GitHub Pages) reads and writes the canonical
> Markdown + YAML files (Google Drive OAuth), and the core logic module provides
> deterministic scaling, the additional-unit display and the recipe format parsing. The
> recipe editor uses the per-step ingredient model: every step has its own counted
> ingredient rows above a free-prose text, and the master ingredient list is derived from
> the rows (the step text may contain display-only inline artifacts for scaled
> quantities, see [storage_format.md](storage_format.md) §4/§5). AI-assisted create/edit,
> Gemini and sharing integrations follow in the upcoming roadmap tasks. The Google Keep
> integration has started: its gateway skeleton (`apps/keep-gateway/`) reads both Keep
> lists over a thin HTTP boundary.

## Components

### Web app (frontend)

- React + TypeScript, built with Vite, styled with plain CSS (custom typography system).
- Static site, hosted on GitHub Pages.
- Responsive UI targeting smartphones (portrait, thumb-reachable) and
  laptops/desktops — one layout that scales from phone to desktop widths; the
  exported `.html` file is the cooking experience.
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
  master data (number schemes, additional units, ingredient list, ingredient mappings) lives in
  `docs/number_schemes.csv`, `docs/additional_units.csv`, `docs/ingredients.csv` and
  `docs/ingredient_unit_mappings.csv`, is validated against the ladder's AQ column and
  compiled into a generated TypeScript module (`packages/core/src/additionalUnitsData.ts`)
  via `npm run generate:additional` (packages/core/scripts/generate-additional-data.mjs).
- The AQ ladder (the standard numbers for additional quantities and for unitless
  inline counts, the distinct fractions 1/10 … 1000) in
  `packages/core/src/aqLadder.ts`, derived from the generated ladder data. It
  backs the §6.1 rounding, the fraction typography and the scaling of unitless
  counts.
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
- Ingredient master data lives in two CSV files in the same Drive folder — `zutaten.csv`
  (ingredient list: name + base unit) and `zutaten-umrechnungen.csv` (AU mappings), in the
  canonical formats of docs/ingredients.csv + docs/ingredient_unit_mappings.csv: the app
  loads both into the core ingredient registry at startup, and they are authoritative once
  they exist — the repo CSVs are the built-in seed used on first run. New ingredients are
  created from the recipe editor („Neue Zutat anlegen“), which appends to both files and
  re-registers them. The split keeps ingredient-level fields (name, base unit, later e.g.
  category) in one row per ingredient, separate from the AU mappings.

### HTML share export

- Self-contained HTML file with the recipe and pre-computed display values for each allowed
  serving option (integer ladder values 1–30); no logic or master data embedded.
- Generated from the core logic and a recipe file.
- Stored in Drive, regenerated automatically on every recipe save (updated in place, so
  shared links stay valid).
- Friends open it in any browser and pick a serving count — no app, no server.

### Keep gateway (backend module)

- **Built as a skeleton in `apps/keep-gateway/`** (Python, Flask + gunicorn):
  `GET /keep/state` reads the meal plan and the shopping list; the three write actions are
  defined but answer `501` until their prerequisites exist. The service is not deployed
  yet. The boundary fails closed (no gateway token ⇒ every Keep route refuses) and the
  browser origin allowlist is explicit. The Keep code lives in the component rather than in
  the spike, so the image is self-contained.
- Synchronizes the meal plan and the shopping list with Google Keep, and applies the
  intelligent shopping-list filtering (always-in-stock vs. may-be-in-stock).
- **Language: Python**, using [`gkeepapi`](https://github.com/kiwiz/gkeepapi). For a personal
  Google account this is the only route: the official Keep API is Workspace-only and has no
  `update` method at all, so it cannot edit a list even in principle.
- **Hosting: Google Cloud Run**, scale-to-zero (`min-instances 0`), in its own Google Cloud
  project. Cost and latency both measured well — a cold sync is ~0.7 s, so scale-to-zero is
  invisible, and the free tier covers this workload by orders of magnitude.
- **The master token must be minted from the cloud, not from the home machine.** This is the
  one non-obvious rule and it is load-bearing: Google refuses to exchange a *home-minted*
  master token for an OAuth token from its datacenter network (`BadAuthentication`), but
  accepts a token that was itself minted from that network. See "Why the token must be minted
  in the cloud" below. `spike/keep-feasibility/mint-in-cloud.py` performs that exchange.
- **No state cache.** Resuming `gkeepapi` from cached state saved ~0.14 s over a cold sync, so
  the cache and the storage behind it are not worth having; a cold sync of the live collection
  (135 shopping + 248 meal-plan items) takes under a second anyway, and dropping the cache
  removes the ephemeral-filesystem problem entirely.
- Isolated behind a clean HTTP boundary, with its own Google auth and secret handling. The web
  app degrades to "Keep features off" when no gateway is reachable (N5 in
  [user_stories.md](user_stories.md)).
- **Endpoint authentication: a pasted gateway token.** The app asks for a shared token when
  the user turns Keep features on, keeps it in memory only (the same pattern as the AI API
  key, N6) and sends it as `Authorization: Bearer`; the gateway compares it in constant time
  against `KEEP_GATEWAY_TOKEN`. Nothing is embedded in the static bundle, and the check is
  one function, so a later move to a real sign-in touches no Keep code. Rejected for now:
  reusing the Drive access token (it would hand the gateway a Drive credential), a
  service-account key in the bundle, Firebase Auth, and IAP in front of Cloud Run (new
  infrastructure for a single household).
- **Credential model: a dedicated throwaway Google account** whose master token the gateway
  holds, with the two notes shared *into* it per note. This bounds the blast radius of a
  leaked token to exactly those two notes, and keeps a suspension of the automating account
  away from the real one. A master token grants full account access, so it is kept out of the
  frontend entirely — a static public bundle cannot keep a secret, and no browser can obtain a
  master token in the first place.
- Sorting is applied server-side (`List.sort_items`) from the ingredient category master
  data, never in the client.

#### Why the token must be minted in the cloud

Measured in `spike/keep-feasibility/` (see its `findings.md`), and worth recording because the
failure is confusing in the opposite direction from the usual one:

- **A home-minted token is refused from the cloud.** The same account, token and device id that
  authenticated from home were rejected as `BadAuthentication` from three Google Cloud addresses
  across two regions. The refusal happens at Google's account-auth endpoint, before any Keep
  request, so no scope, retry or Keep-side setting can work around it.
- **A cloud-minted token is accepted from the cloud.** Running the `oauth_token` →
  master-token exchange *from a Cloud Run job*, then authenticating with the result from the
  same job, returned `outcome: ok` immediately.

So what Google binds is **where the token was created**, not where it is used. Two consequences
belong in the runbook rather than in a footnote: setup and **every re-mint have to run in the
cloud**, and the `oauth_token` cookie they need is a short-lived, full-access session
credential — used once, written to a dedicated secret, and deleted immediately afterwards.

#### Why not an always-free VM

The VM tiers were rejected on their own merits before authentication was ever tested:

- **GCE `e2-micro`** — the free tier covers the instance and a 30 GB disk, but an external IPv4
  address is free for only one hour per month and then costs $0.005/h, i.e. ~$3.65 per month.
  Omitting the address is no escape: without it the VM has no outbound internet, so a tunnel
  needs Cloud NAT, whose address is charged at the same rate.
- **Oracle Always Free** — genuinely free and available in a European region, but Oracle may
  reclaim compute instances that stay below 20% CPU, network and memory over a 7-day window.
  A service answering a few requests a day meets every one of those criteria, and the policy
  has no carve-out for Pay-as-You-Go tenancies.

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
- **Client-side read-through cache:** the web app keeps the recipes and photos it has read in
  memory for the page session, keyed by Drive file id, and de-duplicates concurrent reads. The
  recipe overview therefore warms the editor, and reopening a recipe costs no Drive round-trips.
  Every write through the storage layer refreshes or drops the affected entries. The cache is
  limited to the session: a page reload starts clean, and changes made outside the app are
  picked up on the next load.

## Open questions

- Google Keep backend is decided: a Python `gkeepapi` gateway on Cloud Run, using a dedicated
  throwaway account (see the Keep gateway section). The one rule that must not be lost is that
  the master token has to be minted from the cloud — a home-minted token is refused there.
- Gemini Home / read-aloud integration details (product/API chosen when that milestone is built).
- Recipe-editing AI is decided: Google Gemini via browser-direct REST (`generateContent`), key
  pasted per session; see the ROADMAP Phase 3 note and `apps/web/src/ai/`.
