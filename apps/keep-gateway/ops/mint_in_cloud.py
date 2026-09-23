#!/usr/bin/env python3
"""Mint a master token FROM the cloud, prove the cloud can use it, then store it.

Why this runs in the cloud
--------------------------
The feasibility spike measured something that is easy to get wrong in the expensive
direction: Google refuses a *home-minted* master token when it is exchanged from Google
Cloud's datacenter network (`BadAuthentication`), but accepts one that was itself minted
from that network. What Google binds is **where the token was created**, not where it is
used. So both the initial setup and *every* re-mint have to run here, as a Cloud Run job in
the same project as the gateway.

This script is the spike's `mint-in-cloud.py` folded into the product: same exchange, same
safety check, same handling of secrets - but the authentication and its four-way failure
diagnosis come from `keep_gateway.keep_client`, so the mint and the service can never read a
failure differently.

Secrets
-------
Neither the `oauth_token` cookie nor the master token is ever printed. Only lengths and short
non-reversible fingerprints reach the log. The minted token goes straight into Secret Manager
through the job's metadata-server access token, so it never passes through a command line, a
file or a log line.

Inputs (environment):
    KEEP_EMAIL             throwaway account
    KEEP_DEVICE_ID         stable device id (must match the service)
    KEEP_OAUTH_TOKEN       short-lived browser cookie; deleted again right after
    GOOGLE_CLOUD_PROJECT   project holding the secret
    TARGET_SECRET          secret to add a version to (default keep-master-token-cloud)
    EXPECTED_MAX_CHECKLISTS  safety bound (default 5)

Run it with:  python -m ops.mint_in_cloud        (working directory /app)
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys

import gpsoauth
import requests

from keep_gateway.config import GatewayConfig
from keep_gateway.errors import GatewayError
from keep_gateway.keep_client import all_lists, authenticate

# The fixed client signature of the Google Keep Android app. The whole spike used this value
# explicitly rather than trusting a library default, and the service inherits that choice.
ANDROID_CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788"

# The job's own service-account access token, from the GCE/Cloud Run metadata server. Used to
# write the new secret version without any credential living in the image.
METADATA_TOKEN_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)

# Safety net for the worst failure mode of this script: the cookie was copied out of the
# *main* account's browser profile, so the minted token is a full-access credential for the
# real account. The throwaway account sees exactly two checklists, so anything much larger
# means the wrong account - and the token is then refused instead of stored.
MAX_EXPECTED_CHECKLISTS = int(os.environ.get("EXPECTED_MAX_CHECKLISTS", "5"))


def fingerprint(value: str) -> str:
    """Short, non-reversible fingerprint for a log line that must not carry the secret."""
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:12]} ({len(value)} chars)"


def missing_environment(names: tuple[str, ...]) -> list[str]:
    """Names from `names` that are unset or empty, for a readable config error."""
    return [name for name in names if not os.environ.get(name, "").strip()]


def metadata_access_token() -> str:
    """Access token of the job's service account, from the metadata server."""
    response = requests.get(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"}, timeout=10)
    response.raise_for_status()
    return str(response.json()["access_token"])


def store_in_secret_manager(project: str, secret_id: str, value: str) -> str:
    """Add a new version to an existing secret; return a short status for the log."""
    url = (
        f"https://secretmanager.googleapis.com/v1/projects/{project}"
        f"/secrets/{secret_id}:addVersion"
    )
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {metadata_access_token()}",
            "Content-Type": "application/json",
        },
        json={"payload": {"data": base64.b64encode(value.encode()).decode()}},
        timeout=30,
    )
    if response.status_code != 200:
        return f"FAILED ({response.status_code}) {response.text[:200]}"
    return f"stored as a new version of {secret_id}"


def run_mint(record: dict) -> int:
    """Do the exchange, the proof and the store; fill `record` and return an exit code.

    Split out of `main` so the whole decision path can be driven in tests with the exchange,
    the authentication and the store patched - without a cloud project or a Google account.
    """
    email = os.environ.get("KEEP_EMAIL", "")
    device_id = os.environ.get("KEEP_DEVICE_ID", "")
    oauth_token = os.environ.get("KEEP_OAUTH_TOKEN", "")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    target_secret = os.environ.get("TARGET_SECRET", "keep-master-token-cloud")

    missing = missing_environment(
        ("KEEP_EMAIL", "KEEP_DEVICE_ID", "KEEP_OAUTH_TOKEN", "GOOGLE_CLOUD_PROJECT")
    )
    if missing:
        record.update(stage="config", error=f"missing: {', '.join(missing)}")
        return 1

    record["oauth_token"] = fingerprint(oauth_token)

    # --- Step 1: mint the master token from this cloud origin ---------------------------
    try:
        response = gpsoauth.exchange_token(
            email, oauth_token, device_id, client_sig=ANDROID_CLIENT_SIG
        )
    except Exception as exc:  # network, TLS or an unexpected API change
        record.update(stage="exchange", error=f"{type(exc).__name__}: {exc}")
        return 1

    master_token = response.get("Token")
    if not master_token:
        # Report the server's own words, minus the field that would carry the secret.
        record.update(
            stage="exchange",
            outcome="FAILED",
            server_response={key: value for key, value in response.items() if key != "Token"},
        )
        return 1

    record.update(stage="exchange", outcome="minted", master_token=fingerprint(master_token))

    # --- Step 2: can THIS cloud origin authenticate with the token it just minted? -------
    config = GatewayConfig(
        keep_email=email,
        keep_master_token=master_token,
        keep_device_id=device_id,
    )
    try:
        keep = authenticate(config)
        lists = all_lists(keep)
        record.update(
            stage="authenticate",
            outcome="ok",
            checklists=len(lists),
            titles=sorted((entry.title or "") for entry in lists),
        )
    except GatewayError as error:
        # The diagnosis is the product's own: a dead credential and a blocked network are
        # different findings, and the service would report them with the same codes.
        record.update(
            stage="authenticate",
            outcome="FAILED",
            error_code=error.code,
            detail=error.detail,
        )
        return 1

    # --- Step 3: refuse to store a credential that belongs to the wrong account ----------
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
        return 1

    # --- Step 4: keep the working token, without printing it -----------------------------
    record["stored"] = store_in_secret_manager(project, target_secret, master_token)
    return 0


def main() -> int:
    """Run the mint and print exactly one JSON record, whatever happens."""
    record: dict = {"stage": "start"}
    exit_code = run_mint(record)
    print(json.dumps(record, indent=2, sort_keys=True))
    if exit_code == 0:
        print(
            "\nVERDICT: SUCCESS - a cloud-minted master token authenticates from the cloud.\n"
            "The gateway picks it up on its next revision (see the runbook's re-mint section)."
        )
    else:
        print(
            "\nVERDICT: the mint did not complete. The record above says which stage failed.\n"
            "The old secret version is untouched, so the gateway keeps working until you "
            "store a working token."
        )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
