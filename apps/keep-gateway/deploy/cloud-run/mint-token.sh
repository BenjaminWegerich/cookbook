#!/usr/bin/env bash
# Mint (or re-mint) the Keep master token - the recovery path for a dead credential.
#
# Why this is a script and not a paragraph in a README: a re-mint needs a browser cookie *and*
# a cloud-side exchange, so the runbook is the difference between a recoverable outage and a
# lost integration. Every step that is easy to get wrong is encoded here:
#
#   * the cookie is pasted at a hidden prompt, never on a command line or in shell history
#   * it is written to its own secret, used once, and destroyed again even when the mint fails
#   * the mint runs as a Cloud Run job in the cloud, because Google refuses a home-minted
#     token from its network
#   * the job refuses to store a token that can see more checklists than the throwaway
#     account should (the "wrong browser profile" accident, which would mint a full-access
#     token for the main account)
#   * the service is given a fresh revision afterwards, so it actually reads the new version
#
# Usage, from apps/keep-gateway:
#
#   ./deploy/cloud-run/mint-token.sh
#
# Environment variables: PROJECT, REGION, SERVICE, MINT_JOB, MASTER_SECRET, COOKIE_SECRET,
# KEEP_EMAIL, KEEP_DEVICE_ID (the last two default to the spike's .env).

set -euo pipefail

PROJECT="${PROJECT:-cookbook-keep}"
REGION="${REGION:-europe-west3}"
SERVICE="${SERVICE:-keep-gateway}"
MINT_JOB="${MINT_JOB:-keep-mint}"
MASTER_SECRET="${MASTER_SECRET:-keep-master-token-cloud}"
COOKIE_SECRET="${COOKIE_SECRET:-keep-oauth-token}"

step() { printf '\n=== %s\n' "$1"; }

GATEWAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPIKE_DIR="$(cd "$GATEWAY_DIR/../.." && pwd)/spike/keep-feasibility"
if [[ -x "$SPIKE_DIR/.tools/google-cloud-sdk/bin/gcloud" ]]; then
  PATH="$SPIKE_DIR/.tools/google-cloud-sdk/bin:$PATH"
fi
command -v gcloud >/dev/null || { echo "gcloud not found - see the README's prerequisites." >&2; exit 1; }

# --- Preconditions ---------------------------------------------------------------------
gcloud config set project "$PROJECT" --quiet
ACTIVE_ACCOUNT="$(gcloud config get-value account --quiet 2>/dev/null || true)"
[[ -n "$ACTIVE_ACCOUNT" && "$ACTIVE_ACCOUNT" != "(unset)" ]] || { echo "Run: gcloud auth login" >&2; exit 1; }
echo "Authenticated as ${ACTIVE_ACCOUNT}"

KEEP_EMAIL="${KEEP_EMAIL:-}"
KEEP_DEVICE_ID="${KEEP_DEVICE_ID:-}"
if [[ -f "$SPIKE_DIR/.env" ]]; then
  [[ -n "$KEEP_EMAIL" ]] || KEEP_EMAIL="$(grep '^KEEP_EMAIL=' "$SPIKE_DIR/.env" | cut -d= -f2- || true)"
  [[ -n "$KEEP_DEVICE_ID" ]] || KEEP_DEVICE_ID="$(grep '^KEEP_DEVICE_ID=' "$SPIKE_DIR/.env" | cut -d= -f2- || true)"
fi
[[ -n "$KEEP_EMAIL" && -n "$KEEP_DEVICE_ID" ]] || {
  echo "KEEP_EMAIL / KEEP_DEVICE_ID unknown - keep them in $SPIKE_DIR/.env or export them." >&2
  exit 1
}

# The service image is the mint job's image: one artifact, so the authentication and its
# diagnosis cannot differ between the service and the job that mints for it.
IMAGE="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
[[ -n "$IMAGE" ]] || {
  echo "Service ${SERVICE} not found in ${REGION}. Deploy it first: ./deploy/cloud-run/provision.sh" >&2
  exit 1
}
echo "Image: ${IMAGE}"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# --- The cookie, in its own short-lived secret -----------------------------------------
step "Preparing the one-time cookie secret (${COOKIE_SECRET})"
if gcloud secrets describe "$COOKIE_SECRET" >/dev/null 2>&1; then
  echo "already exists - a previous run left it behind; reusing it for this mint"
else
  gcloud secrets create "$COOKIE_SECRET" --replication-policy=automatic --quiet
fi
gcloud secrets add-iam-policy-binding "$COOKIE_SECRET" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
# The mint writes the *new* token through the metadata server, which the job's service account
# must be allowed to do. The spike granted this by hand; doing it here removes the ambiguity.
gcloud secrets add-iam-policy-binding "$MASTER_SECRET" \
  --member="serviceAccount:${RUN_SA}" \
  --role="roles/secretmanager.secretVersionAdder" --quiet >/dev/null

cat <<'EOF'

In a browser session logged in as the THROWAWAY account (never the main one):

  1. Open https://accounts.google.com/EmbeddedSetup and log in; click "I agree".
     The page may keep loading forever - that is expected.
  2. DevTools (F12) -> Application -> Cookies -> https://accounts.google.com
  3. Copy the value of the `oauth_token` cookie.

It is a short-lived, full-access session credential: it is used once, right now, and deleted
again immediately afterwards - including when the mint fails.

