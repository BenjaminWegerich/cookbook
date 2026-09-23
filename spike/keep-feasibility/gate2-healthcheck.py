#!/usr/bin/env python3
"""Gate 2 health check: does master-token auth keep working from a cloud host?

Run this on the candidate VM (and optionally from cron/systemd every few hours).
Each run appends one JSON line to a log file, so a lockout or an IP-level block
shows up as a change over days rather than as a single success.

Three outcomes are distinguished deliberately - they mean very different things:

  ok             auth and sync worked
  rejected       Google refused the token (`LoginException`); the credential died
  blocked        the private API answered with non-JSON, i.e. this host or network
                 is being refused (the documented failure mode for the notes/v1 API)
  network        the request never completed

It also records the host's **public egress IP**, because Google treats a changing
IP as a new device. If the IP drifts on every run, that is itself a finding.

The auth call and its error diagnosis are reused from `keep-spike.py`, so both
scripts cannot drift apart in how they interpret a failure.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

SECRETS_FILE_DEFAULT = Path(__file__).with_name(".env")
LOG_FILE_DEFAULT = Path(__file__).with_name("gate2-log.jsonl")
SPIKE_FILE = Path(__file__).with_name("keep-spike.py")

# Public IP echo services, tried in order. Used only to detect egress IP drift.
IP_ECHO_URLS = ("https://api.ipify.org?format=json", "https://ifconfig.me/ip")


def load_spike_module():
    """Import `keep-spike.py` despite its dashed filename.

    The dash makes a normal `import` impossible, so the module is loaded by path.
    Reusing it keeps the auth error diagnosis in exactly one place.
    """
    spec = importlib.util.spec_from_file_location("keep_spike", SPIKE_FILE)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Could not load {SPIKE_FILE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def current_public_ip() -> str:
    """Return this host's public egress IP, or a marker if it cannot be read."""
    for url in IP_ECHO_URLS:
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            text = response.text.strip()
            if text.startswith("{"):
                return str(json.loads(text).get("ip", "unknown"))
            if text:
                return text
        except Exception:
            continue
    return "unavailable"


def append_log(log_file: Path, record: dict) -> None:
    """Append one JSON line, keeping the log machine-readable and append-only."""
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def summarize(log_file: Path) -> int:
    """Print a short roll-up of the log: outcomes, distinct IPs, time span."""
    if not log_file.exists():
        print(f"No log at {log_file} yet.")
        return 0
    records = [
        json.loads(line)
        for line in log_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        print("Log is empty.")
        return 0

    outcomes: dict[str, int] = {}
    for record in records:
        outcomes[record["outcome"]] = outcomes.get(record["outcome"], 0) + 1
    ip_addresses = sorted({record.get("public_ip", "?") for record in records})

    print(f"Runs      : {len(records)}")
    print(f"First     : {records[0]['timestamp']}")
    print(f"Last      : {records[-1]['timestamp']}")
    print(f"Outcomes  : {outcomes}")
    print(f"Egress IPs: {ip_addresses}")
    if len(ip_addresses) > 1:
        print("            ^ the IP changed between runs - Google may treat that as a new device")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--secrets-file", type=Path, default=SECRETS_FILE_DEFAULT)
    parser.add_argument("--log-file", type=Path, default=LOG_FILE_DEFAULT)
    parser.add_argument("--summary", action="store_true", help="Summarize the log and exit")
    parser.add_argument("--host-label", default=socket.gethostname(), help="Label recorded in the log")
    parser.add_argument(
        "--from-env",
        action="store_true",
        help=(
            "Read KEEP_EMAIL / KEEP_MASTER_TOKEN / KEEP_DEVICE_ID from the environment "
            "instead of a secrets file. Used on Cloud Run, where secrets come from "
            "Secret Manager and no writable file exists."
        ),
    )
    parser.add_argument(
        "--no-log-file",
        action="store_true",
        help=(
            "Do not append to a log file; print the record to stdout only. Used where "
            "the filesystem is ephemeral and stdout is the real log (Cloud Logging)."
        ),
    )
    args = parser.parse_args(argv)

    if args.summary:
        return summarize(args.log_file)

    spike = load_spike_module()
    record: dict = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "host": args.host_label,
        "public_ip": current_public_ip(),
    }

    try:
        if args.from_env:
            # Environment wins so a container needs no writable secrets file at all.
            values = {
                spike.KEY_EMAIL: os.environ.get(spike.KEY_EMAIL, ""),
                spike.KEY_MASTER_TOKEN: os.environ.get(spike.KEY_MASTER_TOKEN, ""),
                spike.KEY_DEVICE_ID: os.environ.get(spike.KEY_DEVICE_ID, ""),
            }
        else:
            values = spike.read_env_file(args.secrets_file)
        missing = [
            key
            for key in (spike.KEY_EMAIL, spike.KEY_MASTER_TOKEN, spike.KEY_DEVICE_ID)
            if not values.get(key)
        ]
        if missing:
            record.update(outcome="config", detail=f"missing: {', '.join(missing)}")
        else:
            keep, seconds = spike.authenticate(
                values[spike.KEY_EMAIL],
                values[spike.KEY_MASTER_TOKEN],
                values[spike.KEY_DEVICE_ID],
                state=None,
            )
            lists = spike.all_lists(keep)
            record.update(
                outcome="ok",
                sync_seconds=round(seconds, 2),
                checklists=len(lists),
                titles=sorted((entry.title or "") for entry in lists),
            )
    except SystemExit as exit_signal:
        # `authenticate` raises SystemExit with a diagnosis; classify it so the log
        # distinguishes a dead credential from a blocked host.
        message = str(exit_signal)
        if "rejected these credentials" in message:
            outcome = "rejected"
        elif "non-JSON" in message:
            outcome = "blocked"
        elif "Network error" in message:
            outcome = "network"
        else:
            outcome = "error"
        record.update(outcome=outcome, detail=message.splitlines()[0][:300])
    except Exception as exc:  # anything unforeseen is still worth recording
        record.update(outcome="error", detail=f"{type(exc).__name__}: {exc}"[:300])

    if args.no_log_file:
        # Nothing is persisted locally; the stdout line below is the record of truth,
        # which is what Cloud Logging captures from a job run.
        print("(--no-log-file: record goes to stdout only)")
    else:
        append_log(args.log_file, record)
    print(json.dumps(record, indent=2, sort_keys=True))
    return 0 if record["outcome"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
