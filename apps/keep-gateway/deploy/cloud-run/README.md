# Keep gateway on Cloud Run — deploy and recovery runbook

Everything needed to put the gateway on Cloud Run, to let the app in, and — the part that
matters most — to bring the integration back when Google stops accepting the credential.

**The gateway is already deployed** (`keep-gateway`, `europe-west3`); these scripts are
idempotent, so they are also the update path. To see the live state without re-deriving it:

```sh
gcloud run services list --region europe-west3   # keep-gateway (the service)
gcloud secrets list                              # keep-master-token-cloud, tinyurl-api-token
gcloud run jobs list --region europe-west3       # keep-gate2-probe (durability sampler), keep-mint
gcloud functions describe stop-billing --region europe-west3   # the spend guardrail
gcloud scheduler jobs list --location europe-west3             # keep-gate2-probe-6h
```

Scripts, in the order you need them:

| Script | When | What it does |
| ------ | ---- | ------------ |
| `provision.sh` | first deploy, and every later release | builds the image, deploys/rolls the service with its identity configuration, wires the metric + alert, re-points the mint job |
| `mint-token.sh` | once at setup, then only when the credential dies | exchanges a browser cookie for a cloud-minted master token and stores it |
| `setup_monitoring.py` | called by `provision.sh`; runnable alone | log-based metric + email alert (idempotent, `--dry-run` prints the payloads) |
| `setup_budget_guardrail.sh` | once, then only to re-test or re-arm | the €1 budget, its Pub/Sub topic, and the function that detaches billing when the budget is spent (`setup_budget.py` builds the budget itself) |

## Prerequisites

- **`gcloud`, authenticated.** The SDK is unpacked inside the repository
  (`spike/keep-feasibility/.tools/google-cloud-sdk`), not installed system-wide, so the
  scripts prepend it themselves. `gcloud auth login` once; `provision.sh` fails with a clear
  message if the session is missing.
- **A project with billing linked.** Defaults to `cookbook-keep`, the project the feasibility
  spike created. Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Logging and
  Monitoring must be usable; the script enables the APIs.
- **The throwaway account's identifiers** in `spike/keep-feasibility/.env`
  (`KEEP_EMAIL`, `KEEP_DEVICE_ID`). They are not secrets, but they must match the master
  token: the device id has to stay stable or Google treats every run as a new device.
- **The master token secret must exist** (`keep-master-token-cloud`, created during the
  spike). `provision.sh` refuses to invent it, because a home-minted token is refused from
  the cloud — only `mint-token.sh` may fill it.

## First deploy

From `apps/keep-gateway`:

```sh
./deploy/cloud-run/provision.sh
```

Each origin is the app's exact scheme+host — GitHub Pages omits the port and the path. The
default allows both the Pages site and the Vite dev server
(`https://benjaminwegerich.github.io,http://localhost:5173`), so developing against the
deployed gateway needs no extra flag; `--allowed-origin` overrides the whole list. A remote
page cannot claim a localhost origin, and the caller's Google sign-in is required either way.

Then mint the master token, because nothing works before that:

```sh
./deploy/cloud-run/mint-token.sh
```

Nothing to hand to the app: it signs in with Google, and the gateway confirms that sign-in. The
OAuth client id and the address allowlist are configuration, not secrets — `provision.sh`
defaults the client id from `apps/web/.env` so gateway and bundle cannot drift apart, and takes
the list from `--allowed-emails` (default `benjaminwegerich@gmail.com`).

Verify the deployment:

```sh
URL=https://keep-gateway-<hash>-ew.a.run.app      # printed by provision.sh
curl -s "$URL/health"                              # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' "$URL/keep/state"   # 401: the sign-in gate is on
```

`/health` proves the container is up, and the 401 proves the gate is closed. Reading the lists
needs a browser (the sign-in lives there, and that is the point); `mint-token.sh` therefore ends
with exactly these two checks. The master token itself is proven inside the mint job, which
authenticates with it through the same `keep_client` code the service uses.

## What the service is configured with

