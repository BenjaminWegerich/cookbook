# Gate 2 on Cloud Run — exact steps

Answers the one remaining feasibility question: **does master-token authentication keep
working from a Cloud Run datacenter IP over several days?** Everything else is already
settled — shared-note writes and ordering pass, a cold sync takes ~0.7 s, and Cloud Run is
the chosen host.

A **Cloud Run job** is the right shape here, not a service:

- no HTTP surface, so nothing to expose and nothing to authenticate;
- scale-to-zero is the default, and a job costs nothing while it is not running;
- Cloud Scheduler can trigger it directly, so the sampling needs no code of its own;
- a failing run is visible in Cloud Logging rather than silently ignored.

## Fastest path: one script

`provision.sh` does every step in this document — project, APIs, secret, image, job, first
run and schedule — and is re-runnable. From the spike directory:

```sh
./gcloud.sh auth login                # the one step that must be interactive
./gcloud.sh billing accounts list     # note the ACCOUNT_ID
./deploy/cloud-run/provision.sh --billing-account ACCOUNT_ID
```

Everything below is the same work spelled out, for when a step needs running alone or the
script needs adapting. Where it says `gcloud`, use `./gcloud.sh` — see below.

> **Verification status.** The `gcloud` command lines and every flag used here were checked
> against the real CLI (SDK 586.0.0) — which caught two genuine errors in an earlier draft:
> `gcloud builds submit` has **no `--file` flag** (the Dockerfile must sit at the build-context
> root, which is why it is at the top of the spike directory rather than next to this
> document), and adding a secret version is `gcloud secrets versions add`, not
> `gcloud secrets add-version`.
>
> **Still untested:** the image build and the job run, because this machine has no Docker and
> no authenticated project. Treat the first `execute` as the test.

## Prerequisites

- **`gcloud`, via `./gcloud.sh`.** The SDK is unpacked into this repository's `.tools/`
  directory and is deliberately **not** installed system-wide, so a bare `gcloud` gives
  `command not found`. `./gcloud.sh` resolves the SDK from its own location and works from any
  working directory. (`provision.sh` prepends the same path itself, so it needs no help.)
- **Authenticated:** `./gcloud.sh auth login`.
- **A Google Cloud project with billing linked.** Cloud Run, Artifact Registry, Cloud
  Scheduler, Secret Manager and Cloud Build all require a billing account, even inside the
  free tier. Check an existing project with
  `./gcloud.sh billing projects describe PROJECT_ID --format='value(billingAccountName)'` —
  empty output means not linked. Be careful with `billing projects link`: on an already-linked
  project it **moves** the project to the account you name rather than doing nothing.
- The spike's `.env`, holding a working master token.

## 1. Set up the project

```sh
export PROJECT="cookbook-keep"      # any name; must be globally unique
export REGION="europe-west3"        # Frankfurt - closest to you
export JOB="keep-gate2-probe"
export REPO="keep-probe"

gcloud projects create "$PROJECT"
gcloud config set project "$PROJECT"

# Link billing (required, and not scriptable in one line):
#   https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT
```

## 2. Enable the APIs

```sh
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

## 3. Store the master token as a secret

Run these from the spike directory. The token is read out of `.env` through a pipe and is
never printed:

```sh
cd /path/to/cookbook/spike/keep-feasibility

grep '^KEEP_MASTER_TOKEN=' .env | cut -d= -f2- | \
  gcloud secrets create keep-master-token --data-file=-
```

When the token is later re-minted, add a new version rather than a new secret:

```sh
grep '^KEEP_MASTER_TOKEN=' .env | cut -d= -f2- | \
  gcloud secrets versions add keep-master-token --data-file=-
```

## 4. Let the job read the secret

```sh
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
export RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding keep-master-token \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

## 5. Build and push the image

```sh
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" || true

export IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/gate2:latest"
gcloud builds submit --tag "$IMAGE" .
```

Run this **from the spike directory**, and note there is no `--file` flag: `gcloud builds
submit --tag` always builds the `Dockerfile` sitting at the root of the uploaded source, which
is why the Dockerfile lives at the top of the spike directory rather than next to this
document. The context must be the spike directory so the image can reuse `keep-spike.py`
instead of duplicating the auth logic.

**`.dockerignore` keeps `.env` out of that upload** — verify it before the first submit if you
change the layout, because `gcloud builds submit` uploads the whole context before building.

## 6. Create the job

```sh
export KEEP_EMAIL_VALUE=$(grep '^KEEP_EMAIL=' .env | cut -d= -f2-)
export KEEP_DEVICE_ID_VALUE=$(grep '^KEEP_DEVICE_ID=' .env | cut -d= -f2-)

gcloud run jobs create "$JOB" \
  --image "$IMAGE" \
  --region "$REGION" \
  --set-env-vars "KEEP_EMAIL=${KEEP_EMAIL_VALUE},KEEP_DEVICE_ID=${KEEP_DEVICE_ID_VALUE}" \
  --set-secrets "KEEP_MASTER_TOKEN=keep-master-token:latest" \
  --max-retries 0 \
  --tasks 1
```

`--max-retries 0` is deliberate: a refusal is the finding we are looking for, and retrying it
would only mask a consistent block.

**`KEEP_DEVICE_ID` must be the value from `.env`, unchanged.** The device id has to stay
stable for the lifetime of the deployment; a changing one makes Google treat every run as a
new device, which is the exact pattern that triggers extra verification.

## 7. First run — the first Gate 2 data point

```sh
gcloud run jobs execute "$JOB" --region "$REGION" --wait
```

Then read the record:

```sh
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\"" \
  --limit 5 --format='value(textPayload)' --freshness=1h
```

## 8. Sample it every six hours

