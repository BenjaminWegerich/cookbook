"""Tests for the HTTP boundary: authentication, CORS, the error contract, the routes.

The Keep client is replaced by a fake through `create_app(client_factory=...)`, so these
tests need neither a Google account nor a network - the same isolation the spike used for
its write/cleanup paths, applied to the service.
"""

from __future__ import annotations

import logging
import unittest

from keep_gateway.app import create_app
from keep_gateway.config import GatewayConfig
from keep_gateway.errors import KeepAuthRejected

# Fixed values for the test deployment. The gateway token is a fake; nothing here touches
# a real credential.
BEARER_TOKEN = "test-gateway-token"
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
        "bearer_token": BEARER_TOKEN,
        "allowed_origins": (ALLOWED_ORIGIN,),
    }
    values.update(overrides)
    return GatewayConfig(**values)  # type: ignore[arg-type]


class FakeKeepClient:
    """Stands in for `KeepClient`: returns a fixed state, or raises a fixed failure."""

    def __init__(self, state: dict | None = None, error: Exception | None = None) -> None:
        self._state = FAKE_STATE if state is None else state
        self._error = error

    def read_state(self) -> dict:
        if self._error is not None:
            raise self._error
        return self._state


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

    def build_app(self, *, client: FakeKeepClient | None = None, **config_overrides: object):
        """Create the boundary with a fake Keep client and return both app and fake."""
        fake = client if client is not None else FakeKeepClient()
        app = create_app(config=make_config(**config_overrides), client_factory=lambda _config: fake)
        app.config["TESTING"] = True
        return app, fake

    def auth_headers(self, token: str = BEARER_TOKEN) -> dict[str, str]:
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

    def test_state_rejects_a_wrong_token(self) -> None:
        app, _fake = self.build_app()
        with app.test_client() as client:
            response = client.get("/keep/state", headers=self.auth_headers("not-the-token"))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "unauthorized")

    def test_missing_gateway_token_fails_closed(self) -> None:
        """An unconfigured deployment is off, never open - even for a "valid-looking" call."""
        app, _fake = self.build_app(bearer_token="")
        with app.test_client() as client:
            response = client.get("/keep/state", headers={"Authorization": "Bearer anything"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"]["code"], "gateway_not_configured")

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
    # Write actions: defined in the boundary, not implemented yet (the write-action step)
    # ----------------------------------------------------------------------------------

    def test_write_actions_answer_501(self) -> None:
        app, _fake = self.build_app()
        for path in ("/keep/mealplan", "/keep/shopping", "/keep/shopping/sort"):
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
        headers = {"Authorization": f"Bearer {BEARER_TOKEN}", "Origin": FOREIGN_ORIGIN}
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
            tool = client.get("/keep/state", headers={"Authorization": f"Bearer {BEARER_TOKEN}"})
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
