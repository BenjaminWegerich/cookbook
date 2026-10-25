# Architecture

> **Status:** v1 foundation and the recipe-management UI (Phase 2) implemented. The web app
> (React + TypeScript on Vite, hosted on GitHub Pages) reads and writes the canonical
> Markdown + YAML files (Google Drive OAuth), and the core logic module provides
> deterministic scaling, the additional-unit display and the recipe format parsing. The
> recipe editor uses the per-step ingredient model: every step has its own counted
> ingredient rows above a free-prose text, and the master ingredient list is derived from
> the rows (the step text may contain display-only inline artifacts for scaled
> quantities, see [storage_format.md](storage_format.md) §4/§5). AI-assisted create/edit runs
> in the browser against Gemini, whose URL context tool reads linked pages; on Android a share
> target feeds a TikTok caption into the same screen through a small Cloudflare Worker
> (`apps/tiktok-extractor/`). The Google Keep
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
- Entry point for the shopping-list transfer, recipe sharing and the Android share target
  (TikTok → Cookbook).

### Core logic module (framework-free TypeScript)

- The quantity optimizer and its master data (see
  [quantity_scaling.md](quantity_scaling.md),
  [recipe_scaling_algorithm.md](../recipe_scaling_algorithm.md)): the allowed
  base quantities live in `docs/BQs.csv`, the allowed additional quantities and
  their number-scheme columns in `docs/AQs.csv`. Both are compiled into
  `packages/core/src/quantityData.ts` via `npm run generate:quantity`
  (`scripts/generate-quantity-data.mjs`). `quantityValues.ts` implements the
  decade rule, membership and formatting; `quantityOptimizer.ts` implements the
  three scoring branches, the scheme gate, the tie-break, the fallback and the
  constrained master-list quantity (`optimizeMasterQuantity`).
  `recipe/masterQuantity.ts` recovers the step uses behind a master row.
  `precision.ts` resolves the quantity/ingredient levels and interpolates the
  weights; `servingSizes.ts` holds the allowed serving counts.
- Additional-unit display logic (see
  [additional_quantity_specifications.md](additional_quantity_specifications.md)):
  `docs/additional_units.csv` (arrangement, scheme, exactness, shopping flag,
  display forms), `docs/ingredients.csv` (base unit, mandatory precision, reorder
  point, display forms) and `docs/ingredient_unit_mappings.csv` (factor only; no
  priority) are compiled into `packages/core/src/additionalUnitsData.ts` via
  `npm run generate:additional` (`scripts/generate-additional-data.mjs`).
- The legacy AQ bridge (`packages/core/src/aqLadder.ts`) still backs the
  nearest-AQ display helpers in `additionalUnits.ts`; the recipe and shopping
  code use the optimizer and BQ/AQ tables directly. The old ladder modules
  (`ladder.ts`, `ladderData.ts`, `standard_numbers.csv`) are no longer imported
  by the app; they remain exported and tested until the cleanup task in
  [ROADMAP.md](ROADMAP.md) removes them.
- Shopping master data (see [storage_format.md](storage_format.md) §10 and
  [shopping_item_identity.md](shopping_item_identity.md)): the three CSV codecs and their
  serializers (`packages/core/src/shoppingRouteCsv.ts`), the runtime registry holding the
  current route, item table and synonym table plus the store/section lists the ingredient
  sheet's pickers are built from (`packages/core/src/shoppingRouteRegistry.ts`), the compiled
  seed (`packages/core/src/shoppingRouteData.ts`, generated from `docs/shopping_route.csv` +
  `docs/shopping_items.csv` + `docs/shopping_synonyms.csv` via
  `npm run generate:shopping-route`), and the read-time resolution of a Keep line to an item
  (`packages/core/src/shoppingSort.ts`: name field, exact item/variant match, suggestions).
- The multi-level sub-recipe plan (`packages/core/src/subRecipePlan.ts`): which Zutaten-Rezepte
  a bundle of dishes reaches (only `ingredient_recipe` titles are links, at any depth), their
  topological order, and per sub-recipe the requirement (the exact sum over all parents), the
  stock prefill `min(requirement, reorder point)`, the exact cooking amount
  `requirement − stock`, and the bottom-level uses of the dishes *and* the cooked
  sub-recipes. Its ingredients scale by `cook / yield`; no ladder rung is involved.
  `resolveSubRecipePlan` adds the invalidation rule: a row whose requirement moved
  away from the acknowledged one loses its stock and marks the rows below it in turn.
- Recipe format parsing and validation
  (see [storage_format.md](storage_format.md)).
