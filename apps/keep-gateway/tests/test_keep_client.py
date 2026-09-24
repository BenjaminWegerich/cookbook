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
    }
    values.update(overrides)
    return GatewayConfig(**values)  # type: ignore[arg-type]


class FakeItem:
    """Minimal stand-in for `gkeepapi.node.ListItem`."""

    def __init__(
        self,
        text: str,
        checked: bool = False,
        indented: bool = False,
        sort: int = 0,
        deleted: bool = False,
    ) -> None:
        self.text = text
        self.checked = checked
        self.indented = indented
        self.sort = sort
        self.deleted = deleted

    def delete(self) -> None:
        """gkeepapi's `delete` only marks a timestamp; the item stays in the list."""
        self.deleted = True


class FakeList:
    """Minimal stand-in for `gkeepapi.node.List`.

    `items` mirrors the real one: display order (highest sort id first) with
    deleted items hidden. That is the shape both `describe_list` and the write
    path read, so the fakes exercise the same assumptions.
    """

    def __init__(self, title: str | None, items: list[FakeItem] | None = None) -> None:
        self.title = title
        self._items = list(items or [])

    @property
    def items(self) -> list[FakeItem]:
        visible = (item for item in self._items if not item.deleted)
        return sorted(visible, key=lambda item: item.sort, reverse=True)

    def add(self, text: str, checked: bool = False, sort: int | None = None) -> FakeItem:
        item = FakeItem(text, checked=checked, sort=0 if sort is None else sort)
        self._items.append(item)
        return item


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


class SyncTests(unittest.TestCase):
    """The write path pushes with `sync`; a failed push must be a typed error, not a 500."""

    def test_a_consistency_failure_becomes_a_keep_api_error(self) -> None:
        keep = mock.MagicMock()
        keep.sync.side_effect = gkeepapi.exception.SyncException("consistency")
        with self.assertRaises(KeepApiError) as raised:
            keep_client.sync(keep)
        self.assertIn("SyncException", raised.exception.detail or "")

    def test_a_network_failure_becomes_unreachable(self) -> None:
        keep = mock.MagicMock()
        keep.sync.side_effect = requests.exceptions.ConnectionError("no route to host")
        with self.assertRaises(KeepUnreachable):
            keep_client.sync(keep)


class VerifyMealPlanStateTests(unittest.TestCase):
    """The write's own check: an unverified write must never look like success."""

    @staticmethod
    def state(*texts: str) -> dict:
        return {"title": "Essensplan", "items": [{"text": text} for text in texts]}

    def test_accepts_the_entry_appearing_exactly_once_at_the_top(self) -> None:
        keep_client.verify_meal_plan_state(
            self.state("Kürbissuppe (6 Portionen)", "Brot"),
            "Kürbissuppe (6 Portionen)",
            ["Kürbissuppe"],
        )

    def test_accepts_several_added_lines_in_the_order_they_were_given(self) -> None:
        """The undo shape: a block of restored lines reads in its original order."""
        keep_client.verify_meal_plan_state(
            self.state("Kürbissuppe (4 Portionen)", "Kürbissuppe", "Brot"),
            ["Kürbissuppe (4 Portionen)", "Kürbissuppe"],
            ["Kürbissuppe (6 Portionen)"],
        )

    def test_reports_added_lines_in_the_wrong_order(self) -> None:
        with self.assertRaises(KeepApiError):
            keep_client.verify_meal_plan_state(
                self.state("Kürbissuppe", "Kürbissuppe (4 Portionen)", "Brot"),
                ["Kürbissuppe (4 Portionen)", "Kürbissuppe"],
                [],
            )

    def test_reports_one_missing_line_among_several(self) -> None:
        with self.assertRaises(KeepApiError):
            keep_client.verify_meal_plan_state(
                self.state("Kürbissuppe (4 Portionen)", "Brot"),
                ["Kürbissuppe (4 Portionen)", "Kürbissuppe"],
                [],
            )

    def test_reports_a_missing_entry(self) -> None:
        with self.assertRaises(KeepApiError):
            keep_client.verify_meal_plan_state(
                self.state("Brot"), "Kürbissuppe (6 Portionen)", []
            )

    def test_reports_a_duplicated_entry(self) -> None:
        with self.assertRaises(KeepApiError):
            keep_client.verify_meal_plan_state(
                self.state("Kürbissuppe (6 Portionen)", "Kürbissuppe (6 Portionen)"),
                "Kürbissuppe (6 Portionen)",
                [],
            )

    def test_reports_a_replaced_entry_left_behind(self) -> None:
        with self.assertRaises(KeepApiError):
            keep_client.verify_meal_plan_state(
                self.state("Kürbissuppe (6 Portionen)", "Kürbissuppe"),
                "Kürbissuppe (6 Portionen)",
                ["Kürbissuppe"],
            )

    def test_re_planning_at_the_same_size_is_not_a_stale_entry(self) -> None:
        """The replaced text and the new text are identical; only one may remain."""
        keep_client.verify_meal_plan_state(
            self.state("Kürbissuppe (6 Portionen)"),
            "Kürbissuppe (6 Portionen)",
            ["Kürbissuppe (6 Portionen)"],
        )


class ListThatDropsWrites(FakeList):
    """A list whose `add` silently does nothing — a server that stored something else."""

    def add(self, text: str, checked: bool = False, sort: int | None = None) -> FakeItem:
        return FakeItem(text)


