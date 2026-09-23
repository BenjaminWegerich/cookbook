"""Google Keep gateway: a thin HTTP boundary in front of the private Keep API.

The web app never talks to Keep itself. It calls this service, which owns the credential
(a master token of a dedicated throwaway account) and the `gkeepapi` client, and answers in
terms of user actions ("add this dish to the meal plan") rather than Keep's own shape.

The package is deliberately small and stateless:

    config.py       environment configuration, read once per process
    errors.py       the typed failures, each with a stable machine code + HTTP status
    keep_client.py  the Keep access layer (authentication, list lookup, reading state)
    app.py          the Flask boundary: routing, authentication seam, JSON error shape

Design rationale lives in ../../docs/ARCHITECTURE.md ("Keep gateway") and the roadmap in
../../docs/ROADMAP.md; the feasibility spike that proved the approach is in
../../spike/keep-feasibility/.
"""

from __future__ import annotations

__all__ = ["__version__"]

# Version of the HTTP boundary, not of Keep or gkeepapi. Bumped when the request or
# response shape changes, so a stale frontend deployment is visible in the logs.
__version__ = "0.1.0"
