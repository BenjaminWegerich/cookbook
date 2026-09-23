"""Run the gateway locally: `python -m keep_gateway`.

Uses Flask's development server, which is all a local smoke test needs. It binds to
loopback on purpose: the process holds a master token that can write to the Keep account,
so it must not become reachable from the local network by accident. For a real deployment,
gunicorn behind Cloud Run is the entry point (`wsgi.py`).
"""

from __future__ import annotations

import logging
import sys

from .app import create_app
from .config import local_port

logger = logging.getLogger("keep_gateway")


def main() -> int:
    """Boot the app, print the two URLs worth trying, and serve until interrupted."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    port = local_port()
    # create_app() reads the environment and reports, per request, what is missing - so a
    # local run without secrets still starts and answers /health.
    app = create_app()

    print(f"Keep gateway listening on http://127.0.0.1:{port}")
    print(f"  liveness : curl -s http://127.0.0.1:{port}/health")
    print(f"  state    : curl -s -H 'Authorization: Bearer $KEEP_GATEWAY_TOKEN' \\")
    print(f"               http://127.0.0.1:{port}/keep/state")
    app.run(host="127.0.0.1", port=port, debug=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
