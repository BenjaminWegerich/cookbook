"""The Keep access layer: authentication, list lookup and reading the two lists.

This is the gateway's own copy of the technique the feasibility spike proved in
`spike/keep-feasibility/keep-spike.py`. The spike stays as the historical record of *how*
the approach was validated; the product owns its own code so the deployed image never
depends on a directory that exists to answer questions that are already answered. The
authentication call, its failure diagnosis and the list lookup are intentionally
line-for-line the same logic as the spike, so the two cannot drift in how they read a
failure - and the write technique the spike validated (marker prefix, sort ids above every
existing item, verify-then-cleanup) is the recipe the later actions must follow.

Two spike findings are encoded here and must not be "optimised" away:

  * **No state cache.** Resuming `gkeepapi` from a cached snapshot saved ~0.14 s over a
    cold sync, so a cache is not worth its storage problem - every request authenticates
    cold (`state=None`).
  * **Failures are translated, not propagated.** "Google rejected the token" and "this
    network is blocked" are different findings with different consequences, so each maps
    onto its own `GatewayError` subclass instead of a shared traceback.
"""

from __future__ import annotations

import logging
from typing import Any

import gkeepapi
import requests
from gkeepapi import node

from .config import GatewayConfig
from .errors import (
    GatewayNotConfigured,
    KeepApiError,
    KeepAuthRejected,
    KeepListMissing,
    KeepUnreachable,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------------------
# List access helpers (pure functions over a synced gkeepapi client)
# --------------------------------------------------------------------------------------


def all_lists(keep: gkeepapi.Keep) -> list[node.List]:
    """Return every (non-trashed) checklist note visible to this account."""
    return list(keep.find(func=lambda candidate: isinstance(candidate, node.List)))


def find_list_by_title(keep: gkeepapi.Keep, title: str) -> node.List:
    """Resolve a checklist by its exact title (case-insensitively).

    A missing list is a real misconfiguration - the note was unshared or renamed - so it
    raises a typed error instead of returning None; the visible titles go into the log
    line, never into the HTTP response.
    """
    wanted = title.strip().casefold()
    lists = all_lists(keep)
    for candidate in lists:
        if (candidate.title or "").strip().casefold() == wanted:
            return candidate

    visible = sorted((candidate.title or "<untitled>") for candidate in lists)
    raise KeepListMissing(
        "One of the configured Keep lists is not available.",
        detail=f"no checklist titled {title!r}; visible: {visible}",
    )


def describe_list(target: node.List) -> dict[str, Any]:
    """Render one checklist as the boundary's list shape.

    Only user-visible facts cross the boundary: the title and, in display order, each
    item's text, checked state and indentation. `id` and `sort` stay inside the gateway -
    they are Keep's implementation detail, and the roadmap is explicit that the frontend
    must not learn Keep's shape.

    `target.items` is already in display order as gkeepapi returns it (highest sort id
    first), which is exactly the order the Keep app renders, so no re-sorting happens here.
    """
    items = [
        {
            "text": item.text,
            "checked": bool(item.checked),
            "indented": bool(item.indented),
        }
        for item in target.items
    ]
    return {"title": target.title or "", "items": items}


# --------------------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------------------


def authenticate(config: GatewayConfig) -> gkeepapi.Keep:
    """Authenticate and fully sync a Keep session, or raise a typed gateway error.

    Every failure mode the spike documented is mapped onto its own error so the frontend
    and the operator log can tell them apart:

        missing secrets      -> GatewayNotConfigured  (503, the service is off)
        LoginException       -> KeepAuthRejected      (the token died: re-mint it)
        non-JSON / network   -> KeepUnreachable       (this host or network is refused)
        any other Keep error -> KeepApiError
    """
    missing = config.missing_keep_secrets()
    if missing:
        raise GatewayNotConfigured(
            "The Keep gateway is not configured.",
            detail=f"missing environment variables: {', '.join(missing)}",
        )

    keep = gkeepapi.Keep()
    try:
        # state=None: never resume from a cache (see the module docstring). sync=True
        # makes this call do the full download, so a request owns exactly one cold sync.
        keep.authenticate(
            config.keep_email,
            config.keep_master_token,
            state=None,
            sync=True,
            device_id=config.keep_device_id,
        )
    except gkeepapi.exception.LoginException as exc:
        # The credential is dead. This is the one Keep failure an operator must act on,
        # and the re-auth runbook (a browser cookie plus a cloud-side exchange) is why.
        raise KeepAuthRejected(
            "Google rejected the Keep credential.",
            detail="LoginException from the account-auth endpoint; the master token is invalid, "
            "expired or belongs to another account - re-mint it from the cloud.",
        ) from exc
    except requests.exceptions.JSONDecodeError as exc:
        # Documented failure mode of the private API - how a blocked network shows up.
        # Caught before RequestException, because JSONDecodeError subclasses it.
        raise KeepUnreachable(
            "The Keep service did not answer in a usable way.",
            detail="the private notes/v1 API returned a non-JSON response (blocked host or "
            "network, per spike/keep-feasibility/findings.md)",
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise KeepUnreachable(
            "The Keep service could not be reached.",
            detail=f"network error talking to Google: {exc}",
        ) from exc
    except gkeepapi.exception.KeepException as exc:
        raise KeepApiError(
            "The Keep service reported an error.",
            detail=f"gkeepapi {type(exc).__name__}: {exc}",
        ) from exc

    return keep


# --------------------------------------------------------------------------------------
# Per-request client
# --------------------------------------------------------------------------------------


class KeepClient:
    """One short-lived Keep connection, created per request and thrown away.

    Deliberately not a module-level singleton: the gateway keeps no session between
    requests (no state cache, no background refresh), so the cheapest correct model is to
    connect inside the request that needs data. A cold sync measured well under a second
    in the spike, which is what makes this affordable.

    The class is also the seam the HTTP layer tests replace: `app.create_app()` accepts a
    factory returning something with the same `read_state()` shape, so the boundary can be
    tested without a Keep account or network.
    """

    def __init__(self, config: GatewayConfig) -> None:
        self._config = config

    def read_state(self) -> dict[str, Any]:
        """Return the meal plan and the shopping list, in display order.

        Read-only, which is why it is the first endpoint the skeleton implements: it can
        never damage the real lists while the safer write techniques are still being built.
        """
        keep = authenticate(self._config)
        mealplan = find_list_by_title(keep, self._config.mealplan_title)
        shopping = find_list_by_title(keep, self._config.shopping_title)
        return {
            "mealplan": describe_list(mealplan),
            "shopping": describe_list(shopping),
        }

    # ----------------------------------------------------------------------------------
    # Write actions (the write-action step). Each one must follow the spike's non-destructive
    # recipe: mark what we create, place it with sort ids above every existing item, then
    # verify and clean up. They are intentionally absent until their prerequisites exist
    # (ingredient categories for the aisle sort, the scaled-line payload for the shopping
    # list); the HTTP layer answers 501 for them in the meantime.
    # ----------------------------------------------------------------------------------
