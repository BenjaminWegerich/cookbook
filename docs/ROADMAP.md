# Roadmap

Open tasks for the cookbook project. Completed tasks are removed from this file.

## How the tasks relate

The foundations (technology stack, recipe storage format) are decided. Scaling logic and
unit tables are core functionality used by the web app. The web-app milestone is split into
three phases: foundations (recipe format handling, Drive storage, HTML export), recipe
management (design, list, editor), and AI-assisted create/edit. The exported HTML file is
the cooking experience (scaling + step navigation); the web app manages recipes. The Google
Keep integration is a follow-up milestone. Sharing builds on the web app and the export.

## Known external blockers

- [ ] **Android keyboard hides on Chromium 154.** Chrome and WebView 154 dismiss the soft
      keyboard when an IME-owned popup takes window focus — Gboard's spell-check suggestions
      and language menu, Samsung Keyboard's clipboard confirmation. It affects every text field
      of the app, is reproducible across Chromium-based browsers and is reported upstream
      ([Chromium 570135727](https://issues.chromium.org/issues/570135727),
      [Chromium 570312518](https://issues.chromium.org/issues/570312518)); the app cannot keep
      the keyboard open. Re-test after a Chrome/WebView update. Samsung Internet and Firefox
      are not affected.

## Web app — Phase 2: Recipe management (depends on: Phase 1)

- [x] Recipe editor: create and edit all fields, validation feedback per storage_format.md
      §7, save to Drive, rename flow (§6). UI in German.

### Open follow-ups (not urgent)

- [ ] Extend the built-in seed data (`docs/ingredients.csv` +
      `docs/ingredient_unit_mappings.csv`) with more ingredients. New ingredients are added
      through the web app („Neue Zutat anlegen“) and land in the Drive `zutaten.csv` +
      `zutaten-umrechnungen.csv`; the repo CSVs are the seed that initializes those files
      on first use.
- [ ] Use the ingredient display forms: `zutaten.csv` now carries `Singular;Plural`
      ([storage_format.md](storage_format.md) §9), but nothing reads them yet. Decide which
      surfaces name an ingredient with a count (e.g. the cooking view's Zutaten list, the
      shopping list) and render the matching form there, falling back to the canonical name
      when the pair is empty.
- [ ] Shopping master data management: a second button next to „Zutaten verwalten" opens the
      shopping route/item table for both ingredient and non-ingredient shopping-list entries
      ([storage_format.md](storage_format.md) §10).

### Design system: follow-ups from the DESIGN.md compliance pass

- [ ] Give the export's symbols the drawing of the size they render at (DESIGN §4.5): the 14px
      „Rezept" link and the 18px bar arrows currently use the 24px drawings; the
      `_20px.xml` drawings belong there. The embedded typefaces' glyph coverage is also
      unverified (no tooling in the repo decodes a WOFF2 `cmap`), and DESIGN.md §6.2 carries a
      heading with no rule under it.

## Web app — Phase 3: AI-assisted create/edit (depends on: Phase 2)

- [x] Provider-agnostic AI abstraction — provider decision: Google Gemini, called browser-direct
      via its REST API (no relay); the seam keeps DeepSeek possible later behind a CORS relay.
      Implemented in `apps/web/src/ai/` (types, Gemini adapter, factory, session key store).
- [x] AI key handling: pasted per session, never stored (N6). Since the Android share target
      (which always starts the app cold): an opt-in „Auf diesem Gerät merken“ and a „Vergessen“
      line under the composer.
- [x] AI create: natural-language description → draft recipe in the canonical format,
      reviewable and editable before saving.
- [x] AI edit: fill gaps / correct units, preview + accept or reject (user story A3).
- [x] AI workflow refinements:
      - [x] More entry fields: servings, „schnell und einfach“ / „günstig“ / „vegan“.
      - [x] Wire the entry fields (Typ, Portionen/Ergiebigkeit, Vorgaben, „KI-Verhalten“)
            into the AI prompt.
      - [x] Choose between asking clarifying questions first vs. drafting directly.
      - [x] Resume the chat after a draft has been created: change requests go to the AI, and a
            drafted Zutaten-Rezept continues the same conversation after it was saved (the dish
            that uses it is prefilled as the next request).
- [x] Model `gemini-3.8-flash` (free tier) with the URL context tool: a link pasted into the AI
      prompt is read server-side, so copied page text is only the fallback — and for pages the
      tool cannot read (TikTok, Instagram) the „Quelltext“ field takes the caption. Google Search
      grounding stays off — not available on the free tier.
- [x] Android share target: TikTok → Teilen → Cookbook opens the AI-create screen with the
      caption in the „Quelltext“ field. The caption comes from `apps/tiktok-extractor/` (a
      Cloudflare Worker; the browser cannot fetch tiktok.com and the URL context tool is blocked
      there). Other shared links land in the description.

## Google Keep — follow-up milestone (depends on: web app)

Backend decided: a Python `gkeepapi` gateway on **Google Cloud Run**, behind a clean HTTP
boundary, holding the master token of a **dedicated throwaway account** that the two notes are
shared into. Design and rationale in [ARCHITECTURE.md](ARCHITECTURE.md) ("Keep gateway").
A feasibility spike in `spike/keep-feasibility/` validated the approach against the live
account: shared-note writes and ordering pass, a cold sync is ~0.7 s, and the write strategy
was proven non-destructive on the real 135-item list.

The gateway is built and deployed (`apps/keep-gateway/`, Cloud Run, `europe-west3`): the HTTP
boundary and the read path are done and verified against the live account, a log-based alert
watches for a rejected credential, and a €1 budget guardrail caps the project's spend. It owns
its copy of the spike's authentication and failure-diagnosis code, so the deployed image stays
self-contained. The read-only frontend, the meal-plan recipe overview and the meal-plan write
are built (the two captioned sections, recognition, the Google sign-in, the overview's three
card forms,
„Zum Essensplan hinzufügen“, which links the entry at the recipe's cooking view through the
deployed export host, „Umplanen“ with its size change (confirmed by „Übernehmen“, which
writes only when the chosen size really differs), and „Abhaken“, which ticks
the entry off and can be undone). „Kochen“ opens the recipe's HTML export in a new tab,
at the size the plan states when the dish is planned — otherwise at the recipe's written default
size; the „Eintrag ersetzen“ menu is built (an unrecognized entry can be replaced by an existing
recipe 1:1 with an undo notice, or turned into a new recipe through the prefilled editor or AI
screen, which return to the entry's overview). The shopping flow is built as well („Einkaufsliste
schreiben“ selects the planned dishes, the cooking step „Vorräte auswählen — Teil 1:
Zutaten-Rezepte“ decides how much of each linked Zutaten-Rezept is made, the stock step „Teil 2:
Zutaten“ sets each bottom-level ingredient's Vorrat, and the difference goes to
„Einkaufsliste“). The aisle sort is built as well („Einkaufsliste sortieren“ assigns unassigned
items a stop or ignores them, then reorders the list).

One non-obvious rule came out of that spike and must not be lost: **the master token has to be
minted from the cloud.** A token minted on the home machine is refused by Google's account-auth
endpoint from Google Cloud's network (`BadAuthentication`), while a token minted *from* Cloud
Run and then used there works immediately. What Google binds is where the token was created,
not where it is used.

- [x] Add a dish to the meal plan (the "Essensplan" list in Google Keep): the app writes the
      entry with its chosen size and a link to the recipe's HTML export — the size is a query
      parameter on the export host, so the cooking view opens on it — and replaces the entries
      recognized as the same recipe. The line's link is shortened through TinyURL on demand
      (gateway `POST /shorten`, token `TINYURL_API_TOKEN`), so Keep shows
      „Kürbissuppe (6 Portionen): tinyurl.com/…“ (the scheme is dropped — Keep links the bare
      host too); without a token the long export URL is written unchanged.
- [x] Deploy the export host (`apps/export-host/README.md`) and set the repository variable
      `VITE_EXPORT_HOST_URL`. Deployed and verified on 2026-09-24 in Google Keep's in-app browser:
      the cooking view's size picker and step navigation work there, and the promised size opens
      the right view. Before it, the app linked exports through Drive, whose viewer does not run
      the export's script.
- [x] Add the scaled ingredient list of the meal plan's recipes to the shopping list
      ("Einkaufsliste"): the dishes are picked per checkbox („Einkaufsliste schreiben“), the
      linked Zutaten-Rezepte are cooked first („Vorräte auswählen — Teil 1: Zutaten-Rezepte“:
      each sub-recipe's stock prefills with `min(required, reorder point)`, the rest is cooked,
      snapped to the nearest ladder rung), then the stock step („Teil 2: Zutaten“) prefills each
      bottom-level ingredient's stock with `min(need, reorder point)`, and the difference is
      rounded up to whole shopping units and written with `POST /keep/shopping`
      (undo via „Rückgängig“).
- [x] Sort the shopping list by category/aisle (built on the shopping-route master data,
      storage_format.md §10): „Einkaufsliste sortieren“ lists the unchecked entries without an
      Einkaufsort, each of which is assigned a store + section (like „Neue Zutat anlegen“) or
      ignored (placed at the top); the gateway applies the derived order and verifies it.
- [x] Give the shopping list an item identity of its own (design in
      [shopping_item_identity.md](shopping_item_identity.md)): the assignment file
      is replaced by `einkaufs-artikel.csv` (`Item;Store;Section` — the identity of
      everything buyable and the only place a route is kept) plus
      `einkaufs-synonyme.csv` (`Variant;Item` — „Möhren“ → „Karotten“); `zutaten.csv`
      keeps the ingredient master data without a route. Matching moved to read time:
      normalize, undo the app's own line shape — its unit vocabulary derived from
      the additional units flagged `Shopping Unit` plus the formatter's base-unit
      tokens, never a hand-kept copy — then require the name field to be *exactly*
      an item name (or a variant, compared case-folded), so „Muffins mit Blaubeeren“
      stays unresolved instead of sorting as „Blaubeeren“. A line with no hit is
      offered similar item names (simple containment on the item names, no fuzzy
      engine); confirming one appends a synonym row, and the sort page's „Artikel“
      field is editable for the new-item path — the two kinds of decision are
      mutually exclusive, and the page does not display the silent resolution.
      Migration reads `einkaufs-zuordnung.csv` once, writes
      `einkaufs-artikel.csv` + the empty `einkaufs-synonyme.csv`, then deletes the
      old file. Out of scope: an automatic similarity ("fuzzy") merge, and any
      normalization written back into the tables.
- [ ] Refine when a unit shows its singular and when its plural form. The rule implemented
      with the unit display forms is the coarse „count above one → plural“
      (`auDisplayName` in `packages/core/src/additionalUnits.ts`), so `0` reads „0 Packung“,
      a fraction below one stays singular („½ Packung“) and a mixed number above one is plural
      („1 ½ Packungen“). Decide the rule with Ben against German number agreement: whether `0`
      takes the plural („0 Packungen“), whether a decimal count does, and whether the choice
      keys on the numeric value or on the rendered count text. Align it with the ingredient
      display-forms task above, which carries the same question for `<INF>` („1 Stück
      Karotte“ vs. „1 Stück Karotten“), then update §3.2 of
      additional_quantity_specifications.md and the tests.

### Next steps, in order

The feasibility work is finished and the gateway is built, deployed and guarded; everything
below is building, not investigating: the frontend and the actual features.

1. [x] **Frontend integration with graceful degradation** (N5): the app probes the gateway,
   signs in with Google automatically after the login (memory only, reopenable from the
   „Essensplan“ section) and keeps working unchanged when the gateway is missing or unreachable.
   The meal-plan view is built and agreed with Ben: the „Essensplan“ section above „Restliche
   Sammlung“, recognition of meal-plan entries (`packages/core/src/mealPlan.ts`) and the
   „Unbekannt“ badge. The gateway URL is the build variable
   `VITE_KEEP_GATEWAY_URL` (repository variable for the Pages build).
2. [x] **Meal-plan recipe overview**: a recognized plan card opens the overview with the
   entry's planned size (servings/yield) shown first in its caption/value row, so the dish
   can be viewed, edited and scaled from the plan; an unrecognized entry gets a destination
   of its own there („Eintrag ersetzen“ / „Abhaken“). „Einplanen“ performs the
   write, „Umplanen“ changes the size with „Übernehmen“ and „Abhaken“ ticks the entry off (step 4);
   „Kochen“ opens the recipe's HTML export in a new tab, at the size the plan states when
   the dish is planned and otherwise at the recipe's written default size; the „Eintrag
   ersetzen“ menu is built:
   `ReplaceRecipeSheet` replaces the entry 1:1 with a chosen recipe and size (undo notice), and
   the two create entries open the editor or the AI screen prefilled with the entry's complete
   text and return to the entry's overview.
3. **Shopping master data** — the prerequisite for aisle sorting: the route file
   (`einkaufsweg.csv`, `Store;Section`, walking order), the item table
   (`einkaufs-artikel.csv`, `Item;Store;Section`, covering ingredients and
   non-ingredients) and the synonym table (`einkaufs-synonyme.csv`,
   `Variant;Item`). Format in [storage_format.md](storage_format.md) §10, identity
   model in [shopping_item_identity.md](shopping_item_identity.md). The data is
   built and editable: the seed CSVs, the codecs and serializers in
   `packages/core/src/shoppingRouteCsv.ts`, the runtime registry
   (`shoppingRouteRegistry.ts`), the read-time resolution
   (`packages/core/src/shoppingSort.ts`) and the Drive set
   (`apps/web/src/drive/shoppingRouteMasterData.ts`, including the migration from
   `einkaufs-zuordnung.csv`); the create sheet asks for the stop in the „Einkauf“
   field (store chips + section search). The aisle sort and its entry point for
   items that are not ingredients are built on this data (see the `[x]` sort task
   above and the `[x]` item-identity task).
4. **Implement the Keep actions**: the meal-plan write is done ([x] — „Zum Essensplan
   hinzufügen“ writes the entry with its chosen size and links it at the recipe's HTML export
   (the size is a query parameter on the export host), replacing the entries recognized as the
   same recipe; the gateway changes as little as possible and verifies the result), and so is
   taking a dish off the plan ([x] — „Abhaken“ ticks the entry off in Keep via
   `POST /keep/mealplan/check` and can be undone; changing the size reuses the meal-plan write),
   and so is the shopping list ([x] — „Einkaufsliste schreiben“ writes the chosen recipes'
   ingredients via `POST /keep/shopping`, with the pantry flow and an undo; the linked
   Zutaten-Rezepte are cooked in „Teil 1“, so „Teil 2“ buys only the bottom level).

Two things to carry over rather than rediscover:
- **Writes must be non-destructive.** The spike proved this is achievable — a write/delete
  cycle left the real 135-item list with identical order and sort ids — and both list writes
  already follow the technique (sort ids above every existing item, verify the result). The
  aisle sort reuses it rather than reinventing it.
- **`spike/keep-feasibility/` is a spike, not the product.** Its tooling, tests and the
  `mint-in-cloud.py` recovery script are worth keeping; the rest exists to answer questions
  that are now answered. The gateway keeps that authentication and diagnosis logic in
  `apps/keep-gateway/keep_gateway/keep_client.py` rather than importing `keep-spike.py`, so
  the deployed image is self-contained.

## Integrations (depends on: web app, storage)

- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.

## Drive access (depends on: web app, storage)

- [ ] **Folder-scoped Drive credential via a gateway.** The web app calls the Drive API with
      the signed-in account's `drive` token. The code only touches the Cookbook folder, but
      the grant covers that account's whole Drive — the price for seeing recipes the app did
      not create itself (imported files, a shared collection folder). Replace it with a small
      HTTP service in the shape of the Keep gateway (Cloud Run, identity token + allowlist,
      secret held server-side): it acts as a service account (or a throwaway account) on the
      Cookbook folder shared with it and exposes list, read, write, rename, delete, photo
      upload/download and HTML export. The browser would then hold no Drive token, a leaked
      credential would reach exactly the shared folder, and two personal accounts could share
      one collection without either granting full Drive access.
      Prerequisite for [Sharing](#sharing-depends-on-web-app-storage).

## Sharing (depends on: web app, storage)

- [x] Share an individual recipe: the recipe overview's „Mehr“ menu leads with „Link kopieren“
      and „Teilen“ — the clipboard copy in every browser, the system's share sheet only where the
      browser has one (`apps/web/src/share/shareRecipe.ts`). Both send the recipe's name and its
      export link without a size (the recipe's written amount, which the friend scales in the
      cooking view), and the export is rewritten in place on every save, so a shared link stays
      valid and current. The link is shortened through the gateway like a meal-plan entry —
      requested when „Mehr“ opens so the tap never waits — and stays the long export URL where
      the shortener cannot answer (Keep not connected, shortening off, gateway unreachable).
- [ ] Share the whole collection with friends (link generation and collection export; the
      single-recipe HTML export itself is built in Phase 1 as the cooking view).