| Setting | Value | Why |
| ------- | ----- | --- |
| `--allow-unauthenticated` | on | a browser cannot hold a Cloud Run IAM credential; the gate is the caller's Google sign-in, checked inside the service |
| `--min-instances` | 0 | scale to zero; a cold Keep sync is ~1 s, so the cold start is invisible |
| `--max-instances` | 2 | bounds what a leaked URL can cost |
| `--concurrency` | 8 | matches gunicorn's thread count; the request rate is a household's |
| `KEEP_MASTER_TOKEN` | Secret Manager `keep-master-token-cloud:latest` | the cloud-minted credential |
| `TINYURL_API_TOKEN` | Secret Manager `tinyurl-api-token:latest`, when it exists | shortens the meal-plan line's export link; absent ⇒ the app writes the long URL |
| `KEEP_OAUTH_CLIENT_ID` | the web client id (default: read from `apps/web/.env`) | the audience a caller's token must name; without it every call is refused |
| `KEEP_ALLOWED_EMAILS` | default `benjaminwegerich@gmail.com` | who may call. Empty ⇒ nobody, never "anybody" |
| `KEEP_GATEWAY_ALLOWED_ORIGINS` | the Pages origin + `http://localhost:5173` | CORS is closed by default; a foreign `Origin` is refused anyway |

**The service URL is public.** That is deliberate (the browser must reach it) and safe only
because every `/keep/*` and `/shorten` route requires a Google-confirmed sign-in and fails
closed when the identity configuration is missing. Do not add an unauthenticated Keep route.

## The TinyURL secret (optional)

The meal-plan line links the recipe's cooking view; without a shortener that link is the whole
Apps Script address plus the Drive file id. `TINYURL_API_TOKEN` — the API token of a free
TinyURL account — lets the gateway shorten it, so the Keep line reads
`Kürbissuppe (6 Portionen): tinyurl.com/k7f2qa` (the app drops the scheme; Keep links the bare
host too). The gateway calls TinyURL's API
server-side (`POST /shorten`), because that API sends no CORS header the Pages origin could use
and the token may never ship in the browser bundle.

**Optional by design.** `provision.sh` binds the secret only when it exists *and* has a
version; without it the gateway answers `shortening_disabled` and the app writes the long URL,
exactly as before. Nothing else changes.

Create it once. The `read` command waits for the token without echoing it — paste with
`Ctrl+Shift+V` (or a right-click) and press Enter — and `--data-file=-` reads it from that pipe,
so it never appears in the shell history. Run the block **line by line**, or at least run the
`read` line on its own: pasting the whole block at once would feed the following `printf` line
to the prompt instead of the token.

```sh
cd apps/keep-gateway
export PATH="$PWD/../../spike/keep-feasibility/.tools/google-cloud-sdk/bin:$PATH"
gcloud config set project cookbook-keep --quiet

read -rsp "TinyURL API token: " TINYURL_TOKEN && echo
printf '%s' "$TINYURL_TOKEN" | \
  gcloud secrets create tinyurl-api-token --replication-policy=automatic --data-file=-
unset TINYURL_TOKEN
```

If you would rather see what you paste, put the token into a temporary file and pass the file
instead, then delete it again:

```sh
gcloud secrets create tinyurl-api-token --replication-policy=automatic \
  --data-file="$HOME/tinyurl-token.txt"
shred -u "$HOME/tinyurl-token.txt"
```

Then redeploy — this grants the runtime service account `secretAccessor` on the secret and binds
it as `TINYURL_API_TOKEN`:

```sh
./deploy/cloud-run/provision.sh
```

The summary line `shorten on (tinyurl-api-token)` proves the binding. To **rotate** the token,
add a version and redeploy:

```sh
read -rsp "TinyURL API token: " TINYURL_TOKEN && echo
printf '%s' "$TINYURL_TOKEN" | gcloud secrets versions add tinyurl-api-token --data-file=-
unset TINYURL_TOKEN
./deploy/cloud-run/provision.sh
```

What the token can do is narrow: it creates links under the TinyURL account and nothing else —
no Drive file, no Keep note. The links themselves are permanent, so a failure to *create* one
only means the Keep line stays long.

