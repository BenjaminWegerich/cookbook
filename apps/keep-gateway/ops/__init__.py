"""Operational tooling that ships inside the gateway image but never serves traffic.

The gateway is both a long-running service (`wsgi.py`) and the home of the one-off jobs that
keep it working - today the master-token mint. Keeping them in one image means the credential
logic and its diagnosis exist once, and a Cloud Run job only has to override the container
command (see deploy/cloud-run/README.md).
"""
