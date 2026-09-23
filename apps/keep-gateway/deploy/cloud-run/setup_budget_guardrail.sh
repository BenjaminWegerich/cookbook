#!/usr/bin/env bash
# Arm the billing guardrail: budget -> Pub/Sub topic -> function that detaches billing.
#
# Google is explicit that a budget is an alarm, not a cap: reaching a threshold does not stop
# usage or billing. This script builds the only thing that does - a function that detaches the
# project from its billing account once the budget is genuinely spent.
#
# Rollout order is enforced rather than advised: the function is always deployed with
# DRY_RUN=true, so the whole chain can be proved with a synthetic notification before it is
# able to switch anything off. Re-run with --armed to let it act.
#
# Usage, from apps/keep-gateway:
#
#   ./deploy/cloud-run/setup_budget_guardrail.sh            # wire it up, disarmed
#   ./deploy/cloud-run/setup_budget_guardrail.sh --test     # prove the chain (sends one message)
#   ./deploy/cloud-run/setup_budget_guardrail.sh --armed    # let it actually cut billing off
#   ./deploy/cloud-run/setup_budget_guardrail.sh --budget-only
#
# Environment overrides: PROJECT, REGION, GUARD_PROJECT, TOPIC, FUNCTION, SA_NAME, AMOUNT,
# CURRENCY, BUDGET_NAME.

set -euo pipefail

PROJECT="${PROJECT:-cookbook-keep}"
REGION="${REGION:-europe-west3}"
GUARD_PROJECT="${GUARD_PROJECT:-$PROJECT}"
TOPIC="${TOPIC:-budget-guardrail}"
FUNCTION="${FUNCTION:-stop-billing}"
SA_NAME="${SA_NAME:-budget-guardrail}"
AMOUNT="${AMOUNT:-1}"
CURRENCY="${CURRENCY:-EUR}"
BUDGET_NAME="${BUDGET_NAME:-Keep gateway guardrail}"

ARMED=0
BUDGET_ONLY=0
RUN_TEST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --armed)       ARMED=1;       shift ;;
    --budget-only) BUDGET_ONLY=1; shift ;;
    --test)        RUN_TEST=1;    shift ;;
    --project)     PROJECT="$2"; GUARD_PROJECT="$2"; shift 2 ;;
    --region)      REGION="$2";   shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s\n' "$1"; }

# --- Locate gcloud -----------------------------------------------------------------------
GATEWAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPIKE_DIR="$(cd "$GATEWAY_DIR/../.." && pwd)/spike/keep-feasibility"
if [[ -x "$SPIKE_DIR/.tools/google-cloud-sdk/bin/gcloud" ]]; then
  PATH="$SPIKE_DIR/.tools/google-cloud-sdk/bin:$PATH"
fi
command -v gcloud >/dev/null || { echo "gcloud not found - see the README's prerequisites." >&2; exit 1; }

ACTIVE_ACCOUNT="$(gcloud config get-value account --quiet 2>/dev/null || true)"
[[ -n "$ACTIVE_ACCOUNT" && "$ACTIVE_ACCOUNT" != "(unset)" ]] || { echo "Run: gcloud auth login" >&2; exit 1; }
echo "Authenticated as ${ACTIVE_ACCOUNT}"

# A test run only needs the topic and the function that are already there: publishing a
# synthetic notification should not rebuild an image or touch the budget.
SKIP_SETUP=0
if [[ "$RUN_TEST" -eq 1 ]]; then SKIP_SETUP=1; fi

# --- The billing account that will be detached ------------------------------------------
step "Billing account"
BILLING_ACCOUNT="$(gcloud billing projects describe "$GUARD_PROJECT" \
  --format='value(billingAccountName.basename())' 2>/dev/null || true)"
[[ -n "$BILLING_ACCOUNT" ]] || {
  echo "${GUARD_PROJECT} is not linked to a billing account, so there is nothing to guard." >&2
  exit 1
}
echo "${GUARD_PROJECT} is billed to ${BILLING_ACCOUNT}"

