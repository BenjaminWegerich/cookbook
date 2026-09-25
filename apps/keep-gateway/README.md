# Keep gateway

A small HTTP service that lets the cookbook web app read and update the two Google Keep
notes — **Einkaufsliste** (shopping list) and **Essensplan** (meal plan).

It exists because Keep has no usable API for a personal Google account: the official API is
Workspace-only, so the only route is the unofficial `gkeepapi` client with a long-lived
master token. A token like that can never live in a static browser bundle, so it lives in
this service instead and the app talks to a clean, action-shaped HTTP boundary. Design and
rationale: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) ("Keep gateway"); the feasibility
spike that proved the approach is in [`spike/keep-feasibility/`](../../spike/keep-feasibility/).

**Status: deployed and verified.** The service runs on Cloud Run in `europe-west3`
(scale-to-zero), `GET /health` answers, and the read path returns both real Keep lists end to
end. Both meal-plan writes are implemented — the plan write (`POST /keep/mealplan`) and ticking
a dish off (`POST /keep/mealplan/check`); the shopping-list write and the aisle sort still
answer `501 not_implemented` until their prerequisites exist (the ingredient-category and
write-action steps). The meal-plan line links the cooking view through a short TinyURL when the
deployment has a `TINYURL_API_TOKEN` (`POST /shorten`); without one the long export URL is
written, so the shortener is optional. Deployment, the credential alert and the €1
spend guardrail are all in place — see
[`deploy/cloud-run/README.md`](deploy/cloud-run/README.md).

## Endpoints

| Method | Path                   | Purpose                                              | Status |
| ------ | ---------------------- | ---------------------------------------------------- | ------ |
| `GET`  | `/health`              | Liveness. No Keep call, no token, no config details. | works |
| `GET`  | `/keep/state`          | Meal plan and shopping list, in Keep's display order. | works |
| `POST` | `/keep/mealplan`       | Add dish lines to "Essensplan".                       | works |
| `POST` | `/keep/mealplan/check` | Tick meal-plan lines off / back on ("Vom Plan entfernen"). | works |
| `POST` | `/shorten`             | Shorten one export URL for a meal-plan line.         | works with a token, else `503` |
| `POST` | `/keep/shopping`       | Add a recipe's scaled ingredients to "Einkaufsliste". | `501` until the write-action step |
| `POST` | `/keep/shopping/sort`  | Reorder the shopping list by category/aisle.          | `501` until the category and write-action steps |

Everything under `/keep/` and `/shorten` requires `Authorization: Bearer <token>`: the caller's
Google sign-in for the identity scopes (`openid email`). The service has Google confirm it and
checks the address against `KEEP_ALLOWED_EMAILS`. A token that grants more than the identity
scopes — above all one that could touch Drive files — is refused.

`GET /keep/state` answers:

```json
{
  "mealplan": {
    "title": "Essensplan",
    "items": [{ "text": "Kürbissuppe", "checked": false, "indented": false }]
  },
  "shopping": {
    "title": "Einkaufsliste",
    "items": [{ "text": "500 g Kartoffeln", "checked": false, "indented": false }]
  }
}
```

Items arrive in the order the Keep app shows them. Only user-visible facts cross the
boundary — note ids, sort ids and account details stay inside the service, so a change in
Keep or in `gkeepapi` cannot leak into the app.

`POST /keep/mealplan` adds one or more lines and replaces the entries of the same recipe:

```json
{
  "add": "Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=6",
  "remove": ["Kürbissuppe", "Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=4"]
}
```

`add` is the complete line (or the lines, in reading order) to put at the top of "Essensplan" —
the recipe title plus the app's chosen entry shape, today an export link whose fragment carries
the size; the gateway treats the text as opaque. `remove` are the exact texts of every line that
names the same recipe — checked or not, and whatever size it states. The app owns the rule that
decides which lines those are (`mealPlanEntriesForTitle` in `packages/core/src/mealPlan.ts`,
next to the parser), so the gateway only executes the action.

The same endpoint carries the app's undo (the snackbar's "Rückgängig"): `add` is then a list of
the lines the previous write replaced, in their original order, or an empty list when it only
has to take the added line back off a first-time plan. A body that neither adds nor removes is
rejected. The answer is the changed list in the checklist shape of `GET /keep/state`:

```json
{
  "mealplan": {
    "title": "Essensplan",
    "items": [{ "text": "Kürbissuppe: https://…/view#portionen=6", "checked": false, "indented": false }]
  }
}
```

`POST /shorten` shortens one export URL for a meal-plan line:

```json
{ "url": "https://<export-host>/exec?f=<id>&portionen=6" }
```

