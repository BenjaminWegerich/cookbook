"""Tests for the cloud mint job.

The mint is the recovery path, so its two dangerous mistakes are what these tests pin down:
storing a token without proving the cloud can use it, and storing a token that belongs to the
*wrong* account. Everything external - the exchange, the authentication, the list read and
the Secret Manager write - is patched.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from keep_gateway.errors import KeepAuthRejected
from ops import mint_in_cloud


class FakeList:
    """Minimal stand-in for `gkeepapi.node.List` (only `.title` is read)."""

    def __init__(self, title: str) -> None:
        self.title = title


BASE_ENV = {
    "KEEP_EMAIL": "bot@example.com",
    "KEEP_DEVICE_ID": "device-id",
    "KEEP_OAUTH_TOKEN": "oauth-cookie-value",
    "GOOGLE_CLOUD_PROJECT": "cookbook-keep",
}


class MintTests(unittest.TestCase):
    """One test per branch of `run_mint`; the store call marks "a token was persisted"."""

    def run_mint(self, *, env: dict | None = None, exchange: dict | None = None,
                 lists: list | None = None, auth_error: Exception | None = None,
                 exchange_error: Exception | None = None) -> tuple[int, dict, mock.Mock]:
        """Drive `run_mint` with patched externals; return (exit code, record, store mock)."""
        record: dict = {"stage": "start"}
        store = mock.Mock(return_value="stored as a new version of keep-master-token-cloud")

        with mock.patch.dict(mint_in_cloud.os.environ, env if env is not None else BASE_ENV, clear=True):
            with mock.patch.object(mint_in_cloud.gpsoauth, "exchange_token") as exchange_token:
                if exchange_error is not None:
                    exchange_token.side_effect = exchange_error
                else:
                    exchange_token.return_value = exchange if exchange is not None else {"Token": "master-token"}

                with mock.patch.object(mint_in_cloud, "authenticate") as authenticate:
                    if auth_error is not None:
                        authenticate.side_effect = auth_error
                    with mock.patch.object(
                        mint_in_cloud, "all_lists", return_value=lists or []
                    ):
                        with mock.patch.object(
                            mint_in_cloud, "store_in_secret_manager", store
                        ):
                            code = mint_in_cloud.run_mint(record)

        return code, record, store

    def test_fingerprint_never_reveals_the_value(self) -> None:
        fingerprint = mint_in_cloud.fingerprint("super-secret-token")
        self.assertNotIn("super-secret-token", fingerprint)
        self.assertIn("18 chars", fingerprint)

    def test_missing_configuration_stops_before_any_network_call(self) -> None:
        code, record, store = self.run_mint(env={"KEEP_EMAIL": "bot@example.com"})
        self.assertEqual(code, 1)
        self.assertEqual(record["stage"], "config")
        self.assertIn("KEEP_OAUTH_TOKEN", record["error"])
        store.assert_not_called()

    def test_failed_exchange_is_reported_without_the_token_field(self) -> None:
        code, record, store = self.run_mint(
            exchange={"Error": "BadAuthentication", "Token": ""}
        )
        self.assertEqual(code, 1)
        self.assertEqual(record["outcome"], "FAILED")
        self.assertNotIn("Token", record["server_response"])
        store.assert_not_called()

    def test_exchange_exception_is_reported(self) -> None:
        code, record, _store = self.run_mint(exchange_error=RuntimeError("no route"))
        self.assertEqual(code, 1)
        self.assertEqual(record["stage"], "exchange")
        self.assertIn("RuntimeError", record["error"])

    def test_a_token_the_cloud_cannot_use_is_never_stored(self) -> None:
        """The whole point of the mint-from-the-cloud rule: prove it here, or store nothing."""
        code, record, store = self.run_mint(
            auth_error=KeepAuthRejected("dead", detail="BadAuthentication")
        )
        self.assertEqual(code, 1)
        self.assertEqual(record["error_code"], "keep_auth_rejected")
        store.assert_not_called()

    def test_too_many_checklists_aborts_without_storing(self) -> None:
        """The wrong browser profile would mint a full-access token for the main account."""
        code, record, store = self.run_mint(
            lists=[FakeList(f"list-{index}") for index in range(6)]
        )
        self.assertEqual(code, 1)
        self.assertEqual(record["outcome"], "ABORTED")
        self.assertIn("main account", record["reason"])
        store.assert_not_called()

    def test_success_stores_the_token_and_keeps_it_out_of_the_record(self) -> None:
        code, record, store = self.run_mint(
            exchange={"Token": "master-token-value"},
            lists=[FakeList("Einkaufsliste"), FakeList("Essensplan")],
        )
        self.assertEqual(code, 0)
        self.assertEqual(record["stage"], "authenticate")
        self.assertEqual(record["titles"], ["Einkaufsliste", "Essensplan"])
        store.assert_called_once_with("cookbook-keep", "keep-master-token-cloud", "master-token-value")
        self.assertNotIn("master-token-value", json.dumps(record))

    def test_target_secret_can_be_overridden(self) -> None:
        env = {**BASE_ENV, "TARGET_SECRET": "keep-master-token-experiment"}
        _code, _record, store = self.run_mint(env=env, lists=[FakeList("Einkaufsliste")])
        self.assertEqual(store.call_args.args[1], "keep-master-token-experiment")


if __name__ == "__main__":
    unittest.main()
