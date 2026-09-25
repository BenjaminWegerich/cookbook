"""The HTTP boundary: the only thing the web app is allowed to know about Keep.

The boundary is deliberately thin and action-shaped. One endpoint per user action, and the
frontend never sees Keep's own model (no note ids, no sort ids, no account details) - so a
change inside Keep or gkeepapi stays inside this service.

Endpoints:

    GET  /health                liveness, unauthenticated, cheap
    GET  /keep/state            the meal plan and shopping list, for app start
    POST /keep/mealplan         add dish lines to "Essensplan", replacing their entries
    POST /keep/mealplan/check   tick or untick meal-plan lines ("Vom Plan entfernen")
    POST /keep/shopping         add a recipe's ingredients to the list
    POST /keep/shopping/sort    reorder the list by category/aisle     (501 for now)
    POST /shorten               shorten one export URL for a meal-plan line

Three cross-cutting rules live here rather than at the call sites:

  * **Authentication is a seam, and it fails closed.** The service sits on a public URL and
    its credential can write to the user's Keep account, so a missing caller-identity
    configuration means "off" (503), never "open". Who may call is the gateway-authentication
    decision (see ARCHITECTURE.md): the web app's Google sign-in, confirmed with Google by
    `identity.py`. That replaced a shared token the user had to paste per session; the whole
    change is `_require_google_identity` plus the verifier behind it. `/shorten` sits behind
    the same gate: the owner's TinyURL token is what pays for a link, so the route must not be
    an open shortener on a public URL.
  * **CORS is closed by default.** The web app is a static bundle on another origin, so the
    browser needs an allowlist; only explicitly configured origins receive the headers, and
    a request that *carries* a foreign Origin is refused outright.
  * **Every error is JSON.** The app must be able to branch on a stable code, so no HTML
    error page and no traceback ever leaves the process.
"""

from __future__ import annotations

import hmac
import json
import logging
import time
from http import HTTPStatus
from typing import Any, Callable

from flask import Flask, Response, g, jsonify, request
from werkzeug.exceptions import HTTPException

from . import __version__
from .config import GatewayConfig, load_config
from .errors import (
    BadRequest,
    GatewayError,
    GatewayNotConfigured,
    NotImplementedYet,
    OriginNotAllowed,
    ShortenUnavailable,
    Unauthorized,
)
from .identity import CallerVerifier, GoogleIdentityVerifier
from .short_links import MAX_TARGET_LENGTH, TinyUrlShortener

logger = logging.getLogger("keep_gateway")

# A static bundle cannot hold a session credential, so the web app sends the Google access
# token its sign-in produced; `Authorization: Bearer` is the least surprising shape for it
# (and one CORS-safe header). The value is opaque to this service - identity.py has Google
# say what it means.
AUTHORIZATION_HEADER = "Authorization"
BEARER_PREFIX = "bearer "

# Machine codes for the Werkzeug-level failures (404, 405, ...) so *every* response the
# app can receive has the same `error.code` field to branch on.
HTTP_ERROR_CODES: dict[int, str] = {
    HTTPStatus.BAD_REQUEST: "bad_request",
    HTTPStatus.UNAUTHORIZED: "unauthorized",
    HTTPStatus.FORBIDDEN: "forbidden",
    HTTPStatus.NOT_FOUND: "not_found",
    HTTPStatus.METHOD_NOT_ALLOWED: "method_not_allowed",
    HTTPStatus.NOT_IMPLEMENTED: "not_implemented",
    HTTPStatus.SERVICE_UNAVAILABLE: "unavailable",
}

# What each unwritten endpoint will do, quoted back in its 501 so the frontend (and a
# curious curl) is told the truth instead of being handed an empty success.
PENDING_ACTIONS: dict[str, str] = {
    "/keep/shopping/sort": "Sorting the shopping list by category",
}

# A factory is anything that turns configuration into a Keep client: the real one is
# `KeepClient` (`read_state()` plus one method per write action); the tests hand in a fake,
# which is how the boundary is verified without a Google account or a network.
ClientFactory = Callable[[GatewayConfig], Any]