- No React, no DOM — a plain TypeScript module, unit-tested with Vitest.
- Consumed by the web app and by the export generator (which pre-computes the display values
  for the share file).

### Recipe storage

- Markdown + YAML files, one per recipe, in the `Rezepte` subfolder of the Drive `Cookbook`
  folder (see [storage_format.md](storage_format.md)).
- Sample recipes live in the repository's `examples/` folder (canonical
  format, validated by the core test suite); they can be copied into the
  `Rezepte` subfolder of the Drive "Cookbook" folder to develop against a populated
  collection.
- Single source of truth, read by the web app, the HTML export, and (later) the backend
  module and the Gemini for Home preparation.
- Ingredient master data lives in two CSV files in the `Stammdaten` subfolder — `zutaten.csv`
  (ingredient list: name + base unit + reorder point + the optional Singular/Plural display
  forms) and `zutaten-umrechnungen.csv` (AU mappings), in the canonical formats of
  docs/ingredients.csv + docs/ingredient_unit_mappings.csv: the app loads both into the core
  ingredient registry at startup, and they are authoritative once they exist — the repo CSVs
  are the built-in seed used on first run. New ingredients are created from the recipe
  editor's quantity sheet or the „Zutaten“ screen („Neue Zutat anlegen“), through the shared
  `MasterDataSheet`: it collects name, base unit, display forms, reorder point, AU mappings,
  precision and the shopping stop/synonyms, appends to both ingredient files and
  creates/updates the item row. The split keeps ingredient-level fields (name, base unit,
  reorder point, display forms) in one row per ingredient, separate from the AU mappings.
- Where an item is bought is a separate master-data set in the same `Stammdaten` subfolder —
  `einkaufsweg.csv` (the route: store + section per row, in walking order),
  `einkaufs-artikel.csv` (the item table: item → store + section — the identity of everything
  buyable and the only place a route is kept) and `einkaufs-synonyme.csv` (the synonym table:
  variant text → item), in the canonical formats of docs/shopping_route.csv +
  docs/shopping_items.csv + docs/shopping_synonyms.csv (see
  [storage_format.md](storage_format.md) §10 and
  [shopping_item_identity.md](shopping_item_identity.md)). The item table's name set is a
  **superset of the ingredient list**, so items that are not recipe ingredients at all
  („Klopapier“, „Seife“, „Blumen“) have their place there too, while `zutaten.csv` keeps the
  ingredient master data without a route. The create sheet („Neue Zutat anlegen“) asks for the
  stop in an „Einkauf“ field while it collects the other master-data fields — the store as
  chips, the section as a searchable list of that store's sections — and writes the item row
  before the ingredient row: a row without an ingredient is valid (the name set is a superset),
  an ingredient without its row is not (it is then simply never bought). The „Einkaufsartikel“
  screen (`apps/web/src/components/ShoppingPlaces.tsx`) creates and edits item rows and their
  synonym lists directly through the same shared sheet; a duplicate item name is rejected
  case-folded.
- **Master-data writes read before they write.** Every append, edit, rename and sort
  assignment first reads the authoritative file content from Drive and only then writes
  the set, so a spreadsheet edit made meanwhile is not overwritten. A save that writes
  both sets reads each set's files before its write; the create path resolves the Cookbook
  folder and lists its subfolders once and shares that snapshot between the two writes, while
  the edit path lets each write resolve its own snapshot (either may create the `Stammdaten`
  folder). Independent file reads and uploads run in parallel, while no write starts before
  every read of its set has finished. The snapshot carries only file
  ids and names — file content is always read fresh. The shared write path for an ingredient
  edit is `apps/web/src/components/ingredientMasterUpdate.tsx`: it writes the ingredient pair
  first, then the item row/synonyms (creating the row when the ingredient has none), rolls the
  ingredient back if the shopping write fails, and captures both previous states for the
  notice's „Rückgängig“.
- Resolving a Keep line to an item happens at read time in core
  (`packages/core/src/shoppingSort.ts`, [shopping_item_identity.md](shopping_item_identity.md)):
  the line's decoration is undone to a name field, that field must equal an item name (or a
  variant) exactly, and an unresolved line is offered similar item names on the sort page —
  confirming one appends a synonym row, the only write that flow performs. No sort run rewrites
  the master data or a Keep text.

### HTML share export

- Self-contained HTML file with the recipe and pre-computed display values for every allowed
  size; no logic and no master data embedded, so no scaling runs at runtime.
  - a finished dish bakes the allowed serving counts (servingSizes.ts);
  - an ingredient recipe bakes the allowed BQ values within ±1 decade of its written yield
    (`packages/core/src/recipe/yieldViews.ts`), the same range the meal plan accepts. The
    written yield itself may be any positive number; only BQ values are baked.
