"""Typed failures for the gateway, each mapping onto one HTTP status and machine code.

The frontend has to distinguish three very different situations before it can degrade
gracefully ("Keep features off", N5 in docs/user_stories.md):

    * the gateway is not configured / not reachable at all,
    * the caller is not allowed to use it,
    * the gateway is up but Keep itself failed - and *how* it failed, because
      "the credential died" (an operator has to re-mint) and "this network is blocked"
      (no configuration helps) call for completely different reactions.

Every failure therefore carries a stable `code` the app can branch on, and a short,
non-technical `message` that is safe to show. The long diagnosis (which list titles were
visible, the underlying exception) is logged server-side instead of returned, so the
boundary never leaks Keep's shape or the credential's state to a caller.
"""

from __future__ import annotations

from http import HTTPStatus


class GatewayError(Exception):
    """Base class: one failure, one HTTP status, one stable machine code.

    Raising a subclass anywhere in the request path is enough - the Flask app registers a
    single error handler for this base class and turns it into the JSON error shape.
    """

    # Overridden by every subclass; the base is the "we did not see this coming" case.
    status: HTTPStatus = HTTPStatus.INTERNAL_SERVER_ERROR
    code: str = "internal_error"

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        """Store the caller-facing message and an optional server-side-only detail.

        `detail` never leaves the process: it is what makes a log line actionable (the
        offending title, the exception text) without widening the public response.
        """
        super().__init__(message)
        self.message = message
        self.detail = detail


# --------------------------------------------------------------------------------------
# Configuration and access
# --------------------------------------------------------------------------------------


class GatewayNotConfigured(GatewayError):
    """Credentials or the caller-identity settings are absent, so the service refuses to act.

    This is the fail-closed default: a deployment that was never told which Google account may
    call it, or which OAuth client to trust, must not become an open writer to the user's Keep
    account, so every Keep route answers 503 instead. The web app reads that as "Keep features
    off".
    """

    status = HTTPStatus.SERVICE_UNAVAILABLE
    code = "gateway_not_configured"


class Unauthorized(GatewayError):
    """The caller is not allowed: no token, a token Google refuses, or an address off the list.

    One 401 for all three on purpose - the caller learns that it was refused, never *why*,
    so the allowlist cannot be probed. Which case it was goes to the log (`detail`).
    """

    status = HTTPStatus.UNAUTHORIZED
    code = "unauthorized"


class IdentityCheckUnavailable(GatewayError):
    """Google could not confirm the caller's sign-in (network failure or a 5xx from Google).

    Distinct from `Unauthorized` because the two call for opposite reactions: a 401 means
    "get a fresh sign-in", this means "try again shortly". Fail closed - an unrun check is
    not a passed check - but retryable, which is why it is a 5xx and not a 401.
    """

    status = HTTPStatus.SERVICE_UNAVAILABLE
    code = "identity_unavailable"


class BadRequest(GatewayError):
    """The request body or parameters are not usable (malformed JSON, missing field)."""

    status = HTTPStatus.BAD_REQUEST
    code = "bad_request"


class OriginNotAllowed(GatewayError):
    """A browser request came from an origin that is not on the allowlist.

    This is the cross-origin gate, not the credential gate: a request that *carries* a
    foreign `Origin` header is refused even before the token is looked at, so a page the
    user happens to open cannot drive the gateway on their behalf.
    """

    status = HTTPStatus.FORBIDDEN
    code = "origin_not_allowed"


class NotImplementedYet(GatewayError):
    """A documented endpoint that the skeleton defines but does not implement yet.

    Returning this deliberately (instead of a stub that pretends to work) keeps the
    boundary honest: the web app can already detect and hide the action, and the roadmap
    step that implements it only has to replace this one raise.
    """

    status = HTTPStatus.NOT_IMPLEMENTED
    code = "not_implemented"


# --------------------------------------------------------------------------------------
# Keep itself
# --------------------------------------------------------------------------------------


class KeepAuthRejected(GatewayError):
    """Google refused the master token (`LoginException`).

    The credential is dead: this needs an operator (re-mint from the cloud, see the
    re-auth runbook) and is the one Keep failure worth an alert.
    """

    status = HTTPStatus.BAD_GATEWAY
    code = "keep_auth_rejected"


class KeepUnreachable(GatewayError):
    """The private Keep API could not be talked to (network error or non-JSON answer).

    The spike documented the non-JSON response as the signature of a blocked host or
    network, which is why it is separated from the other Keep failures.
    """

    status = HTTPStatus.BAD_GATEWAY
    code = "keep_unreachable"


class KeepListMissing(GatewayError):
    """One of the two configured checklists is not visible to the throwaway account.

    Typical causes: the note was unshared or renamed, or the account is not the one whose
    token the gateway holds. The visible titles are logged, not returned.
    """

    status = HTTPStatus.BAD_GATEWAY
    code = "keep_list_missing"


class KeepApiError(GatewayError):
    """Any other failure reported by `gkeepapi`, passed through with its diagnosis."""

    status = HTTPStatus.BAD_GATEWAY
    code = "keep_api_error"
