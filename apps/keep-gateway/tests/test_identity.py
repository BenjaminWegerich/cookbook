"""Tests for the caller-identity verifier: Google's answers, the audience, the allowlist.

The HTTP call is replaced by a fake session, so these tests need no network and no Google
account. What is being tested is the decision, not `requests`: which tokeninfo answers are
accepted, which are refused, and which failures must not be mistaken for either.
"""

from __future__ import annotations

import unittest
from typing import Any

import requests

from keep_gateway.errors import IdentityCheckUnavailable, Unauthorized
from keep_gateway.identity import TOKENINFO_URL, GoogleIdentityVerifier

# The deployment under test: one web client and one allowed account.
CLIENT_ID = "1234-fake.apps.googleusercontent.com"
ALLOWED_EMAIL = "cookbook@example.com"
PRESENTED_TOKEN = "ya29.fake-access-token"


def tokeninfo(**overrides: Any) -> dict[str, Any]:
    """A plausible *accepted* tokeninfo answer, with individual fields overridable."""
    body: dict[str, Any] = {
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "email": ALLOWED_EMAIL,
        "email_verified": True,
        "expires_in": "3599",
        "scope": "openid email",
    }
    body.update(overrides)
    return body


class FakeResponse:
    """The `status_code` + `json()` slice of a `requests.Response`."""

    def __init__(self, status_code: int, body: Any = None, *, json_error: bool = False) -> None:
        self.status_code = status_code
        self._body = body
        self._json_error = json_error

    def json(self) -> Any:
        if self._json_error:
            raise ValueError("not JSON")
        return self._body


class FakeSession:
    """Records the one call and answers with a fixed response or raises a fixed error."""

    def __init__(self, response: FakeResponse | None = None, error: Exception | None = None) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, *, params: dict[str, str], timeout: float) -> FakeResponse:
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        if self._error is not None:
            raise self._error
        assert self._response is not None  # a session is always built with one or the other
        return self._response