EOF
read -rsp "oauth_token (not echoed): " OAUTH_COOKIE
echo
[[ -n "$OAUTH_COOKIE" ]] || { echo "No cookie entered - nothing done." >&2; exit 1; }
printf '%s' "$OAUTH_COOKIE" | gcloud secrets versions add "$COOKIE_SECRET" --data-file=- --quiet >/dev/null
unset OAUTH_COOKIE
echo "cookie stored as a new version of ${COOKIE_SECRET}"

# --- Mint job --------------------------------------------------------------------------
step "Mint job (${MINT_JOB})"
# Environment through a temporary YAML file, for the same reason as in provision.sh:
# KEEP_EMAIL contains "@", which no sensible --set-env-vars delimiter can survive.
ENV_FILE="$(mktemp --suffix=.yaml)"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<EOF
KEEP_EMAIL: "${KEEP_EMAIL}"
KEEP_DEVICE_ID: "${KEEP_DEVICE_ID}"
GOOGLE_CLOUD_PROJECT: "${PROJECT}"
TARGET_SECRET: "${MASTER_SECRET}"
EOF

JOB_ARGS=(
  --image "$IMAGE"
  --region "$REGION"
  --command /usr/local/bin/python
  --args "-m,ops.mint_in_cloud"
  --env-vars-file "$ENV_FILE"
  --set-secrets "KEEP_OAUTH_TOKEN=${COOKIE_SECRET}:latest"
  --cpu 1
  --memory 512Mi
  --tasks 1
  --max-retries 0
  --quiet
)
# --max-retries 0 is deliberate: a refusal is the finding we are looking for, and retrying it
# would only repeat the same failure against the same cookie.

if gcloud run jobs describe "$MINT_JOB" --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$MINT_JOB" "${JOB_ARGS[@]}"
  echo "updated"
else
  gcloud run jobs create "$MINT_JOB" "${JOB_ARGS[@]}"
  echo "created"
fi

# --- Run -------------------------------------------------------------------------------
step "Minting from the cloud"
MINT_FAILED=0
gcloud run jobs execute "$MINT_JOB" --region "$REGION" --wait --quiet || MINT_FAILED=1

sleep 5  # let the log entries become queryable before reading them back
echo
echo "--- mint record ---"
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${MINT_JOB}\"" \
  --limit 40 --format='value(textPayload)' --freshness=15m

# --- Destroy the cookie, success or failure --------------------------------------------
step "Destroying the cookie secret"
# The cookie is a live session credential for the throwaway account. It goes away now, even
# when the mint failed: a failure needs a *fresh* cookie anyway, because the one we just used
# may have been invalidated by the attempt.
gcloud secrets delete "$COOKIE_SECRET" --quiet >/dev/null
echo "deleted ${COOKIE_SECRET}"

if [[ "$MINT_FAILED" -ne 0 ]]; then
  cat >&2 <<EOF

The mint did not succeed (the job exited non-zero; its record is printed above).
Nothing was changed in Secret Manager unless the record says it was stored.

  * "rejected this origin" / keep_auth_rejected  -> re-run with a FRESH cookie
  * ABORTED, too many checklists                 -> the cookie came from the main account's
                                                    browser profile; re-copy it from the
                                                    throwaway account
  * missing env / config                         -> a variable is empty; see the record
EOF
  exit 1
fi

# --- Point the service at the new version ----------------------------------------------
step "Rolling the service to the new secret version"
# A revision that references `:latest` resolves it when an instance starts. Existing instances
# keep the value they started with, so the service needs a new revision to pick the new token
# up - there is no way to update a running instance's secret.
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-secrets "KEEP_MASTER_TOKEN=${MASTER_SECRET}:latest" --quiet
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

# --- End-to-end check ------------------------------------------------------------------
step "Checking the service against Keep"
# Read the app's token only to make this one authenticated call; it is never printed. This is
# the check that matters: /health cannot tell a working credential from a dead one.
GATEWAY_TOKEN="$(gcloud secrets versions access latest --secret=keep-gateway-token 2>/dev/null || true)"
if [[ -z "$GATEWAY_TOKEN" ]]; then
  echo "could not read the gateway token secret; check by hand:"
  echo "  curl -s -H 'Authorization: Bearer <token>' ${SERVICE_URL}/keep/state"
else
  curl -s -H "Authorization: Bearer ${GATEWAY_TOKEN}" "${SERVICE_URL}/keep/state" \
    | python3 -c '
import json, sys
try:
    body = json.load(sys.stdin)
except json.JSONDecodeError:
    print("unexpected (non-JSON) answer - see the service log"); sys.exit(0)
if "error" in body:
    print("FAILED:", body["error"]["code"], "-", body["error"]["message"])
else:
    print("OK:", body["mealplan"]["title"], len(body["mealplan"]["items"]), "items,",
          body["shopping"]["title"], len(body["shopping"]["items"]), "items")
'
  unset GATEWAY_TOKEN
fi

cat <<EOF

=== Done

  service  ${SERVICE}
  url      ${SERVICE_URL}

The new token is the latest version of ${MASTER_SECRET}; the previous one is still there as an
older version if you need to compare. The credential alert (email) is wired to
keep_auth_rejected, so the next silent death will not stay silent.
EOF
