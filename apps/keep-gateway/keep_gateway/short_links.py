"""Creates short links for a recipe export's long URL, and reads their target back.

Why this exists: a meal-plan line carries the recipe's export URL, and the Apps Script host
address plus the Drive file id make that line enormous in Google Keep. The app writes a short
link instead. The promised size is baked into the short link's *target* - a redirect does not
reliably forward an added fragment or query parameter, and Apps Script never sees a fragment
at all - so one link exists per (recipe, size), created on demand when a dish is planned. The
Keep line therefore reads "Kürbissuppe: tinyurl.com/k7f2qa": the short link cannot show the
size, and the app recovers it by resolving the link (`resolve`, `POST /shorten/resolve`)
instead of writing the size into the line.

The calls run here rather than in the browser for two reasons: TinyURL's API sends no CORS
header the Pages origin could use, and the API token may never ship in a static bundle.

Contract, kept deliberately narrow: one `POST https://api.tinyurl.com/create` with the bearer
token and `{"url": ...}`; the answer's `data.tiny_url` is returned after checking that it
really is a `tinyurl.com` link. Anything else - a timeout, a 4xx/5xx, an unreadable body, a
link on another host - raises `ShortenFailed`, which the app answers by writing the long URL.
Every created link is permanent, so a failure here only costs the shorter line, never the
plan write.

Resolving is the mirror image and needs no token: one `GET` on the short link, whose redirect
is *read but never followed* (the target's `Location` is the whole answer). A refused,
missing or non-http(s) `Location` raises `ResolveFailed`. Both failures are fail-soft at the
call site: the app writes the long URL, or falls back to the recipe's written size.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from . import __version__
from .errors import ResolveFailed, ShortenFailed

# The one endpoint used and the one host a shortened link may live on. A branded domain would
# need its own configuration; anything else is a refusal, not a link the app embeds in Keep.
TINYURL_CREATE_URL = "https://api.tinyurl.com/create"
TINYURL_HOSTS = frozenset({"tinyurl.com", "www.tinyurl.com"})

# A few seconds at most: the plan write waits for this answer, and the app falls back to the
# long URL, so a hanging shortener must never hold the write open. A resolution runs on the
# plan read, where the app shows the plan without the size when it fails.
REQUEST_TIMEOUT_SECONDS = 5.0

# The shortest and longest target worth sending. The app always sends an export-host URL
# (well under 1000 characters); the bound only stops a malformed caller from making the
# gateway forward an arbitrarily large body to TinyURL.
MAX_TARGET_LENGTH = 2000

# A short link is short (`https://tinyurl.com/<alias>`); the bound only stops a caller from
# making the gateway fetch an arbitrary URL path on the shortener host.
MAX_SHORT_URL_LENGTH = 300

# The statuses a short link answers with. Reading their `Location` header is the whole
# resolution: the target itself is never fetched.
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})

# Identifies the caller to TinyURL. The default `Python-urllib/...` agent is more likely to be
# answered with a challenge page than a redirect.
USER_AGENT = f"cookbook-keep-gateway/{__version__}"


class TinyUrlShortener:
    """One TinyURL client: creates a short link, and reads a link's target back.

    `shorten` uses the configured API token; `resolve` needs none, because reading a redirect
    costs nothing and the link itself is the only input. The token is the only state: TinyURL
    owns the mapping, so nothing is cached here - the app reuses an existing link out of the
    meal plan itself before it asks for a new one, and caches the resolved targets for its
    session.
    """

    def __init__(self, token: str, *, timeout: float = REQUEST_TIMEOUT_SECONDS) -> None:
        self._token = token
        self._timeout = timeout

    def shorten(self, target: str) -> str:
        """Returns the short link for `target`, or raises `ShortenFailed`."""
        request = urllib.request.Request(
            TINYURL_CREATE_URL,
            data=json.dumps({"url": target}).encode("utf-8"),
            headers={
                # The token travels as a bearer credential and never reaches a log line: the
                # error details below name the failure, never the request.
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            # TinyURL's own validation and permission failures arrive as 4xx; both mean "no
            # link this time", which is all the app needs to know.
            raise ShortenFailed(
                "Der Kurzlink konnte nicht erzeugt werden.",
                detail=f"TinyURL answered HTTP {error.code}",
            ) from error
        except (urllib.error.URLError, OSError) as error:
            raise ShortenFailed(
                "Der Kurzlink konnte nicht erzeugt werden.",
                detail=f"TinyURL unreachable: {error}",
            ) from error
        return _tiny_url_from(body)

    def resolve(self, short_url: str) -> str:
        """Returns the export URL `short_url` redirects to, or raises `ResolveFailed`.

        The redirect is read, never followed: the app needs the URL (it parses the promised
        size out of it), and fetching the export host's page is neither this service's job
        nor a request the caller asked for. A shortener that answers 200 instead of a
        redirect (a challenge or error page) is therefore a failure, not a target.
        """
        if not is_tiny_url(short_url):
            raise ResolveFailed(
                "Der Kurzlink kann nicht gelesen werden.",
                detail=f"not a tinyurl.com link: {short_url[:100]!r}",
            )
        request = urllib.request.Request(
            short_url,
            method="GET",
            headers={"Accept": "text/html", "User-Agent": USER_AGENT},
        )
        # `build_opener` skips its default redirect handler when an instance of a subclass is
        # passed, so the 3xx arrives here as an `HTTPError` whose `Location` is the answer.
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(request, timeout=self._timeout) as response:
                raise ResolveFailed(
                    "Der Kurzlink kann nicht gelesen werden.",
                    detail=f"TinyURL answered HTTP {response.status} instead of a redirect",
                )
        except urllib.error.HTTPError as error:
            if error.code not in REDIRECT_STATUSES:
                raise ResolveFailed(
                    "Der Kurzlink kann nicht gelesen werden.",
                    detail=f"TinyURL answered HTTP {error.code}",
                ) from error
            location = error.headers.get("Location") if error.headers is not None else None
            if not isinstance(location, str) or location.strip() == "":
                raise ResolveFailed(
                    "Der Kurzlink kann nicht gelesen werden.",
                    detail=f"redirect {error.code} without a Location header",
                ) from error
            return _checked_target(location.strip())
        except (urllib.error.URLError, OSError) as error:
            raise ResolveFailed(
                "Der Kurzlink kann nicht gelesen werden.",
                detail=f"TinyURL unreachable: {error}",
            ) from error


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stops at a redirect instead of following it (see `TinyUrlShortener.resolve`)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN202
        # Returning None makes urllib raise the 3xx as an `HTTPError`, which carries the
        # `Location` header this module reads.
        return None


def _tiny_url_from(body: str) -> str:
    """Reads `data.tiny_url` from a TinyURL answer and checks the host it names.

    Both checks matter: the response is a third party's document, and a link on some other
    host would end up embedded in the user's Keep line, so a shape that is not exactly the
    documented one is a failure rather than a best guess.
    """
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise ShortenFailed(
            "Der Kurzlink konnte nicht erzeugt werden.",
            detail="TinyURL answered a body that is not JSON",
        ) from error
    data = payload.get("data") if isinstance(payload, dict) else None
    tiny_url = data.get("tiny_url") if isinstance(data, dict) else None
    if not isinstance(tiny_url, str) or not is_tiny_url(tiny_url):
        raise ShortenFailed(
            "Der Kurzlink konnte nicht erzeugt werden.",
            detail=f"TinyURL answered without a usable tiny_url: {body[:200]!r}",
        )
    return tiny_url


def _checked_target(location: str) -> str:
    """Validates a redirect target before the app is told about it.

    The value comes from a third party's `Location` header and ends up in the meal-plan line's
    card and, on the next write, in `POST /shorten`. Only a bounded plain http(s) URL is
    accepted: a `javascript:` or `data:` URL is a link the app must not carry, and a body-sized
    one is not something the shortener could have produced.
    """
    if len(location) > MAX_TARGET_LENGTH:
        raise ResolveFailed(
            "Der Kurzlink kann nicht gelesen werden.",
            detail=f"redirect target is longer than {MAX_TARGET_LENGTH} characters",
        )
    if not location.lower().startswith(("https://", "http://")):
        raise ResolveFailed(
            "Der Kurzlink kann nicht gelesen werden.",
            detail=f"redirect target is not an http(s) URL: {location[:100]!r}",
        )
    return location


def is_tiny_url(url: str) -> bool:
    """True for an `https://tinyurl.com/…` (or `www.`) link and nothing else.

    The check is deliberately strict: this service writes such links into the user's Keep
    note, and the resolve route must not become a reader for arbitrary redirects.
    """
    parts = url.split("/", 3)
    return (
        len(parts) == 4
        and parts[0] == "https:"
        and parts[2].lower() in TINYURL_HOSTS
        and parts[3] != ""
    )
