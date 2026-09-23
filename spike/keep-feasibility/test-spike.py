#!/usr/bin/env python3
"""Integration tests for `keep-spike.py`, run against a fake in-memory Keep server.

Why this exists
---------------
`write` and `cleanup` operate on a **live shopping list**. Testing only the ordering
arithmetic (as a thrown-together script did) leaves the parts that touch real data
unverified: the pre-test snapshot, the "fresh session" re-read that proves the server
stored the order, the leftover guard, and the cleanup restore comparison.

This module drives the real `cmd_write` / `cmd_cleanup` / `cmd_read` code paths with
`authenticate` and `all_lists` replaced by fakes, so a regression is caught here
rather than on the user's actual shopping list.

The fake server models the one behaviour that matters: a *fresh* client only sees
state that reached the server, and it can be told to ignore our sort ids so the
failure path is exercised too.

Run with:
    ./.venv/bin/python -m unittest test-spike -v
"""

from __future__ import annotations

import importlib.util
import io
import itertools
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

# --------------------------------------------------------------------------------------
# Load the spike module (its dashed filename rules out a normal import).
# --------------------------------------------------------------------------------------

SPIKE_PATH = Path(__file__).with_name("keep-spike.py")
_spec = importlib.util.spec_from_file_location("keep_spike", SPIKE_PATH)
spike = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(spike)

_item_ids = itertools.count(1)


# --------------------------------------------------------------------------------------
# Fake Google Keep
# --------------------------------------------------------------------------------------


class FakeServer:
    """In-memory stand-in for the Keep backend.

    `honour_sort_ids` models the pass case. Setting it to False models a server that
    stores items in insertion order and ignores the `sortValue` we send - the failure
    this gate exists to detect.
    """

    def __init__(self, honour_sort_ids: bool = True, accept_new_items: bool = True) -> None:
        self.honour_sort_ids = honour_sort_ids
        # False models the 2019 "Cannot modify shared note" regression: the sharee's
        # new entries are accepted locally but never reach the server.
        self.accept_new_items = accept_new_items
        # False models an account that authenticates but cannot create notes at all.
        self.accept_new_notes = True
        self.records: dict[str, list[dict]] = {}
        self.sync_calls = 0

    def add_list(self, title: str, items: list[tuple[str, bool, int]]) -> None:
        """Seed a checklist with (text, checked, sort) triples."""
        self.records[title] = [
            {
                "id": f"item-{next(_item_ids)}",
                "text": text,
                "checked": checked,
                "sort": sort,
                "deleted": False,
            }
            for text, checked, sort in items
        ]


class FakeListItem:
    """Mirrors the public surface of `gkeepapi.node.ListItem` used by the spike."""

    def __init__(self, server: FakeServer, record: dict) -> None:
        self._server = server
        self._record = record

    @property
    def id(self) -> str:
        return self._record["id"]

    @property
    def text(self) -> str:
        return self._record["text"]

    @property
    def checked(self) -> bool:
        return self._record["checked"]

    @property
    def indented(self) -> bool:
        return False

    @property
    def sort(self) -> int:
        return int(self._record["sort"])

    @sort.setter
    def sort(self, value: int) -> None:
        self._record["sort"] = int(value)

    def delete(self) -> None:
        self._record["deleted"] = True


class FakeList:
    """Mirrors `gkeepapi.node.List` for the members the spike touches.

    `records` may be passed explicitly so a list can exist as an object without ever
    being registered on the server - that is how "the note never appeared" is modelled.
    """

    def __init__(
        self, server: FakeServer, title: str, records: list[dict] | None = None
    ) -> None:
        self._server = server
        self.title = title
        self.id = f"list-{title}"
        # Default to the live server record, creating it if this is a new note.
        self._records = records if records is not None else server.records.setdefault(title, [])

    @property
    def items(self) -> list[FakeListItem]:
        """Live records in display order: top-first, i.e. descending sort id."""
        records = [r for r in self._records if not r["deleted"]]
        if self._server.honour_sort_ids:
            records = sorted(records, key=lambda record: -int(record["sort"]))
        return [FakeListItem(self._server, record) for record in records]

    def add(self, text: str, checked: bool = False, sort=None) -> FakeListItem:
        """Append an item; an int `sort` is stored, a placement value is ignored.

        When `accept_new_items` is False the record is handed back as if created but
        never stored, which is how a server-side refusal looks to the caller.
        """
        record = {
            "id": f"item-{next(_item_ids)}",
            "text": text,
            "checked": checked,
            "sort": sort if isinstance(sort, int) else 0,
            "deleted": False,
        }
        if not self._server.accept_new_items:
            record["deleted"] = True
        self._records.append(record)
        return FakeListItem(self._server, record)

    def delete(self) -> None:
        """Deleting a note removes it from the account entirely."""
        self._server.records.pop(self.title, None)