class GoogleIdentityVerifierTests(unittest.TestCase):
    """One verifier per case, built with a fake session."""

    def build(self, response: FakeResponse | None = None, error: Exception | None = None):
        session = FakeSession(response, error)
        verifier = GoogleIdentityVerifier(CLIENT_ID, frozenset({ALLOWED_EMAIL}), session=session)
        return verifier, session

    # ----------------------------------------------------------------------------------
    # Accepted
    # ----------------------------------------------------------------------------------

    def test_accepts_a_verified_allowlisted_address(self) -> None:
        verifier, session = self.build(FakeResponse(200, tokeninfo()))
        self.assertEqual(verifier.verify(PRESENTED_TOKEN), ALLOWED_EMAIL)
        # The token travels to Google as a query parameter, never in the URL path.
        self.assertEqual(session.calls[0]["url"], TOKENINFO_URL)
        self.assertEqual(session.calls[0]["params"], {"access_token": PRESENTED_TOKEN})

    def test_address_comparison_ignores_case(self) -> None:
        """An address is not case-sensitive; a capital letter must not lock the user out."""
        verifier, _session = self.build(FakeResponse(200, tokeninfo(email="Cookbook@Example.COM")))
        self.assertEqual(verifier.verify(PRESENTED_TOKEN), "Cookbook@Example.COM")

    def test_accepts_google_string_form_of_email_verified(self) -> None:
        """Google has answered both `true` and `"true"`; both must work."""
        verifier, _session = self.build(FakeResponse(200, tokeninfo(email_verified="true")))
        self.assertEqual(verifier.verify(PRESENTED_TOKEN), ALLOWED_EMAIL)

    def test_accepts_azp_when_aud_is_absent(self) -> None:
        verifier, _session = self.build(FakeResponse(200, tokeninfo(aud=None, azp=CLIENT_ID)))
        self.assertEqual(verifier.verify(PRESENTED_TOKEN), ALLOWED_EMAIL)

    def test_rejects_a_token_that_carries_extra_access(self) -> None:
        """A token that could read Drive files must never be accepted here (defense in depth).

        The app asks for `openid email` only, so this should never arrive - but Google tracks
        consent per client, and the gateway must not become the holder of a Drive credential
        even if a response ever came back wider than requested.
        """
        body = tokeninfo(scope="openid email https://www.googleapis.com/auth/drive.file")
        verifier, _session = self.build(FakeResponse(200, body))
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    def test_accepts_the_scope_url_spellings_of_identity_scopes(self) -> None:
        """Google reports some scopes as URLs; the identity ones must still pass."""
        body = tokeninfo(
            scope=(
                "openid https://www.googleapis.com/auth/userinfo.email "
                "https://www.googleapis.com/auth/userinfo.profile"
            )
        )
        verifier, _session = self.build(FakeResponse(200, body))
        self.assertEqual(verifier.verify(PRESENTED_TOKEN), ALLOWED_EMAIL)

    # ----------------------------------------------------------------------------------
    # Refused (401: get a fresh sign-in)
    # ----------------------------------------------------------------------------------

    def test_rejects_a_token_minted_for_another_app(self) -> None:
        """The load-bearing check: a genuine Google token for someone else's app is useless."""
        body = tokeninfo(aud="9999-other.apps.googleusercontent.com", azp="another-client")
        verifier, _session = self.build(FakeResponse(200, body))
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    def test_rejects_an_unverified_address(self) -> None:
        for body in (tokeninfo(email_verified=False), tokeninfo(email_verified="false"), tokeninfo(email_verified=None)):
            with self.subTest(email_verified=body["email_verified"]):
                verifier, _session = self.build(FakeResponse(200, body))
                with self.assertRaises(Unauthorized):
                    verifier.verify(PRESENTED_TOKEN)

    def test_rejects_an_address_off_the_allowlist(self) -> None:
        verifier, _session = self.build(FakeResponse(200, tokeninfo(email="someone@else.example")))
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    def test_rejects_a_missing_address(self) -> None:
        verifier, _session = self.build(FakeResponse(200, tokeninfo(email=None)))
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    def test_rejects_an_expired_token(self) -> None:
        verifier, _session = self.build(FakeResponse(200, tokeninfo(expires_in="0")))
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    def test_google_refusing_the_token_is_a_401(self) -> None:
        """400 is Google's documented answer for invalid, expired or foreign tokens."""
        verifier, _session = self.build(
            FakeResponse(400, {"error": "invalid_token", "error_description": "Invalid Value"})
        )
        with self.assertRaises(Unauthorized):
            verifier.verify(PRESENTED_TOKEN)

    # ----------------------------------------------------------------------------------
    # Undecided (5xx: fail closed, but retryable)
    # ----------------------------------------------------------------------------------

    def test_network_failure_fails_closed_but_is_not_a_401(self) -> None:
        verifier, _session = self.build(error=requests.ConnectionError("no route to host"))
        with self.assertRaises(IdentityCheckUnavailable):
            verifier.verify(PRESENTED_TOKEN)

    def test_google_server_error_fails_closed_but_is_not_a_401(self) -> None:
        verifier, _session = self.build(FakeResponse(503, {"error": "backend_error"}))
        with self.assertRaises(IdentityCheckUnavailable):
            verifier.verify(PRESENTED_TOKEN)

    def test_unreadable_answer_fails_closed_but_is_not_a_401(self) -> None:
        verifier, _session = self.build(FakeResponse(200, json_error=True))
        with self.assertRaises(IdentityCheckUnavailable):
            verifier.verify(PRESENTED_TOKEN)

    def test_the_allowlist_never_leaks_into_the_failure_message(self) -> None:
        """The caller learns that it was refused - not who is allowed."""
        verifier, _session = self.build(FakeResponse(200, tokeninfo(email="someone@else.example")))
        try:
            verifier.verify(PRESENTED_TOKEN)
        except Unauthorized as error:
            self.assertNotIn(ALLOWED_EMAIL, error.message)
            self.assertIn("someone@else.example", error.detail or "")
        else:  # pragma: no cover - the guard above must raise
            self.fail("an unlisted address must be refused")


if __name__ == "__main__":
    unittest.main()
