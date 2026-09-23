#!/usr/bin/env python3
"""Google Keep feasibility spike: master-token bootstrap plus the Gate 1/4 checks.

Background
----------
Google Keep has no usable API for personal Google accounts: the official Keep API
is Workspace-only and cannot edit a list at all. The unofficial clients therefore
talk to Google's private mobile Keep API, authenticated with a long-lived "master
token" instead of an OAuth consent flow.

This spike answers two questions before any cloud host is provisioned:

  Gate 1 (functional)
      Can the throwaway account - as a *sharee* - add items to the shared
      shopping list and control their order? This is the only test that can prove
      the whole design impossible, and it needs no server.

  Gate 4 (timing)
      How long does a cold full sync take, and how fast is a resumed,
      state-cached start? If a cold sync takes only a couple of seconds, serverless
      cold starts stop being a design constraint, and the state cache stops being
      worth persisting.

Security model
--------------
A master token grants full access to the account it belongs to. This spike is
built around a *dedicated throwaway account* that only has the two Keep notes
shared into it, so a compromise exposes those two notes and nothing else. The
token lives in a local `.env` file with mode 0600 and is never printed in full.

Subcommands
-----------
    token     Exchange the browser `oauth_token` cookie for a master token.
    read      Gate 4 timings plus a full inventory of the visible lists.
    scratch   Gate 1 warm-up: the ordered write test on a throwaway-owned note.
    write     Gate 1: create three ordered test items in the shared list.
    cleanup   Delete every test item and verify the real items were restored.

Typical sequence: `token` -> `read` -> `scratch` -> `write` -> (look in the Keep app)
-> `cleanup`. Running `scratch` first exercises the whole toolchain without touching
the real shopping list, so a later failure can be attributed to sharing.
"""

from __future__ import annotations

import argparse
import getpass
import json
import secrets
import stat
import sys
import time
from pathlib import Path
from typing import Any

import gkeepapi
import gpsoauth
import requests
from gkeepapi import node

# --------------------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------------------

# Fixed client signature of the Google Keep Android app, as documented by gpsoauth.
# gpsoauth defaults to this value already; we pass it explicitly so that a future
# library default cannot silently change which app we impersonate.
ANDROID_CLIENT_SIG = "38918a453d07199354f8b19af05ec6562ced5788"

SECRETS_FILE_DEFAULT = Path(__file__).with_name(".env")
STATE_FILE_DEFAULT = Path(__file__).with_name("state.json")
BEFORE_WRITE_FILE_DEFAULT = Path(__file__).with_name("before-write.json")

KEY_EMAIL = "KEEP_EMAIL"
KEY_MASTER_TOKEN = "KEEP_MASTER_TOKEN"
KEY_DEVICE_ID = "KEEP_DEVICE_ID"
KEY_SHOPPING_TITLE = "KEEP_SHOPPING_LIST_TITLE"
KEY_MEALPLAN_TITLE = "KEEP_MEALPLAN_LIST_TITLE"

# Every item this spike creates carries this prefix. `cleanup` deletes nothing else
# and the write phase refuses to touch any item without it, so runbook mistakes
# cannot damage real shopping-list entries.
MARKER = "GATE1-TEST"

# The three test items are created in CREATION_ORDER but must end up displayed in
# EXPECTED order. Both orders differ from alphabetical order and from each other,
# so a passing result proves our own sort ids are being honoured - and not an
# alphabetical default or plain insertion order.
CREATION_ORDER = [f"{MARKER} alpha", f"{MARKER} bravo", f"{MARKER} charlie"]
EXPECTED_TOP_TO_BOTTOM = [f"{MARKER} charlie", f"{MARKER} alpha", f"{MARKER} bravo"]

# Offset added above the highest existing sort id, so test items always sit at the
# very top of the list and never interleave with real entries. gkeepapi generates
# its own ids in the range 1_000_000_000..9_999_999_999.
SORT_OFFSET_ABOVE_EXISTING = 1000

# Title of the throwaway-owned scratch note used by the `scratch` subcommand. The
# German suffix makes it obvious in the Keep app that it is disposable.
SCRATCH_TITLE_DEFAULT = "GATE1-SCRATCH (kann gelöscht werden)"