if [[ "$SKIP_SETUP" -eq 0 && "$BUDGET_ONLY" -eq 0 ]]; then

  # --- APIs -----------------------------------------------------------------------------
  step "Enabling APIs (no-op when already enabled)"
  gcloud services enable \
    pubsub.googleapis.com \
    cloudfunctions.googleapis.com \
    eventarc.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    billingbudgets.googleapis.com \
    cloudbilling.googleapis.com \
    iam.googleapis.com \
    --quiet

  # --- Topic ----------------------------------------------------------------------------
  step "Pub/Sub topic (${TOPIC})"
  if gcloud pubsub topics describe "$TOPIC" >/dev/null 2>&1; then
    echo "already exists"
  else
    gcloud pubsub topics create "$TOPIC" --quiet
    echo "created"
  fi

  # --- Service account ------------------------------------------------------------------
  step "Service account (${SA_NAME})"
  SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
    echo "already exists"
  else
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Budget guardrail (disables billing when the budget is spent)" --quiet
    echo "created"
  fi
  # Which role, and why it is not the narrow one.
  #
  # The Cloud Billing API checks `billing.resourceAssociations.create` / `.delete`, and those
  # permissions live on the BILLING ACCOUNT - not on the project. The project-level
  # roles/billing.projectManager carries resourcemanager.projects.createBillingAssignment and
  # .deleteBillingAssignment, which sounds right and is not: verified against the live API, the
  # call with projectManager returns 403 "IAM_PERMISSION_DENIED ... permission:
  # billing.resourceAssociations.create", while the same call with billing.admin returns 200.
  # There is no organization on this account, so a custom role holding exactly those two
  # permissions cannot be created either - billing.admin is the narrowest predefined role that
  # can do the job, and it is what Google's own disable-billing recipe uses.
  #
  # What that means in practice: one single-purpose service account, usable only by this
  # function, whose only code calls updateBillingInfo. Removing this binding disarms the
  # automatic cut-off; the budget's email alerts keep working either way.
  gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/billing.admin" --quiet >/dev/null
  echo "granted roles/billing.admin on billing account ${BILLING_ACCOUNT}"

  # --- Function -------------------------------------------------------------------------
  step "Function (${FUNCTION})"
  # DRY_RUN is set on every deploy of this script: an update that silently re-armed a
  # previously disarmed guardrail would be worse than one extra --armed run.
  if [[ "$ARMED" -eq 1 ]]; then
    DRY_RUN_VALUE="false"
    echo "ARMED: the function will detach billing when the budget is spent"
  else
    DRY_RUN_VALUE="true"
    echo "DISARMED: the function will only log what it would do"
  fi

  gcloud functions deploy "$FUNCTION" \
    --gen2 \
    --region "$REGION" \
    --runtime python312 \
    --source "$GATEWAY_DIR/deploy/cloud-run/budget-guardrail" \
    --entry-point stop_billing \
    --trigger-topic "$TOPIC" \
    --run-service-account "$SA_EMAIL" \
    --set-env-vars "GUARD_PROJECT=${GUARD_PROJECT},DRY_RUN=${DRY_RUN_VALUE}" \
    --memory 256Mi \
    --max-instances 1 \
    --timeout 60 \
    --quiet

fi

# --- Budget ------------------------------------------------------------------------------
if [[ "$SKIP_SETUP" -eq 0 ]]; then
  step "Budget (${AMOUNT} ${CURRENCY}, scoped to ${GUARD_PROJECT})"
  GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
    python3 "$GATEWAY_DIR/deploy/cloud-run/setup_budget.py" \
      --billing-account "$BILLING_ACCOUNT" \
      --project "$PROJECT" \
      --guard-project "$GUARD_PROJECT" \
      --amount "$AMOUNT" \
      --currency "$CURRENCY" \
      --topic "$TOPIC" \
      --display-name "$BUDGET_NAME"
