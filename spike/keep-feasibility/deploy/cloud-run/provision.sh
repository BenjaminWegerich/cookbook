#!/usr/bin/env bash
# Provision the Gate 2 probe on Cloud Run.
#
# Creates everything the probe needs - project, APIs, secret, image, job, schedule - and
# runs it once so there is an immediate result instead of waiting six hours. Re-runnable:
# every step tolerates a resource that already exists, so a failed run can be retried after
# fixing the cause.
#
# The master token is read out of `.env` through a pipe and is never printed.
#
# Usage, from the spike directory (the one holding .env):
#
#   ./deploy/cloud-run/provision.sh --billing-account 0X0X0X-0X0X0X-0X0X0X
#
# Find the billing account id with:  gcloud billing accounts list
#
# Override any default with an environment variable or flag:
#   PROJECT (cookbook-keep), REGION (europe-west3), JOB (keep-gate2-probe),
#   REPO (keep-probe), SCHEDULE ("0 */6 * * *")

set -euo pipefail

PROJECT="${PROJECT:-cookbook-keep}"
REGION="${REGION:-europe-west3}"
JOB="${JOB:-keep-gate2-probe}"
REPO="${REPO:-keep-probe}"
SCHEDULE="${SCHEDULE:-0 */6 * * *}"
SECRET_NAME="keep-master-token-cloud"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --billing-account) BILLING_ACCOUNT="$2"; shift 2 ;;
    --project)         PROJECT="$2";         shift 2 ;;
    --region)          REGION="$2";          shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s\n' "$1"; }

# --- Locate gcloud ---------------------------------------------------------------------
# The SDK was unpacked into this repository rather than installed system-wide, so a bare
# `gcloud` may well not be on PATH. Prepend the repo-local SDK (resolved from this script's
# own location, not the working directory) so every call below just works.
SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -x "$SPIKE_DIR/.tools/google-cloud-sdk/bin/gcloud" ]]; then
  PATH="$SPIKE_DIR/.tools/google-cloud-sdk/bin:$PATH"
fi

# --- Preconditions ---------------------------------------------------------------------

[[ -f .env ]] || { echo "Run this from the spike directory: .env not found." >&2; exit 1; }
command -v gcloud >/dev/null || {
  echo "gcloud not found on PATH, and no repo-local SDK at .tools/google-cloud-sdk." >&2
  echo "Use ./gcloud.sh for one-off commands, or see deploy/cloud-run/README.md." >&2
  exit 1
}

ACTIVE_ACCOUNT="$(gcloud config get-value account --quiet 2>/dev/null || true)"
if [[ -z "$ACTIVE_ACCOUNT" || "$ACTIVE_ACCOUNT" == "(unset)" ]]; then
  echo "Not authenticated. Run:  ./gcloud.sh auth login" >&2
  exit 1
fi
echo "Authenticated as ${ACTIVE_ACCOUNT}"

# --- Project and billing ---------------------------------------------------------------

step "Project ${PROJECT}"
if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "already exists"
else
  gcloud projects create "$PROJECT"
fi
gcloud config set project "$PROJECT" --quiet

step "Billing"
# Cloud Run, Artifact Registry, Cloud Scheduler, Secret Manager and Cloud Build all refuse
# to work without an active billing account.
#
# Check before linking: `gcloud billing projects link` is NOT a no-op on a project that is
# already linked - it *moves* the project to the billing account you name. Re-linking a
# project that belongs to another billing account would silently move it, so an existing
# link is left alone.
CURRENT_BILLING="$(gcloud billing projects describe "$PROJECT" \
  --format='value(billingAccountName)' 2>/dev/null || true)"

if [[ -n "$CURRENT_BILLING" ]]; then
  echo "already linked to ${CURRENT_BILLING} - leaving it alone"
