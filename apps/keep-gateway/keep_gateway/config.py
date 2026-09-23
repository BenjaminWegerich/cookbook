"""Environment configuration for the gateway.

The service is stateless, so there is nothing to configure per request and nothing to
persist: Cloud Run injects the values at container start and every request reads the same
frozen object. Secrets arrive through Secret Manager (`KEEP_MASTER_TOKEN`) and plain
environment variables (`KEEP_EMAIL`, `KEEP_DEVICE_ID`), exactly as in the feasibility spike.

Two rules are load-bearing and are therefore enforced here rather than at the call site:

  * **The device id must never change.** Google treats a new device id as a new device, and
    a deployment whose id drifts looks like abuse. It is configuration, not a generated
    value, so a restart can never produce a new one.
  * **A missing gateway token means "off", not "open".** The boundary is reachable on a
    public URL, so an unconfigured deployment must refuse to act. `bearer_token` empty is
    therefore the fail-closed case that `app.py` turns into 503 responses.
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
ENV_GATEWAY_TOKEN = "KEEP_GATEWAY_TOKEN"
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

    # Shared secret the web app presents as `Authorization: Bearer <token>`. Empty means
    # the deployment is not configured and every Keep route fails closed.
    bearer_token: str = field(default="", repr=False)

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
        bearer_token=source.get(ENV_GATEWAY_TOKEN, "").strip(),
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