# A factory is anything that turns configuration into a shortener with `shorten(target)`.
# The real one is `TinyUrlShortener`; the tests hand in a fake so no request reaches TinyURL.
ShortenerFactory = Callable[[GatewayConfig], Any]

# The paths that carry the caller's identity: the Keep routes (the master token can write to
# the user's Keep account) and `/shorten` (the owner's TinyURL token pays for every link).
# Everything else is public, which in practice means `/health` alone.
PROTECTED_PREFIXES = ("/keep/", "/shorten")


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------


def _log_event(event: str, **fields: Any) -> None:
    """Emit one structured JSON line, which is what Cloud Logging indexes best.

    Secrets never reach this function: callers pass codes and short detail strings, never
    the bearer token, the master token or the Authorization header.
    """
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, sort_keys=True, ensure_ascii=False))


def _normalize_origin(value: str) -> str:
    """Normalise an origin for comparison: no trailing slash, case-insensitive host."""
    return value.strip().rstrip("/").casefold()


def _origin_allowed(origin: str, config: GatewayConfig) -> bool:
    """True when `origin` is one of the explicitly configured origins."""
    wanted = _normalize_origin(origin)
    return any(wanted == _normalize_origin(allowed) for allowed in config.allowed_origins)


def _presented_token() -> str | None:
    """The bearer token from the request, or None when the header is absent or malformed."""
    header = request.headers.get(AUTHORIZATION_HEADER, "")
    if not header.lower().startswith(BEARER_PREFIX):
        return None
    token = header[len(BEARER_PREFIX):].strip()
    return token or None


def _entry_texts(payload: dict[str, Any], field: str) -> list[str]:
    """Read one optional list of entry texts from a request body, trimmed.

    A missing or null field is an empty list: the write routes need it only when
    the action names entries, and the shared write contract lets `add` be empty.
    Anything that is not a list of non-empty strings is a bad request, so a
    malformed body can never reach the Keep client.
    """
    value = payload.get(field, [])
    if value is None:
        return []
    if not isinstance(value, list) or any(
        not isinstance(text, str) or text.strip() == "" for text in value
    ):
        raise BadRequest(f"'{field}' must be a list of entry texts.")
    return [text.strip() for text in value]


# --------------------------------------------------------------------------------------
# Application factory
# --------------------------------------------------------------------------------------


