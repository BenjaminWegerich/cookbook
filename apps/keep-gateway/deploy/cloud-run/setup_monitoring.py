#!/usr/bin/env python3
"""Create the log-based metric and the alert that make a dead credential noticeable.

The gateway already emits one JSON line per failure (`{"event": "gateway_error", "code":
"keep_auth_rejected", ...}`), so nothing in the service has to change for this: a log-based
metric counts those lines and one alert policy fires when the count is non-zero. That turns
"the integration silently stopped working" into an email.

Idempotent and re-runnable - each object is looked up by name and only created when missing
(the metric's filter is also updated when it has drifted). `--dry-run` prints the exact
payloads without calling the API, which is how this file is verified without a project.

Uses only the standard library, so it runs with the system Python next to the shell scripts.

Access token: read from GOOGLE_ACCESS_TOKEN (provision.sh passes
`gcloud auth print-access-token`), never from the command line.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

LOGGING_API = "https://logging.googleapis.com/v2"
MONITORING_API = "https://monitoring.googleapis.com/v3"

DEFAULT_METRIC = "keep_auth_rejected"
DEFAULT_CHANNEL_NAME = "Cookbook Keep gateway"
DEFAULT_POLICY_NAME = "Keep gateway: Keep credential rejected"

# A just-created log-based metric is not immediately referenceable by Monitoring. The API
# answers the alert-policy create with a 404 that says so explicitly ("it could take up to 10
# minutes to become available"), so the only correct handling is to wait and retry - failing
# here would leave the alert unwired while everything else looks provisioned.
POLICY_RETRY_ATTEMPTS = 6
POLICY_RETRY_DELAY_SECONDS = 45
METRIC_NOT_READY_MARKER = "Cannot find metric(s) that match type"


def api(method: str, url: str, token: str, body: dict | None = None) -> dict:
    """Call a Google API with the access token and return the decoded JSON response.

    Raises RuntimeError with the API's own message, because "the alert did not get created"
    is useless to debug without the field the server objected to.
    """
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
        raise RuntimeError(f"{method} {url} -> {error.code}: {detail[:500]}") from error
    return json.loads(payload) if payload.strip() else {}


def metric_filter(service: str, metric: str) -> str:
    """The log filter behind the metric: our service's rejected-credential lines.

    `jsonPayload.code` works because the gateway prints one JSON object per line and Cloud
    Run's logging agent parses it; the service label keeps the metric blind to any other
    Cloud Run service in the project.
    """
    return (
        f'resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{service}" '
        f'AND jsonPayload.code="{metric}"'
    )


def metric_payload(service: str, metric: str) -> dict:
    """Body for the log-based counter metric."""
    return {
        "name": metric,
        "description": (
            "Counts gateway responses whose code is keep_auth_rejected, i.e. the times Google "
            "refused the Keep master token. Non-zero means the credential needs a re-mint."
        ),
        "filter": metric_filter(service, metric),
        "metricDescriptor": {
            "metricKind": "DELTA",
            "valueType": "INT64",
            "unit": "1",
            "labels": [],
        },
    }


def channel_payload(email: str, display_name: str) -> dict:
    """Body for the email notification channel the alert policy points at."""
    return {
        "type": "email",
        "displayName": display_name,
        "labels": {"email_address": email},
    }


def policy_payload(
    project: str, service: str, metric: str, channel: str, display_name: str
) -> dict:
    """Body for the alert policy: fire as soon as one rejected credential is logged."""
    return {
        "displayName": display_name,
        "documentation": {
            "mimeType": "text/markdown",
            "content": (
                "The Keep gateway was refused by Google (`keep_auth_rejected`).\n\n"
                "This is not transient: the master token is dead and the Keep features stay "
                f"off until it is re-minted **from the cloud**, as described in "
                f"`apps/keep-gateway/deploy/cloud-run/README.md` (section \"Re-minting\").\n\n"
                "While it is dead, the app keeps working - only the Keep actions are hidden."
            ),
        },
        "combiner": "OR",
        "enabled": True,
        "notificationChannels": [channel],
        "conditions": [
            {
                "displayName": "keep_auth_rejected is non-zero",
                "conditionThreshold": {
                    "filter": (
                        f'metric.type="logging.googleapis.com/user/{metric}" '
                        f'AND resource.type="cloud_run_revision" '
                        f'AND resource.labels.service_name="{service}"'
                    ),
                    "comparison": "COMPARISON_GT",
                    "thresholdValue": 0,
                    "duration": "0s",
                    "aggregations": [
                        {
                            # One minute: the alert exists to be noticed quickly, and a
                            # rejected credential never fixes itself by waiting.
                            "alignmentPeriod": "60s",
                            "perSeriesAligner": "ALIGN_SUM",
                            "crossSeriesReducer": "REDUCE_SUM",
                        }
                    ],
                    "trigger": {"count": 1},
                },
            }
        ],
        # Severity is what the notification email leads with: without it every alert arrives
        # as "ALERT - No severity", indistinguishable from any other alert in the inbox.
        "severity": "ERROR",
        # autoClose covers the case where the metric stops reporting at all (the service was
        # deleted, say); the incident would otherwise sit for the seven-day default. It is not
        # the reaction time: a condition that clears closes its incident by itself within about
        # a minute - which is what a self-test and a successful re-mint both look like.
        "alertStrategy": {"autoClose": "3600s"},
    }


def find_by_display_name(items: list[dict], display_name: str) -> dict | None:
    """First entry whose displayName matches, or None."""
    for item in items:
        if item.get("displayName") == display_name:
            return item
    return None


def ensure_metric(project: str, service: str, metric: str, token: str, dry_run: bool) -> str:
    """Create the log-based metric, or update its filter if it already exists.

    Existence is checked with a direct GET rather than the collection listing: a metric that
    was created moments ago answers the direct GET but may still be missing from the list,
    and creating it again then fails with a conflict even though the desired state is already
    reached. Both races are handled rather than reported.
    """
    base = f"{LOGGING_API}/projects/{project}/metrics"
    metric_url = f"{base}/{urllib.parse.quote(metric)}"
    payload = metric_payload(service, metric)
    if dry_run:
        return json.dumps(payload, indent=2, sort_keys=True)

    try:
        current = api("GET", metric_url, token)
    except RuntimeError as error:
        if " 404:" not in str(error):
            raise
        current = None

    if current is None:
        try:
            api("POST", base, token, payload)
            return f"created metric {metric}"
        except RuntimeError as error:
            if "already exists" not in str(error):
                raise
            return f"metric {metric} already existed"

    if current.get("filter") != payload["filter"]:
        api("PUT", metric_url, token, payload)
        return f"updated metric {metric} (filter had drifted)"
    return f"metric {metric} already current"


def ensure_channel(project: str, email: str, display_name: str, token: str, dry_run: bool) -> str:
    """Create the email notification channel; return its resource name (or the payload).

    A duplicate create is answered with an error by the API, so that case re-reads the list
    instead of failing: the endpoint state is the same either way.
    """
    base = f"{MONITORING_API}/projects/{project}/notificationChannels"
    payload = channel_payload(email, display_name)
    if dry_run:
        return json.dumps(payload, indent=2, sort_keys=True)

    existing = api("GET", base, token).get("notificationChannels", [])
    found = find_by_display_name(existing, display_name)
    if found is not None:
        return found["name"]

    try:
        return api("POST", base, token, payload)["name"]
    except RuntimeError as error:
        if "already exists" not in str(error).lower():
            raise
        existing = api("GET", base, token).get("notificationChannels", [])
        found = find_by_display_name(existing, display_name)
        if found is None:
            raise
        return found["name"]


def ensure_policy(
    project: str, service: str, metric: str, channel: str, display_name: str,
    token: str, dry_run: bool, attempts: int = POLICY_RETRY_ATTEMPTS,
    delay: int = POLICY_RETRY_DELAY_SECONDS,
) -> str:
    """Create the alert policy, unless one with the same display name already exists.

    Retries while Monitoring has not caught up with a brand-new metric: that window is
    normal, not a configuration error, and the alert is the one piece of the safety net whose
    absence would be silent.
    """
    base = f"{MONITORING_API}/projects/{project}/alertPolicies"
    payload = policy_payload(project, service, metric, channel, display_name)
    if dry_run:
        return json.dumps(payload, indent=2, sort_keys=True)

    existing = api("GET", base, token).get("alertPolicies", [])
    found = find_by_display_name(existing, display_name)
    if found is not None:
        # Converge an existing policy instead of leaving an old threshold in place. The field
        # mask is what makes PATCH partial; without it the API would reject the request.
        mask = "displayName,documentation,combiner,enabled,notificationChannels,conditions,severity,alertStrategy"
        url = f"{base}/{found['name'].rsplit('/', 1)[-1]}?updateMask={urllib.parse.quote(mask)}"
        api("PATCH", url, token, payload)
        return f"alert policy updated ({found['name']})"

    for attempt in range(1, attempts + 1):
        try:
            created = api("POST", base, token, payload)
            return f"created alert policy {created.get('name', '')}"
        except RuntimeError as error:
            not_ready = METRIC_NOT_READY_MARKER in str(error)
            if not not_ready or attempt == attempts:
                raise
            print(
                f"  metric not visible to Monitoring yet (attempt {attempt}/{attempts}); "
                f"waiting {delay}s ..."
            )
            time.sleep(delay)
    raise AssertionError("unreachable: the loop either returns or raises")


def main(argv: list[str] | None = None) -> int:
    """Wire up metric, channel and alert; print one line per step."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True)
    parser.add_argument("--service", default="keep-gateway", help="Cloud Run service name")
    parser.add_argument("--email", required=True, help="where the alert is sent")
    parser.add_argument("--metric", default=DEFAULT_METRIC)
    parser.add_argument("--channel-name", default=DEFAULT_CHANNEL_NAME)
    parser.add_argument("--policy-name", default=DEFAULT_POLICY_NAME)
    parser.add_argument(
        "--policy-retries",
        type=int,
        default=POLICY_RETRY_ATTEMPTS,
        help="how often to wait for a brand-new metric to become referenceable",
    )
    parser.add_argument(
        "--policy-retry-delay",
        type=int,
        default=POLICY_RETRY_DELAY_SECONDS,
        help="seconds between those attempts",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the payloads and touch nothing (no access token needed)",
    )
    args = parser.parse_args(argv)

    token = os.environ.get("GOOGLE_ACCESS_TOKEN", "")
    if not args.dry_run and not token:
        print(
            "GOOGLE_ACCESS_TOKEN is not set. Run this through provision.sh, or export a token:\n"
            "  export GOOGLE_ACCESS_TOKEN=\"$(gcloud auth print-access-token)\"",
            file=sys.stderr,
        )
        return 2

    print(f"metric    : {ensure_metric(args.project, args.service, args.metric, token, args.dry_run)}")

    channel = ensure_channel(args.project, args.email, args.channel_name, token, args.dry_run)
    if args.dry_run:
        # The channel is a payload here, not yet a resource, so the policy is shown against a
        # placeholder name - the dry run is about the shape of the request, not its wiring.
        print(f"channel   :\n{channel}")
        placeholder = f"projects/{args.project}/notificationChannels/CHANNEL_ID"
        policy = ensure_policy(
            args.project, args.service, args.metric, placeholder, args.policy_name, token, True
        )
        print(f"policy    :\n{policy}")
        return 0

    print(f"channel   : {channel}")
    policy = ensure_policy(
        args.project, args.service, args.metric, channel, args.policy_name, token, False,
        attempts=args.policy_retries, delay=args.policy_retry_delay,
    )
    print(f"policy    : {policy}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
