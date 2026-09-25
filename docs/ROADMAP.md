# Roadmap

Open tasks for the cookbook project. Completed tasks are removed from this file.

## How the tasks relate

The foundations (technology stack, recipe storage format) are decided. Scaling logic and
unit tables are core functionality used by the web app. The web-app milestone is split into
three phases: foundations (recipe format handling, Drive storage, HTML export), recipe
management (design, list, editor), and AI-assisted create/edit. The exported HTML file is
the cooking experience (scaling + step navigation); the web app manages recipes. The Google
Keep integration is a follow-up milestone. Sharing builds on the web app and the export.

## Web app — Phase 2: Recipe management (depends on: Phase 1)

- [x] Recipe editor: create and edit all fields, validation feedback per storage_format.md
      §7, save to Drive, rename flow (§6). UI in German.

### Open follow-ups (not urgent)

- [ ] Extend the built-in seed data (`docs/ingredients.csv` +
      `docs/ingredient_unit_mappings.csv`) with more ingredients. New ingredients are added
      through the web app („Neue Zutat anlegen“) and land in the Drive `zutaten.csv` +
      `zutaten-umrechnungen.csv`; the repo CSVs are the seed that initializes those files
      on first use.

## Web app — Phase 3: AI-assisted create/edit (depends on: Phase 2)

- [x] Provider-agnostic AI abstraction — provider decision: Google Gemini, called browser-direct
      via its REST API (no relay); the seam keeps DeepSeek possible later behind a CORS relay.
      Implemented in `apps/web/src/ai/` (types, Gemini adapter, factory, session key store).
