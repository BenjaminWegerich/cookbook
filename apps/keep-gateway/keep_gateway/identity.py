"""Caller identity: the web app's Google sign-in, confirmed with Google.

The gateway sits on a public URL and its Keep credential can write to the user's notes, so
every Keep route has to answer one question first: *is the caller allowed?* Since the web app
is a static bundle, the only thing it can prove is a Google sign-in - so the app sends the
access token that Google Identity Services gave it (`openid email` scope only, never its Drive
token) and this module has Google confirm that token.

Google is asked rather than the token being decoded here, for two reasons:

  * an access token is an opaque string; only Google can say what it means, and
  * the answer carries the audience - *which app* the token was minted for. That check is the
    load-bearing one: without it, a token Google issued to any other application the user
    once signed into would open this gateway too.

Three outcomes, deliberately distinct (the app branches on them, see
`apps/keep-gateway/README.md`):

  * **accepted** - audience matches this app, the address is verified *and* on the allowlist;
    the address is returned so the request log can name the caller.
  * **refused** (`Unauthorized`, 401) - Google says the token is invalid, expired or minted
    for another app, or the address is not on the allowlist. The app answers a 401 by getting
    a fresh token from Google, so this is an ordinary, recoverable case.
  * **undecided** (`IdentityCheckUnavailable`, 503) - Google could not be reached. Fail
    closed: a check that cannot run is not a check that passed, and the app treats a 5xx as
    "try again" rather than "sign in again".

No state is kept: every request is verified on its own, exactly as the Keep side is read
fresh on every request. Google's answer is small and the extra round trip is invisible next
to a full Keep sync (~0.7 s), so there is nothing worth caching - and a cache would be the
one piece of shared mutable state in an otherwise stateless service.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

import requests

from .errors import IdentityCheckUnavailable, Unauthorized

logger = logging.getLogger("keep_gateway")

# Google's token-inspection endpoint. It answers with the token's audience, the account and
# its verification state, or 400 for a token it does not recognise.
TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Bounds the call so a hanging check cannot hold a request thread until Cloud Run's timeout.
DEFAULT_TIMEOUT_SECONDS = 5.0

# The only scopes a caller's token may carry, checked as a *deny-by-default* set: anything
# outside this list is refused.
#
# This guards a specific hazard. The web app asks for `openid email` alone, deliberately, so
# that the token it hands over cannot touch the user's Drive files - but Google reports
# "previously accepted scopes" alongside a new grant, and an OAuth client's consent is tracked
# per user, not per request. Should an identity token ever come back carrying `drive.file` (or
# anything else), this gateway refuses it instead of becoming a holder of that credential.
# Both spellings are accepted because Google reports the OIDC shorthand for some scopes and
# the equivalent scope URL for others.
PERMITTED_IDENTITY_SCOPES = frozenset(
    {
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    }
)


class HttpResponse(Protocol):
    """The tiny slice of `requests.Response` this module uses (keeps the fake small)."""

    status_code: int

    def json(self) -> Any: ...


class HttpSession(Protocol):
    """The tiny slice of `requests.Session` this module uses."""

    def get(self, url: str, *, params: dict[str, str], timeout: float) -> HttpResponse: ...


class CallerVerifier(Protocol):
    """What `app.py` needs from a verifier: one call, one address or one raised failure.

    A protocol rather than the concrete class so the boundary tests can inject a fake, exactly
    as they inject a fake Keep client - the same seam, no network.
    """

    def verify(self, presented_token: str) -> str: ...


def _verified_email(body: Any) -> str | None:
    """The address from a tokeninfo answer, or None when it is missing/unusable.

    `email_verified` is checked strictly ("true", not merely present): an unverified address
    could be an alias someone else controls, so it can never satisfy the allowlist. Google has
    returned this field both as a JSON boolean and as the string `"true"`, so both are
    accepted - refusing the string form would lock out perfectly good tokens.
    """
    if not isinstance(body, dict):
        return None
    if body.get("email_verified") not in (True, "true"):
        return None
    email = body.get("email")
    if not isinstance(email, str) or email.strip() == "":
        return None
    return email.strip()


def _audiences(body: Any) -> set[str]:
    """Every audience-ish value from a tokeninfo answer (`aud` and `azp`).

    Google puts the client id the token was minted for into `aud`, and the party that
    requested it into `azp`; for tokens from a browser both are the web client id. Accepting
    either keeps the check correct for both shapes without loosening it - both are values
    Google signed, and at least one has to match the configured client id.
    """
    if not isinstance(body, dict):
        return set()
    values: set[str] = set()
    for key in ("aud", "azp"):
        value = body.get(key)
        if isinstance(value, str) and value.strip() != "":
            values.add(value.strip())
    return values


def _is_expired(body: Any) -> bool:
    """True when Google reports no remaining lifetime for the token.

    `expires_in` is a string in Google's answer. A missing field is *not* treated as expired:
    the field is informational, and a token Google already accepted is valid.
    """
    if not isinstance(body, dict):
        return False
    raw = body.get("expires_in")
    try:
        return float(raw) <= 0
    except (TypeError, ValueError):
        return False


def _scopes(body: Any) -> set[str]:
    """The scopes a tokeninfo answer reports, normalised to a set.

    Google returns them space-separated in `scope`; a list has also been observed. An absent
    or unreadable field yields an empty set, which is treated as "nothing extra" - the scope
    check below is a guard against one specific hazard (a Drive-capable token), while the
    audience and address checks are what actually decide access.
    """
    if not isinstance(body, dict):
        return set()
    raw = body.get("scope")
    if isinstance(raw, str):
        return {scope for scope in raw.split() if scope}
    if isinstance(raw, list):
        return {scope for scope in raw if isinstance(scope, str)}
    return set()


class GoogleIdentityVerifier:
    """Verifies a caller's bearer token against Google and the configured allowlist.

    The client id and the allowlist are constructor arguments rather than module globals, so
    the app can inject a fake verifier in tests and a deployment can be configured without
    touching code.
    """

    def __init__(
        self,
        client_id: str,
        allowed_emails: frozenset[str],
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        session: HttpSession | None = None,
    ) -> None:
        """Store the configuration; `session` is injectable so tests need no network."""
        self._client_id = client_id
        self._allowed_emails = allowed_emails
        self._timeout = timeout
        self._session = session if session is not None else requests.Session()

    def verify(self, presented_token: str) -> str:
        """Return the caller's e-mail address, or raise (`Unauthorized` / unavailable).

        Every rejection logs the *reason* server-side (the token itself never does), because
        "Google refused", "wrong app" and "not on the allowlist" need different reactions from
        the operator even though the caller sees the same 401.
        """
        try:
            response = self._session.get(
                TOKENINFO_URL,
                params={"access_token": presented_token},
                timeout=self._timeout,
            )
        except requests.RequestException as error:
            # Fail closed: without Google's answer there is no way to know who is calling.
            raise IdentityCheckUnavailable(
                "The sign-in could not be verified.",
                detail=f"tokeninfo request failed: {error}",
            ) from error

        if response.status_code == 400:
            # Google's documented answer for an invalid, expired or foreign token.
            raise Unauthorized(
                "The Google sign-in is expired or invalid.",
                detail="tokeninfo rejected the token (400)",
            )
        if response.status_code != 200:
            raise IdentityCheckUnavailable(
                "The sign-in could not be verified.",
                detail=f"tokeninfo answered HTTP {response.status_code}",
            )

        try:
            body = response.json()
        except ValueError as error:
            raise IdentityCheckUnavailable(
                "The sign-in could not be verified.",
                detail=f"tokeninfo answered non-JSON: {error}",
            ) from error

        if _is_expired(body):
            raise Unauthorized(
                "The Google sign-in is expired or invalid.",
                detail="tokeninfo reports expires_in <= 0",
            )

        if self._client_id not in _audiences(body):
            # The token is genuine but was minted for a different application.
            raise Unauthorized(
                "This sign-in was not issued for Cookbook.",
                detail=f"audience mismatch (expected {self._client_id!r})",
            )

        extra_scopes = _scopes(body) - PERMITTED_IDENTITY_SCOPES
        if extra_scopes:
            # A token that can do more than identify the caller is not welcome here - above all
            # one that could read or write Drive files. Refusing keeps this service from ever
            # holding such a credential (see PERMITTED_IDENTITY_SCOPES).
            raise Unauthorized(
                "This sign-in carries more access than Cookbook needs.",
                detail=f"token has non-identity scopes: {sorted(extra_scopes)}",
            )

        email = _verified_email(body)
        if email is None:
            raise Unauthorized(
                "The Google sign-in carries no verified e-mail address.",
                detail="tokeninfo has no verified email",
            )

        if email.casefold() not in self._allowed_emails:
            raise Unauthorized(
                "This Google account is not allowed to use Cookbook.",
                # The address is logged, never returned: the caller learns only that it was
                # refused, which keeps the allowlist out of the response.
                detail=f"email {email!r} is not on KEEP_ALLOWED_EMAILS",
            )

        return email