- The theme typeface (weights 400 and 600, latin subset) is embedded as a `data:` WOFF2, so the
  file needs no font fetch or sibling asset (`packages/core/src/recipe/embeddedFonts.ts`, generated
  by `scripts/generate-embedded-fonts.mjs`). A `Noto Serif Display` theme embeds both faces: the
  display serif for the page headings and Noto Serif for the body.
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
- **Sharing one recipe** is the overview's „Mehr“ menu (decided with the user): „Link kopieren“
  puts the recipe's name and the link to its export on the clipboard, and „Teilen“ offers the
  same text to the system's share sheet — the second entry exists only where the browser really
  has one, so neither action has to do the other's job
  (`apps/web/src/share/shareRecipe.ts`). The link is the short one wherever the gateway can make
  it — the same TinyURL route a meal-plan line takes — and the long export URL otherwise; it is
  requested when „Mehr“ opens (`prefetchShortLink`) and read at the tap (`cachedShortLink`),
  because neither action may wait for it: the share sheet needs the tap's activation and the
  clipboard write belongs to the same gesture. The link carries no size, so a shared recipe opens at
  the size it is written in — a shared recipe is not a planned one, and the friend scales the
  cooking view to their own amount; the export is rewritten in place on every save, so a link
  that was sent once stays valid and shows the current recipe. The clipboard copy is confirmed
  by the snackbar, the system's own share sheet is its feedback. Sharing the whole collection is
  still open (ROADMAP).

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
- **Fails closed on what it serves:** only a `*.html` file in the `Exporte` subfolder of the
  folder named `Cookbook` (a file directly in `Cookbook` is still served, for links shared before
  the collection was split into subfolders); a known file id is not enough, and the check never
  descends more than one level. Deployed "execute as me, anyone with the link" — the same trust
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
  app degrades to "Keep features off" when no gateway is reachable (see "Frontend integration"
  below).
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
  the shopping master data (docs/storage_format.md §10, docs/shopping_item_identity.md —
  ignored lines first, then the lines with an item in walking order, then the checked-off
  ones), and the gateway only applies it
  (`KeepClient.sort_shopping_lines`: fresh sort ids above every item, the same non-destructive
  technique and verification as the writes, not `List.sort_items`).

#### Frontend integration (meal plan)

Decided with the user; implemented in `apps/web/src/keep/` and the recipe list.

- **Three captions, no tabs.** The list is one page: the search field on top, then the
  „Einkaufsliste“ heading, then „Essensplan“ (the non-checked Keep entries in Keep's order) and
  below it „Restliche Sammlung“ (the recipes the plan does not use — a planned dish is read
  and changed in the section above, never twice on one screen). The two card sections render
  the same card grid and the one search field filters both at once. The „Einkaufsliste“ heading
  has no body of its own: the caption names the shopping list on its own line, with the
  list's counter („Einkaufsliste (4 Einträge, davon 1 unbekannt)“ — the list's unchecked lines
  and how many of them name no item) in that line and the list's two actions in a row
  beneath it, the bundled write („Einkaufsliste schreiben“) and the aisle sort („sortieren“).
  The card captions carry their counter („Essensplan (5 Einträge, davon 2 unbekannt)“,
  „Restliche Sammlung (8 Rezepte)“) in the editor's field-caption typography; a card section's
  counter disappears as soon as the search field is focused or carries a query, its caption
  stays and the body carries the placeholder sentence, so a section that is empty only because
  of the search still says which section it is. The whole „Einkaufsliste“ heading — caption,
  counter and both actions — disappears the same way, because its actions act on the whole Keep
  list rather than the filtered result. Both actions are soft accent chips (clay text on a light
  clay tint), not filled buttons: they act on the plan and the list, and a filled button would
  compete with the floating action button.
