"""Tests for the HTTP boundary: authentication, CORS, the error contract, the routes.

Both collaborators are replaced through `create_app(...)`: the Keep client by a fake and the
Google-backed identity verifier by a fake, so these tests need neither a Google account nor a
network - the same isolation the spike used for its write/cleanup paths, applied to the
service. The verifier itself (audience, allowlist, Google's answers) is tested against a fake
HTTP session in `test_identity.py`.
"""

from __future__ import annotations

import logging
import unittest

from keep_gateway.app import create_app
from keep_gateway.config import GatewayConfig
from keep_gateway.errors import IdentityCheckUnavailable, KeepAuthRejected, Unauthorized

# Fixed values for the test deployment. The caller's token and the verifier are both fakes;
# nothing here touches Google or a real credential.
CALLER_TOKEN = "fake-google-access-token"
CALLER_EMAIL = "cookbook@example.com"
DEV_TOKEN = "local-dev-token"
ALLOWED_ORIGIN = "https://cookbook.example"
FOREIGN_ORIGIN = "https://evil.example"

# A small but realistic state: German item texts, a checked item, an indented sub-item,
# and a deliberately non-alphabetical order (the order the Keep app would render).
FAKE_STATE = {
    "mealplan": {
        "title": "Essensplan",
        "items": [
            {"text": "Kürbissuppe", "checked": False, "indented": False},
            {"text": "Bratkartoffeln", "checked": True, "indented": False},
        ],
    },
    "shopping": {
        "title": "Einkaufsliste",
        "items": [
            {"text": "500 g Kartoffeln", "checked": False, "indented": False},
            {"text": "für die Suppe", "checked": False, "indented": True},
        ],
    },
}


def make_config(**overrides: object) -> GatewayConfig:
    """A fully configured deployment, with individual fields overridable per test."""
    values: dict[str, object] = {
        "keep_email": "keeper@example.com",
        "keep_master_token": "fake-master-token",
        "keep_device_id": "fake-device-id",
        "shopping_title": "Einkaufsliste",
        "mealplan_title": "Essensplan",
        "oauth_client_id": "fake-client-id.apps.googleusercontent.com",
        "allowed_emails": frozenset({CALLER_EMAIL}),
        "dev_access_token": "",
        "allowed_origins": (ALLOWED_ORIGIN,),
    }
    values.update(overrides)
    return GatewayConfig(**values)  # type: ignore[arg-type]


class FakeKeepClient:
    """Stands in for `KeepClient`: returns a fixed state, or raises a fixed failure."""

    def __init__(self, state: dict | None = None, error: Exception | None = None) -> None:
        self._state = FAKE_STATE if state is None else state
        self._error = error
        # Every write the boundary performed, in order: (entry, replacements).
        self.writes: list[tuple[str, list[str]]] = []

    def read_state(self) -> dict:
        if self._error is not None:
            raise self._error
        return self._state

    def add_meal_plan_entry(self, entry: str, replace: list[str]) -> dict:
        if self._error is not None:
            raise self._error
        self.writes.append((entry, list(replace)))
        return self._state


class FakeIdentityVerifier:
    """Stands in for `GoogleIdentityVerifier`: a fixed caller, or a fixed failure.

    It deliberately does not look at the token: what the boundary has to guarantee is that a
    token is *presented* and that whatever the verifier decides is mapped onto the right HTTP
    answer. Which token Google accepts is the verifier's business (test_identity.py).
    """

    def __init__(self, email: str = CALLER_EMAIL, error: Exception | None = None) -> None:
        self._email = email
        self._error = error
        self.seen_tokens: list[str] = []

    def verify(self, presented_token: str) -> str:
        self.seen_tokens.append(presented_token)
        if self._error is not None:
            raise self._error
        return self._email