```sh
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member="serviceAccount:${RUN_SA}" --role="roles/run.invoker"

gcloud scheduler jobs create http "${JOB}-6h" \
  --location "$REGION" \
  --schedule "0 */6 * * *" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST \
  --oauth-service-account-email "${RUN_SA}"
```

Six hours is a deliberate compromise: lockouts tend to appear hours or days after the first
success, while four attempts a day is far too little traffic to look like abuse.

## Reading the result

Each run emits one JSON record with a four-way outcome:

| Outcome | Meaning | Consequence |
| --- | --- | --- |
| `ok` | Auth and sync succeeded from the cloud IP | Gate 2 passes if this repeats for ~a week |
| `rejected` | Google refused the token (`LoginException`) | The credential died. Re-mint it; if it keeps dying, an unattended host is not viable |
| `blocked` | The private API answered with non-JSON | This network is refused and no configuration fixes it — **drop Cloud Run** and fall back to the laptop |
| `network` | The request never completed | Inconclusive; look at the job's own logs |

The record also carries `public_ip`. **If that changes between runs, note it** — Google treats
a changing IP as a new device, so IP drift is itself a finding, separate from the outcome.

Roll the runs up over time:

```sh
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\"" \
  --limit 200 --format='value(textPayload)' --freshness=7d | grep '"outcome"'
```

## Troubleshooting

Both of these surface as the same unhelpful `Task ... failed with exit code: 2`, so read the
container's own log lines — the entrypoint prints `cwd`, the `/app` listing and the exit code
before and after the run.

**`can't open file '/app/...': [Errno 13] Permission denied`**
The container runs as the non-root `probe` user and cannot *read* the source files. `COPY`
preserves the file modes from the build machine, so a restrictive umask (0600) leaks into the
image and the files become root-only. The Dockerfile now sets the modes explicitly; to check a
build host:

```sh
ls -l keep-spike.py gate2-healthcheck.py     # must be world-readable (r--, not ---)
```

**`can't open file '/app/...': [Errno 2] No such file or directory`**
Genuinely missing, or the container's working directory is not `/app`. Compare the `cwd=` line
in the log with the `WORKDIR` in the Dockerfile.

**Everything fails immediately after the project is created**
IAM has not propagated yet. Re-run — the script retries the billing link and the build.

## Minting the token — the one rule that is easy to get wrong

**The master token must be minted from the cloud, not from the home machine.** This is
measured, not theoretical: the same account, token and device id that authenticate from home
are rejected as `BadAuthentication` from every Google Cloud address tried — and a token minted
*from* Cloud Run and then used there works immediately. What Google binds is **where the token
was created**, not where it is used.

That makes minting a required setup *and recovery* step, and it is why `provision.sh` will not
seed the secret from `.env` — that token works locally and fails here.

### Minting procedure

The cookie is a short-lived, full-access **session credential**. It is written to a dedicated
secret, used once, and the secret is deleted immediately afterwards.

```sh
# 1. A secret to carry the cookie - it lives only for the next few minutes.
cd /home/ben/cookbook/spike/keep-feasibility
./gcloud.sh secrets create keep-oauth-token --replication-policy=automatic --quiet

# 2. Copy the cookie in a browser session logged in as the THROWAWAY account:
#      https://accounts.google.com/EmbeddedSetup  ->  log in  ->  "I agree"
#      DevTools -> Application -> Cookies -> https://accounts.google.com -> oauth_token
#    Paste it at the hidden prompt: not echoed, not in shell history, never seen by a log.
read -rsp "oauth_token: " TOK && printf '%s' "$TOK" | \
  ./gcloud.sh secrets versions add keep-oauth-token --data-file=- && unset TOK

# 3. Mint from the cloud and immediately test it there.
./gcloud.sh run jobs execute keep-mint --region "$REGION" --wait
./gcloud.sh logging read 'resource.labels.job_name="keep-mint"' \
  --limit 30 --freshness=10m --format='value(textPayload)'

# 4. Destroy the cookie secret - it is no longer needed and should not linger.
./gcloud.sh secrets delete keep-oauth-token --quiet
```

Use the **throwaway** account. Taking the cookie from the main account's browser profile would
mint a full-access token for the main account; `mint-in-cloud.py` guards against that by
aborting without storing anything if the token can see more checklists than the throwaway
account should (two).

## Cost guardrail — do this before walking away

Cloud Run's free tier is a **discount, not a cap**: usage past it is billed. For this workload
(four runs a day, each a fraction of a second) that is orders of magnitude inside the free
allowance — 180,000 vCPU-seconds and 2 M requests per month — but set the guard anyway:

1. Create a budget at <https://console.cloud.google.com/billing/budgets> — €1 is plenty.
2. Attach the **"Disable billing"** notification via Pub/Sub and a function, following
   [Disable billing usage with notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications).
   Google is explicit that this "doesn't guarantee that you won't spend more than your
   budget" because notifications lag costs, which is why the budget sits far below your funds.

Secret Manager, Cloud Scheduler (3 jobs/month) and Artifact Registry (0.5 GB) all stay inside
their own free tiers at this size.

## Teardown

```sh
gcloud scheduler jobs delete "${JOB}-6h" --location "$REGION" --quiet
gcloud run jobs delete "$JOB" --region "$REGION" --quiet
gcloud artifacts repositories delete "$REPO" --location "$REGION" --quiet
gcloud secrets delete keep-master-token --quiet
```

## If Gate 2 fails

A `blocked` result is a real finding, not a dead end. The fallback is the already-documented
option A: run the same gateway on the laptop, keep the systemd units in `deploy/`, and let the
phone fall back to the Keep app. Nothing about the gateway's design changes — only where the
process runs.
