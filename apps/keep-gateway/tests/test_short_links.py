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

from keep_gateway.errors import ResolveFailed, ShortenFailed
from keep_gateway.short_links import TinyUrlShortener, _NoRedirect, _tiny_url_from

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


class FakeStatusResponse:
    """A stand-in for a 2xx answer: it has a status and can be used as a context manager."""

    status = 200

    def __enter__(self) -> "FakeStatusResponse":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class ResolveTests(unittest.TestCase):
    """Reading a short link's target: the redirect is the answer, nothing is fetched."""

    LINK = "https://tinyurl.com/kuerbis6"
    TARGET = "https://script.google.com/macros/s/abc/exec?f=1AbCdEf&portionen=6"

    def _resolve_with(self, open_result: object, link: str = LINK) -> str:
        """Runs `resolve` against a fake opener that returns or raises `open_result`."""
        opener = mock.Mock()
        if isinstance(open_result, Exception):
            opener.open.side_effect = open_result
        else:
            opener.open.return_value = open_result
        with mock.patch(
            "keep_gateway.short_links.urllib.request.build_opener", lambda _handler: opener
        ):
            return TinyUrlShortener("unused-token").resolve(link)

    def test_reads_the_redirect_location_without_following_it(self) -> None:
        # A 3xx that urllib reports as an HTTPError: what the no-redirect handler produces.
        error = urllib.error.HTTPError(
            self.LINK, 301, "Moved Permanently", {"Location": self.TARGET}, None
        )
        with mock.patch(
            "keep_gateway.short_links.urllib.request.build_opener"
        ) as build_opener:
            build_opener.return_value.open.side_effect = error
            target = TinyUrlShortener("unused-token").resolve(self.LINK)

        self.assertEqual(target, self.TARGET)
        opener = build_opener.call_args.args[0]
        # The redirect must be stopped, not followed: this is the whole safety of the call.
        # `build_opener` takes the handler class and instantiates it itself.
        self.assertIs(opener, _NoRedirect)
        request = build_opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, self.LINK)
        self.assertEqual(request.get_method(), "GET")

    def test_an_answer_that_is_no_redirect_is_a_failure(self) -> None:
        """A 200 means a challenge or error page, not a target."""
        with self.assertRaises(ResolveFailed) as caught:
            self._resolve_with(FakeStatusResponse())
        self.assertEqual(caught.exception.code, "resolve_failed")

    def test_a_missing_location_is_a_failure(self) -> None:
        error = urllib.error.HTTPError(self.LINK, 302, "Found", {}, None)
        with self.assertRaises(ResolveFailed) as caught:
            self._resolve_with(error)
        self.assertEqual(caught.exception.code, "resolve_failed")

    def test_a_non_redirect_http_error_is_a_failure(self) -> None:
        error = urllib.error.HTTPError(self.LINK, 404, "Not Found", {}, None)
        with self.assertRaises(ResolveFailed) as caught:
            self._resolve_with(error)
        self.assertEqual(caught.exception.code, "resolve_failed")
        self.assertIn("404", caught.exception.detail or "")

    def test_a_transport_error_is_a_failure(self) -> None:
        with self.assertRaises(ResolveFailed) as caught:
            self._resolve_with(urllib.error.URLError("name resolution failed"))
        self.assertEqual(caught.exception.code, "resolve_failed")

    def test_a_target_that_is_not_http_is_refused(self) -> None:
        """The target ends up in the app and in the next shortening call: no `javascript:`."""
        for location in (
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "ftp://example.com/x",
            "https://" + "a" * 3000,
        ):
            with self.subTest(location=location):
                error = urllib.error.HTTPError(
                    self.LINK, 301, "Moved Permanently", {"Location": location}, None
                )
                with self.assertRaises(ResolveFailed):
                    self._resolve_with(error)

    def test_a_link_that_is_not_a_tinyurl_is_refused_without_a_request(self) -> None:
        """The check sits in the client too, so no caller can turn it into an open reader."""
        with mock.patch("keep_gateway.short_links.urllib.request.build_opener") as build_opener:
            for link in ("https://evil.example/k7f2qa", "http://tinyurl.com/k7f2qa", ""):
                with self.subTest(link=link):
                    with self.assertRaises(ResolveFailed):
                        TinyUrlShortener("unused-token").resolve(link)
        build_opener.assert_not_called()

    def test_the_no_redirect_handler_declines_every_redirect(self) -> None:
        """Returning None is what makes urllib surface the 3xx instead of following it."""
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 301, "Moved", {}, "https://x"))


if __name__ == "__main__":
    unittest.main()
