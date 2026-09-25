#!/usr/bin/env bash
# Provision (or update) the Keep gateway on Cloud Run.
#
# Creates and updates, idempotently, so this is also the "deploy a new build" path:
#
#   1. the Cloud Run *service* (public URL, scale-to-zero, gated by the caller's Google sign-in)
#   2. the log-based metric and the email alert for a rejected credential
#   3. the mint job's image, when the mint has been set up before
#
# Deliberately NOT done here: seeding the master token. A home-minted token is refused from
# Google Cloud's network (`BadAuthentication`), so the secret may only be filled by the mint
# job - see ./mint-token.sh and the README.
#
# Usage, from apps/keep-gateway:
#
#   ./deploy/cloud-run/provision.sh
#   ./deploy/cloud-run/provision.sh --allowed-origin https://user.github.io
#   ./deploy/cloud-run/provision.sh --skip-build          # redeploy the current revision
#
# Environment variables override every default: PROJECT, REGION, SERVICE, REPO, MASTER_SECRET,
# TINYURL_SECRET, OAUTH_CLIENT_ID, ALLOWED_EMAILS, MINT_JOB, ALLOWED_ORIGINS, ALERT_EMAIL, TAG.

set -euo pipefail

PROJECT="${PROJECT:-cookbook-keep}"
REGION="${REGION:-europe-west3}"
SERVICE="${SERVICE:-keep-gateway}"
REPO="${REPO:-keep-probe}"
MASTER_SECRET="${MASTER_SECRET:-keep-master-token-cloud}"
TINYURL_SECRET="${TINYURL_SECRET:-tinyurl-api-token}"
MINT_JOB="${MINT_JOB:-keep-mint}"
COOKIE_SECRET="${COOKIE_SECRET:-keep-oauth-token}"

# Caller identity: the OAuth client the web app is built with (the audience Google must confirm
# on every presented token) and the accounts allowed to call the gateway. Neither is a secret -
# the client id ships in the public bundle and the allowlist is a policy, not a credential.
# Empty OAUTH_CLIENT_ID is filled from the web app's own .env below, so the gateway cannot be
# pinned to a different client than the bundle it serves.
OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID:-}"
ALLOWED_EMAILS="${ALLOWED_EMAILS:-benjaminwegerich@gmail.com}"

# The shared token the app used to be asked to paste. It is no longer read by the service; the
# name is kept here only so the summary can offer the exact cleanup command (see the README,
# "Retiring the pasted token").
RETIRED_TOKEN_SECRET="${RETIRED_TOKEN_SECRET:-keep-gateway-token}"

# The browser origins allowed to call the gateway. Each is the exact scheme+host, no path:
# the published app on the repository's GitHub Pages site, plus the Vite dev server so
# developing against the deployed gateway keeps working (decided with the user: a remote page
# cannot claim a localhost origin, and the gateway token is still required either way). Add
# more with a comma, or override the whole list with --allowed-origin.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://benjaminwegerich.github.io,http://localhost:5173}"

# Where the "credential rejected" alert goes. Must be an address Google can send to.
ALERT_EMAIL="${ALERT_EMAIL:-benjaminwegerich@gmail.com}"

SKIP_BUILD=0
KEEP_EMAIL="${KEEP_EMAIL:-}"
KEEP_DEVICE_ID="${KEEP_DEVICE_ID:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)         PROJECT="$2";         shift 2 ;;
    --region)          REGION="$2";          shift 2 ;;
    --allowed-origin)  ALLOWED_ORIGINS="$2"; shift 2 ;;
    --alert-email)     ALERT_EMAIL="$2";     shift 2 ;;
    --keep-email)      KEEP_EMAIL="$2";      shift 2 ;;
    --keep-device-id)  KEEP_DEVICE_ID="$2";  shift 2 ;;
    --oauth-client-id) OAUTH_CLIENT_ID="$2"; shift 2 ;;
    --allowed-emails)  ALLOWED_EMAILS="$2";  shift 2 ;;
    --skip-build)      SKIP_BUILD=1;         shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s\n' "$1"; }

# --- Locate gcloud and the component's own paths ---------------------------------------
GATEWAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$GATEWAY_DIR/../.." && pwd)"
SPIKE_DIR="$REPO_ROOT/spike/keep-feasibility"

