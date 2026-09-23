"""WSGI entry point for the container.

gunicorn imports the module-level `app` from here:

    gunicorn --bind :$PORT --workers 1 --threads 8 wsgi:app

One worker with several threads is the right shape for this service: every request does
its own cold Keep sync (by design - no state cache), so a second *process* would only
duplicate memory without adding capacity for a single household's request rate.

Logging is configured to pass the gateway's own JSON lines through unchanged; gunicorn's
default configuration would drop them, because Python logging ignores INFO records until
some handler says otherwise.
"""

from __future__ import annotations

import logging

from keep_gateway.app import create_app

# "%(message)s" only: each record is already a complete JSON object (see app._log_event),
# so any added prefix would break the "one JSON object per line" contract Cloud Logging
# indexes on.
logging.basicConfig(level=logging.INFO, format="%(message)s")

app = create_app()
