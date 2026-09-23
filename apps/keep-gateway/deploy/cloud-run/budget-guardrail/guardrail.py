"""The budget guardrail's decision and its two Cloud Billing calls.

Deliberately free of the Cloud Functions runtime so it can be unit-tested and reasoned about
without deploying anything: `main.py` owns the runtime decorator, this module owns the
behaviour.

What it guards against
----------------------
A Cloud Billing budget is an alarm, not a cap - Google is explicit that reaching a threshold
does not stop usage or billing. The only thing that actually stops the money is detaching the
project from its billing account, which is what this does when the budget is *spent*.

Why it refuses to act on a forecast
-----------------------------------
Budget notifications arrive for both spent and forecast thresholds. A forecast notification
carries the *actual* cost so far in `costAmount` (low) and the projection in `forecastAmount`
(high). Acting on those would de-bill a healthy project the first time a projection crossed
the line, so the decision requires `costAmount >= budgetAmount` - actual money, not a
projection. A forecast alert still emails the user; it just cannot switch anything off.
"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from typing import Any

BILLING_API = "https://cloudbilling.googleapis.com/v1"
METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)


def _number(value: Any) -> float | None:
    """Parse a JSON number that the budget schema may send as a number or a string."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def decode_budget_notification(message: dict) -> dict:
    """Decode a Pub/Sub message body into the budget notification.

    The budget publishes a JSON document how Google's own sample expects it: base64 in
    `message.data`. A malformed message must not raise inside the function - an exception
    would look like a broken guardrail and, worse, could invite a retry storm.
    """
    raw = message.get("data")
    if not raw:
        return {}
    try:
        return json.loads(base64.b64decode(raw).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def evaluate(notification: dict) -> tuple[bool, str]:
    """Decide whether the budget is genuinely spent; return `(should_disable, reason)`.

    The reason is logged verbatim, so every run says why it did or did not act.
    """
    cost = _number(notification.get("costAmount"))
    budget = _number(notification.get("budgetAmount"))
    forecast = _number(notification.get("forecastAmount"))
    currency = notification.get("currencyCode", "")

    if cost is None:
        return False, "notification carries no actual cost (spent threshold not reached)"
    if budget is None or budget <= 0:
        return False, f"notification carries no usable budget amount ({budget!r})"
    if cost < budget:
        return (
            False,
            f"actual cost {cost:.2f} {currency} is below the budget {budget:.2f} {currency} "
            f"(forecast {forecast if forecast is not None else 'n/a'})",
        )
    return True, f"actual cost {cost:.2f} {currency} reached the budget {budget:.2f} {currency}"


def metadata_token() -> str:
    """Access token of the function's service account, from the metadata server."""
    request = urllib.request.Request(METADATA_TOKEN_URL)
    request.add_header("Metadata-Flavor", "Google")
    with urllib.request.urlopen(request, timeout=10) as response:
        return str(json.loads(response.read().decode())["access_token"])


def _api(method: str, url: str, token: str, body: dict | None = None) -> dict:
    """Call the Cloud Billing API and return the decoded JSON response."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> {error.code}: {detail[:300]}") from error
    return json.loads(payload) if payload.strip() else {}


def billing_enabled(project_id: str, token: str) -> bool:
    """Whether the project is currently attached to a billing account."""
    info = _api("GET", f"{BILLING_API}/projects/{project_id}/billingInfo", token)
    return bool(info.get("billingEnabled"))


def disable_billing(project_id: str, token: str) -> None:
    """Detach the project from its billing account.

    An empty `billingAccountName` is the documented way to switch billing off - the same call
    the Console's "Disable billing" button makes.
    """
    _api(
        "PUT",
        f"{BILLING_API}/projects/{project_id}/billingInfo",
        token,
        {"billingAccountName": ""},
    )


def handle(project_id: str, notification: dict, *, token: str, dry_run: bool) -> str:
    """Evaluate one notification and act on it; return the log line.

    `dry_run` is the rollout safety: the function is deployed with `DRY_RUN=true`, proved with
    a synthetic notification, and only then switched to acting.

    The current billing state is read on a best-effort basis. Reading a project's billing
    association needs `billing.resourceAssociations.list`, which the least-privilege
    `roles/billing.projectManager` deliberately does not include - so a refusal there is
    expected, not fatal, and the function still does the one thing it exists to do. A repeated
    notification after a cut-off is therefore harmless: disabling already-disabled billing is
    a no-op.
    """
    should_disable, reason = evaluate(notification)

    if not should_disable:
        return f"guardrail: no action - {reason}"
    if not project_id:
        return f"guardrail: misconfigured - GUARD_PROJECT is empty, so {reason} was ignored"
    if dry_run:
        return f"guardrail: DRY RUN - would disable billing on {project_id}: {reason}"

    read_note = ""
    try:
        if not billing_enabled(project_id, token):
            return f"guardrail: billing on {project_id} is already disabled ({reason})"
    except RuntimeError as error:
        read_note = f" [state unreadable, acting anyway: {str(error)[:120]}]"

    disable_billing(project_id, token)
    return (
        f"guardrail: DISABLED billing on {project_id} ({reason}).{read_note} "
        "Re-attach the billing account in the Console to bring the project back."
    )