The answer is `{ "shortUrl": "https://tinyurl.com/k7f2qa" }`. The meal-plan line carries its
link as raw text (Keep has no hyperlink-with-text), and the Apps Script address plus the Drive
file id make that line enormous; with a short link the line reads
"Kürbissuppe (6 Portionen): https://tinyurl.com/k7f2qa".

The app asks here at the moment a dish is planned, never in advance, because one link exists per
(recipe, size): the promised size is baked into the link's *target*, since a redirect does not
reliably forward an appended parameter — which is also why the size moves into the visible
parenthetical label. Only `https://` targets up to 2000 characters are accepted, and the route
sits behind the same Google sign-in as the Keep routes. Without a `TINYURL_API_TOKEN` it answers
`shortening_disabled`; every failure there means the app writes the long export URL, so
shortening never blocks a plan write.

`POST /keep/mealplan/check` ticks meal-plan lines off or back on, without deleting them — the
recipe overview's "Vom Plan entfernen" and its "Rückgängig":

```json
{
  "check": ["Kürbissuppe: https://drive.google.com/file/d/<id>/view#portionen=6"],
  "uncheck": []
}
```

`check` are the exact texts to tick off, `uncheck` the exact texts to tick back on. At least one
of the two must be non-empty and no text may name both; a malformed body is a `400`. The app owns
the rule that decides which lines belong to a recipe (`mealPlanEntriesForTitle` in
`packages/core/src/mealPlan.ts`), so the gateway only executes the action. Only the `checked`
flag changes — text, sort ids and every unrelated item stay as they are — the change is one
sync, and the state read back is verified (a named line that is missing, or that did not reach
the requested state, is a `keep_api_error` instead of a reported success). The answer is the
changed list in the same shape as `POST /keep/mealplan`.

Every failure — including `404` and `405` — answers with the same shape, so the app can
branch on a stable code and switch Keep features off cleanly (N5):

```json
{ "error": { "code": "keep_auth_rejected", "message": "Google rejected the Keep credential." } }
```

| Code | HTTP | Meaning | What happens next |
| ---- | ---- | ------- | ----------------- |
| `gateway_not_configured` | 503 | No OAuth client id and/or no address allowlist configured. | Fail-closed: Keep features are off. |
| `unauthorized` | 401 | Missing, expired or foreign sign-in, or an address off the allowlist. | The app signs in with Google again. |
| `identity_unavailable` | 503 | Google could not confirm the caller's sign-in. | Fail-closed and retryable; nothing to configure. |
| `origin_not_allowed` | 403 | Browser origin not on the allowlist. | Configuration error; check `KEEP_GATEWAY_ALLOWED_ORIGINS`. |
| `keep_auth_rejected` | 502 | Google refused the master token. | **Operator action:** re-mint it from the cloud (runbook). |
| `keep_unreachable` | 502 | Network error, or the private API answered non-JSON (blocked host). | Retry; if permanent, move the service. |
| `keep_list_missing` | 502 | A configured note is not visible to the throwaway account. | Check the note is still shared and its title. |
| `keep_api_error` | 502 | Any other `gkeepapi` failure. | See the server log line. |
| `not_implemented` | 501 | Documented action, not built yet. | The shopping-list write and the aisle sort. |
| `bad_request` | 400 | Malformed body, a write body without a usable `add` entry text, or a `/shorten` target that is not an `https://` URL. | Check the JSON body. |
| `shortening_disabled` | 503 | No `TINYURL_API_TOKEN` is configured. | The app writes the long export URL; nothing to fix unless short links are wanted. |
| `shorten_failed` | 502 | TinyURL refused, timed out, or answered unusably. | The app writes the long export URL; the diagnosis is in the server log line. |
| `internal_error` | 500 | Unexpected failure. | The traceback is in the log, not the response. |

## Configuration

All configuration is environment variables; the service keeps no state and writes no files.

| Variable | Required | Meaning |
| -------- | -------- | ------- |
| `KEEP_EMAIL` | yes | The **throwaway** account whose token this is. |
| `KEEP_MASTER_TOKEN` | yes | Its master token. Secret — Secret Manager in the cloud. |
| `KEEP_DEVICE_ID` | yes | Stable device id. **Never change it**; a new value looks like a new device to Google. |
| `KEEP_OAUTH_CLIENT_ID` | yes | The web client the app signs in with. A caller's token must name it as its audience, which is what stops a token minted for any other Google app. |
| `KEEP_ALLOWED_EMAILS` | yes | Comma-separated accounts allowed to call the service. Empty ⇒ nobody (fail-closed), never "anybody". |
| `KEEP_DEV_ACCESS_TOKEN` | no | Static token accepted for local `curl` only. **Never set on Cloud Run** — it is a debugging aid, not a second production path. |
| `TINYURL_API_TOKEN` | no | API token of a free TinyURL account, used to shorten the meal-plan line's export link. Secret — Secret Manager in the cloud. Empty ⇒ export links stay long and everything else works. |
| `KEEP_GATEWAY_ALLOWED_ORIGINS` | for browsers | Comma-separated origins allowed to call the service (the GitHub Pages URL and `http://localhost:5173` for the dev server by default). Empty ⇒ no browser caller. No wildcard. |
| `KEEP_SHOPPING_LIST_TITLE` | no | Default `Einkaufsliste`. |
| `KEEP_MEALPLAN_LIST_TITLE` | no | Default `Essensplan`. |
| `PORT` | no | Default `8080`, which is what Cloud Run injects. |