- [x] AI key handling: pasted per session, never stored (N6).
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
are built (tabs, recognition, the Google sign-in, the overview's three card forms,
„Zum Essensplan hinzufügen“, which links the entry at the recipe's cooking view through the
deployed export host, „Umplanen“ with its size change, and „Vom Plan entfernen“, which ticks
the entry off and can be undone). „Jetzt kochen“ is still a placeholder; the „Eintrag
ersetzen“ menu is built (an unrecognized entry can be replaced by an existing recipe 1:1 with
an undo notice, or turned into a new recipe through the prefilled editor or AI screen, which
return to the entry's overview). What remains is the shopping-list write and the aisle sort.

One non-obvious rule came out of that spike and must not be lost: **the master token has to be
minted from the cloud.** A token minted on the home machine is refused by Google's account-auth
endpoint from Google Cloud's network (`BadAuthentication`), while a token minted *from* Cloud
Run and then used there works immediately. What Google binds is where the token was created,
not where it is used.

- [ ] Confirm durability: the 6-hourly sampler is running, but a first success is not a token
      that survives weeks. Watch the log for `rejected` before treating the setup as settled.
- [x] Add a dish to the meal plan (the "Essensplan" list in Google Keep): the app writes the
      entry with its chosen size and a link to the recipe's HTML export — the size is a query
      parameter on the export host, so the cooking view opens on it — and replaces the entries
      recognized as the same recipe. The line's link is shortened through TinyURL on demand
      (gateway `POST /shorten`, token `TINYURL_API_TOKEN`), so Keep shows
      „Kürbissuppe (6 Portionen): https://tinyurl.com/…“; without a token the long export URL is
      written unchanged.
- [x] Deploy the export host (`apps/export-host/README.md`) and set the repository variable
      `VITE_EXPORT_HOST_URL`. Deployed and verified on 2026-09-24 in Google Keep's in-app browser:
      the cooking view's size picker and step navigation work there, and the promised size opens
      the right view. Before it, the app linked exports through Drive, whose viewer does not run
      the export's script.
- [ ] Add the scaled ingredient list of a recipe to the shopping list ("Einkaufsliste"),
      including linked Zutaten-Rezepte: a sub-recipe is scaled by the ladder-rung difference
      to its yield so its own ingredients join the list (recipe_structure.md "The link means…").
- [ ] Sort the shopping list by category/aisle (needs ingredient category master data),
      applied server-side via `List.sort_items`.

### Next steps, in order

The feasibility work is finished and the gateway is built, deployed and guarded; everything
below is building, not investigating. Step 1 keeps an eye on the foundation; the rest is the
frontend and the actual features.

1. **Confirm durability before building on it.** The gateway is worthless if the token dies
   after a week. Check the sampler's log — `keep-gate2-probe-6h` runs every 6 hours and records
   one JSON line per run. Anything other than `ok` means stop and fix the token path first.
   Verify with:
   `gcloud logging read 'resource.labels.job_name="keep-gate2-probe"' --limit 200 --format='value(textPayload)' --freshness=7d`
2. [x] **Frontend integration with graceful degradation** (N5): the app probes the gateway,
   signs in with Google automatically after the login (memory only, reopenable from the
   „Essensplan“ tab) and keeps working unchanged when the gateway is missing or unreachable.
   The meal-plan view is built and agreed with Ben: „Essensplan“ / „Sammlung“ tabs, recognition
   of meal-plan entries (`packages/core/src/mealPlan.ts`) and the „Eingeplant“ /
   „Unbekannt“ badges. The gateway URL is the build variable
   `VITE_KEEP_GATEWAY_URL` (repository variable for the Pages build).
3. [x] **Meal-plan recipe overview**: a recognized plan card opens the overview with the
   entry's planned size (servings/yield) shown first in its caption/value row, so the dish
   can be viewed, edited and scaled from the plan; an unrecognized entry gets a destination
   of its own there („Eintrag ersetzen“ / „Vom Plan entfernen“). „Einplanen“ performs the
   write, „Umplanen“ changes the size and „Vom Plan entfernen“ ticks the entry off (step 5);
   „Jetzt kochen“ is still a placeholder; the „Eintrag ersetzen“ menu is built:
   `ReplaceRecipeSheet` replaces the entry 1:1 with a chosen recipe and size (undo notice), and
   the two create entries open the editor or the AI screen prefilled with the entry's complete
   text and return to the entry's overview.
4. **Ingredient category master data** — a prerequisite for aisle sorting: each ingredient
   needs a category. Extend `docs/ingredients.csv` (and the Drive `zutaten.csv`) with it.
5. **Implement the Keep actions**: the meal-plan write is done ([x] — „Zum Essensplan
   hinzufügen“ writes the entry with its chosen size and links it at the recipe's HTML export
   (the size is a query parameter on the export host), replacing the entries recognized as the
   same recipe; the gateway changes as little as possible and verifies the result), and so is
   taking a dish off the plan ([x] — „Vom Plan entfernen“ ticks the entry off in Keep via
   `POST /keep/mealplan/check` and can be undone; changing the size reuses the meal-plan write).
   Still open: add a recipe's scaled ingredients to the shopping list (including linked
   Zutaten-Rezepte), and sort by category.
6. **Then** the intelligent filtering from the Integrations section (exclude always-in-stock,
   query may-be-in-stock), which builds on the same gateway.

Two things to carry over rather than rediscover:
- **Writes must be non-destructive.** The spike proved this is achievable — a write/delete
  cycle left the real 135-item list with identical order and sort ids — and the meal-plan
  write already follows the technique (sort ids above every existing item, verify the result).
  The remaining two actions must reuse it rather than reinvent it.
- **`spike/keep-feasibility/` is a spike, not the product.** Its tooling, tests and the
  `mint-in-cloud.py` recovery script are worth keeping; the rest exists to answer questions
  that are now answered. The gateway keeps that authentication and diagnosis logic in
  `apps/keep-gateway/keep_gateway/keep_client.py` rather than importing `keep-spike.py`, so
  the deployed image is self-contained.

## Integrations (depends on: web app, storage)

- [ ] Intelligent shopping-list filtering: exclude always-in-stock ingredients, query
      may-be-in-stock ingredients.
- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.

## Sharing (depends on: web app, storage)

- [ ] Share individual recipes or the whole collection with friends (link generation and
      collection export; the single-recipe HTML export itself is built in Phase 1 as the
      cooking view).