class GatewayBoundaryTests(unittest.TestCase):
    """One app per test, built from configuration plus a fake Keep client."""

    def setUp(self) -> None:
        # The gateway logs one JSON line per request on purpose; in the test run that is
        # noise, and `assertLogs` still works because it attaches its own handler.
        self.logger = logging.getLogger("keep_gateway")
        self._previous_propagate = self.logger.propagate
        self.logger.propagate = False
        self.addCleanup(self._restore_propagate)

    def _restore_propagate(self) -> None:
        self.logger.propagate = self._previous_propagate

    def build_app(
        self,
        *,
        client: FakeKeepClient | None = None,
        verifier: FakeIdentityVerifier | None = None,
        **config_overrides: object,
    ):
        """Create the boundary with fakes for Keep and for the caller identity."""
        fake = client if client is not None else FakeKeepClient()
        checker = verifier if verifier is not None else FakeIdentityVerifier()
        app = create_app(
            config=make_config(**config_overrides),
            client_factory=lambda _config: fake,
            identity_verifier=checker,
        )
        app.config["TESTING"] = True
        return app, fake

    def auth_headers(self, token: str = CALLER_TOKEN) -> dict[str, str]:
        """Headers for a legitimate call, including the allowed browser origin."""
        return {"Authorization": f"Bearer {token}", "Origin": ALLOWED_ORIGIN}

    # ----------------------------------------------------------------------------------
    # Liveness
    # ----------------------------------------------------------------------------------

    def test_health_answers_without_a_token_or_origin(self) -> None:
        """The liveness probe must stay cheap and always answerable (the frontend integration needs it)."""
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")
        self.assertIn("version", response.get_json())

    def test_health_does_not_touch_keep(self) -> None:
        """A dead credential must not make the gateway look unreachable."""
        app, _fake = self.build_app(client=FakeKeepClient(error=KeepAuthRejected("dead")))
        with app.test_client() as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)

    # ----------------------------------------------------------------------------------
    # Authentication seam (the gateway-authentication decision)
    # ----------------------------------------------------------------------------------

    def test_state_requires_a_token(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/state", headers={"Origin": ALLOWED_ORIGIN})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "unauthorized")

    def test_state_rejects_a_token_google_refuses(self) -> None:
        """Whatever Google says no to is a 401 - expired, foreign or unlisted alike."""
        app, _fake = self.build_app(
            verifier=FakeIdentityVerifier(error=Unauthorized("The Google sign-in is expired or invalid."))
        )
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers("stale-token"))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "unauthorized")

    def test_a_token_google_cannot_judge_is_a_retryable_503(self) -> None:
        """A check that cannot run must never count as a passed check, but it is not a 401."""
        app, _fake = self.build_app(
            verifier=FakeIdentityVerifier(error=IdentityCheckUnavailable("Google is unreachable."))
        )
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"]["code"], "identity_unavailable")

    def test_missing_identity_config_fails_closed(self) -> None:
        """An unconfigured deployment is off, never open - even for a "valid-looking" call."""
        for overrides in (
            {"oauth_client_id": ""},
            {"allowed_emails": frozenset()},
        ):
            with self.subTest(**overrides):
                app, _fake = self.build_app(**overrides)
                with app.test_client() as client:
                    response = client.get("/keep/state", headers=self.auth_headers())
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json()["error"]["code"], "gateway_not_configured")

    def test_a_valid_sign_in_reaches_the_verifier_and_the_route(self) -> None:
        """The happy path, including that the presented token is what the verifier sees."""
        verifier = FakeIdentityVerifier()
        app, _fake = self.build_app(verifier=verifier)
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(verifier.seen_tokens, [CALLER_TOKEN])

    def test_dev_token_is_accepted_only_when_configured(self) -> None:
        """The local operator escape hatch: off by default, exact match when switched on.

        The verifier refuses everything here, so a 200 can only come from the dev token - which
        also proves the dev path short-circuits before Google is consulted.
        """
        verifier = FakeIdentityVerifier(error=Unauthorized("not a Google-issued token"))
        app, _fake = self.build_app(dev_access_token=DEV_TOKEN, verifier=verifier)
        with app.test_client() as client:
            local = client.get("/keep/state", headers=self.auth_headers(DEV_TOKEN))
            wrong = client.get("/keep/state", headers=self.auth_headers("not-the-dev-token"))
        self.assertEqual(local.status_code, 200)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(verifier.seen_tokens, ["not-the-dev-token"])

    # ----------------------------------------------------------------------------------
    # GET /keep/state
    # ----------------------------------------------------------------------------------

    def test_state_returns_both_lists(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["mealplan"]["title"], "Essensplan")
        self.assertEqual(body["shopping"]["title"], "Einkaufsliste")
        self.assertEqual(body["shopping"]["items"][0]["text"], "500 g Kartoffeln")
        self.assertTrue(body["shopping"]["items"][1]["indented"])

    def test_state_is_not_cached(self) -> None:
        """Live data owned by another app: a stale shopping list is worse than a slow one."""
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    # ----------------------------------------------------------------------------------
    # Error contract
    # ----------------------------------------------------------------------------------

    def test_dead_credential_maps_to_its_own_code(self) -> None:
        """The app and the operator must be able to tell "token died" from "blocked"."""
        app, _fake = self.build_app(
            client=FakeKeepClient(error=KeepAuthRejected("Google rejected the Keep credential."))
        )
        with app.test_client() as client:
            with self.assertLogs("keep_gateway", level="INFO") as captured:
                response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"]["code"], "keep_auth_rejected")
        # The long diagnosis is for the log, not for the caller.
        self.assertTrue(any("keep_auth_rejected" in line for line in captured.output))

    def test_unexpected_failure_is_json_500(self) -> None:
        app, _fake = self.build_app(client=FakeKeepClient(error=RuntimeError("boom")))
        with app.test_client() as client:
            # assertLogs also keeps the deliberately logged traceback out of the test output;
            # the point is that it is logged, not returned.
            with self.assertLogs("keep_gateway", level="ERROR") as captured:
                response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"]["code"], "internal_error")
        # The caller learns nothing about the failure beyond "internal error".
        self.assertNotIn("boom", response.get_data(as_text=True))
        self.assertTrue(any("RuntimeError" in line for line in captured.output))

    def test_unknown_path_is_json_404(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/nope")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"]["code"], "not_found")

    def test_wrong_method_is_json_405(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/mealplan", headers=self.auth_headers())
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.get_json()["error"]["code"], "method_not_allowed")

    # ----------------------------------------------------------------------------------
    # POST /keep/mealplan (the write button)
    # ----------------------------------------------------------------------------------

    def test_mealplan_write_passes_the_entry_and_replacements_to_the_client(self) -> None:
        app, fake = self.build_app()
        with app.test_client() as client:
            response = client.post(
                "/keep/mealplan",
                headers=self.auth_headers(),
                json={
                    "add": "Kürbissuppe (6 Portionen)",
                    "remove": ["Kürbissuppe", "Kürbissuppe (4 Portionen)"],
                },
            )
        self.assertEqual(response.status_code, 200)
        # The app owns the recognition rule and sends the exact texts to drop.
        self.assertEqual(
            fake.writes,
            [("Kürbissuppe (6 Portionen)", ["Kürbissuppe", "Kürbissuppe (4 Portionen)"])],
        )
        # The answer is the post-write state, shaped like GET /keep/state.
        self.assertEqual(response.get_json()["mealplan"]["title"], "Essensplan")

    def test_mealplan_write_defaults_to_no_replacements(self) -> None:
        app, fake = self.build_app()
        with app.test_client() as client:
            response = client.post(
                "/keep/mealplan", headers=self.auth_headers(), json={"add": "Kürbissuppe"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake.writes, [("Kürbissuppe", [])])

    def test_mealplan_write_trims_the_entry_text(self) -> None:
        app, fake = self.build_app()
        with app.test_client() as client:
            response = client.post(
                "/keep/mealplan", headers=self.auth_headers(), json={"add": "  Kürbissuppe  "}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fake.writes, [("Kürbissuppe", [])])

    def test_mealplan_write_rejects_a_missing_or_empty_entry(self) -> None:
        app, fake = self.build_app()
        for body in ({}, {"add": ""}, {"add": "   "}, {"add": 6}):
            with self.subTest(body=body):
                with app.test_client() as client:
                    response = client.post(
                        "/keep/mealplan", headers=self.auth_headers(), json=body
                    )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"]["code"], "bad_request")
        self.assertEqual(fake.writes, [])

    def test_mealplan_write_rejects_a_malformed_remove_list(self) -> None:
        app, fake = self.build_app()
        for remove in ("Kürbissuppe", [1], [""]):
            with self.subTest(remove=remove):
                with app.test_client() as client:
                    response = client.post(
                        "/keep/mealplan",
                        headers=self.auth_headers(),
                        json={"add": "Kürbissuppe", "remove": remove},
                    )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"]["code"], "bad_request")
        self.assertEqual(fake.writes, [])

    def test_mealplan_write_requires_a_json_object(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.post(
                "/keep/mealplan",
                headers=self.auth_headers(),
                data="not json",
                content_type="text/plain",
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"]["code"], "bad_request")

    def test_mealplan_write_reports_keep_failures_with_their_code(self) -> None:
        app, _fake = self.build_app(
            client=FakeKeepClient(error=KeepAuthRejected("Google rejected the Keep credential."))
        )
        with app.test_client() as client:
            response = client.post(
                "/keep/mealplan", headers=self.auth_headers(), json={"add": "Kürbissuppe"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"]["code"], "keep_auth_rejected")

    def test_mealplan_write_still_requires_a_token(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.post("/keep/mealplan", json={"add": "Kürbissuppe"})
        self.assertEqual(response.status_code, 401)

    # ----------------------------------------------------------------------------------
    # Write actions still to come: defined in the boundary, not implemented yet
    # ----------------------------------------------------------------------------------

    def test_unimplemented_write_actions_answer_501(self) -> None:
        app, _fake = self.build_app()
        for path in ("/keep/shopping", "/keep/shopping/sort"):
            with self.subTest(path=path):
                with app.test_client() as client:
                    response = client.post(path, headers=self.auth_headers(), json={})
                self.assertEqual(response.status_code, 501)
                self.assertEqual(response.get_json()["error"]["code"], "not_implemented")

    def test_write_actions_still_require_a_token(self) -> None:
        """A 501 must not be reachable anonymously, or the seam would be untested."""
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.post("/keep/shopping")
        self.assertEqual(response.status_code, 401)

    # ----------------------------------------------------------------------------------
    # CORS: the web app lives on another origin (the frontend integration)
    # ----------------------------------------------------------------------------------

    def test_allowed_origin_gets_cors_headers(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers())
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN)
        self.assertIn("Authorization", response.headers.get("Access-Control-Allow-Headers", ""))

    def test_foreign_origin_is_refused_even_with_a_valid_token(self) -> None:
        app, _fake = self.build_app()
        headers = {"Authorization": f"Bearer {CALLER_TOKEN}", "Origin": FOREIGN_ORIGIN}
        with app.test_client() as client:
            response = client.get("/keep/state", headers=headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"]["code"], "origin_not_allowed")
        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_origin_header_is_required_to_be_on_the_allowlist(self) -> None:
        """An empty allowlist means no browser caller - but a non-browser caller still works."""
        app, _fake = self.build_app(allowed_origins=())
        with app.test_client() as client:
            browser = client.get("/keep/state", headers=self.auth_headers())
            tool = client.get("/keep/state", headers={"Authorization": f"Bearer {CALLER_TOKEN}"})
        self.assertEqual(browser.status_code, 403)
        self.assertEqual(tool.status_code, 200)

    def test_preflight_is_answered_without_a_token(self) -> None:
        """Browsers never send Authorization on a preflight; requiring it would break CORS."""
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.options(
                "/keep/state",
                headers={
                    "Origin": ALLOWED_ORIGIN,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization",
                },
            )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN)
        self.assertIn("GET", response.headers.get("Access-Control-Allow-Methods", ""))


if __name__ == "__main__":
    unittest.main()