# The SDK lives unpacked in the spike directory rather than system-wide, so a bare `gcloud`
# may well not be on PATH. Prepend it (resolved from this script's location) so every call
# below just works.
if [[ -x "$SPIKE_DIR/.tools/google-cloud-sdk/bin/gcloud" ]]; then
  PATH="$SPIKE_DIR/.tools/google-cloud-sdk/bin:$PATH"
fi
command -v gcloud >/dev/null || { echo "gcloud not found - see the README's prerequisites." >&2; exit 1; }

# --- Preconditions ---------------------------------------------------------------------
ACTIVE_ACCOUNT="$(gcloud config get-value account --quiet 2>/dev/null || true)"
if [[ -z "$ACTIVE_ACCOUNT" || "$ACTIVE_ACCOUNT" == "(unset)" ]]; then
  echo "Not authenticated. Run:  gcloud auth login" >&2
  exit 1
fi
echo "Authenticated as ${ACTIVE_ACCOUNT}"

# The throwaway account's identifiers live in the spike's .env. They are not secrets (only
# the master token is), but they must match the token exactly: a different device id makes
# Google treat the deployment as a new device.
if [[ -f "$SPIKE_DIR/.env" ]]; then
  [[ -n "$KEEP_EMAIL" ]] || KEEP_EMAIL="$(grep '^KEEP_EMAIL=' "$SPIKE_DIR/.env" | cut -d= -f2- || true)"
  [[ -n "$KEEP_DEVICE_ID" ]] || KEEP_DEVICE_ID="$(grep '^KEEP_DEVICE_ID=' "$SPIKE_DIR/.env" | cut -d= -f2- || true)"
fi
[[ -n "$KEEP_EMAIL" ]] || { echo "KEEP_EMAIL unknown: pass --keep-email or keep it in $SPIKE_DIR/.env" >&2; exit 1; }
[[ -n "$KEEP_DEVICE_ID" ]] || { echo "KEEP_DEVICE_ID unknown: pass --keep-device-id or keep it in $SPIKE_DIR/.env" >&2; exit 1; }

# The caller identity: the client id comes from the web app's own .env when it is not given, so
# gateway and bundle cannot drift apart (a mismatch would show up as every sign-in being refused
# with an audience error in the log).
WEB_ENV="$REPO_ROOT/apps/web/.env"
if [[ -z "$OAUTH_CLIENT_ID" && -f "$WEB_ENV" ]]; then
  OAUTH_CLIENT_ID="$(grep '^VITE_GOOGLE_CLIENT_ID=' "$WEB_ENV" | cut -d= -f2- || true)"
fi
[[ -n "$OAUTH_CLIENT_ID" ]] || {
  echo "OAUTH_CLIENT_ID unknown: pass --oauth-client-id, or set VITE_GOOGLE_CLIENT_ID in $WEB_ENV" >&2
  exit 1
}
[[ -n "$ALLOWED_EMAILS" ]] || { echo "ALLOWED_EMAILS empty: nobody could call the gateway, which would switch Keep off" >&2; exit 1; }

# --- Project and APIs ------------------------------------------------------------------
step "Project ${PROJECT}"
gcloud config set project "$PROJECT" --quiet

step "Enabling APIs (no-op when already enabled)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --quiet

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# --- Master token secret ---------------------------------------------------------------
step "Master token secret (${MASTER_SECRET})"
if ! gcloud secrets describe "$MASTER_SECRET" >/dev/null 2>&1; then
  cat >&2 <<EOF
${MASTER_SECRET} does not exist.
It is created by the mint (see ./mint-token.sh), because only a cloud-minted token works
from Cloud Run. Run the mint first, or check the secret name.
EOF
  exit 1
fi
VERSIONS="$(gcloud secrets versions list "$MASTER_SECRET" --format='value(name)' 2>/dev/null | wc -l)"
if [[ "$VERSIONS" -eq 0 ]]; then
  echo "${MASTER_SECRET} has no version yet - run ./mint-token.sh before relying on the service." >&2
else
  echo "present with ${VERSIONS} version(s)"
fi

gcloud secrets add-iam-policy-binding "$MASTER_SECRET" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
echo "read access granted to ${RUN_SA}"