# Canonical names of the two shared notes. These are the defaults the CLI falls back
# to when .env does not override them, kept here as the single source of truth.
SHOPPING_TITLE_DEFAULT = "Einkaufsliste"
MEALPLAN_TITLE_DEFAULT = "Essensplan"


# --------------------------------------------------------------------------------------
# Secrets file handling
# --------------------------------------------------------------------------------------


def read_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE file, ignoring blank lines and comments."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def write_env_file(path: Path, values: dict[str, str]) -> None:
    """Write KEY=VALUE lines and restrict the file to owner read/write (0600)."""
    lines = [
        "# Local secrets for the Keep feasibility spike.",
        "# NEVER commit this file: a master token grants full access to the account.",
        "",
    ]
    lines += [f"{key}={value}" for key, value in sorted(values.items())]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def required_secrets(secrets_file: Path, *, need_token: bool) -> dict[str, str]:
    """Load the secrets file and fail with a readable message when it is incomplete."""
    values = read_env_file(secrets_file)
    missing = [key for key in (KEY_EMAIL, KEY_DEVICE_ID) if not values.get(key)]
    if need_token and not values.get(KEY_MASTER_TOKEN):
        missing.append(KEY_MASTER_TOKEN)
    if missing:
        raise SystemExit(
            f"{secrets_file} is missing: {', '.join(missing)}\n"
            "Run the `token` subcommand first:\n"
            "  ./.venv/bin/python keep-spike.py token"
        )
    return values


# --------------------------------------------------------------------------------------
# Command: token
# --------------------------------------------------------------------------------------


def cmd_token(args: argparse.Namespace) -> int:
    """Exchange the browser `oauth_token` cookie for a long-lived master token."""
    stored = read_env_file(args.secrets_file)

    email = args.email or stored.get(KEY_EMAIL) or input(
        "Email of the throwaway Keep account: "
    ).strip()
    if not email:
        print("ERROR: an email address is required.", file=sys.stderr)
        return 2

    # The device id must stay stable for the lifetime of the deployment. A changing
    # device id makes Google treat each run as a new device, which is exactly the
    # pattern that triggers extra verification - so it is generated once, persisted,
    # and reused on every later run (including on the cloud host).
    device_id = stored.get(KEY_DEVICE_ID) or secrets.token_hex(8)
    print(f"Device id: {device_id}  (stable - keep it unchanged between runs)")

    print(
        "\nIn the browser where you are logged in as the THROWAWAY account, open:\n"
        "  https://accounts.google.com/EmbeddedSetup\n"
        'Log in and click "I agree". The page may keep loading forever - that is fine.\n'
        "Then copy the `oauth_token` cookie:\n"
        "  DevTools (F12) -> Application -> Cookies -> https://accounts.google.com\n"
    )
    oauth_token = getpass.getpass("oauth_token cookie value (not echoed): ").strip()
    if not oauth_token:
        print("ERROR: no oauth_token entered.", file=sys.stderr)
        return 2

    print("\nExchanging oauth_token for a master token ...")
    try:
        response = gpsoauth.exchange_token(
            email, oauth_token, device_id, client_sig=ANDROID_CLIENT_SIG
        )
    except Exception as exc:  # network, TLS or an unexpected API change
        print(f"ERROR: the exchange request failed: {exc}", file=sys.stderr)
        return 1

    master_token = response.get("Token")
    if not master_token:
        print("ERROR: the response contained no master token.", file=sys.stderr)
        print(json.dumps(response, indent=2, sort_keys=True), file=sys.stderr)
        if any("too long" in str(value).lower() for value in response.values()):
            print(
                "\nHint: 'Plaintext is too long' means the pasted oauth_token is\n"
                "truncated or is the wrong cookie. Copy the complete value again.",
                file=sys.stderr,
            )
        return 1

    stored[KEY_EMAIL] = email
    stored[KEY_MASTER_TOKEN] = master_token
    stored[KEY_DEVICE_ID] = device_id
    stored.setdefault(KEY_SHOPPING_TITLE, args.shopping_title)
    stored.setdefault(KEY_MEALPLAN_TITLE, args.mealplan_title)
    if args.shopping_title:
        stored[KEY_SHOPPING_TITLE] = args.shopping_title
    if args.mealplan_title:
        stored[KEY_MEALPLAN_TITLE] = args.mealplan_title
    write_env_file(args.secrets_file, stored)

    shown = (
        master_token
        if args.show_token
        else f"{master_token[:6]}...{master_token[-4:]} ({len(master_token)} chars)"
    )
    print(f"\nMaster token: {shown}")
    print(f"Saved to {args.secrets_file} (mode 0600).")
    print("\nNext step:  ./.venv/bin/python keep-spike.py read")
    return 0