## Retiring the pasted token

The service used to be gated by a shared token the app asked the user to paste. It is now gated
by the caller's Google sign-in, so that secret is dead weight — and a stored password in Google
Passwords that no longer belongs to anything. Cleaning up after the switch:

```sh
# 1. delete the secret (it is no longer referenced by the service)
gcloud secrets delete keep-gateway-token

# 2. remove the stored password from Google Passwords
#    (passwords.google.com → search "keep-gateway-token" or the Pages URL → delete)

# 3. confirm the deployment still answers
curl -s "$URL/health"
curl -s -o /dev/null -w '%{http_code}\n' "$URL/keep/state"   # 401
```

If a deployment is ever rolled back to a revision that still expects the old token, it will fail
closed (503 `gateway_not_configured`) rather than open up — re-minting it would then be a
`gcloud secrets create` plus the `--set-secrets` flag in `provision.sh`'s removed step. The
forward path is the sign-in, not the rollback.

**Rotating the caller's access instead** is now Google's job: remove the address from
`KEEP_ALLOWED_EMAILS` and redeploy, or remove Cookbook's access at
`myaccount.google.com/permissions`. There is no shared secret left to rotate.

## Re-minting the master token (recovery)

**Symptom:** the app shows no Keep actions, `GET /keep/state` answers
`{"error": {"code": "keep_auth_rejected", ...}}`, and the email alert fired.

**Cause:** Google no longer accepts the master token. It is not transient — retrying does not
help, and there is nothing to fix inside Keep or in the sharing settings.

**Fix:**

```sh
cd apps/keep-gateway
./deploy/cloud-run/mint-token.sh
```

The script walks the whole path: it prepares the one-time cookie secret, asks you to paste the
`oauth_token` cookie from a browser session logged in as the **throwaway** account, runs the
mint as a Cloud Run job, prints the job's record, destroys the cookie secret again, rolls the
service onto the new version, and finishes with the `/keep/state` check. Re-run it whenever
the credential dies.

Two rules are encoded in the mint and must not be relaxed:

1. **The mint has to run in the cloud.** Google refuses a token that was *created* on the home
   network when it is first used from a Google Cloud address (`BadAuthentication`). What
   Google binds is where the token was created, not where it is used — so the exchange runs as
   a Cloud Run job, never locally.
2. **The cookie has to come from the throwaway account.** It grants full access to whoever is
   logged in. The mint refuses to store a token that can see more checklists than the
   throwaway account should, so the worst case is a failed run rather than a full-access
   credential for the main account.

While the credential is dead the app keeps working; only the Keep features disappear (N5).

## The alert

`provision.sh` wires three objects, all named after the failure they watch:

- **metric** `keep_auth_rejected` — a log-based counter over
  `resource.labels.service_name="keep-gateway" AND jsonPayload.code="keep_auth_rejected"`.
  The gateway already prints one JSON line per failure, so no service change was needed.
- **notification channel** `Cookbook Keep gateway` — the email address passed as
  `--alert-email`.
- **alert policy** `Keep gateway: Keep credential rejected` — severity `ERROR`, fires on the
  first rejected credential (a 60 s window, so within about a minute) and closes itself about
  a minute after the condition clears. `autoClose` (1 h) is not the reaction time: it only
  covers the case where the metric stops reporting altogether.

Inspect them:

```sh
gcloud logging metrics describe keep_auth_rejected
gcloud monitoring policies list          # needs the alpha/beta component, or use the console
# Console: Monitoring → Alerting → Policies, and Logging → Log-based metrics
```

**The email channel delivers — verified.** The first self-test actually arrived as an email,
so an API-created channel does work here without anyone clicking a verification link. If
Google does send a verification email for the address, click it anyway; an unverified channel
would look perfectly healthy in every listing while delivering nothing, and that is the one
failure this alert exists to prevent. The email subject leads with the policy's severity
(`ALERT - Error`); the policy name and the documentation text are in the body.

