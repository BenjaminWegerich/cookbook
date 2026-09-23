"""The HTTP boundary: the only thing the web app is allowed to know about Keep.

The boundary is deliberately thin and action-shaped. One endpoint per user action, and the
frontend never sees Keep's own model (no note ids, no sort ids, no account details) - so a
change inside Keep or gkeepapi stays inside this service.

Endpoints:

    GET  /health                liveness, unauthenticated, cheap
    GET  /keep/state            the meal plan and shopping list, for app start
    POST /keep/mealplan         add a dish to "Essensplan"            (501 for now)
    POST /keep/shopping         add a recipe's ingredients to the list (501 for now)
    POST /keep/shopping/sort    reorder the list by category/aisle     (501 for now)

Three cross-cutting rules live here rather than at the call sites:

  * **Authentication is a seam, and it fails closed.** The service sits on a public URL and
    its credential can write to the user's Keep account, so an empty token configuration
    means "off" (503), never "open". How the *user* obtains the token is the
    gateway-authentication decision (see ARCHITECTURE.md): a shared token the user pastes
    per session, mirroring the Gemini key. Replacing that decision means replacing
    `_require_gateway_token` and nothing else.
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
    GatewayError,
    GatewayNotConfigured,
    NotImplementedYet,
    OriginNotAllowed,
    Unauthorized,
)

logger = logging.getLogger("keep_gateway")

# Session-scoped credentials in a static bundle are impossible, so the web app sends a
# token the user supplied at runtime; `Authorization: Bearer` is the least surprising shape.
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
    "/keep/mealplan": "Adding a dish to the meal plan",
    "/keep/shopping": "Adding a recipe's ingredients to the shopping list",
    "/keep/shopping/sort": "Sorting the shopping list by category",
}

# A factory is anything that turns configuration into a reader with `read_state()`.
# The real one is `KeepClient`; the tests hand in a fake, which is how the boundary is
# verified without a Google account or a network.
ClientFactory = Callable[[GatewayConfig], Any]


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


# --------------------------------------------------------------------------------------
# Application factory
# --------------------------------------------------------------------------------------


def create_app(config: GatewayConfig | None = None, client_factory: ClientFactory | None = None) -> Flask:
    """Build the Flask application.

    Configuration and the Keep client are injected so the app can be constructed with test
    doubles; production calls `create_app()` with neither and gets the environment and the
    real `KeepClient`.
    """
    settings = config if config is not None else load_config()
    # Imported here, not at module import time, so the boundary can be imported (and its
    # tests collected) even where gkeepapi is not installed.
    if client_factory is None:
        from .keep_client import KeepClient

        client_factory = KeepClient

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
    def _require_gateway_token() -> Response | None:
        """Authenticate every Keep route with the shared gateway token.

        Fail-closed in two ways: an unconfigured token makes the service refuse to serve
        Keep routes at all (503), and a wrong or missing token is a 401. The comparison is
        constant-time so the token cannot be recovered byte by byte.
        """
        if not request.path.startswith("/keep/"):
            return None
        if not settings.bearer_token:
            raise GatewayNotConfigured(
                "The Keep gateway is not configured.",
                detail="KEEP_GATEWAY_TOKEN is empty, so Keep routes are refused",
            )
        presented = _presented_token()
        if presented is None or not hmac.compare_digest(
            presented.encode("utf-8"), settings.bearer_token.encode("utf-8")
        ):
            raise Unauthorized("A valid gateway token is required.")
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
        """Add a dish to the meal plan ("Essensplan"). Implemented in the write-action step."""
        raise NotImplementedYet(
            f"{PENDING_ACTIONS['/keep/mealplan']} is not implemented yet."
        )

    @app.post("/keep/shopping")
    def keep_shopping() -> Response:
        """Add a recipe's scaled ingredients ("Einkaufsliste"). Part of the write-action step."""
        raise NotImplementedYet(
            f"{PENDING_ACTIONS['/keep/shopping']} is not implemented yet."
        )

    @app.post("/keep/shopping/sort")
    def keep_shopping_sort() -> Response:
        """Sort the shopping list by category/aisle. Needs the ingredient-category step first."""
        raise NotImplementedYet(
            f"{PENDING_ACTIONS['/keep/shopping/sort']} is not implemented yet."
        )

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