# --------------------------------------------------------------------------------------
# Shared authentication helpers
# --------------------------------------------------------------------------------------


def authenticate(
    email: str,
    master_token: str,
    device_id: str,
    *,
    state: dict[str, Any] | None,
) -> tuple[gkeepapi.Keep, float]:
    """Authenticate and fully sync, returning the client and the elapsed seconds.

    `state` is the dict produced by `Keep.dump()`; passing it makes gkeepapi resume
    from a cached snapshot instead of downloading everything, which is the mechanism
    we are measuring for a cold start.

    Every failure is translated into a short diagnosis. This matters for Gate 2:
    "Google rejected the token" and "this environment is blocked from the private
    Keep API" are different findings and must not look like the same traceback.
    """
    keep = gkeepapi.Keep()
    started = time.perf_counter()
    try:
        keep.authenticate(email, master_token, state=state, sync=True, device_id=device_id)
    except gkeepapi.exception.LoginException as exc:
        raise SystemExit(
            f"Google rejected these credentials: {exc}\n"
            "The master token is invalid, expired, or belongs to another account.\n"
            "Mint a fresh one:\n"
            "  ./.venv/bin/python keep-spike.py token"
        ) from exc
    except requests.exceptions.JSONDecodeError as exc:
        # Documented failure mode of the unofficial API: the endpoint answers with
        # something that is not JSON. This is how "blocked from this network" shows
        # up, and it is precisely what Gate 2 has to rule out for a cloud host.
        raise SystemExit(
            "The private Keep API (www.googleapis.com/notes/v1) returned a non-JSON\n"
            "response. That is how a blocked environment or network shows up. This is\n"
            "the exact Gate 2 failure mode - record the host and network this ran on.\n"
            f"Underlying error: {exc}"
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise SystemExit(f"Network error while talking to Google: {exc}") from exc
    except gkeepapi.exception.KeepException as exc:
        raise SystemExit(f"gkeepapi reported {type(exc).__name__}: {exc}") from exc
    elapsed = time.perf_counter() - started
    return keep, elapsed


def all_lists(keep: gkeepapi.Keep) -> list[node.List]:
    """Return every (non-trashed) checklist note visible to this account."""
    return list(keep.find(func=lambda candidate: isinstance(candidate, node.List)))


def find_list_by_title(keep: gkeepapi.Keep, title: str) -> node.List:
    """Resolve a checklist by its exact title, or explain what is available."""
    wanted = title.strip().casefold()
    lists = all_lists(keep)
    for candidate in lists:
        if (candidate.title or "").strip().casefold() == wanted:
            return candidate
    available = sorted((candidate.title or "<untitled>") for candidate in lists)
    raise SystemExit(
        f"No checklist titled {title!r} is visible to this account.\n"
        f"Visible checklists: {available}\n"
        "Adjust KEEP_SHOPPING_LIST_TITLE in .env (or pass --list-title)."
    )


def describe_item(item: node.ListItem) -> dict[str, Any]:
    """Flatten one list item into plain data for reporting and snapshots."""
    return {
        "text": item.text,
        "checked": bool(item.checked),
        "sort": int(item.sort),
        "indented": bool(item.indented),
        "id": item.id,
    }


def item_snapshot(items: list[node.ListItem]) -> list[dict[str, Any]]:
    """Snapshot a list's items in display order, ready for JSON and comparison."""
    return [describe_item(item) for item in items]


def print_list_overview(keep: gkeepapi.Keep, mealplan_title: str) -> list[node.List]:
    """Print every visible checklist with its items, and return them."""
    lists = all_lists(keep)
    if not lists:
        print("  (no checklists are visible to this account)")
        return lists

    for candidate in sorted(lists, key=lambda entry: (entry.title or "").casefold()):
        title = candidate.title or "<untitled>"
        items = list(candidate.items)
        checked_count = sum(1 for item in items if item.checked)
        role = " [MEAL PLAN]" if title.casefold() == mealplan_title.casefold() else ""
        try:
            collaborators = list(candidate.collaborators.all())
        except Exception:  # collaborator data is optional; never fail the report on it
            collaborators = []
        print(f"\n  '{title}'{role}")
        print(f"    id: {candidate.id}")
        print(f"    items: {len(items)} ({checked_count} checked)")
        print(f"    collaborators: {collaborators if collaborators else '(none listed)'}")
        for item in items[:12]:
            box = "[x]" if item.checked else "[ ]"
            indent = "    " if item.indented else "  "
            print(f"      {indent}{box} {item.text}   (sort={int(item.sort)})")
        if len(items) > 12:
            print(f"      ... {len(items) - 12} more item(s)")
    return lists


# --------------------------------------------------------------------------------------
# Command: read  (Gate 4)
# --------------------------------------------------------------------------------------


def cmd_read(args: argparse.Namespace) -> int:
    """Measure sync timings (Gate 4) and inventory the visible lists."""
    values = required_secrets(args.secrets_file, need_token=True)
    email = values[KEY_EMAIL]
    master_token = values[KEY_MASTER_TOKEN]
    device_id = values[KEY_DEVICE_ID]
    mealplan_title = values.get(KEY_MEALPLAN_TITLE, MEALPLAN_TITLE_DEFAULT)

    print("=== Gate 4: sync timings ===")

    # 1. Cold start: no cached state, so gkeepapi downloads everything.
    keep, cold_seconds = authenticate(email, master_token, device_id, state=None)
    print(f"  cold full sync (no cached state): {cold_seconds:.2f} s")

    # 2. Warm sync in the same session: only the delta should move.
    started = time.perf_counter()
    keep.sync()
    warm_seconds = time.perf_counter() - started
    print(f"  warm incremental sync:            {warm_seconds:.2f} s")

    # 3. Resumed start: persist the state, then authenticate again from it. This is
    #    what a serverless host would have to do on every cold start, so it decides
    #    whether persisting the cache is worth any infrastructure at all.
    cached_state = keep.dump()
    args.state_file.write_text(json.dumps(cached_state), encoding="utf-8")
    print(f"  cached state written to:          {args.state_file.name}")

    _, resumed_seconds = authenticate(email, master_token, device_id, state=cached_state)
    print(f"  resumed start (from cached state): {resumed_seconds:.2f} s")

    print("\n  Interpretation: if the cold sync is already fast, cold starts on a")
    print("  serverless host are harmless and the state cache can be dropped.")

    print("\n=== Inventory of visible lists ===")
    print_list_overview(keep, mealplan_title)

    # Keep the state fresh for the next run.
    args.state_file.write_text(json.dumps(keep.dump()), encoding="utf-8")
    return 0


# --------------------------------------------------------------------------------------
# Command: write  (Gate 1)
# --------------------------------------------------------------------------------------


def ensure_no_marker_items(keep: gkeepapi.Keep, target: node.List) -> None:
    """Refuse to continue if a previous run's test items are still present."""
    leftovers = [item for item in target.items if item.text.startswith(MARKER)]
    if leftovers:
        raise SystemExit(
            f"{len(leftovers)} leftover test item(s) found. Run `cleanup` first:\n"
            "  ./.venv/bin/python keep-spike.py cleanup"
        )


def report_order_comparison(
    server_order: list[str], *, context: str
) -> tuple[bool, str]:
    """Print the Gate 1 verdict for an ordered write and return `(passed, label)`.

    The label is one of `PASS`, `FAIL (create)` or `FAIL (order)`. Keeping the two
    failures apart matters: "nothing arrived" kills the design outright, while "the
    order was ignored" only means sorting has to move into the app. Reporting both
    as a generic failure would send the investigation the wrong way.

    `context` names where we wrote, so the same verdict reads correctly for a shared
    list ("a shared list") and for a list the account owns ("a list this account owns").
    """
    if not server_order:
        print(
            f"\n  RESULT: FAIL (create) - no items reached the server in {context}.\n"
            "  Writing does not work there at all, which is the v0.11.4 shared-note\n"
            "  regression when the context is a shared list. Nothing about ordering\n"
            "  can be concluded."
        )
        return False, "FAIL (create)"

    if server_order != EXPECTED_TOP_TO_BOTTOM:
        print(
            f"\n  RESULT: FAIL (order) - items were created in {context}, but the order we\n"
            "  set was not preserved. Writing works; controlling order does not. Category\n"
            "  sorting would have to be reconsidered (e.g. sort in the app, not in Keep)."
        )
        return False, "FAIL (order)"

    print(f"\n  RESULT: PASS - items can be created in {context} and their order controlled.")
    return True, "PASS"


def cmd_write(args: argparse.Namespace) -> int:
    """Gate 1: add three ordered test items to the shared shopping list."""
    values = required_secrets(args.secrets_file, need_token=True)
    email = values[KEY_EMAIL]
    master_token = values[KEY_MASTER_TOKEN]
    device_id = values[KEY_DEVICE_ID]
    title = args.list_title or values.get(KEY_SHOPPING_TITLE, SHOPPING_TITLE_DEFAULT)

    keep, cold_seconds = authenticate(email, master_token, device_id, state=None)
    print(f"Authenticated and fully synced in {cold_seconds:.2f} s")

    target = find_list_by_title(keep, title)
    ensure_no_marker_items(keep, target)

    # Record the real items before we touch anything, so `cleanup` can prove the
    # original arrangement came back untouched.
    real_items = [item for item in target.items if not item.text.startswith(MARKER)]
    before = item_snapshot(real_items)
    args.before_write_file.write_text(json.dumps(before, indent=2), encoding="utf-8")
    print(f"Recorded {len(before)} existing item(s) before the test.")

    # Place the test items above everything else, so they never interleave with
    # real entries and are easy to find in the Keep app.
    highest_existing = max((int(item.sort) for item in real_items), default=0)
    base = highest_existing + SORT_OFFSET_ABOVE_EXISTING

    # EXPECTED_TOP_TO_BOTTOM is [charlie, alpha, bravo]; a higher sort value sits
    # closer to the top, so charlie needs the largest value.
    sort_ids = {
        EXPECTED_TOP_TO_BOTTOM[0]: base + 3,
        EXPECTED_TOP_TO_BOTTOM[1]: base + 2,
        EXPECTED_TOP_TO_BOTTOM[2]: base + 1,
    }

    print(f"\nCreating {len(CREATION_ORDER)} test item(s) in '{target.title}':")
    for text in CREATION_ORDER:
        target.add(text, False, sort_ids[text])
        print(f"  added '{text}' with sort={sort_ids[text]}")

    started = time.perf_counter()
    keep.sync()
    print(f"sync() with new items took {time.perf_counter() - started:.2f} s")

    # Read the list back from the server in a *fresh* session. Local state would
    # only prove our own in-memory ordering; a fresh sync proves the server stored
    # it - which is the actual Gate 1 question.
    print("\nRe-reading from the server in a fresh session ...")
    fresh, fresh_seconds = authenticate(email, master_token, device_id, state=None)
    fresh_target = find_list_by_title(fresh, title)
    marker_items = [item for item in fresh_target.items if item.text.startswith(MARKER)]
    server_order = [item.text for item in marker_items]

    print(f"  (fresh full sync: {fresh_seconds:.2f} s)")
    print(f"  created on the server:    {len(marker_items)} of {len(EXPECTED_TOP_TO_BOTTOM)}")
    print(f"  expected (top to bottom): {EXPECTED_TOP_TO_BOTTOM}")
    print(f"  server returned:          {server_order}")

    passed, _label = report_order_comparison(server_order, context="a shared list")

    print(
        "\n=== MANUAL VERIFICATION (please do this now) ===\n"
        f"  1. Open Google Keep as the MAIN account and open the list '{title}'.\n"
        f"  2. It should show the three '{MARKER}' items at the top, in this order:\n"
        f"       {EXPECTED_TOP_TO_BOTTOM[0]}\n"
        f"       {EXPECTED_TOP_TO_BOTTOM[1]}\n"
        f"       {EXPECTED_TOP_TO_BOTTOM[2]}\n"
        "  3. Tell me exactly what you see, then run cleanup:\n"
        "       ./.venv/bin/python keep-spike.py cleanup\n"
    )
    # A failed order check is a real result, not a crash, so it exits non-zero
    # rather than 0: scripts and monitoring can then tell the two apart.
    return 0 if passed else 1


# --------------------------------------------------------------------------------------
# Command: scratch
# --------------------------------------------------------------------------------------


def cmd_scratch(args: argparse.Namespace) -> int:
    """Zero-risk first live run, on a list the throwaway account *owns*.

    `write` cannot separate two very different questions, because both look like a
    failure on the shared list:

      * does the toolchain work at all (auth, create a note, add items, sort, sync)?
      * or is the problem specific to writing into a *shared* note?

    This command answers the first one against a throwaway-owned note. Nothing the
    user cares about can be damaged, and the note is deleted again unless `--keep`
    is passed for inspection in the Keep app.
    """
    values = required_secrets(args.secrets_file, need_token=True)
    email = values[KEY_EMAIL]
    master_token = values[KEY_MASTER_TOKEN]
    device_id = values[KEY_DEVICE_ID]
    title = args.list_title or SCRATCH_TITLE_DEFAULT

    keep, cold_seconds = authenticate(email, master_token, device_id, state=None)
    print(f"Authenticated and fully synced in {cold_seconds:.2f} s")

    # Clear a scratch note left behind by an interrupted run. The title is unique to
    # this spike, so this cannot touch a note the user created.
    for existing in all_lists(keep):
        if (existing.title or "").strip().casefold() == title.strip().casefold():
            print(f"Removing the leftover scratch note '{existing.title}' ...")
            existing.delete()
    keep.sync()

    print(f"Creating the scratch note '{title}' ...")
    scratch = keep.createList(title)

    # The note starts empty, so any base above gkeepapi's own range keeps the order
    # unambiguous. The same three marker items and the same expected order as the
    # shared-list test are reused, so the two verdicts are directly comparable.
    base = 9_000_000_000
    sort_ids = {
        EXPECTED_TOP_TO_BOTTOM[0]: base + 3,
        EXPECTED_TOP_TO_BOTTOM[1]: base + 2,
        EXPECTED_TOP_TO_BOTTOM[2]: base + 1,
    }
    for text in CREATION_ORDER:
        scratch.add(text, False, sort_ids[text])
        print(f"  added '{text}' with sort={sort_ids[text]}")
    keep.sync()

    print("\nRe-reading from the server in a fresh session ...")
    fresh, fresh_seconds = authenticate(email, master_token, device_id, state=None)
    try:
        fresh_scratch = find_list_by_title(fresh, title)
    except SystemExit:
        print(
            "\n  RESULT: FAIL (create) - the scratch note never appeared on the server.\n"
            "  This account cannot create notes at all, so the shared list is not the\n"
            "  problem; suspect the credential or the API, not sharing."
        )
        return 1

    server_order = [item.text for item in fresh_scratch.items if item.text.startswith(MARKER)]
    print(f"  (fresh full sync: {fresh_seconds:.2f} s)")
    print(f"  created on the server:    {len(server_order)} of {len(EXPECTED_TOP_TO_BOTTOM)}")
    print(f"  expected (top to bottom): {EXPECTED_TOP_TO_BOTTOM}")
    print(f"  server returned:          {server_order}")

    passed, _label = report_order_comparison(server_order, context="a list this account owns")

    if args.keep:
        print(
            f"\nKeeping the scratch note '{title}' for inspection. Delete it in the Keep\n"
            "app when you are done, or re-run this command to have it cleaned up."
        )
    else:
        fresh_scratch.delete()
        fresh.sync()
        print(f"\nScratch note '{title}' deleted again.")

    return 0 if passed else 1


# --------------------------------------------------------------------------------------
# Command: cleanup
# --------------------------------------------------------------------------------------


def cmd_cleanup(args: argparse.Namespace) -> int:
    """Delete every test item and verify the real items kept their arrangement."""
    values = required_secrets(args.secrets_file, need_token=True)
    email = values[KEY_EMAIL]
    master_token = values[KEY_MASTER_TOKEN]
    device_id = values[KEY_DEVICE_ID]
    title = args.list_title or values.get(KEY_SHOPPING_TITLE, SHOPPING_TITLE_DEFAULT)

    keep, _ = authenticate(email, master_token, device_id, state=None)
    target = find_list_by_title(keep, title)

    marker_items = [item for item in target.items if item.text.startswith(MARKER)]
    if not marker_items:
        print(f"No '{MARKER}' items found in '{target.title}' - nothing to clean up.")
    else:
        print(f"Deleting {len(marker_items)} test item(s) from '{target.title}':")
        for item in marker_items:
            print(f"  removing '{item.text}'")
            item.delete()
        keep.sync()

    # Verify the real items are exactly where they were before the write phase.
    after = item_snapshot([item for item in target.items if not item.text.startswith(MARKER)])
    if args.before_write_file.exists():
        before = json.loads(args.before_write_file.read_text(encoding="utf-8"))
        same_order = [entry["text"] for entry in before] == [entry["text"] for entry in after]
        same_sort = [entry["sort"] for entry in before] == [entry["sort"] for entry in after]
        print(f"\n  real items before: {len(before)}, after: {len(after)}")
        print(f"  order restored:    {'yes' if same_order else 'NO'}")
        print(f"  sort ids restored: {'yes' if same_sort else 'NO'}")
        if not (same_order and same_sort):
            print(
                "  NOTE: the test items changed the arrangement of real items. Report this -\n"
                "  it means the spike disturbed the list and needs a safer strategy."
            )
        args.before_write_file.unlink()
    else:
        print("\n  (no pre-test snapshot found; skipping the restore comparison)")
        print(f"  real items remaining: {len(after)}")
    return 0


# --------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI: one shared secrets file, plus a subcommand per phase."""
    parser = argparse.ArgumentParser(
        description="Google Keep feasibility spike (Gate 1 functional, Gate 4 timing).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--secrets-file",
        type=Path,
        default=SECRETS_FILE_DEFAULT,
        help="Where the master token and device id live (default: ./.env)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    token_parser = subparsers.add_parser("token", help="Obtain a master token")
    token_parser.add_argument("--email", help="Throwaway account email")
    token_parser.add_argument(
        "--shopping-title",
        default=SHOPPING_TITLE_DEFAULT,
        help="Title of the shared shopping list",
    )
    token_parser.add_argument(
        "--mealplan-title",
        default=MEALPLAN_TITLE_DEFAULT,
        help="Title of the shared meal-plan list",
    )
    token_parser.add_argument(
        "--show-token",
        action="store_true",
        help="Print the full master token instead of a masked preview",
    )
    token_parser.set_defaults(func=cmd_token)

    read_parser = subparsers.add_parser("read", help="Gate 4 timings and list inventory")
    read_parser.add_argument(
        "--state-file",
        type=Path,
        default=STATE_FILE_DEFAULT,
        help="Where to cache the gkeepapi state between runs",
    )
    read_parser.set_defaults(func=cmd_read)

    write_parser = subparsers.add_parser("write", help="Gate 1: ordered write test")
    write_parser.add_argument("--list-title", help="Target list title (default from .env)")
    write_parser.add_argument(
        "--before-write-file",
        type=Path,
        default=BEFORE_WRITE_FILE_DEFAULT,
        help="Where to store the pre-test snapshot used by cleanup",
    )
    write_parser.set_defaults(func=cmd_write)

    scratch_parser = subparsers.add_parser(
        "scratch", help="Gate 1 warm-up: the same test on a throwaway-owned note"
    )
    scratch_parser.add_argument(
        "--list-title", help=f"Scratch note title (default: {SCRATCH_TITLE_DEFAULT!r})"
    )
    scratch_parser.add_argument(
        "--keep",
        action="store_true",
        help="Leave the scratch note in place for inspection instead of deleting it",
    )
    scratch_parser.set_defaults(func=cmd_scratch)

    cleanup_parser = subparsers.add_parser("cleanup", help="Remove test items")
    cleanup_parser.add_argument("--list-title", help="Target list title (default from .env)")
    cleanup_parser.add_argument(
        "--before-write-file",
        type=Path,
        default=BEFORE_WRITE_FILE_DEFAULT,
        help="Pre-test snapshot to compare against",
    )
    cleanup_parser.set_defaults(func=cmd_cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and dispatch to the requested subcommand."""
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
