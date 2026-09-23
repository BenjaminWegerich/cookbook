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
- [ ] AI edit: fill gaps / correct units, preview + accept or reject (user story A3).
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

One non-obvious rule came out of that spike and must not be lost: **the master token has to be
minted from the cloud.** A token minted on the home machine is refused by Google's account-auth
endpoint from Google Cloud's network (`BadAuthentication`), while a token minted *from* Cloud
Run and then used there works immediately. What Google binds is where the token was created,
not where it is used.

- [ ] Keep gateway: HTTP boundary on Cloud Run, graceful degradation to "Keep features off"
      when unreachable. No state cache (a cold sync is ~0.7 s).
- [ ] Token minting: fold `spike/keep-feasibility/mint-in-cloud.py` into the gateway's setup
      and recovery path. The `oauth_token` cookie it needs is a short-lived, full-access session
      credential — used once, held in a dedicated secret, deleted immediately afterwards.
- [ ] Token handling: storage outside the repository, an alert on authentication failure, and a
      documented re-auth runbook. A re-mint needs a browser cookie *and* a cloud-side exchange,
      so the runbook is the difference between a recoverable outage and a lost integration.
- [ ] Confirm durability: the 6-hourly sampler is running, but a first success is not a token
      that survives weeks. Watch the log for `rejected` before treating the setup as settled.
- [ ] Add a dish to the meal plan (the "Essensplan" list in Google Keep).
- [ ] Add the scaled ingredient list of a recipe to the shopping list ("Einkaufsliste"),
      including linked Zutaten-Rezepte: a sub-recipe is scaled by the ladder-rung difference
      to its yield so its own ingredients join the list (recipe_structure.md "The link means…").
- [ ] Sort the shopping list by category/aisle (needs ingredient category master data),
      applied server-side via `List.sort_items`.

### Next steps, in order

The feasibility work is finished; everything below is building, not investigating. Steps 1-3
are the gateway's skeleton and can be done in one pass; 4-6 are what make it safe to leave
running; 7-9 are the actual features.

1. **Confirm durability before building on it.** The gateway is worthless if the token dies
   after a week. Check the sampler's log — `keep-gate2-probe-6h` runs every 6 hours and records
   one JSON line per run. Anything other than `ok` means stop and fix the token path first.
   Verify with:
   `gcloud logging read 'resource.labels.job_name="keep-gate2-probe"' --limit 200 --format='value(textPayload)' --freshness=7d`
2. **Build the gateway service itself** (new component, e.g. `apps/keep-gateway/`, Python):
   a small HTTP service over `gkeepapi`, reusing the spike's modules rather than duplicating
   them (`keep-spike.py` already owns authentication and the failure diagnosis). Runs as a
   Cloud Run *service* (not a job), `min-instances 0`, no state cache.
3. **Define the HTTP boundary** and keep it thin — one endpoint per user action, so the
   frontend never learns Keep's shape:
   - `GET  /keep/state` — the meal plan and shopping list, for app start
   - `POST /keep/mealplan` — add a dish to "Essensplan"
   - `POST /keep/shopping` — add a recipe's scaled ingredients to "Einkaufsliste"
   - `POST /keep/shopping/sort` — reorder by category/aisle
4. **Decide the endpoint's authentication.** The service is reachable from a public URL and
   its credential can write to Keep, so it cannot be open. Note the constraint that makes this
   non-trivial: the frontend is a *public static bundle*, so no shared secret can be embedded
   in it — the mechanism has to be something the user supplies at runtime or a real sign-in.
5. **Frontend integration with graceful degradation** (N5): detect whether a gateway is
   reachable; if not, hide the Keep actions and keep the app fully usable. The core must not
   depend on Keep — this is a documented non-functional requirement, not a nicety.
6. **Operational safety**: token in Secret Manager (done for the probe), an alert on
   authentication failure, and the re-auth runbook kept current. A re-mint needs a browser
   cookie *and* a cloud-side exchange, so a stale runbook is the difference between a
   recoverable outage and a lost integration.
7. **Ingredient category master data** — a prerequisite for aisle sorting: each ingredient
   needs a category. Extend `docs/ingredients.csv` (and the Drive `zutaten.csv`) with it.
8. **Implement the three Keep actions**: add a dish to the meal plan, add a recipe's scaled
   ingredients to the shopping list (including linked Zutaten-Rezepte), and sort by category.
9. **Then** the intelligent filtering from the Integrations section (exclude always-in-stock,
   query may-be-in-stock), which builds on the same gateway.

Two things to carry over rather than rediscover:
- **Writes must be non-destructive.** The spike proved this is achievable — a write/delete
  cycle left the real 135-item list with identical order and sort ids — but the technique
  (marker prefix, sort ids above every existing item, verify-then-cleanup) should be reused
  rather than reinvented.
- **`spike/keep-feasibility/` is a spike, not the product.** Its tooling, tests and the
  `mint-in-cloud.py` recovery script are worth keeping; the rest exists to answer questions
  that are now answered.

## Integrations (depends on: web app, storage)

- [ ] Intelligent shopping-list filtering: exclude always-in-stock ingredients, query
      may-be-in-stock ingredients.
- [ ] Gemini for Home: speech-optimized preparation of recipe steps for read-aloud.

## Sharing (depends on: web app, storage)

- [ ] Share individual recipes or the whole collection with friends (link generation and
      collection export; the single-recipe HTML export itself is built in Phase 1 as the
      cooking view).