# --- TinyURL secret (optional) ---------------------------------------------------------
# The shortener's API token. Unlike the master token it is created once by the operator
# (`gcloud secrets create`, see the README) - there is nothing to mint here. It is optional
# on purpose: without it the gateway answers `shortening_disabled` and the app keeps writing
# the long export URL, so a deployment that never sets it stays fully functional. A secret
# with no version is treated as absent, because Cloud Run refuses to deploy a reference to it.
step "TinyURL secret (${TINYURL_SECRET}, optional)"
SECRET_BINDINGS="KEEP_MASTER_TOKEN=${MASTER_SECRET}:latest"
SHORTENING_STATE="off"
if gcloud secrets describe "$TINYURL_SECRET" >/dev/null 2>&1; then
  TINYURL_VERSIONS="$(gcloud secrets versions list "$TINYURL_SECRET" --format='value(name)' 2>/dev/null | wc -l)"
  if [[ "$TINYURL_VERSIONS" -gt 0 ]]; then
    gcloud secrets add-iam-policy-binding "$TINYURL_SECRET" \
      --member="serviceAccount:${RUN_SA}" \
      --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
    SECRET_BINDINGS="${SECRET_BINDINGS},TINYURL_API_TOKEN=${TINYURL_SECRET}:latest"
    SHORTENING_STATE="on"
    echo "present with ${TINYURL_VERSIONS} version(s) - export-link shortening is on"
  else
    echo "${TINYURL_SECRET} has no version, so it is not bound - export links stay long" >&2
  fi
else
  echo "no ${TINYURL_SECRET} - export links stay long (the app falls back to the host URL)" >&2
fi

# --- Image -----------------------------------------------------------------------------
step "Image"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" --quiet 2>/dev/null || true

if [[ "$SKIP_BUILD" -eq 1 ]]; then
  # Reuse the tag of the current service revision, so a redeploy without a rebuild is exact.
  TAG="${TAG:-$(gcloud run services describe "$SERVICE" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].image)' 2>/dev/null | awk -F: '{print $NF}')}"
  [[ -n "$TAG" ]] || { echo "--skip-build needs an existing service or an explicit TAG" >&2; exit 1; }
  echo "reusing tag ${TAG}"
else
  # A unique tag per build: with ":latest" there is no way to tell from the service
  # description which build is actually running, which is how a failed fix looks identical.
  TAG="${TAG:-$(date -u +%Y%m%d-%H%M%S)}"
fi
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/keep-gateway:${TAG}"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "building ${IMAGE}"
  # No --file flag exists: gcloud builds the Dockerfile at the build-context root, which is
  # why the gateway directory holds its own Dockerfile.
  ( cd "$GATEWAY_DIR" && gcloud builds submit --tag "$IMAGE" . --quiet )
fi

# --- Service ---------------------------------------------------------------------------
step "Cloud Run service (${SERVICE})"
# Two flags deserve their reasoning:
#
#   --allow-unauthenticated  The web app is a static bundle in a browser: it cannot hold a
#                            Cloud Run IAM credential. The gate is the caller's Google sign-in,
#                            checked inside the service - so the URL itself is public and
#                            useless without an allowed account.
#   --min-instances 0        Scale to zero. A cold Keep sync is ~1s, so the cold start is
#                            invisible and the free tier covers this workload.
#
# Environment goes through a temporary YAML file rather than `--set-env-vars`. That flag
# splits on a delimiter, and no natural delimiter survives here: the throwaway address, the
# allowlist and the origin list all contain "@" or ",". A file has no delimiter rules.
ENV_FILE="$(mktemp --suffix=.yaml)"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<EOF
KEEP_EMAIL: "${KEEP_EMAIL}"
KEEP_DEVICE_ID: "${KEEP_DEVICE_ID}"
KEEP_GATEWAY_ALLOWED_ORIGINS: "${ALLOWED_ORIGINS}"
KEEP_OAUTH_CLIENT_ID: "${OAUTH_CLIENT_ID}"
KEEP_ALLOWED_EMAILS: "${ALLOWED_EMAILS}"
EOF

SERVICE_ARGS=(
  --image "$IMAGE"
  --region "$REGION"
  --allow-unauthenticated
  --min-instances 0
  --max-instances 2
  --cpu 1
  --memory 512Mi
  --concurrency 8
  --timeout 30
  --env-vars-file "$ENV_FILE"
  --set-secrets "$SECRET_BINDINGS"
  --quiet
)

