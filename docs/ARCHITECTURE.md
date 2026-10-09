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
> integration has started: its gateway (`apps/keep-gateway/`) reads both Keep lists over a
> thin HTTP boundary, and the web app shows the meal plan as the first of the recipe list's two
> captioned sections („Essensplan“ over „Restliche Sammlung“, entry recognition, the
> danger „unbekannt“ symbol that is an unrecognized card's media area) and writes a planned
> dish back, linking it at the recipe's HTML export
> behind the caller's Google sign-in, degrading to "Keep off" when the gateway is unreachable. That export link is served by a
> small Apps Script web app (`apps/export-host/`), because a Drive viewer renders the stored
> file without running its script; without a host the app falls back to Drive links.

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
- Shopping-route master data (see [storage_format.md](storage_format.md) §10): the two CSV
  codecs and their serializers (`packages/core/src/shoppingRouteCsv.ts`), the runtime registry
  holding the current route and item assignment plus the store/section lists the ingredient
  sheet's pickers are built from (`packages/core/src/shoppingRouteRegistry.ts`), and the
  compiled seed (`packages/core/src/shoppingRouteData.ts`, generated from
  `docs/shopping_route.csv` + `docs/shopping_items.csv` via `npm run generate:shopping-route`).
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
  (ingredient list: name + base unit + reorder point) and `zutaten-umrechnungen.csv`
  (AU mappings), in the canonical formats of docs/ingredients.csv +
  docs/ingredient_unit_mappings.csv: the app loads both into the core ingredient registry
  at startup, and they are authoritative once they exist — the repo CSVs are the built-in
  seed used on first run. New ingredients are created from the recipe editor („Neue Zutat
  anlegen“), which collects name, base unit, reorder point and AU mappings, appends to both
  files and re-registers them. The split keeps ingredient-level fields (name, base unit,
  reorder point) in one row per ingredient, separate from the AU mappings.
- Where an item is bought is a third, separate master data pair in the same Drive folder —
  `einkaufsweg.csv` (the route: store + section per row, in walking order) and
  `einkaufs-zuordnung.csv` (item → stop), in the canonical formats of
  docs/shopping_route.csv + docs/shopping_items.csv (see
  [storage_format.md](storage_format.md) §10). Its name set is a **superset of the ingredient
  list**, so items that are not recipe ingredients at all („Klopapier“, „Seife“, „Blumen“)
  have their place there too. The create sheet („Neue Zutat anlegen“) asks for the stop in an
  „Einkauf“ field while it collects the other master-data fields — the store as chips, the
  section as a searchable list of that store's sections — and writes the assignment before the
  ingredient row: a row without an ingredient is valid (the name set is a superset), an
  ingredient without its row is not.

### HTML share export

- Self-contained HTML file with the recipe and pre-computed display values for every allowed
  size; no logic and no master data embedded, so no scaling runs at runtime.
  - a finished dish bakes the integer ladder serving counts 1–30;
  - an ingredient recipe bakes the ladder yields within ±2 decades of its written yield
    (`packages/core/src/recipe/yieldViews.ts`), the same range the meal plan accepts.
- The theme typeface (weights 400 and 600, latin subset) is embedded as a `data:` WOFF2, so the
  file needs no font fetch or sibling asset (`packages/core/src/recipe/embeddedFonts.ts`, generated
  by `scripts/generate-embedded-fonts.mjs`).
- Generated from the core logic and a recipe file, stored in Drive and regenerated automatically
  on every recipe save (updated in place, so shared links stay valid).
- The page opens on the written size or on the size the URL asks for (`?portionen=6`,
  `&menge=500g`); a meal-plan entry links the export with that size, so a planned dish opens at
  exactly the amount it was planned for.
- **Served by the export host, not by Drive.** A Drive viewer renders the stored file without
  running its script and drops the URL fragment, so the size picker and step navigation stay dead
  there (observed in Google Keep's in-app browser). With no host configured the app falls back to
  the Drive link — fine in a desktop browser and in Chrome on Android, unusable inside Keep.
- Friends open it in any browser and pick a size — no app, no server of our own.

### Export host (Apps Script)

- **Built and deployed** as a Google Apps Script web app (`apps/export-host/`). It serves a
  recipe's `<title>.html` from the cookbook owner's Drive as an ordinary page, so the export's
  embedded script runs. Verified on 2026-09-24 in Google Keep's in-app browser — the case it
  exists for: the size picker and the step navigation work there, and the promised size opens the
  right view.
- Request shape: `<web-app-url>?f=<exportFileId>` plus the planned size as a query parameter
  (`&portionen=6`, `&menge=500g` — `packages/core/src/planLink.ts` owns the names).
- The size is delivered two ways: injected as `window.__COOKBOOK_PLAN_SIZE__` (an Apps Script page
  runs in a sandbox iframe that hides the outer URL) and as a `<style>` element that shows only the
  promised view until the script takes over, so the page is right even before it runs.
- **Fails closed on what it serves:** only a `*.html` file whose parent folder is named `Cookbook`;
  a known file id is not enough. Deployed "execute as me, anyone with the link" — the same trust
  level as link-shared Drive files, with nothing to host and no credential in the web app.
- The URL is the build variable `VITE_EXPORT_HOST_URL` (repository variable for the Pages build).
  Apps Script has no bundler, so `Code.gs` repeats the parameter names and the element id — they
  change together with `planLink.ts`.
- Deployment and recovery: [apps/export-host/README.md](../apps/export-host/README.md).

### Keep gateway (backend module)

- **Built and deployed** as `apps/keep-gateway/` (Python, Flask + gunicorn) on Cloud Run in
  `europe-west3`, scale-to-zero. `GET /health` is the liveness probe — deliberately not
  `/healthz`, which Google's frontend answers itself before a `run.app` request reaches the
  container — and `GET /keep/state` reads the meal plan and the shopping list. All four write
  actions are built (the plan write, ticking a dish off, the shopping list, and the aisle sort,
  which reorders the list on the shopping-route master data, storage_format.md §10). A log-based
  alert
  watches for a rejected credential, and a €1 budget guardrail detaches billing if the project
  ever spends it (both in `deploy/cloud-run/`). The boundary fails closed (no gateway token ⇒
  every Keep route refuses) and the browser origin allowlist is explicit. The Keep code lives
  in the component rather than in the spike, so the image is self-contained.
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
- **Endpoint authentication: the user's Google sign-in.** The app signs in with Google Identity
  Services for the identity scopes only (`openid email`), requested with incremental
  authorization switched off (`include_granted_scopes: false`) — Google's default returns every
  scope the user has granted this client, which would put the Drive grant into the token the
  gateway receives. It sends that short-lived token as
  `Authorization: Bearer`, and the gateway has Google confirm it (`oauth2/v3/tokeninfo`):
  audience = the web OAuth client, the address verified and on `KEEP_ALLOWED_EMAILS`. Nothing
  is embedded in the static bundle, and the check is one seam (`_require_google_identity` plus
  `identity.py`), so changing the scheme again touches no Keep code. A token carrying anything
  beyond the identity scopes is refused, so the gateway can never end up holding a Drive
  credential. Rejected: the pasted shared token this replaced (a second secret per session —
  one the browser's password manager kept confusing with the Gemini API key), reusing the Drive
  access token (it would hand the gateway a Drive credential), a service-account key in the
  bundle, Firebase Auth, and IAP in front of Cloud Run (new infrastructure for a single
  household).
- **Credential model: a dedicated throwaway Google account** whose master token the gateway
  holds, with the two notes shared *into* it per note. This bounds the blast radius of a
  leaked token to exactly those two notes, and keeps a suspension of the automating account
  away from the real one. A master token grants full account access, so it is kept out of the
  frontend entirely — a static public bundle cannot keep a secret, and no browser can obtain a
  master token in the first place.
- Sorting is applied server-side, never in the client: the core derives the target order from
  the shopping-route master data (docs/storage_format.md §10 — ignored lines first, then the
  assigned lines in walking order, then the checked-off ones), and the gateway only applies it
  (`KeepClient.sort_shopping_lines`: fresh sort ids above every item, the same non-destructive
  technique and verification as the writes, not `List.sort_items`).

#### Frontend integration (meal plan)

Decided with the user; implemented in `apps/web/src/keep/` and the recipe list.

- **Two captioned sections, no tabs.** The list is one page: the search field on top, then
  „Essensplan“ (the non-checked Keep entries in Keep's order) and below it „Restliche Sammlung“
  (the recipes the plan does not use — a planned dish is read and changed in the section above,
  never twice on one screen). Both render the same card grid and the one search field filters
  both at once. Each caption carries its counter („Essensplan (5 Einträge, davon 2 unbekannt)“,
  „Restliche Sammlung (8 Rezepte)“) in the editor's field-caption typography; the counter
  disappears as soon as the search field is focused or carries a query, the caption stays and the
  body carries the placeholder sentence, so a section that is empty only because of the search
  still says which section it is. The caption row's two actions — „Einkaufsliste schreiben“ and
  „Einkaufsliste sortieren“ — disappear the same way, because both act on the whole list rather
  than the filtered result. „Einkaufsliste schreiben“ sits in the „Essensplan“ caption row as a
  quiet text button: it acts on the plan, and a filled button would compete with the floating
  action button.
- **Recognition.** An entry is a recipe when its text — without a trailing export link and
  without an optional ` (6 Portionen)`, ` (500 g)` or ` (1,5 l)` suffix — is the exact,
  case-sensitive title of a recipe file, and a stated size fits the recipe: an integer ladder
  value 1–30 on a finished dish, a ladder value in the recipe's own family unit on an ingredient
  recipe, and one the recipe's export really bakes. The logic is framework-free and unit-tested
  in `packages/core/src/mealPlan.ts`. Only entries that state a size need a recipe file read, and
  the Drive content cache makes repeated entries free. A trailing parenthetical that is not a
  size stays in the title candidate, so a recipe whose name carries it is still found; for an
  entry that matches no recipe, `splitTitleNote` separates it as a free-text note.
- **Cards.** Recognized entries use the known card format. An unrecognized entry renders with
  the danger „unbekannt“ symbol as its whole media area (no photo, no badge; the glyph is the
  serving cloche of `RoomServiceIcon`, so the state reads as "a dish, not known yet" and not as a
  failure) and
  its title without export link, stated size and free-text note — the shape a known card has —
  and is tappable: the recipe overview is its destination, where the entry can be replaced by
  an existing recipe or by a new one (manual or AI) or dropped from the plan with „Abhaken“.
- **Recipe overview.** A card opens the overview sheet in one of three forms. A recipe that is
  not on the meal plan is unchanged. A planned recipe shows the entry's stated size first in
  its caption/value row („Geplant 6 Portionen“ / „Geplant 1,5 l“) and turns „Einplanen“ into
  „Umplanen“; the hero carries no „Eingeplant“ badge, since the „Geplant“ value and „Umplanen“
  already state the plan, and a planned recipe only ever appears in the „Essensplan“ section
  („Restliche Sammlung“ leaves it out). An unrecognized entry has no hero at all; its
  caption/value row leads with the danger „Unbekannt“ badge and then shows the parts its line
  carries: the parsed title, the free-text note as a line of its own under the
  title (in its written parentheses, in the description's typography), the stated size as the
  „Geplant“ caption/value item exactly like a known planned recipe, and the link's domain
  behind a „Link“ caption right after it, opened in a new tab. It then offers the replace/drop
  destination described above. „Einplanen“ writes the dish to the meal plan;
  „Umplanen“ opens the same overlay in a replan mode that pre-selects the plan's stated size
  and replaces the entry with „Menge ändern“. Every carry-out action ends the flow back at the
  list: a planned recipe's „Abhaken“ (in its „Umplanen“ overlay) and an unrecognized
  entry's own „Abhaken“ button both check the entry off. The sheet renders the
  *live* plan App derives from the current resolution, so its „Geplant“ value and its travel
  action follow the plan while it is open. „Jetzt kochen“ opens the
  recipe's HTML export in a new tab, at the size the plan states when the dish is planned and
  otherwise at the recipe's written default size; a missing export file is reported instead of
  opening a dead link. An unrecognized entry's „Eintrag ersetzen“ menu is built in all three
  entries:
  „Bestehendes Rezept auswählen“ opens a second overlay of the sheet, which searches the
  collection, takes the size in the familiar control and overwrites the one unrecognized entry
  with the chosen recipe in the known format (a 1:1 replacement, undone by the notice's
  „Rückgängig“); „Rezept manuell schreiben“ and „Rezept mit KI schreiben“ open the known create
  sites with the entry's complete Keep text prefilled (as the new recipe's title or the AI's
  first request) and return to the same overview when they close, so a just-created recipe
  whose title matches the entry shows up there in the recognized style.
- **Meal-plan write.** „Zum Essensplan hinzufügen“ sends the complete entry line and the exact
  texts of every line naming the same recipe — checked or not, and whatever size it states
  (`mealPlanEntriesForTitle` next to the parser). The line is built by `mealPlanEntryText` and
  carries the recipe's export link with the chosen size: „Kürbissuppe:
  https://<export-host>/exec?f=<id>&portionen=6“. Keep has no hyperlink-with-text, so the raw URL
  has to stand in the item; the fragment on a Drive fallback link is the same size in the shape
  that page could read. Since the host URL is enormous, the gateway shortens that link on
  request (`POST /shorten`, TinyURL token `TINYURL_API_TOKEN`) and the line becomes
  „Kürbissuppe (6 Portionen): tinyurl.com/…“ — the size moves into the visible label
  because the short link hides it, while the link's *target* still carries the size. The short
  link is written without its `https://`, because Keep links a bare `tinyurl.com/…` too and the
  scheme only lengthens the line; `parseMealPlanText` restores it on read, so the link the app
  reuses stays the shortener's own URL. Links are created on demand per (recipe, size) and
  reused from the plan when it already carries one;
  without a token, or when TinyURL fails, the long URL is written as before. A recipe without an
  export file falls back to the linkless „Kürbissuppe (6 Portionen)“.
  The app owns that rule; the gateway only executes the action. It places the new line above
  every remaining item with the spike's sort-id rule, deletes the replaced entries, syncs once
  and verifies the result before answering the changed list — a write is never reported as
  successful unverified. Success is reported by the shared snackbar with a full undo
  („Rückgängig“ puts the replaced lines back; the gateway accepts one or several added lines
  for exactly that, see [ui_patterns.md](ui_patterns.md)).
- **Removing from the plan is a check, not a delete.** „Abhaken“ ticks the entry's
  Keep lines off (`POST /keep/mealplan/check`) instead of deleting them, so the lines stay
  visible in Keep as cooked; the success snackbar's „Rückgängig“ ticks them back on. The app
  sends the exact texts it recognized as the entry: a recognized recipe's lines by the same
  `mealPlanEntriesForTitle` rule the write uses, an unrecognized entry's one complete line. The
  gateway writes only the `checked` flag, syncs once and verifies the result before answering
  the changed list. Changing the size instead reuses the ordinary write: the new line replaces
  the old ones. Both notices name the entry (a recipe by title, an unrecognized line by its text
  without the export link) and repeat that the shopping list stays untouched.
- **Adding ingredients is one write, and its undo takes back one instance per line.** The pantry
  sheet („Vorräte auswählen“) builds the lines from the meal plan's recipes, already rounded up to
  whole shopping units, and `POST /keep/shopping` puts them at the top of „Einkaufsliste“; the
  snackbar's „Rückgängig“ sends those same lines as `remove`. Because the same line may be on the
  list twice, `remove` takes off *one* instance per named text instead of every match — otherwise
  the undo would delete a line the user had put there themselves (decided with the user). The
  gateway places the new lines above every remaining item, syncs once and verifies the counts it
  read before the write; a named line that Keep no longer carries fails the undo instead of
  claiming it is back to before.
- **Sign-in.** Started automatically once the Google login is done, reopenable from the
  „Essensplan“ section; the token is held in memory only, like the AI API key (N6), and nothing
  has to be looked up by hand any more. An expired token is renewed silently; only when Google
  needs a gesture does the section offer „Keep verbinden“. The gateway URL is the build-time
  variable `VITE_KEEP_GATEWAY_URL`; without it the feature is off. The app asks Google for
  **two** credentials (the Drive token and this identity token) through the same GIS token
  flow, and that flow has exactly **one** popup window per page. Measured on 2026-09-25: a
  second sign-in started in the same tick as the first one's token was closed again with
  `popup_closed` — on either credential, whichever went second. That was the reported „the popup
  opens and closes instantly, then I have to tap ‚Mit Google verbinden‘“ — the Drive sign-in,
  which gates the whole app, was the one losing. The app therefore serialises its flows and
  keeps a minimum distance between them (`POPUP_FLOW_SPACING_MS` in
  `apps/web/src/auth/googleAuth.ts`), and it spends the page's first silent flow on Drive: the
  Keep hook receives the Drive login state (`UseKeepOptions.enabled`) and only then asks for its
  identity token. A silent attempt is never started while the tab is in the background — a
  hidden tab that pops a window up only shows an unexplained flash. What remains inherent:
  `prompt: 'none'` suppresses Google's screens, not GIS's popup window, so a successful silent
  sign-in still shows a brief flash. Two further facts for the runbook: the silent start needs
  exactly **one** Google account signed into the browser (with several, Google answers no silent
  request at all, so every reload costs one tap per credential — signing out of the extra
  accounts brings the silent start back), observed 2026-09-24; and development builds report a
  declined silent request to the browser console
  (`[cookbook] silent Google sign-in for … failed: …`), which is the fastest way to tell a
  browser restriction from a missing grant.

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
- **Reusable UI patterns:** cross-screen patterns are specified once in
  [ui_patterns.md](ui_patterns.md). The transient snackbar (one at a time, 6 s countdown,
  optional action) is rendered once at the app root and is the confirmation layer for finished
  actions.

## Open questions

- Google Keep backend is decided: a Python `gkeepapi` gateway on Cloud Run, using a dedicated
  throwaway account (see the Keep gateway section). The one rule that must not be lost is that
  the master token has to be minted from the cloud — a home-minted token is refused there.
- Gemini Home / read-aloud integration details (product/API chosen when that milestone is built).
- Recipe-editing AI is decided: Google Gemini via browser-direct REST (`generateContent`), key
  pasted per session; see the ROADMAP Phase 3 note and `apps/web/src/ai/`.
