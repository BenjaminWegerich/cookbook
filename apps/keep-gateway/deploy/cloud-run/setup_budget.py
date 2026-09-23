#!/usr/bin/env python3
"""Create (or converge) the Cloud Billing budget that arms the guardrail.

Two things matter about the budget this creates:

* **It is scoped to the one project**, not the whole billing account, so an unrelated project
  could never trip the cut-off.
* **Credits count.** With `INCLUDE_ALL_CREDITS` the tracked cost is usage *minus* credits, so
  the free tier keeps the number at zero and only real money can cross the threshold.

The threshold rules are the email early warnings; the Pub/Sub topic is what lets the guardrail
function act. Both are attached here, so the budget never exists in a state where it can only
send mail.

Idempotent: a budget with the same display name is patched rather than duplicated.
`--dry-run` prints the exact payload and touches nothing.

Access token: from GOOGLE_ACCESS_TOKEN (the shell script passes `gcloud auth print-access-token`).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUDGETS_API = "https://billingbudgets.googleapis.com/v1"
DEFAULT_DISPLAY_NAME = "Keep gateway guardrail"


def api(method: str, url: str, token: str, quota_project: str, body: dict | None = None) -> dict:
    """Call the Billing Budgets API, returning the decoded JSON response.

    `x-goog-user-project` names the project the call is billed and rate-limited against, which
    the API requires when it is called with user credentials rather than a service account.
    """
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("x-goog-user-project", quota_project)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> {error.code}: {detail[:400]}") from error
    return json.loads(payload) if payload.strip() else {}


def budget_payload(
    guard_project: str, display_name: str, amount: float, currency: str, topic: str
) -> dict:
    """The budget body: project-scoped amount, four thresholds, and the guardrail topic."""
    return {
        "displayName": display_name,
        "budgetFilter": {
            "projects": [f"projects/{guard_project}"],
            # Credits reduce the cost the budget tracks, so the free tier shows up as ~0 and
            # only genuine spend can reach the threshold.
            "creditTypesTreatment": "INCLUDE_ALL_CREDITS",
        },
        "amount": {"specifiedAmount": {"currencyCode": currency, "units": str(int(amount))}},
        "thresholdRules": [
            # Email warnings. The guardrail ignores the forecast rule by design (see
            # guardrail.py); it is here so a projection that looks wrong warns early.
            {"thresholdPercent": 0.5, "spendBasis": "CURRENT_SPEND"},
            {"thresholdPercent": 0.9, "spendBasis": "CURRENT_SPEND"},
            {"thresholdPercent": 1.0, "spendBasis": "CURRENT_SPEND"},
            {"thresholdPercent": 1.0, "spendBasis": "FORECASTED_SPEND"},
        ],
        "notificationsRule": {
            "pubsubTopic": f"projects/{guard_project}/topics/{topic}",
            # schemaVersion 1.0 is the shape that carries costAmount *and* forecastAmount,
            # which is exactly the pair the guardrail's decision needs.
            "schemaVersion": "1.0",
            # Keep the default billing-admin emails; the topic is an addition, not a switch.
            "disableDefaultIamRecipients": False,
        },
    }


def find_by_display_name(budgets: list[dict], display_name: str) -> dict | None:
    """First budget whose displayName matches, or None."""
    for budget in budgets:
        if budget.get("displayName") == display_name:
            return budget
    return None


def ensure_budget(
    billing_account: str,
    guard_project: str,
    display_name: str,
    amount: float,
    currency: str,
    topic: str,
    token: str,
    dry_run: bool,
) -> str:
    """Create the budget, or patch an existing one to the desired shape."""
    base = f"{BUDGETS_API}/billingAccounts/{billing_account}/budgets"
    payload = budget_payload(guard_project, display_name, amount, currency, topic)
    if dry_run:
        return json.dumps(payload, indent=2, sort_keys=True)

    existing = api("GET", base, token, guard_project).get("budgets", [])
    found = find_by_display_name(existing, display_name)

    if found is None:
        created = api("POST", base, token, guard_project, payload)
        return f"created budget {created.get('name', '')}"

    budget_id = found["name"].rsplit("/", 1)[-1]
    mask = "displayName,budgetFilter,amount,thresholdRules,notificationsRule"
    url = f"{base}/{urllib.parse.quote(budget_id)}?updateMask={urllib.parse.quote(mask)}"
    api("PATCH", url, token, guard_project, payload)
    return f"updated budget {found['name']}"


def main(argv: list[str] | None = None) -> int:
    """Wire the budget; print one line (or the payload, in a dry run)."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--billing-account", required=True)
    parser.add_argument("--project", required=True, help="quota project for the API call")
    parser.add_argument("--guard-project", required=True, help="the project the budget watches")
    parser.add_argument("--amount", type=float, default=1.0)
    parser.add_argument("--currency", default="EUR")
    parser.add_argument("--topic", default="budget-guardrail")
    parser.add_argument("--display-name", default=DEFAULT_DISPLAY_NAME)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    token = os.environ.get("GOOGLE_ACCESS_TOKEN", "")
    if not args.dry_run and not token:
        print("GOOGLE_ACCESS_TOKEN is not set - run this through setup_budget_guardrail.sh.", file=sys.stderr)
        return 2

    print(
        ensure_budget(
            args.billing_account,
            args.guard_project,
            args.display_name,
            args.amount,
            args.currency,
            args.topic,
            token,
            args.dry_run,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