def create_app(
    config: GatewayConfig | None = None,
    client_factory: ClientFactory | None = None,
    identity_verifier: CallerVerifier | None = None,
    shortener_factory: ShortenerFactory | None = None,
) -> Flask:
    """Build the Flask application.

    Configuration, the Keep client, the caller verifier and the shortener are injected so the
    app can be constructed with test doubles; production calls `create_app()` with none of
    them and gets the environment, the real `KeepClient`, the real Google-backed verifier and
    the real TinyURL client.
    """
    settings = config if config is not None else load_config()
    # Imported here, not at module import time, so the boundary can be imported (and its
    # tests collected) even where gkeepapi is not installed.
    if client_factory is None:
        from .keep_client import KeepClient

        client_factory = KeepClient
    verifier = (
        identity_verifier
        if identity_verifier is not None
        else GoogleIdentityVerifier(settings.oauth_client_id, settings.allowed_emails)
    )
    shortener = (
        shortener_factory(settings)
        if shortener_factory is not None
        else TinyUrlShortener(settings.tinyurl_api_token)
    )

    app = Flask(__name__)
    # Leave nothing to Flask's testing shortcuts: an unexpected exception is a 500 JSON
    # response in production *and* in the tests, so both see the same behaviour.
    app.config["PROPAGATE_EXCEPTIONS"] = False
    app.json.sort_keys = False

    # ----------------------------------------------------------------------------------
    # Request lifecycle
    # ----------------------------------------------------------------------------------

    @app.before_request
    def _start_request_timer() -> None:
        """Record the start instant, so the completion line can carry a duration."""
        g.request_started = time.perf_counter()

    @app.before_request
    def _guard_origin() -> Response | None:
        """Refuse a browser request from an origin that is not explicitly allowed.

        A request *without* an Origin header is not a browser cross-origin request (curl,
        another service) and is left to the token check. A request *with* a foreign Origin
        is refused before anything else, so a misconfigured deployment cannot be driven
        from an arbitrary page the user happens to visit.
        """
        origin = request.headers.get("Origin", "")
        if origin and not _origin_allowed(origin, settings):
            raise OriginNotAllowed(
                "This origin is not allowed to use the Keep gateway.",
                detail=f"origin {origin!r} is not in KEEP_GATEWAY_ALLOWED_ORIGINS",
            )
        return None

    @app.before_request
    def _answer_preflight() -> Response | None:
        """Answer CORS preflights before authentication.

        A browser never sends the Authorization header on a preflight, so requiring the
        token here would make every real request fail. The headers themselves are attached
        in `_finish_response`.
        """
        if request.method == "OPTIONS":
            return Response(status=HTTPStatus.NO_CONTENT)
        return None

    @app.before_request
    def _require_google_identity() -> Response | None:
        """Authenticate every route in `PROTECTED_PREFIXES` against the caller's Google sign-in.

        Fail-closed three times over: a deployment without a client id or an allowlist refuses
        to serve protected routes at all (503); a missing, foreign or unlisted sign-in is a 401;
        and a Google check that cannot run is a 503 rather than a pass. The only other way in is
        `KEEP_DEV_ACCESS_TOKEN`, which exists so an operator can curl a local run and is unset
        in every deployment.
        """
        if not request.path.startswith(PROTECTED_PREFIXES):
            return None
        missing = settings.missing_auth_config()
        if missing:
            raise GatewayNotConfigured(
                "The Keep gateway is not configured.",
                detail=f"missing {', '.join(missing)}, so Keep routes are refused",
            )
        presented = _presented_token()
        if presented is None:
            raise Unauthorized("A verified Google sign-in is required.")
        if settings.dev_access_token and hmac.compare_digest(
            presented.encode("utf-8"), settings.dev_access_token.encode("utf-8")
        ):
            # Local operator access: no Google identity behind it, so the request log stays
            # honest by leaving the caller empty.
            g.caller_email = None
            return None
        g.caller_email = verifier.verify(presented)
        return None

    @app.after_request
    def _finish_response(response: Response) -> Response:
        """Attach CORS headers, forbid caching, and log one line per request."""
        origin = request.headers.get("Origin", "")
        if origin and _origin_allowed(origin, settings):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers.add("Vary", "Origin")

        # Keep state is live data owned by another app, so nothing may be cached on the way
        # back - a stale shopping list is worse than a slightly slower request.
        if request.path.startswith("/keep/"):
            response.headers["Cache-Control"] = "no-store"

        started = getattr(g, "request_started", None)
        _log_event(
            "request",
            method=request.method,
            path=request.path,
            status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 1) if started else None,
            origin=origin or None,
            # Which account drove the request. None for /health, for a refused call and for
            # the local dev token - only a Google-confirmed call has a name attached.
            caller=getattr(g, "caller_email", None),
        )
        return response

    # ----------------------------------------------------------------------------------
    # Routes
    # ----------------------------------------------------------------------------------

    @app.get("/health")
    def health() -> Response:
        """Liveness only: no Keep call, no configuration disclosure, no authentication.

        The web app uses this to decide whether Keep features exist at all (N5), so it has
        to stay cheap and always answerable - including when the credential is dead.

        Deliberately NOT `/healthz`: on a `run.app` URL Google's frontend answers that exact
        path itself with its own HTML 404, before the request ever reaches the container, so
        a liveness probe there looks permanently dead while every other path works. `/health`
        and the other obvious names do reach the app; verified against the deployed service.
        """
        return jsonify({"status": "ok", "version": __version__})

    @app.get("/keep/state")
    def keep_state() -> Response:
        """The meal plan and the shopping list, in Keep's own display order."""
        return jsonify(client_factory(settings).read_state())

    @app.post("/keep/mealplan")
    def keep_mealplan() -> Response:
        """Add dish lines to the meal plan, replacing the entries that name them.

        Body: `{"add": "<entry text>" | ["<entry text>", ...], "remove": [...]}`.
        `add` is the complete line — or the lines, in reading order — to put at the
        top of "Essensplan" (recipe title plus size suffix). A single string is the
        ordinary write; a list is how the app restores what a previous write
        replaced (undo), and an empty list is the undo of a first-time plan, which
        only takes the added line back off. `remove` are the exact texts of every
        line that names the same recipe — checked or not, and whatever size it
        states. The rule that decides which lines those are lives in the app
        (`packages/core/src/mealPlan.ts`, next to the parser), so the client decides
        *what* is the same dish and this boundary only executes the action — the
        same division that keeps the app from learning Keep's model.

        The answer is the meal plan after the write, in the shape one checklist has
        in `GET /keep/state` (`{"mealplan": {"title", "items"}}`), so the app can
        update it without a second request. Only the changed list is returned:
        reading the shopping list too would let an unrelated, missing note turn a
        successful write into an error.
        """
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise BadRequest("A JSON object body is required.")
        raw_add = payload.get("add")
        if isinstance(raw_add, str):
            added = [raw_add.strip()]
        elif isinstance(raw_add, list) and all(isinstance(text, str) for text in raw_add):
            added = [text.strip() for text in raw_add]
        else:
            raise BadRequest("The body needs an 'add' entry text or a list of entry texts.")
        if any(text == "" for text in added):
            raise BadRequest("Every added entry text must be non-empty.")
        remove = _entry_texts(payload, "remove")
        if not added and not remove:
            raise BadRequest("The body must add or remove at least one entry text.")
        return jsonify(client_factory(settings).add_meal_plan_entries(added, remove))

    @app.post("/keep/mealplan/check")
    def keep_mealplan_check() -> Response:
        """Tick ("check") or untick meal-plan lines, changing nothing else.

        Body: `{"check": ["<entry text>", ...], "uncheck": ["<entry text>", ...]}`.

        This is the recipe overview's "Vom Plan entfernen" and its undo. Removing
        a dish from the plan does not delete the Keep line - it is ticked off, so
        the line stays visible in Keep as "cooked" - and "Rückgängig" ticks it
        back on. `check` are the exact texts to tick, `uncheck` the exact texts
        to tick back on; the app owns the rule that decides which lines belong to
        a recipe, so this boundary only executes the action. A body that changes
        nothing, or that names the same entry in both directions, is refused.

        The answer is the meal plan after the write, in the shape one checklist
        has in `GET /keep/state`, so the app can update it without a second
        request - and only that list, because it is the one the action changed.
        """
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise BadRequest("A JSON object body is required.")
        checked = _entry_texts(payload, "check")
        unchecked = _entry_texts(payload, "uncheck")
        if not checked and not unchecked:
            raise BadRequest("The body must check or uncheck at least one entry text.")
        if set(checked) & set(unchecked):
            raise BadRequest("An entry text cannot be checked and unchecked at once.")
        return jsonify(client_factory(settings).set_meal_plan_checked(checked, unchecked))

    @app.post("/keep/shopping")
    def keep_shopping() -> Response:
        """Add the ingredients of the planned dishes to "Einkaufsliste", on top of the list.

        Body: `{"add": ["<line>", ...], "remove": ["<line>", ...]}` — always the
        list form, for both directions. Unlike the meal-plan write there is no
        earlier request shape to stay compatible with (this route answered 501
        until the write existed), so the boundary stays strict instead of also
        accepting a single string: the app sends lists, and a body that is not one
        is a bad request rather than a guess.

        `add` are the complete lines to put at the top of "Einkaufsliste", in the
        order they should read: one line per ingredient, in the app's display form
        and already rounded up to whole shopping units. `remove` are the exact
        texts the undo takes back off. The app owns that line form and that
        arithmetic (`packages/core/src/shoppingList.ts` and the pantry sheet);
        this boundary treats a line as opaque text and only executes the action.

        `remove` takes one instance per named text off the list - not every item
        carrying it - so an undo cannot delete an identical line the user had put
        on the list themselves (see `KeepClient.add_shopping_lines`). A body that
        changes nothing is refused.

        The answer is the shopping list after the write, in the shape one checklist
        has in `GET /keep/state` (`{"shopping": {"title", "items"}}`), so the app can
        update it without a second request - and only that list, because it is the
        one the action changed.
        """
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise BadRequest("A JSON object body is required.")
        added = _entry_texts(payload, "add")
        removed = _entry_texts(payload, "remove")
        if not added and not removed:
            raise BadRequest("The body must add or remove at least one line.")
        return jsonify(client_factory(settings).add_shopping_lines(added, removed))

    @app.post("/keep/shopping/sort")
    def keep_shopping_sort() -> Response:
        """Sort the shopping list by category/aisle. Needs the ingredient-category step first."""
        raise NotImplementedYet(
            f"{PENDING_ACTIONS['/keep/shopping/sort']} is not implemented yet."
        )

    @app.post("/shorten")
    def shorten() -> Response:
        """Shorten one export URL for a meal-plan line.

        Body: `{"url": "<the export host URL including its promised size>"}`. The answer is
        `{"shortUrl": "https://tinyurl.com/<alias>"}`.

        Why the meal plan needs this: the Keep line carries the export URL as raw text (Keep
        has no hyperlink-with-text), and the Apps Script address plus the Drive file id make
        the line enormous. The promised size is already part of `url`, so the short link's
        target opens the right cooking view - the app writes the size as the line's
        parenthetical label, because the short link itself no longer shows it.

        Deliberately narrow: only `https://` targets, a bounded length, and the same Google
        sign-in as the Keep routes. A missing token is `shortening_disabled`; the app treats
        every failure here as "write the long URL", so this route never blocks a plan write.
        """
        if not settings.shortening_configured():
            raise ShortenUnavailable(
                "Kurzlinks sind in dieser Installation nicht eingerichtet.",
                detail="TINYURL_API_TOKEN is not set",
            )
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise BadRequest("A JSON object body is required.")
        target = payload.get("url")
        if not isinstance(target, str) or target.strip() == "":
            raise BadRequest("The body needs a 'url' to shorten.")
        target = target.strip()
        if len(target) > MAX_TARGET_LENGTH:
            raise BadRequest("The URL to shorten is too long.")
        if not target.startswith("https://"):
            raise BadRequest("Only https:// URLs can be shortened.")
        return jsonify({"shortUrl": shortener.shorten(target)})

    # ----------------------------------------------------------------------------------
    # Error shape: one JSON contract for every failure
    # ----------------------------------------------------------------------------------

    @app.errorhandler(GatewayError)
    def handle_gateway_error(error: GatewayError) -> tuple[Response, int]:
        """Turn a typed gateway failure into `{"error": {"code", "message"}}`."""
        _log_event(
            "gateway_error",
            code=error.code,
            status=int(error.status),
            path=request.path,
            method=request.method,
            detail=error.detail,
        )
        return (
            jsonify({"error": {"code": error.code, "message": error.message}}),
            int(error.status),
        )

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException) -> tuple[Response, int]:
        """Give Werkzeug's own failures (404, 405, ...) the same JSON shape."""
        status = error.code or int(HTTPStatus.INTERNAL_SERVER_ERROR)
        code = HTTP_ERROR_CODES.get(status, "http_error")
        return (
            jsonify({"error": {"code": code, "message": error.description}}),
            status,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_error(error: Exception) -> tuple[Response, int]:
        """Last resort: log the traceback, return a code with no internal detail."""
        logger.exception("unhandled error while serving %s %s", request.method, request.path)
        return (
            jsonify(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "The Keep gateway failed unexpectedly.",
                    }
                }
            ),
            int(HTTPStatus.INTERNAL_SERVER_ERROR),
        )

    return app