**Proving the alert works** (without breaking the credential). Write one log entry that
matches the metric's filter, then watch for the incident. The entry is marked `selftest` and
touches nothing:

```sh
ACCESS="$(gcloud auth print-access-token)"
curl -s -X POST "https://logging.googleapis.com/v2/entries:write" \
  -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
  -d '{"entries":[{"logName":"projects/cookbook-keep/logs/keep-gateway-alert-selftest",
       "resource":{"type":"cloud_run_revision","labels":{"service_name":"keep-gateway",
       "location":"europe-west3","revision_name":"alert-selftest"}},
       "severity":"ERROR",
       "jsonPayload":{"event":"gateway_error","code":"keep_auth_rejected","selftest":true}}]}'

# a minute later, the incident should be there:
curl -s -H "Authorization: Bearer $ACCESS" \
  "https://monitoring.googleapis.com/v3/projects/cookbook-keep/alerts"
```

The metric needs about a minute, and a *just-created or just-updated* policy may take a few
minutes before its first evaluation — the first attempt was missed because of exactly that, so
do not conclude the alert is broken from the first quiet minute. **Each self-test sends a real
alert email** and a real incident; both clear themselves about a minute later.

Silence it deliberately by disabling the policy in the console; do not delete the metric —
that is the history that shows whether the token dies repeatedly.

## The billing guardrail

A budget is an alarm, not a cap: Google is explicit that reaching a threshold does not stop
usage or billing. This is the only mechanism that does — a €1 budget that publishes to a
Pub/Sub topic, and a function that detaches the project from its billing account once the
budget is genuinely spent.

```sh
./deploy/cloud-run/setup_budget_guardrail.sh          # wire it up, disarmed (DRY_RUN=true)
./deploy/cloud-run/setup_budget_guardrail.sh --test   # prove the chain; sends one message
./deploy/cloud-run/setup_budget_guardrail.sh --armed  # let it actually cut billing off
./deploy/cloud-run/setup_budget_guardrail.sh --budget-only
```

`--test` publishes a message that reports a **spent** budget, so it refuses to run while the
guardrail is armed — a self-test must never be the reason a project goes dark. Prove the chain
disarmed, then arm it.

What it creates: the `budget-guardrail` topic, the `stop-billing` function (gen2, running as
the single-purpose `budget-guardrail@` service account), and the `Keep gateway guardrail`
budget — €1, scoped to the project, credits included, with 50/90/100 % spent and 100 %
forecast thresholds. Emails keep going to the billing admins; the topic is an addition.

**The decision rule is deliberately narrow.** The function acts only when `costAmount` has
reached `budgetAmount` — actual money. A forecast notification carries the low actual cost and
the high projection, so a projection that crosses the line warns by email and can never
switch anything off. That distinction is the difference between a guardrail and a tripwire
that fires on its own optimism; it is unit-tested in `tests/test_budget_guardrail.py`.

**Why the service account holds `roles/billing.admin` on the billing account.** The Billing
API checks `billing.resourceAssociations.create` / `.delete`, which are *billing-account*
permissions. The project-level `roles/billing.projectManager` looks like the narrow fit and is
not: against the live API it answers `403 IAM_PERMISSION_DENIED … permission:
billing.resourceAssociations.create`, while `billing.admin` answers `200` (both measured, with
a no-op write that re-set the same billing account). The account has no organization, so a
custom role holding exactly those two permissions cannot be created — `billing.admin` is the
narrowest predefined role that works, and it is what Google's disable-billing recipe uses. It
is granted to one service account that only this function can use, whose only code calls
`updateBillingInfo`. To drop the automation without losing the email alerts, remove that
binding (and the function with it).

**If it ever fires**, the project loses its billing account: the gateway, builds, the probe
and anything else server-side stops. Re-attach it here and nothing else is needed — the
gateway is stateless:

<https://console.cloud.google.com/billing/linkedaccount?project=cookbook-keep>

Inspect the budget in the Console:

<https://console.cloud.google.com/billing/01B2EE-2E5ACC-AE4800/budgets>

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `403` with `origin_not_allowed` | the app's origin is not in the allowlist | re-run `provision.sh --allowed-origin <origin>` (exact scheme+host, no path) |
| `503` with `gateway_not_configured` | `KEEP_OAUTH_CLIENT_ID` or `KEEP_ALLOWED_EMAILS` is missing, or the secret has no version | re-run `provision.sh` (it reads the client id from `apps/web/.env`) and check the summary's `caller` line |
| `401` with a sign-in the app just obtained | the account is not on `KEEP_ALLOWED_EMAILS`, or the client id does not match the bundle's | check the service log line's `detail` (`audience mismatch` vs `not on KEEP_ALLOWED_EMAILS`), then re-run `provision.sh` |
| `503` with `identity_unavailable` | Google could not be reached to confirm the sign-in | transient; the app retries. If permanent, check Cloud Run egress |
| `502` with `keep_list_missing` | one of the two notes is no longer shared/visible, or was renamed | re-share the note into the throwaway account, or set `KEEP_SHOPPING_LIST_TITLE` / `KEEP_MEALPLAN_LIST_TITLE` |
| `502` with `keep_unreachable` | network error, or the private API answered non-JSON (a blocked host) | retry; if it persists, the fallback is running the same image on the home machine |
| `502` with `keep_auth_rejected` | the credential died | `./deploy/cloud-run/mint-token.sh` |
| build fails with `PERMISSION_DENIED` right after enabling APIs | IAM has not propagated | wait a minute and re-run `provision.sh` |
| a `curl` cannot read the lists at all | expected: the sign-in lives in a browser, not in `curl` | check `/health` and the 401 above, then open the app and sign in |
| `/healthz` answers a Google-branded HTML 404 while every other path works | Google's frontend intercepts that exact path on `run.app` URLs before the request reaches the container | the liveness route is `/health` for this reason — do not "fix" it back |
| the guardrail logs an `ERROR` with `403 … permission: billing.resourceAssociations.create` | the Billing API is not enabled, or the service account holds only the project-level role | `gcloud services enable cloudbilling.googleapis.com`, then re-run `setup_budget_guardrail.sh --armed` (it grants `roles/billing.admin`) |
| the guardrail logs `no action` for a spent budget | the notification carried no `costAmount`, or the budget is higher than expected | read the reason in the log line; check the budget amount in the Console |

## Teardown

```sh
gcloud run services delete keep-gateway --region europe-west3 --quiet
gcloud run jobs delete keep-mint --region europe-west3 --quiet
# (keep-gateway-token is gone already if the sign-in switch was completed)
gcloud secrets delete keep-master-token-cloud --quiet
# harmless: the next meal-plan line simply carries the long export URL again
gcloud secrets delete tinyurl-api-token --quiet
gcloud logging metrics delete keep_auth_rejected --quiet

# the guardrail
gcloud functions delete stop-billing --region europe-west3 --quiet
gcloud pubsub topics delete budget-guardrail --quiet
gcloud iam service-accounts delete budget-guardrail@cookbook-keep.iam.gserviceaccount.com --quiet
gcloud billing accounts remove-iam-policy-binding 01B2EE-2E5ACC-AE4800 \
  --member="serviceAccount:budget-guardrail@cookbook-keep.iam.gserviceaccount.com" \
  --role="roles/billing.admin" --quiet
# the budget itself is deleted in the Console (see the link above)

# the Artifact Registry images and the alert policy are removed in the console,
# or:  gcloud artifacts repositories delete keep-probe --location europe-west3 --quiet
```

Deleting `keep-master-token-cloud` ends the integration until a fresh mint; deleting the
throwaway account ends it permanently.

## Cost guardrail

Cloud Run's free tier is a discount, not a cap. This workload (a few requests a day, each
about a second) is orders of magnitude inside the allowance — 180,000 vCPU-seconds and 2 M
requests a month — but the guard is in place anyway: the €1 project-scoped budget described
under "The billing guardrail" above, with the
[disable-billing notification](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)
wired to a function, so an unexpected loop turns the project off rather than a bill on.