fi

# --- Prove the chain ---------------------------------------------------------------------
if [[ "$RUN_TEST" -eq 1 ]]; then
  step "Proving the chain with a synthetic notification"

  # The message below reports a SPENT budget, so on an armed guardrail it would detach billing
  # for real. Check first and refuse: a self-test must never be the reason a project goes
  # dark, and the dry run is the only state in which this test is meaningful anyway.
  CURRENT_DRY_RUN="$(gcloud run services describe "$FUNCTION" --region "$REGION" --format=json 2>/dev/null \
    | python3 -c 'import json,sys
spec = json.load(sys.stdin)
envs = spec["spec"]["template"]["spec"]["containers"][0].get("env", [])
print(next((entry.get("value", "") for entry in envs if entry.get("name") == "DRY_RUN"), ""))' 2>/dev/null || true)"

  if [[ "$CURRENT_DRY_RUN" != "true" ]]; then
    cat >&2 <<EOF

The guardrail is ARMED (DRY_RUN is "${CURRENT_DRY_RUN:-unset}"), so a spent-budget test message
would disable billing on ${GUARD_PROJECT} for real. Nothing was published.

Prove the chain in the disarmed state instead:

  ./deploy/cloud-run/setup_budget_guardrail.sh          # redeploy disarmed
  ./deploy/cloud-run/setup_budget_guardrail.sh --test   # prove it
  ./deploy/cloud-run/setup_budget_guardrail.sh --armed  # arm it again
EOF
    exit 1
  fi

  # costAmount > budgetAmount, so the guardrail reaches its decision. With DRY_RUN=true it
  # stops one call short of the Cloud Billing API - which is the point of the dry run.
  gcloud pubsub topics publish "$TOPIC" \
    --message "{\"budgetDisplayName\": \"${BUDGET_NAME}\", \"costAmount\": $((AMOUNT + 4)), \"budgetAmount\": ${AMOUNT}, \"currencyCode\": \"${CURRENCY}\", \"alertThresholdExceeded\": 1.0, \"selftest\": true}" \
    --quiet

  echo "waiting for the function ..."
  sleep 15
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${FUNCTION}\"" \
    --limit 10 --freshness=10m --format='value(textPayload)' | grep -i guardrail || {
      echo "No guardrail line yet - the function may still be cold-starting; read the log again with:"
      echo "  gcloud logging read 'resource.labels.service_name=\"${FUNCTION}\"' --limit 20 --freshness=15m --format='value(textPayload)'"
    }
fi

# --- Summary -----------------------------------------------------------------------------
cat <<EOF

=== Guardrail

  project    ${GUARD_PROJECT} (billing account ${BILLING_ACCOUNT})
  budget     ${BUDGET_NAME}: ${AMOUNT} ${CURRENCY}, thresholds 50/90/100% spent, 100% forecast
  topic      ${TOPIC}
  function   ${FUNCTION} (gen2, ${REGION}), service account ${SA_NAME}@${PROJECT}.iam.gserviceaccount.com
  state      $([[ "$ARMED" -eq 1 ]] && echo "ARMED - will disable billing when the budget is spent" || echo "DISARMED (DRY_RUN=true)")

NEXT
  1. Prove the chain while it is still disarmed:
       ./deploy/cloud-run/setup_budget_guardrail.sh --test
  2. Once the log shows "DRY RUN - would disable billing ...", arm it:
       ./deploy/cloud-run/setup_budget_guardrail.sh --armed
  3. Inspect the budget in the Console:
       https://console.cloud.google.com/billing/${BILLING_ACCOUNT}/budgets

IF IT EVER FIRES
  The project loses its billing account and everything server-side stops (the gateway, builds,
  logs beyond the free allowance). Re-attach it here:
    https://console.cloud.google.com/billing/linkedaccount?project=${GUARD_PROJECT}
  The gateway is stateless, so re-linking is all that is needed - no redeploy.
EOF