## Local development

The virtualenv is created `--without-pip` and bootstrapped from the spike's virtualenv,
because this machine has no `python3.14-venv` package. That is one command longer, but it
avoids installing anything system-wide.

```sh
cd apps/keep-gateway

python3 -m venv --without-pip .venv
../../spike/keep-feasibility/.venv/bin/pip --python .venv/bin/python install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

Run the tests (no account, no network — the Keep client is replaced by a fake):

```sh
./.venv/bin/python -m unittest discover -s tests -t . -v
```

Run the service against the real account, using the spike's local `.env`:

```sh
set -a; . ../../spike/keep-feasibility/.env; set +a
export KEEP_OAUTH_CLIENT_ID=<the web client id from apps/web/.env>
export KEEP_ALLOWED_EMAILS=benjaminwegerich@gmail.com
export KEEP_GATEWAY_ALLOWED_ORIGINS=http://localhost:5173
export KEEP_DEV_ACCESS_TOKEN=local-smoke-token   # any value; local curl only
export TINYURL_API_TOKEN=<TinyURL API token>    # optional; without it export links stay long
./.venv/bin/python -m keep_gateway            # or the gunicorn line from the Dockerfile

curl -s http://127.0.0.1:8098/health
curl -s -H "Authorization: Bearer $KEEP_DEV_ACCESS_TOKEN" http://127.0.0.1:8098/keep/state
```

In the deployed service there is no such token: a caller proves itself with its Google sign-in,
which a browser obtains and a `curl` cannot. That is why local runs set the dev token above —
and why it must never be set anywhere a real user can reach.

It binds to loopback on purpose: the process holds a credential that can write to the Keep
account, so it must not be reachable from the local network by accident.

## Deployment

Deployed as a Cloud Run **service** in the project the feasibility spike created
(`cookbook-keep`, `europe-west3`), scale-to-zero, no state cache, and gated by the caller's
Google sign-in (see "Endpoint authentication" in ARCHITECTURE.md). The build context is this
directory, so no file from the spike is needed to build the image.

Build, service, secrets, metric and alert are one idempotent script:

```sh
./deploy/cloud-run/provision.sh
```

The master token has to be minted from the cloud, because Google refuses a home-minted one
there:

```sh
./deploy/cloud-run/mint-token.sh
```

The full runbook — prerequisites, what the service is configured with, retiring the old pasted
token, re-minting after a dead credential, the credential alert, the €1 billing guardrail that
detaches billing if the project ever spends it, troubleshooting and teardown — is in
[`deploy/cloud-run/README.md`](deploy/cloud-run/README.md).

## Design notes

- **No state cache.** Every request authenticates and fully syncs Keep. A cached state saved
  ~0.14 s in the spike, far less than the storage problem it brings on an ephemeral
  filesystem. Measured here: a cold sync of the live collection (248 meal-plan + 135
  shopping items) takes 0.8–1.0 s.
- **The master token must be minted from the cloud.** Google refuses a home-minted token
  from its datacenter network, so setup *and every re-mint* run in the cloud. See
  `spike/keep-feasibility/deploy/cloud-run/README.md`.
- **The gateway owns its Keep code** (`keep_gateway/keep_client.py`) rather than importing
  `spike/keep-spike.py`. The spike is the record of how the approach was validated, not a
  library; and because `gcloud builds submit` needs the Dockerfile at the build-context
  root, importing it would have forced either a repository-root Dockerfile or a fragile
  vendored copy. The authentication call and the failure diagnosis are the same logic, and
  the docstrings say so.
- **Python modules use `snake_case`** (`keep_gateway/`, `keep_client.py`) although the
  repository's convention is kebab-case file names: a Python package's modules have to be
  importable, and `keep-client.py` cannot be imported. The standalone spike scripts keep
  their kebab-case names because they are loaded by path.
- **Writes stay non-destructive.** Every write action follows the recipe the spike proved on
  the real 135-item list: place what we create with sort ids above every existing item, change
  as little as possible, and verify the state read back. The meal-plan write is the first one
  built (`KeepClient.add_meal_plan_entries`); the shopping-list write and the aisle sort follow
  it.