class FakeKeep:
    """Mirrors the members of `gkeepapi.Keep` the spike uses."""

    def __init__(self, server: FakeServer) -> None:
        self._server = server

    def sync(self, resync: bool = False) -> None:
        self._server.sync_calls += 1

    def createList(self, title: str, items=None) -> FakeList:
        """Create an empty checklist, as `gkeepapi.Keep.createList` does.

        When `accept_new_notes` is False the note is handed back as an object but is
        never registered on the server, so a later fresh sync cannot find it.
        """
        if not self._server.accept_new_notes:
            return FakeList(self._server, title, records=[])
        return FakeList(self._server, title)

    def dump(self) -> dict:
        return {"fake": True, "lists": list(self._server.records)}


# --------------------------------------------------------------------------------------
# Test base
# --------------------------------------------------------------------------------------

SEED_ITEMS = [
    ("400 g Mehl", False, 7_500_000_000),
    ("1 l Milch", True, 6_000_000_000),
    ("2 Zwiebeln", False, 4_000_000_000),
    ("Salz", False, 2_000_000_000),
]


class SpikeTestCase(unittest.TestCase):
    """Shared fixture: a temporary work dir plus the fake wiring."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.work = Path(self._tmp.name)

        # A real secrets file, so the genuine loader is exercised too.
        self.env_file = self.work / ".env"
        self.env_file.write_text(
            "KEEP_EMAIL=throwaway@example.com\n"
            "KEEP_MASTER_TOKEN=fake-token\n"
            "KEEP_DEVICE_ID=0123456789abcdef\n"
            "KEEP_SHOPPING_LIST_TITLE=Einkaufsliste\n"
            "KEEP_MEALPLAN_LIST_TITLE=Essensplan\n",
            encoding="utf-8",
        )
        self.before_write_file = self.work / "before-write.json"
        self.state_file = self.work / "state.json"

        # Store the originals so patched module globals are restored after each test.
        self._original_authenticate = spike.authenticate
        self._original_all_lists = spike.all_lists
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        spike.authenticate = self._original_authenticate
        spike.all_lists = self._original_all_lists

    def wire(self, server: FakeServer) -> None:
        """Point the spike at the fake server instead of Google."""
        spike.authenticate = lambda *args, **kwargs: (FakeKeep(server), 0.42)
        spike.all_lists = lambda keep: [FakeList(server, t) for t in server.records]

    def make_server(
        self, honour_sort_ids: bool = True, accept_new_items: bool = True
    ) -> FakeServer:
        server = FakeServer(
            honour_sort_ids=honour_sort_ids, accept_new_items=accept_new_items
        )
        server.add_list("Einkaufsliste", SEED_ITEMS)
        server.add_list("Essensplan", [("Pizza", False, 1_000_000_000)])
        self.wire(server)
        return server

    def run_spike(self, *argv: str) -> tuple[int, str, str]:
        """Run the CLI in-process, capturing stdout/stderr and the exit code.

        `SystemExit` is caught here, so the interpreter never gets to print its
        message. We print it ourselves to emulate the real CLI: Python writes a
        string `SystemExit` argument to stderr and exits with status 1.
        """
        out, err = io.StringIO(), io.StringIO()
        code = 0
        with redirect_stdout(out), redirect_stderr(err):
            full = ["--secrets-file", str(self.env_file), *argv]
            try:
                code = spike.main(full)
            except SystemExit as signal:
                if signal.code is None:
                    code = 0
                elif isinstance(signal.code, int):
                    code = signal.code
                else:
                    code = 1
                    err.write(f"{signal.code}\n")
        return code, out.getvalue(), err.getvalue()

    def marker_texts(self, server: FakeServer) -> list[str]:
        """Marker items on the server, in display order."""
        fake = FakeList(server, "Einkaufsliste")
        return [item.text for item in fake.items if item.text.startswith(spike.MARKER)]

    def real_texts(self, server: FakeServer) -> list[str]:
        """Non-marker items on the server, in display order."""
        fake = FakeList(server, "Einkaufsliste")
        return [item.text for item in fake.items if not item.text.startswith(spike.MARKER)]


# --------------------------------------------------------------------------------------
# Gate 1: write
# --------------------------------------------------------------------------------------


class WritePhaseTests(SpikeTestCase):
    def test_places_marker_items_on_top_in_expected_order(self) -> None:
        server = self.make_server()
        code, out, _ = self.run_spike(
            "write", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 0)
        self.assertIn("RESULT: PASS", out)
        self.assertEqual(self.marker_texts(server), spike.EXPECTED_TOP_TO_BOTTOM)

    def test_leaves_real_items_in_their_original_relative_order(self) -> None:
        server = self.make_server()
        before = self.real_texts(server)

        self.run_spike("write", "--before-write-file", str(self.before_write_file))

        self.assertEqual(self.real_texts(server), before)

    def test_writes_the_pre_test_snapshot_for_cleanup(self) -> None:
        self.make_server()
        self.run_spike("write", "--before-write-file", str(self.before_write_file))

        self.assertTrue(self.before_write_file.exists())
        snapshot = json.loads(self.before_write_file.read_text(encoding="utf-8"))
        self.assertEqual([entry["text"] for entry in snapshot], [t for t, _, _ in SEED_ITEMS])

    def test_reports_failure_when_the_server_ignores_sort_ids(self) -> None:
        # The failure this gate exists to detect: insertion order comes back instead.
        self.make_server(honour_sort_ids=False)
        code, out, _ = self.run_spike(
            "write", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 1, "a failed order check must exit non-zero")
        self.assertIn("RESULT: FAIL (order)", out)

    def test_reports_create_failure_when_the_sharee_cannot_write(self) -> None:
        # Items are created locally but never reach the server: the 2019 shared-note
        # regression. This must NOT be reported as an ordering problem.
        server = self.make_server(accept_new_items=False)
        code, out, _ = self.run_spike(
            "write", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 1)
        self.assertIn("RESULT: FAIL (create)", out)
        self.assertNotIn("RESULT: FAIL (order)", out)
        self.assertEqual(self.marker_texts(server), [])
        self.assertIn("0 of 3", out)

    def test_refuses_to_run_when_leftover_markers_exist(self) -> None:
        server = self.make_server()
        server.records["Einkaufsliste"].append(
            {
                "id": "leftover",
                "text": f"{spike.MARKER} stale",
                "checked": False,
                "sort": 9_999_999_999,
                "deleted": False,
            }
        )

        code, _, err = self.run_spike(
            "write", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 1)
        self.assertIn("leftover test item", err)
        # The guard must not have written anything.
        self.assertEqual(len(self.marker_texts(server)), 1)


# --------------------------------------------------------------------------------------
# Gate 1: cleanup
# --------------------------------------------------------------------------------------


class CleanupPhaseTests(SpikeTestCase):
    def test_removes_markers_and_reports_the_list_restored(self) -> None:
        server = self.make_server()
        self.run_spike("write", "--before-write-file", str(self.before_write_file))

        code, out, _ = self.run_spike(
            "cleanup", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 0)
        self.assertEqual(self.marker_texts(server), [])
        self.assertIn("order restored:    yes", out)
        self.assertIn("sort ids restored: yes", out)

    def test_is_a_no_op_when_no_markers_are_present(self) -> None:
        server = self.make_server()
        codes_before = len(server.records["Einkaufsliste"])

        code, out, _ = self.run_spike(
            "cleanup", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 0)
        self.assertIn("nothing to clean up", out)
        self.assertEqual(len(server.records["Einkaufsliste"]), codes_before)

    def test_flags_a_disturbed_list(self) -> None:
        # Deliberately corrupt the snapshot so the restore comparison must fail.
        server = self.make_server()
        self.run_spike("write", "--before-write-file", str(self.before_write_file))
        self.before_write_file.write_text(
            json.dumps([{"text": "something else", "checked": False, "sort": 1, "id": "x"}]),
            encoding="utf-8",
        )

        _, out, _ = self.run_spike(
            "cleanup", "--before-write-file", str(self.before_write_file)
        )

        self.assertIn("order restored:    NO", out)
        self.assertIn("Report this", out)

    def test_second_cleanup_finds_nothing_left_to_do(self) -> None:
        self.make_server()
        self.run_spike("write", "--before-write-file", str(self.before_write_file))
        self.run_spike("cleanup", "--before-write-file", str(self.before_write_file))

        code, out, _ = self.run_spike(
            "cleanup", "--before-write-file", str(self.before_write_file)
        )

        self.assertEqual(code, 0)
        self.assertIn("nothing to clean up", out)


# --------------------------------------------------------------------------------------
# Gate 1 warm-up: scratch
# --------------------------------------------------------------------------------------


class ScratchPhaseTests(SpikeTestCase):
    def test_passes_and_deletes_the_scratch_note_again(self) -> None:
        server = self.make_server()

        code, out, _ = self.run_spike("scratch")

        self.assertEqual(code, 0)
        self.assertIn("RESULT: PASS", out)
        self.assertIn("deleted again", out)
        # The scratch note must not survive the run.
        self.assertNotIn(spike.SCRATCH_TITLE_DEFAULT, server.records)

    def test_can_leave_the_scratch_note_for_inspection(self) -> None:
        server = self.make_server()

        code, out, _ = self.run_spike("scratch", "--keep")

        self.assertEqual(code, 0)
        self.assertIn("Keeping the scratch note", out)
        self.assertIn(spike.SCRATCH_TITLE_DEFAULT, server.records)
        stored = FakeList(server, spike.SCRATCH_TITLE_DEFAULT)
        self.assertEqual(
            [i.text for i in stored.items if i.text.startswith(spike.MARKER)],
            spike.EXPECTED_TOP_TO_BOTTOM,
        )

    def test_clears_a_leftover_scratch_note_before_creating_a_new_one(self) -> None:
        server = self.make_server()
        # Simulate an interrupted earlier run that left the note behind.
        server.add_list(spike.SCRATCH_TITLE_DEFAULT, [("stale", False, 1)])

        code, out, _ = self.run_spike("scratch")

        self.assertEqual(code, 0)
        self.assertIn("Removing the leftover scratch note", out)
        # Only the fresh marker items remain - the stale entry is gone.
        stored = FakeList(server, spike.SCRATCH_TITLE_DEFAULT)
        self.assertNotIn("stale", [i.text for i in stored.items])

    def test_reports_create_failure_when_the_note_never_appears(self) -> None:
        # The account can authenticate but cannot create notes at all.
        server = self.make_server()
        server.accept_new_notes = False

        code, out, _ = self.run_spike("scratch")

        self.assertEqual(code, 1)
        self.assertIn("FAIL (create)", out)
        self.assertIn("cannot create notes at all", out)

    def test_reports_order_failure_on_an_owned_list(self) -> None:
        # Writing works but sort ids are ignored even on a note we own - which rules
        # sharing out as the cause.
        self.make_server(honour_sort_ids=False)

        code, out, _ = self.run_spike("scratch")

        self.assertEqual(code, 1)
        self.assertIn("FAIL (order)", out)
        self.assertIn("a list this account owns", out)


# --------------------------------------------------------------------------------------
# Gate 4: read
# --------------------------------------------------------------------------------------


class ReadPhaseTests(SpikeTestCase):
    def test_prints_timings_inventory_and_caches_state(self) -> None:
        self.make_server()

        code, out, _ = self.run_spike("read", "--state-file", str(self.state_file))

        self.assertEqual(code, 0)
        self.assertIn("cold full sync", out)
        self.assertIn("warm incremental sync", out)
        self.assertIn("resumed start", out)
        # Every visible checklist is reported, with the meal plan marked.
        self.assertIn("'Einkaufsliste'", out)
        self.assertIn("'Essensplan' [MEAL PLAN]", out)
        self.assertTrue(self.state_file.exists())

    def test_missing_checklist_gives_an_actionable_message(self) -> None:
        server = self.make_server()
        del server.records["Einkaufsliste"]
        self.wire(server)

        code, _, err = self.run_spike("write", "--before-write-file", str(self.before_write_file))

        self.assertEqual(code, 1)
        self.assertIn("Visible checklists", err)
        self.assertIn("Einkaufsliste", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