else
  # `gcloud billing accounts list` prints a column literally headed ACCOUNT_ID. Passing that
  # header through by mistake gets you a bare "INVALID_ARGUMENT: Request contains an invalid
  # argument", so check the shape before calling the API.
  #
  # Deliberately alphanumeric rather than hexadecimal: billing ids may contain letters beyond
  # F, and a too-strict pattern would reject a valid id. This catches the two realistic
  # mistakes - the column header and the documentation placeholder.
  BILLING_PATTERN='^[0-9A-Za-z]{6}-[0-9A-Za-z]{6}-[0-9A-Za-z]{6}$'

  if [[ -z "$BILLING_ACCOUNT" ]]; then
    # Auto-select only when there is exactly one open account, so the choice cannot be wrong.
    mapfile -t OPEN_ACCOUNTS < <(gcloud billing accounts list \
      --filter='open=true' --format='value(accountId)' 2>/dev/null)
    if [[ ${#OPEN_ACCOUNTS[@]} -eq 1 ]]; then
      BILLING_ACCOUNT="${OPEN_ACCOUNTS[0]}"
      echo "using the only open billing account: ${BILLING_ACCOUNT}"
    else
      echo
      echo "Several billing accounts are available, so name one explicitly. Open accounts:"
      gcloud billing accounts list --filter='open=true'
      echo
      echo "Re-run with:  ./deploy/cloud-run/provision.sh --billing-account <ID>"
      exit 1
    fi
  fi

  if [[ "$BILLING_ACCOUNT" == "ACCOUNT_ID" \
     || "$BILLING_ACCOUNT" == "0X0X0X-0X0X0X-0X0X0X" \
     || ! "$BILLING_ACCOUNT" =~ $BILLING_PATTERN ]]; then
    cat >&2 <<EOF
'$BILLING_ACCOUNT' is not a billing account ID.

The real ID looks like 0X0X0X-0X0X0X-0X0X0X, but with actual characters. Note that
\`gcloud billing accounts list\` prints a column *headed* ACCOUNT_ID - use the value
underneath that header, not the header itself:

EOF
    gcloud billing accounts list
    exit 1
  fi

  # A freshly created project can take a few seconds to become linkable, which surfaces as
  # the same INVALID_ARGUMENT. Retry briefly before concluding anything.
  for attempt in 1 2 3 4 5; do
    if gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT" --quiet; then
      echo "linked to ${BILLING_ACCOUNT}"
      break
    fi
    if [[ $attempt -eq 5 ]]; then
      echo "Could not link billing to ${PROJECT} after 5 attempts." >&2
      exit 1
    fi
    echo "link attempt ${attempt} failed; retrying in 5s ..."
    sleep 5
  done
fi

# --- APIs ------------------------------------------------------------------------------

step "Enabling APIs (this takes a minute)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  --quiet

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# A unique tag per build, not a floating ":latest".
#
# With ":latest" there is no way to tell from the job description which revision is actually
# running - which is precisely how a failure can look identical after a fix, because the old
# image is still deployed. A timestamped tag makes every deployment traceable, and the digest
# is printed after the build so the deployed image can be compared against it.
TAG="${TAG:-$(date -u +%Y%m%d-%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/gate2:${TAG}"

# --- Secret ----------------------------------------------------------------------------

step "Master token in Secret Manager"
# The token here must be a CLOUD-MINTED one. Google refuses to exchange a home-minted master
# token for an OAuth token from its datacenter network (BadAuthentication), but accepts a token
# that was itself minted from Cloud Run. So this script deliberately does NOT seed the secret
# from .env - that token works locally and fails here, and seeding it would look like success
# while breaking the probe.
if gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  VERSIONS="$(gcloud secrets versions list "$SECRET_NAME" --format='value(name)' 2>/dev/null | wc -l)"
  if [[ "$VERSIONS" -eq 0 ]]; then
    cat >&2 <<EOF

${SECRET_NAME} exists but has no version, so the probe cannot authenticate.

Mint a token FROM THE CLOUD by running the mint job, which needs a fresh oauth_token cookie
from a browser session logged in as the throwaway account:

  ./gcloud.sh secrets create keep-oauth-token --replication-policy=automatic --quiet
  read -rsp "oauth_token: " TOK && printf '%s' "\$TOK" | \\
    ./gcloud.sh secrets versions add keep-oauth-token --data-file=- && unset TOK
  ./gcloud.sh run jobs execute keep-mint --region ${REGION} --wait
  ./gcloud.sh secrets delete keep-oauth-token --quiet

See the "Minting" section of deploy/cloud-run/README.md.
EOF
    exit 1
  fi
  echo "secret present with ${VERSIONS} version(s) - leaving it alone"
else
  gcloud secrets create "$SECRET_NAME" --replication-policy=automatic --quiet
  echo "created empty; run the mint job to give it a cloud-minted token (see above)"
fi

gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null
echo "read access granted to ${RUN_SA}"

# --- Image -----------------------------------------------------------------------------

step "Building the image (reuses the spike's own modules; ignore files keep .env out)"
echo "tag: ${TAG}"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --quiet 2>/dev/null || true
# No --file flag exists: gcloud always builds the `Dockerfile` at the context root.
#
# Retried because a project that was created, and an API that was enabled, seconds ago can
# still refuse the call while IAM propagates - the same PERMISSION_DENIED as a genuine
# permissions problem, but transient.
build_ok=0
for attempt in 1 2 3; do
  if gcloud builds submit --tag "$IMAGE" . --quiet; then
    build_ok=1
    break
  fi
  if [[ $attempt -lt 3 ]]; then
    echo "build submit attempt ${attempt} failed; retrying in 20s ..." >&2
    sleep 20
  fi
done

if [[ $build_ok -ne 1 ]]; then
  cat >&2 <<EOF

gcloud builds submit failed three times.

Right after creating a project and enabling the Cloud Build API, this is usually IAM simply
not having propagated - re-running this script often just works.

If it persists, check which roles you hold on ${PROJECT}:

  ./gcloud.sh projects get-iam-policy ${PROJECT} \\
    --flatten="bindings[].members" \\
    --filter="bindings.members:${ACTIVE_ACCOUNT}" \\
    --format="table(bindings.role)"

The project creator should hold roles/owner. If that is missing:

  ./gcloud.sh projects add-iam-policy-binding ${PROJECT} \\
    --member="user:${ACTIVE_ACCOUNT}" --role="roles/owner"

Also confirm the Cloud Build service account exists:

  ./gcloud.sh iam service-accounts list --project ${PROJECT} | grep cloudbuild
EOF
  exit 1
fi

echo "built image: ${IMAGE}"
BUILT_DIGEST="$(gcloud artifacts docker images describe "$IMAGE" \
  --format='value(image_summary.digest)' 2>/dev/null || true)"
[[ -n "$BUILT_DIGEST" ]] && echo "built digest: ${BUILT_DIGEST}"

# --- Job -------------------------------------------------------------------------------

step "Cloud Run job"
KEEP_EMAIL_VALUE="$(grep '^KEEP_EMAIL=' .env | cut -d= -f2-)"
KEEP_DEVICE_ID_VALUE="$(grep '^KEEP_DEVICE_ID=' .env | cut -d= -f2-)"

# KEEP_DEVICE_ID must stay the value from .env: a changing device id makes Google treat
# every run as a new device, which is the pattern that triggers extra verification.
JOB_ARGS=(
  --image "$IMAGE"
  --region "$REGION"
  --set-env-vars "KEEP_EMAIL=${KEEP_EMAIL_VALUE},KEEP_DEVICE_ID=${KEEP_DEVICE_ID_VALUE}"
  --set-secrets "KEEP_MASTER_TOKEN=${SECRET_NAME}:latest"
  --max-retries 0
  --tasks 1
  --quiet
)

if gcloud run jobs describe "$JOB" --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB" "${JOB_ARGS[@]}"
  echo "updated"
else
  gcloud run jobs create "$JOB" "${JOB_ARGS[@]}"
  echo "created"
fi

# --- First run -------------------------------------------------------------------------

step "Executing once (the first Gate 2 data point)"
gcloud run jobs execute "$JOB" --region "$REGION" --wait --quiet

sleep 10  # let the log entries become queryable
echo
echo "--- result ---"
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\"" \
  --limit 5 --format='value(textPayload)' --freshness=1h

# --- Schedule --------------------------------------------------------------------------

step "Scheduling every 6 hours"
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member="serviceAccount:${RUN_SA}" --role="roles/run.invoker" --quiet >/dev/null

TRIGGER_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"
if gcloud scheduler jobs describe "${JOB}-6h" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB}-6h" --location "$REGION" \
    --schedule "$SCHEDULE" --uri "$TRIGGER_URI" --http-method POST \
    --oauth-service-account-email "$RUN_SA" --quiet
  echo "updated"
else
  gcloud scheduler jobs create http "${JOB}-6h" --location "$REGION" \
    --schedule "$SCHEDULE" --uri "$TRIGGER_URI" --http-method POST \
    --oauth-service-account-email "$RUN_SA" --quiet
  echo "created"
fi

# --- Done ------------------------------------------------------------------------------

cat <<EOF

=== Provisioned

  project   ${PROJECT}
  region    ${REGION}
  job       ${JOB}
  schedule  ${SCHEDULE}

Read the accumulated outcomes over the coming days with:

  gcloud logging read \\
    "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" \\
    --limit 200 --format='value(textPayload)' --freshness=7d | grep '"outcome"'

NEXT, and easy to forget: set a budget guardrail before walking away.
Cloud Run's free tier is a discount, not a cap, so usage past it is billed. Create a EUR 1
budget and attach the "disable billing" notification:
  https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications

Teardown when finished:
  gcloud scheduler jobs delete ${JOB}-6h --location ${REGION} --quiet
  gcloud run jobs delete ${JOB} --region ${REGION} --quiet
  gcloud artifacts repositories delete ${REPO} --location ${REGION} --quiet
  gcloud secrets delete ${SECRET_NAME} --quiet
EOF
