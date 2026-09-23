"""Cloud Functions entry point for the budget guardrail.

Runtime glue only: the decision and the Cloud Billing calls live in `guardrail.py`, which is
importable without the Functions runtime and therefore unit-tested in the repository's test
suite. Deployed as a 2nd-generation function with a Pub/Sub trigger, on the topic the budget
publishes to (see ../setup_budget_guardrail.sh and the runbook).

Logging is one JSON object per line so Cloud Logging picks up the severity: a run that
actually disables billing is a WARNING, a run that could not do its job is an ERROR.
"""

from __future__ import annotations

import json
import os

import functions_framework

from guardrail import decode_budget_notification, handle, metadata_token


def _log(severity: str, message: str) -> None:
    """Emit one structured log line with an explicit severity."""
    print(json.dumps({"severity": severity, "message": message}), flush=True)


def _dry_run_enabled() -> bool:
    """Whether the guardrail may only report what it would do (the rollout default)."""
    return os.environ.get("DRY_RUN", "").strip().lower() in {"1", "true", "yes", "on"}


@functions_framework.cloud_event
def stop_billing(cloud_event) -> None:
    """Handle one budget notification.

    Failures are logged and swallowed on purpose: a raised exception would make Pub/Sub retry
    the same notification, turning a permissions mistake into repeated calls against the
    Cloud Billing API. One clear ERROR line is the better failure mode.
    """
    message = (cloud_event.data or {}).get("message", {})
    notification = decode_budget_notification(message)

    project_id = os.environ.get("GUARD_PROJECT", "").strip() or os.environ.get(
        "GOOGLE_CLOUD_PROJECT", ""
    ).strip()

    try:
        result = handle(
            project_id,
            notification,
            token=metadata_token(),
            dry_run=_dry_run_enabled(),
        )
    except Exception as error:  # noqa: BLE001 - see the docstring
        _log("ERROR", f"guardrail: FAILED - {type(error).__name__}: {error}")
        return

    _log("WARNING" if "DISABLED billing" in result else "INFO", result)
