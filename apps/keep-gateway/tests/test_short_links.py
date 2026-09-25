"""Tests for the TinyURL client: answer parsing, host checking and the failure paths.

No network: `urllib.request.urlopen` is replaced, so these tests pin the contract the gateway
relies on - a usable `tiny_url` or a `ShortenFailed` - without TinyURL being reachable. The
HTTP boundary around the client is covered in `test_app.py`.
"""

from __future__ import annotations

import io
import json
import unittest
import urllib.error
from unittest import mock

from keep_gateway.errors import ShortenFailed
from keep_gateway.short_links import TinyUrlShortener, _tiny_url_from

OK_BODY = json.dumps(
    {
        "data": {
            "domain": "tinyurl.com",
            "alias": "kuerbis6",
            "tiny_url": "https://tinyurl.com/kuerbis6",
        },
        "code": 0,
        "errors": [],
    }
)


class FakeResponse(io.BytesIO):
    """A minimal stand-in for the object `urlopen` returns as a context manager."""

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


class TinyUrlResponseTests(unittest.TestCase):
    """The pure parsing step: one usable link or a typed failure, never a guess."""

    def test_reads_the_tiny_url(self) -> None:
        self.assertEqual(_tiny_url_from(OK_BODY), "https://tinyurl.com/kuerbis6")

    def test_rejects_a_body_that_is_not_json(self) -> None:
        with self.assertRaises(ShortenFailed) as caught:
            _tiny_url_from("<html>maintenance</html>")
        self.assertEqual(caught.exception.code, "shorten_failed")

    def test_rejects_a_response_without_a_usable_link(self) -> None:
        for body in (
            json.dumps({"code": 1, "data": [], "errors": ["Unauthenticated"]}),
            json.dumps({"data": {}}),
            json.dumps({"data": {"tiny_url": ""}}),
            # A link on another host would end up in the user's Keep line: refused, not used.
            json.dumps({"data": {"tiny_url": "https://evil.example/kuerbis6"}}),
            json.dumps({"data": {"tiny_url": "http://tinyurl.com/kuerbis6"}}),
            json.dumps([1, 2, 3]),
        ):
            with self.subTest(body=body):
                with self.assertRaises(ShortenFailed):
                    _tiny_url_from(body)


class TinyUrlShortenerTests(unittest.TestCase):
    """The HTTP step: the bearer token and the body, and every transport failure."""

    def _shorten_with(self, urlopen: object, target: str = "https://example.com/x") -> str:
        with mock.patch("keep_gateway.short_links.urllib.request.urlopen", urlopen):
            return TinyUrlShortener("fake-token").shorten(target)

    def test_posts_the_target_with_the_bearer_token(self) -> None:
        calls: list[tuple[object, float]] = []

        def fake_urlopen(request, timeout):  # noqa: ANN001, ANN202 - a stdlib-shaped double
            calls.append((request, timeout))
            return FakeResponse(OK_BODY.encode("utf-8"))

        short = self._shorten_with(fake_urlopen)

        self.assertEqual(short, "https://tinyurl.com/kuerbis6")
        request, _timeout = calls[0]
        self.assertEqual(request.full_url, "https://api.tinyurl.com/create")
        self.assertEqual(request.get_header("Authorization"), "Bearer fake-token")
        self.assertEqual(json.loads(request.data.decode("utf-8")), {"url": "https://example.com/x"})

    def test_an_http_error_becomes_a_shorten_failure(self) -> None:
        def fake_urlopen(request, timeout):  # noqa: ANN001, ANN202
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

        with self.assertRaises(ShortenFailed) as caught:
            self._shorten_with(fake_urlopen)
        self.assertEqual(caught.exception.code, "shorten_failed")
        self.assertIn("401", caught.exception.detail or "")

    def test_a_transport_error_becomes_a_shorten_failure(self) -> None:
        def fake_urlopen(request, timeout):  # noqa: ANN001, ANN202
            raise urllib.error.URLError("name resolution failed")

        with self.assertRaises(ShortenFailed) as caught:
            self._shorten_with(fake_urlopen)
        self.assertEqual(caught.exception.code, "shorten_failed")

    def test_the_token_never_reaches_the_logged_detail(self) -> None:
        """A failure detail is logged server-side, so it must not carry the credential."""
        body = json.dumps({"data": {"tiny_url": "https://evil.example/x"}})
        shortener = TinyUrlShortener("super-secret-token")
        with mock.patch(
            "keep_gateway.short_links.urllib.request.urlopen",
            lambda request, timeout: FakeResponse(body.encode("utf-8")),
        ):
            with self.assertRaises(ShortenFailed) as caught:
                shortener.shorten("https://example.com/x")
        self.assertNotIn("super-secret-token", caught.exception.detail or "")


if __name__ == "__main__":
    unittest.main()
