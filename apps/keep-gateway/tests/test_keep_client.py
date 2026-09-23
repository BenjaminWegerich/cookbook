"""Tests for the Keep access layer: list lookup, the boundary's list shape, and the way
every authentication failure is translated.

`gkeepapi.Keep` is patched, and the list helpers are driven either by fakes or by patching
`all_lists`, so no test needs a Google account, a token or a network. What is asserted is
the *contract* the HTTP layer relies on: which error a failure becomes, and which facts
cross the boundary.
"""

from __future__ import annotations

import unittest
from unittest import mock

import gkeepapi
import requests

from keep_gateway import keep_client
from keep_gateway.config import GatewayConfig
from keep_gateway.errors import (
    GatewayNotConfigured,
    KeepApiError,
    KeepAuthRejected,
    KeepListMissing,
    KeepUnreachable,
)


def make_config(**overrides: object) -> GatewayConfig:
    """A complete configuration; the values are fakes and never used against Google."""
    values: dict[str, object] = {
        "keep_email": "keeper@example.com",
        "keep_master_token": "fake-master-token",
        "keep_device_id": "fake-device-id",
        "shopping_title": "Einkaufsliste",
        "mealplan_title": "Essensplan",
        "bearer_token": "test-gateway-token",
    }
    values.update(overrides)
    return GatewayConfig(**values)  # type: ignore[arg-type]


class FakeItem:
    """Minimal stand-in for `gkeepapi.node.ListItem`."""

    def __init__(self, text: str, checked: bool = False, indented: bool = False, sort: int = 0) -> None:
        self.text = text
        self.checked = checked
        self.indented = indented
        self.sort = sort


class FakeList:
    """Minimal stand-in for `gkeepapi.node.List`."""

    def __init__(self, title: str | None, items: list[FakeItem] | None = None) -> None:
        self.title = title
        self.items = items or []


class DescribeListTests(unittest.TestCase):
    """`describe_list` is the contract with the frontend - it must not leak Keep's model."""

    def test_keeps_display_order_and_returns_only_visible_facts(self) -> None:
        target = FakeList(
            "Einkaufsliste",
            [
                FakeItem("500 g Kartoffeln", sort=9000),
                FakeItem("2 Zwiebeln", checked=True, sort=8000),
                FakeItem("für die Suppe", indented=True, sort=7000),
            ],
        )
        described = keep_client.describe_list(target)

        self.assertEqual(described["title"], "Einkaufsliste")
        self.assertEqual(
            [item["text"] for item in described["items"]],
            ["500 g Kartoffeln", "2 Zwiebeln", "für die Suppe"],
        )
        self.assertTrue(described["items"][1]["checked"])
        self.assertTrue(described["items"][2]["indented"])

        # Keep's implementation details stay inside the gateway (the boundary contract).
        for item in described["items"]:
            self.assertEqual(set(item), {"text", "checked", "indented"})

    def test_untitled_list_still_has_a_string_title(self) -> None:
        """A note without a title must not put `null` into the response shape."""
        self.assertEqual(keep_client.describe_list(FakeList(None))["title"], "")


class FindListTests(unittest.TestCase):
    """Title lookup is the one place a renamed or unshared note shows up."""

    def test_matches_case_insensitively_and_ignores_padding(self) -> None:
        wanted = FakeList("Einkaufsliste")
        with mock.patch.object(keep_client, "all_lists", return_value=[FakeList("Essensplan"), wanted]):
            found = keep_client.find_list_by_title(object(), "  einkaufsliste ")
        self.assertIs(found, wanted)

    def test_missing_list_is_a_typed_error_with_the_visible_titles_in_the_detail(self) -> None:
        with mock.patch.object(
            keep_client, "all_lists", return_value=[FakeList("Essensplan"), FakeList(None)]
        ):
            with self.assertRaises(KeepListMissing) as raised:
                keep_client.find_list_by_title(object(), "Einkaufsliste")

        # The server-side detail names the alternatives; the caller-facing message does not.
        self.assertIn("Essensplan", raised.exception.detail or "")
        self.assertIn("<untitled>", raised.exception.detail or "")
        self.assertNotIn("Essensplan", raised.exception.message)


class AuthenticateTests(unittest.TestCase):
    """Every documented failure mode must become its own typed gateway error."""

    def test_missing_credentials_are_refused_before_any_network_call(self) -> None:
        config = make_config(keep_master_token="", keep_device_id="")
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            with self.assertRaises(GatewayNotConfigured) as raised:
                keep_client.authenticate(config)
        keep_class.assert_not_called()
        self.assertIn("KEEP_MASTER_TOKEN", raised.exception.detail or "")
        self.assertIn("KEEP_DEVICE_ID", raised.exception.detail or "")

    def test_never_resumes_from_a_cache(self) -> None:
        """No state cache: every request must prove the credential with a cold sync."""
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            keep_client.authenticate(make_config())

        _args, kwargs = keep_class.return_value.authenticate.call_args
        self.assertIsNone(kwargs["state"])
        self.assertTrue(kwargs["sync"])
        self.assertEqual(kwargs["device_id"], "fake-device-id")

    def test_rejected_credential_is_reported_as_auth_rejected(self) -> None:
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            keep_class.return_value.authenticate.side_effect = gkeepapi.exception.LoginException(
                "BadAuthentication"
            )
            with self.assertRaises(KeepAuthRejected) as raised:
                keep_client.authenticate(make_config())
        self.assertIn("re-mint", raised.exception.detail or "")

    def test_non_json_answer_is_reported_as_unreachable(self) -> None:
        """This is how the spike documented a blocked host or network showing up."""
        error = requests.exceptions.JSONDecodeError("Expecting value", "<html>", 0)
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            keep_class.return_value.authenticate.side_effect = error
            with self.assertRaises(KeepUnreachable) as raised:
                keep_client.authenticate(make_config())
        self.assertIn("non-JSON", raised.exception.detail or "")

    def test_network_error_is_reported_as_unreachable(self) -> None:
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            keep_class.return_value.authenticate.side_effect = requests.exceptions.ConnectionError(
                "no route to host"
            )
            with self.assertRaises(KeepUnreachable):
                keep_client.authenticate(make_config())

    def test_any_other_keep_error_is_reported_as_an_api_error(self) -> None:
        with mock.patch.object(keep_client.gkeepapi, "Keep") as keep_class:
            keep_class.return_value.authenticate.side_effect = gkeepapi.exception.SyncException(
                "consistency"
            )
            with self.assertRaises(KeepApiError) as raised:
                keep_client.authenticate(make_config())
        self.assertIn("SyncException", raised.exception.detail or "")


if __name__ == "__main__":
    unittest.main()