class AddMealPlanEntriesTests(unittest.TestCase):
    """The write path: replace what the app recognized, place the new entries on top."""

    def _client_with(self, plan: FakeList):
        """A `KeepClient` whose authentication and list lookup are replaced by fakes."""
        keep = mock.MagicMock()
        for patch in (
            mock.patch.object(keep_client, "authenticate", return_value=keep),
            mock.patch.object(keep_client, "find_list_by_title", return_value=plan),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        return keep_client.KeepClient(make_config()), keep

    def test_replaces_the_recognized_entries_and_places_the_entry_above_the_rest(self) -> None:
        plan = FakeList(
            "Essensplan",
            [
                FakeItem("Kürbissuppe (4 Portionen)", sort=5000),
                FakeItem("Brot", sort=3000),
                FakeItem("Kürbissuppe", checked=True, sort=1000),
            ],
        )
        client, keep = self._client_with(plan)

        state = client.add_meal_plan_entries(
            ["Kürbissuppe (6 Portionen)"], ["Kürbissuppe", "Kürbissuppe (4 Portionen)"]
        )

        # One sync carries the whole change.
        keep.sync.assert_called_once()
        # The new entry is on top, both recognized entries are gone - the checked
        # one as well - and the unrelated entry did not move.
        self.assertEqual(
            [item["text"] for item in state["mealplan"]["items"]],
            ["Kürbissuppe (6 Portionen)", "Brot"],
        )
        added = next(item for item in plan._items if item.text == "Kürbissuppe (6 Portionen)")
        self.assertGreater(added.sort, 3000)
        # Only the changed list is answered: the write never touches (or reads) the
        # shopping list, so a missing note cannot fail a successful write.
        self.assertEqual(set(state), {"mealplan"})

    def test_restores_several_lines_at_the_top_in_their_given_order(self) -> None:
        """The undo shape: what a previous write replaced comes back as one block."""
        plan = FakeList("Essensplan", [FakeItem("Brot", sort=3000)])
        client, keep = self._client_with(plan)

        state = client.add_meal_plan_entries(
            ["Kürbissuppe (4 Portionen)", "Kürbissuppe"], ["Kürbissuppe (6 Portionen)"]
        )

        keep.sync.assert_called_once()
        self.assertEqual(
            [item["text"] for item in state["mealplan"]["items"]],
            ["Kürbissuppe (4 Portionen)", "Kürbissuppe", "Brot"],
        )
        restored = [item for item in plan._items if item.text != "Brot"]
        self.assertEqual(len(restored), 2)
        self.assertEqual(
            [item.text for item in sorted(restored, key=lambda item: item.sort, reverse=True)],
            ["Kürbissuppe (4 Portionen)", "Kürbissuppe"],
        )

    def test_an_empty_replacement_list_only_adds(self) -> None:
        plan = FakeList("Essensplan", [FakeItem("Brot", sort=3000)])
        client, _keep = self._client_with(plan)

        state = client.add_meal_plan_entries(["Kürbissuppe (6 Portionen)"], [])

        self.assertEqual(
            [item["text"] for item in state["mealplan"]["items"]],
            ["Kürbissuppe (6 Portionen)", "Brot"],
        )

    def test_matches_replaced_texts_ignoring_surrounding_whitespace(self) -> None:
        """Keep may keep whitespace the app's parsed texts do not carry."""
        plan = FakeList("Essensplan", [FakeItem("  Kürbissuppe (4 Portionen)  ", sort=1000)])
        client, _keep = self._client_with(plan)

        state = client.add_meal_plan_entries(
            ["Kürbissuppe (6 Portionen)"], ["Kürbissuppe (4 Portionen)"]
        )

        self.assertEqual(
            [item["text"] for item in state["mealplan"]["items"]],
            ["Kürbissuppe (6 Portionen)"],
        )

    def test_a_remove_only_write_takes_an_entry_off_without_adding(self) -> None:
        """The undo of a first-time plan: nothing was replaced, so nothing comes back."""
        plan = FakeList(
            "Essensplan",
            [FakeItem("Kürbissuppe (6 Portionen)", sort=2000), FakeItem("Brot", sort=1000)],
        )
        client, keep = self._client_with(plan)

        state = client.add_meal_plan_entries([], ["Kürbissuppe (6 Portionen)"])

        keep.sync.assert_called_once()
        self.assertEqual([item["text"] for item in state["mealplan"]["items"]], ["Brot"])

    def test_refuses_a_write_that_neither_adds_nor_removes(self) -> None:
        plan = FakeList("Essensplan", [FakeItem("Kürbissuppe", sort=1000)])
        client, keep = self._client_with(plan)

        with self.assertRaises(ValueError):
            client.add_meal_plan_entries([], [])
        keep.sync.assert_not_called()
        self.assertEqual([item.text for item in plan.items], ["Kürbissuppe"])

    def test_a_write_that_does_not_land_raises_instead_of_reporting_success(self) -> None:
        plan = ListThatDropsWrites("Essensplan", [FakeItem("Brot", sort=1000)])
        client, _keep = self._client_with(plan)

        with self.assertRaises(KeepApiError):
            client.add_meal_plan_entries(["Kürbissuppe (6 Portionen)"], [])


if __name__ == "__main__":
    unittest.main()
