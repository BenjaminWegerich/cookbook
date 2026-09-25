"""Shortens a recipe export's long URL through TinyURL.

Why this exists: a meal-plan line carries the recipe's export URL, and the Apps Script host
address plus the Drive file id make that line enormous in Google Keep. The app writes a short
link instead. The promised size is baked into the short link's *target* - a redirect does not
reliably forward an added fragment or query parameter, and Apps Script never sees a fragment
at all - so one link exists per (recipe, size), created on demand when a dish is planned.

The call runs here rather than in the browser for two reasons: TinyURL's API sends no CORS
header the Pages origin could use, and the API token may never ship in a static bundle.

Contract, kept deliberately narrow: one `POST https://api.tinyurl.com/create` with the bearer
token and `{"url": ...}`; the answer's `data.tiny_url` is returned after checking that it
really is a `tinyurl.com` link. Anything else - a timeout, a 4xx/5xx, an unreadable body, a
link on another host - raises `ShortenFailed`, which the app answers by writing the long URL.
Every created link is permanent, so a failure here only costs the shorter line, never the
plan write.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .errors import ShortenFailed

# The one endpoint used and the one host a shortened link may live on. A branded domain would
# need its own configuration; anything else is a refusal, not a link the app embeds in Keep.
TINYURL_CREATE_URL = "https://api.tinyurl.com/create"
TINYURL_HOSTS = frozenset({"tinyurl.com", "www.tinyurl.com"})

# A few seconds at most: the plan write waits for this answer, and the app falls back to the
# long URL, so a hanging shortener must never hold the write open.
REQUEST_TIMEOUT_SECONDS = 5.0

# The shortest and longest target worth sending. The app always sends an export-host URL
# (well under 1000 characters); the bound only stops a malformed caller from making the
# gateway forward an arbitrarily large body to TinyURL.
MAX_TARGET_LENGTH = 2000


class TinyUrlShortener:
    """Shortens one URL per call with the configured TinyURL API token.

    The token is the only state: TinyURL owns the mapping, so nothing is cached here - the
    app reuses an existing link out of the meal plan itself before it asks for a new one.
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
    if not isinstance(tiny_url, str) or not _is_tinyurl(tiny_url):
        raise ShortenFailed(
            "Der Kurzlink konnte nicht erzeugt werden.",
            detail=f"TinyURL answered without a usable tiny_url: {body[:200]!r}",
        )
    return tiny_url


def _is_tinyurl(url: str) -> bool:
    """True for an `https://tinyurl.com/…` (or `www.`) link and nothing else."""
    parts = url.split("/", 3)
    return (
        len(parts) == 4
        and parts[0] == "https:"
        and parts[2].lower() in TINYURL_HOSTS
        and parts[3] != ""
    )