# `gcloud run deploy` creates the service or rolls a new revision for an existing one, so
# this is both the first deploy and the update path - one code path, no drift between them.
gcloud run deploy "$SERVICE" "${SERVICE_ARGS[@]}"

SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "url: ${SERVICE_URL}"

# --- Monitoring ------------------------------------------------------------------------
step "Log-based metric and alert"
# A failure here must not hide the successful deploy above: the service is already serving,
# and a brand-new log-based metric can take minutes to become referenceable by Monitoring.
# So this step reports, continues to the summary, and makes the script exit non-zero at the
# very end.
MONITORING_FAILED=0
GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
  python3 "$GATEWAY_DIR/deploy/cloud-run/setup_monitoring.py" \
    --project "$PROJECT" --service "$SERVICE" --email "$ALERT_EMAIL" || MONITORING_FAILED=1

if [[ "$MONITORING_FAILED" -ne 0 ]]; then
  cat >&2 <<EOF

The metric and the notification channel are in place, but the alert policy is not.
Re-run just this part (no rebuild needed), with a longer wait:

  cd ${GATEWAY_DIR}
  GOOGLE_ACCESS_TOKEN="\$(gcloud auth print-access-token)" \\
    python3 deploy/cloud-run/setup_monitoring.py \\
      --project ${PROJECT} --service ${SERVICE} --email ${ALERT_EMAIL} \\
      --policy-retries 12 --policy-retry-delay 60
EOF
fi

# --- Mint job --------------------------------------------------------------------------
step "Mint job (${MINT_JOB})"
# The mint job shares the service image and only overrides the container command, so the
# credential logic and its diagnosis exist in one place. It is (re)pointed at the new image
# only once the cookie secret exists: Cloud Run refuses a job that references a secret with
# no versions, and that secret is deliberately created only for the minutes a mint needs.
if gcloud secrets describe "$COOKIE_SECRET" >/dev/null 2>&1; then
  if gcloud run jobs describe "$MINT_JOB" --region "$REGION" >/dev/null 2>&1; then
    gcloud run jobs update "$MINT_JOB" --region "$REGION" --image "$IMAGE" --quiet
    echo "updated to ${TAG}"
  else
    echo "cookie secret exists but no ${MINT_JOB} job - run ./mint-token.sh to create it"
  fi
else
  echo "no ${COOKIE_SECRET} secret, so the job is left alone (./mint-token.sh sets it up)"
fi

# --- Summary ---------------------------------------------------------------------------
cat <<EOF

=== Provisioned

  project    ${PROJECT}
  region     ${REGION}
  service    ${SERVICE}
  url        ${SERVICE_URL}
  image      ${IMAGE}
  origins    ${ALLOWED_ORIGINS}
  caller     ${ALLOWED_EMAILS} (via ${OAUTH_CLIENT_ID})
  shorten    ${SHORTENING_STATE} (${TINYURL_SECRET})
  alert to   ${ALERT_EMAIL}

NEXT
  1. The master token. If the service logs keep the credential is rejected, or nothing has
     been minted yet, run:
       ./deploy/cloud-run/mint-token.sh
  2. Check the deployment:
       curl -s ${SERVICE_URL}/health
  3. The retired app token. This deployment no longer uses KEEP_GATEWAY_TOKEN; if the secret
     ${RETIRED_TOKEN_SECRET} still exists, delete it and remove the stored password from Google
     Passwords (see the README, "Retiring the pasted token"):
       gcloud secrets delete ${RETIRED_TOKEN_SECRET}
  4. Export-link shortening is ${SHORTENING_STATE}. It needs the operator-created secret
     ${TINYURL_SECRET} (a TinyURL API token); create it and re-run this script to turn it on
     (README, "The TinyURL secret"). Without it the meal-plan line carries the long export
     URL and everything else works unchanged.
  5. Budget guardrail, if not set already (free tier is a discount, not a cap):
       https://console.cloud.google.com/billing/budgets

Teardown is in the README (section "Teardown").
EOF

if [[ "$MONITORING_FAILED" -ne 0 ]]; then
  echo "NOTE: the alert policy is still missing - see the instructions above." >&2
fi
exit "$MONITORING_FAILED"
