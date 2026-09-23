#!/usr/bin/env python3
"""Mint a master token FROM the cloud, then immediately test whether the cloud can use it.

The hypothesis
--------------
Gate 2 established that Google refuses master-token authentication from Google Cloud's
datacenter network: the same account, token and device id authenticate from the home network
and are rejected as `BadAuthentication` from three Google Cloud addresses across two regions,
at Google's account-auth endpoint (`android.clients.google.com`), before any Keep request.

Everything else has been ruled out, so one explanation remains: the refusal may be bound to
*where the master token was created* rather than *where it is used*. Every token tested so far
was minted on the home network. This script mints one from the cloud instead - the Android
`oauth_token` -> master-token exchange (`gpsoauth.exchange_token`) - and then immediately tries
to authenticate with it from the same cloud origin.

If that succeeds, a hosted gateway is back on the table. If it fails, the refusal is about the
origin of use, and the gateway belongs on the home network.

Handling of secrets
-------------------
Neither the `oauth_token` nor the master token is ever printed. Only lengths and short hashes
appear in the log. On success the new master token is written to Secret Manager via the
metadata-server access token, so it never has to pass through a log line.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys

import gpsoauth
import requests

# Same fixed Android client signature the rest of the spike uses.
ANDROID_CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788"

METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)

# Safety net. The cookie that mints the token is copied out of a browser, and using the wrong
# profile would mint a token for the MAIN account - which can see every note, not just the two
# shared ones. The throwaway account sees exactly two checklists, so anything much larger means
# the wrong account; the token is then refused rather than stored.
MAX_EXPECTED_CHECKLISTS = int(os.environ.get("EXPECTED_MAX_CHECKLISTS", "5"))


def fingerprint(value: str) -> str:
    """Short non-reversible fingerprint, for logs that must not carry the secret itself."""
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:12]} ({len(value)} chars)"


def metadata_access_token() -> str:
    """Access token for the job's service account, from the GCE metadata server."""
    response = requests.get(
        METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"}, timeout=10
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


def store_in_secret_manager(project: str, secret_id: str, value: str) -> str:
    """Add a new version to an existing secret, returning a short status for the log."""
    token = metadata_access_token()
    url = (
        f"https://secretmanager.googleapis.com/v1/projects/{project}"
        f"/secrets/{secret_id}:addVersion"
    )
    payload = {"payload": {"data": base64.b64encode(value.encode()).decode()}}
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if response.status_code != 200:
        return f"FAILED ({response.status_code}) {response.text[:200]}"
    return f"stored as a new version of {secret_id}"


def main() -> int:
    email = os.environ.get("KEEP_EMAIL", "")
    device_id = os.environ.get("KEEP_DEVICE_ID", "")
    oauth_token = os.environ.get("KEEP_OAUTH_TOKEN", "")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    target_secret = os.environ.get("TARGET_SECRET", "keep-master-token-cloud")

    record: dict[str, object] = {"stage": "start"}
    missing = [
        name
        for name, value in (
            ("KEEP_EMAIL", email),
            ("KEEP_DEVICE_ID", device_id),
            ("KEEP_OAUTH_TOKEN", oauth_token),
            ("GOOGLE_CLOUD_PROJECT", project),
        )
        if not value
    ]
    if missing:
        record.update(stage="config", error=f"missing: {', '.join(missing)}")
        print(json.dumps(record, indent=2))
        return 1

    record["oauth_token"] = fingerprint(oauth_token)

    # --- Step 1: mint the master token from this cloud origin ---------------------------
    try:
        response = gpsoauth.exchange_token(
            email, oauth_token, device_id, client_sig=ANDROID_CLIENT_SIG
        )
    except Exception as exc:
        record.update(stage="exchange", error=f"{type(exc).__name__}: {exc}")
        print(json.dumps(record, indent=2))
        return 1

    master_token = response.get("Token")
    if not master_token:
        # Report the server's own words, but never the request that carried the secret.
        record.update(
            stage="exchange",
            outcome="FAILED",
            server_response={k: v for k, v in response.items() if k != "Token"},
        )
        print(json.dumps(record, indent=2))
        print("\nVERDICT: Google refused the exchange from the cloud as well.")
        return 1

    record.update(stage="exchange", outcome="minted", master_token=fingerprint(master_token))

    # --- Step 2: can THIS cloud origin authenticate with the token it just minted? ------
    # Imported here so the exchange above is clearly the first thing that happens.
    import importlib.util
    from pathlib import Path

    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("keep_spike", here / "keep-spike.py")
    if spec is None or spec.loader is None:
        record.update(stage="load", error="could not load keep-spike.py")
        print(json.dumps(record, indent=2))
        return 1
    spike = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(spike)

    try:
        keep, seconds = spike.authenticate(email, master_token, device_id, state=None)
        lists = spike.all_lists(keep)
        record.update(
            stage="authenticate",
            outcome="ok",
            sync_seconds=round(seconds, 2),
            checklists=len(lists),
            titles=sorted((entry.title or "") for entry in lists),
        )
    except SystemExit as signal:
        record.update(stage="authenticate", outcome="FAILED", detail=str(signal).splitlines()[0][:300])
        print(json.dumps(record, indent=2))
        print(
            "\nVERDICT: the token was minted in the cloud but the cloud still cannot use it.\n"
            "The refusal is about the origin of USE, not of creation - a hosted gateway is out."
        )
        return 1

    # --- Safety check before anything is persisted ---------------------------------------
    if len(lists) > MAX_EXPECTED_CHECKLISTS:
        record.update(
            stage="safety",
            outcome="ABORTED",
            reason=(
                f"{len(lists)} checklists visible, more than the {MAX_EXPECTED_CHECKLISTS} "
                "expected for the throwaway account - the cookie was probably copied from the "
                "main account's browser profile"
            ),
        )
        print(json.dumps(record, indent=2))
        print(
            "\nVERDICT: ABORTED. This token can see far more notes than the throwaway account\n"
            "should, so it was NOT stored. Re-copy the oauth_token from a browser session that\n"
            "is definitely logged in as the throwaway account."
        )
        return 1

    # --- Step 3: keep the working token, without printing it ----------------------------
    record["stored"] = store_in_secret_manager(project, target_secret, master_token)
    print(json.dumps(record, indent=2))
    print(
        "\nVERDICT: SUCCESS - a cloud-minted master token authenticates from the cloud.\n"
        f"The new token is in Secret Manager as '{target_secret}'."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