- **Recognition.** An entry is a recipe when its text — without a trailing export link and
  without an optional ` (6 Portionen)`, ` (500 g)` or ` (1,5 l)` suffix — is the exact,
  case-sensitive title of a recipe file, and a stated size fits the recipe: an allowed
  serving count on a finished dish, and one of the baked BQ views in the recipe's own
  family unit on an ingredient recipe. The logic is framework-free and unit-tested
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
  and replaces the entry with „Übernehmen“ — which, answered on the unchanged size, writes
  nothing, closes the overlay and leaves the overview open. Every carry-out action ends the flow back at the
  list: a planned recipe's „Abhaken“ (in its „Umplanen“ overlay) and an unrecognized
  entry's own „Abhaken“ button both check the entry off. The sheet renders the
  *live* plan App derives from the current resolution, so its „Geplant“ value and its travel
  action follow the plan while it is open. „Kochen“ opens the
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
- **Linked Zutaten-Rezepte are cooked, not bought.** The pantry flow is two steps
  (`apps/web/src/components/SubRecipeSelect.tsx`, then `PantrySelect.tsx`; App's `pantrySub`
  and `pantry` screens). Step 1 walks the sub-recipe closure
  (`apps/web/src/keep/shoppingBundle.ts` reads every reachable `ingredient_recipe` file, and
  reports an unreadable one instead of falling back to buying it) and asks per sub-recipe how
  much is already made; step 2 buys only the bottom level, its needs including what the cooked
  sub-recipes consume. Each sub-recipe's reorder point comes from the ingredient master data
  (storage_format.md §9), and a recipe rename carries that row along
  (`apps/web/src/drive/ingredientMasterData.ts`).
- **Adding ingredients is one write, and its undo takes back one instance per line.** The bottom
  level of the pantry flow („Vorräte auswählen — Teil 2: Zutaten“) builds the lines from the meal
  plan's recipes, already rounded up to
  whole shopping units, and `POST /keep/shopping` puts them at the top of „Einkaufsliste“; the
  snackbar's „Rückgängig“ sends those same lines as `remove`. Because the same line may be on the
  list twice, `remove` takes off *one* instance per named text instead of every match — otherwise
  the undo would delete a line the user had put there themselves (decided with the user). The
  gateway places the new lines above every remaining item, syncs once and verifies the counts it
  read before the write; a named line that Keep no longer carries fails the undo instead of
  claiming it is back to before.
- **Sign-in.** Started automatically once the Google login is done, reopenable from the
  „Essensplan“ section; the token is held in memory only, like the AI API key by default (N6),
  and nothing has to be looked up by hand any more. An expired token is renewed silently; only when Google
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

### TikTok extractor (Cloudflare Worker)

- `apps/tiktok-extractor/`: the backend half of the Android share flow. The installed PWA
  registers a `share_target` in its manifest (`/cookbook/?url=…`), so TikTok's share sheet can
  hand a link to Cookbook. The browser cannot fetch `tiktok.com` (CORS) and the AI's URL context
  tool is blocked there, so this Worker fetches the public video page and returns the caption
  from its hydration JSON (`__UNIVERSAL_DATA_FOR_REHYDRATION__` → `webapp.reflow.video.detail`,
  or the older `webapp.video-detail`). oEmbed is not an option: it returns no caption and
  rate-limits.
- Deliberately separate from the keep-gateway: it holds no credential and serves public data,
  while the gateway's whole design is built around holding one narrowly scoped Keep credential.
  Its host allowlist keeps it from becoming an open fetch proxy (SSRF), and CORS is `*` because
  the response gives away nothing a `curl` could not fetch.
- The app maps the share into the AI screen's two fields
  (`apps/web/src/share/incomingShare.ts`): a TikTok caption into „Quelltext“, any other link into
  the description, where the URL context tool reads it. Without `VITE_TIKTOK_EXTRACTOR_URL` the
  flow degrades to „open the AI screen and paste by hand“.

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
- **One narrow job per backend:** the keep-gateway exists to hold the one credential the
  browser must not have; the TikTok extractor holds none and is kept apart from it, so a
  scraping endpoint can never widen that credential's blast radius.
- **One source of truth, derived presentations:** the canonical recipe files are the only
  data; the web app is a live renderer, and the HTML export and the speech preparation are
  generated artifacts.
- **Deterministic scaling:** scaling uses preferred-number tables, not AI — results must be
  reproducible and practical (e.g., 5 tbsp oil for 4 people → 6 tbsp for 5 people, not 6.25).
- **Additional-unit master data:** additional units (e.g., tbsp, pack, piece) are converted
  to g / ml per ingredient; measured values improve accuracy. Each additional unit also defines
  its display arrangement, number scheme and singular/plural display forms; the selection logic
  is specified in [additional_quantity_specifications.md](additional_quantity_specifications.md).
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
  pasted per session and optionally remembered on this device (opt-in since the share target,
  which always starts the app cold), model `gemini-3.8-flash` with the URL context tool (the
  Interactions API is the eventual migration). Google Search grounding is off (paid tier only).
  See the ROADMAP Phase 3 note and `apps/web/src/ai/`.
