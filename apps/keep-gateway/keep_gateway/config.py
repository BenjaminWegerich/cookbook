"""Environment configuration for the gateway.

The service is stateless, so there is nothing to configure per request and nothing to
persist: Cloud Run injects the values at container start and every request reads the same
frozen object. Secrets arrive through Secret Manager (`KEEP_MASTER_TOKEN`) and plain
environment variables (`KEEP_EMAIL`, `KEEP_DEVICE_ID`), exactly as in the feasibility spike.

Two rules are load-bearing and are therefore enforced here rather than at the call site:

  * **The device id must never change.** Google treats a new device id as a new device, and
    a deployment whose id drifts looks like abuse. It is configuration, not a generated
    value, so a restart can never produce a new one.
  * **No configured caller identity means "off", not "open".** The boundary is reachable on
    a public URL, so an unconfigured deployment must refuse to act. An empty
    `oauth_client_id` or an empty `allowed_emails` is therefore the fail-closed case that
    `app.py` turns into 503 responses.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

# Canonical titles of the two shared Keep notes. They are the same defaults the spike CLI
# falls back to, kept in one place per component; the environment can override them when a
# note is ever renamed.
DEFAULT_SHOPPING_TITLE = "Einkaufsliste"
DEFAULT_MEALPLAN_TITLE = "Essensplan"

# Environment variable names, spelled once so a typo cannot silently disable authentication.
ENV_KEEP_EMAIL = "KEEP_EMAIL"
ENV_KEEP_MASTER_TOKEN = "KEEP_MASTER_TOKEN"
ENV_KEEP_DEVICE_ID = "KEEP_DEVICE_ID"
ENV_SHOPPING_TITLE = "KEEP_SHOPPING_LIST_TITLE"
ENV_MEALPLAN_TITLE = "KEEP_MEALPLAN_LIST_TITLE"
ENV_OAUTH_CLIENT_ID = "KEEP_OAUTH_CLIENT_ID"
ENV_ALLOWED_EMAILS = "KEEP_ALLOWED_EMAILS"
ENV_DEV_ACCESS_TOKEN = "KEEP_DEV_ACCESS_TOKEN"
ENV_ALLOWED_ORIGINS = "KEEP_GATEWAY_ALLOWED_ORIGINS"
ENV_PORT = "PORT"


@dataclass(frozen=True)
class GatewayConfig:
    """Everything the gateway needs, resolved once from the environment.

    Frozen because it is shared across threads: gunicorn runs several request threads in
    one worker, and a mutable config read from two of them would be a race waiting to
    happen.
    """

    keep_email: str = ""
    keep_master_token: str = ""
    keep_device_id: str = ""
    shopping_title: str = DEFAULT_SHOPPING_TITLE
    mealplan_title: str = DEFAULT_MEALPLAN_TITLE

    # Identity of the *caller*: the web app signs in with Google and presents the resulting
    # access token, which the gateway has Google confirm (`identity.py`). The OAuth client id
    # is what binds the token to *this* app - without it, a token minted for any other Google
    # app would be accepted. Both values are plain configuration, not secrets: they end up in
    # a public bundle and a deployed environment either way.
    oauth_client_id: str = ""
    # Lower-cased e-mail allowlist: the only accounts allowed to drive the gateway. Empty
    # means "nobody", never "anybody" - the fail-closed case app.py turns into 503.
    allowed_emails: frozenset[str] = frozenset()

    # Local-development escape hatch: a static token accepted in addition to a verified
    # Google identity, so an operator can `curl` the running service without minting a
    # browser token. Unset by default, and never set in a deployed environment. Kept out of
    # repr() so it cannot leak through a log line.
    dev_access_token: str = field(default="", repr=False)

    # Browser origins allowed to call the gateway, comma-separated in the environment.
    # Empty means "no cross-origin caller is accepted": the web app is a static bundle on
    # another origin, so a deployment that forgets this simply gets no Keep features.
    # A wildcard is deliberately not supported - the allowlist is explicit.
    allowed_origins: tuple[str, ...] = ()

    def missing_keep_secrets(self) -> list[str]:
        """Names of the Keep credentials that are absent, for a readable log line."""
        pairs = (
            (ENV_KEEP_EMAIL, self.keep_email),
            (ENV_KEEP_MASTER_TOKEN, self.keep_master_token),
            (ENV_KEEP_DEVICE_ID, self.keep_device_id),
        )
        return [name for name, value in pairs if not value]

    def missing_auth_config(self) -> list[str]:
        """Names of the caller-identity settings that are absent, for a log line.

        Mirrors `missing_keep_secrets`: the names travel to the log, the values never do.
        """
        pairs = (
            (ENV_OAUTH_CLIENT_ID, self.oauth_client_id),
            (ENV_ALLOWED_EMAILS, self.allowed_emails),
        )
        return [name for name, value in pairs if not value]


def load_config(environ: Mapping[str, str] | None = None) -> GatewayConfig:
    """Build the configuration from the process environment.

    Missing values are *not* an error here: the process must still boot so that
    `/health` can answer and the web app can see the gateway exists but is off. The
    request path is what refuses to work without credentials.
    """
    source = os.environ if environ is None else environ
    return GatewayConfig(
        keep_email=source.get(ENV_KEEP_EMAIL, "").strip(),
        keep_master_token=source.get(ENV_KEEP_MASTER_TOKEN, "").strip(),
        keep_device_id=source.get(ENV_KEEP_DEVICE_ID, "").strip(),
        shopping_title=source.get(ENV_SHOPPING_TITLE, "").strip() or DEFAULT_SHOPPING_TITLE,
        mealplan_title=source.get(ENV_MEALPLAN_TITLE, "").strip() or DEFAULT_MEALPLAN_TITLE,
        oauth_client_id=source.get(ENV_OAUTH_CLIENT_ID, "").strip(),
        # Case-folded here, once, so every comparison later is a plain set lookup: an address
        # is not case-sensitive, and a deployment must not fail because of a capital letter.
        allowed_emails=frozenset(
            email.strip().casefold()
            for email in source.get(ENV_ALLOWED_EMAILS, "").split(",")
            if email.strip()
        ),
        dev_access_token=source.get(ENV_DEV_ACCESS_TOKEN, "").strip(),
        allowed_origins=tuple(
            origin.strip()
            for origin in source.get(ENV_ALLOWED_ORIGINS, "").split(",")
            if origin.strip()
        ),
    )


def local_port(environ: Mapping[str, str] | None = None) -> int:
    """Port to listen on for local runs. Cloud Run sets `PORT`; 8080 matches its default."""
    source = os.environ if environ is None else environ
    raw = source.get(ENV_PORT, "").strip()
    try:
        return int(raw) if raw else 8080
    except ValueError:
        return 8080
