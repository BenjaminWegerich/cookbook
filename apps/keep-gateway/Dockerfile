# Keep gateway: the HTTP boundary in front of the private Google Keep API, deployed as a
# Cloud Run *service* (scale-to-zero, no state). See README.md for the endpoints and the
# configuration, and ../../docs/ARCHITECTURE.md ("Keep gateway") for the design.
#
# Build context is this directory, so the image is self-contained: it copies the package
# and the WSGI entry point and nothing else. `gcloud builds submit --tag IMAGE .` has no
# --file flag, so this Dockerfile has to sit at the context root.
FROM python:3.14-slim

# Unbuffered, so each request's JSON log line reaches Cloud Logging as it happens rather
# than when a buffer happens to flush.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so this layer survives changes to the gateway code.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The package, plus the WSGI entry point gunicorn imports, plus the operational jobs.
# `ops/` is what the mint Cloud Run job overrides the command to run: one image serves both,
# so the credential logic and its diagnosis exist exactly once.
COPY keep_gateway ./keep_gateway
COPY ops ./ops
COPY wsgi.py ./

# Modes are set explicitly rather than inherited: COPY preserves the source file modes, and
# the feasibility spike lost a run to a restrictive umask leaking into the image as
# root-only files that the non-root user then could not read.
RUN chmod 0755 /app \
 && chmod -R a+rX /app/keep_gateway /app/ops \
 && chmod 0644 /app/requirements.txt /app/wsgi.py

# Never run as root: the process holds a credential that can write to the Keep account.
RUN useradd --create-home --uid 10001 gateway
USER gateway

# Cloud Run injects PORT (8080 by default); one worker with threads is enough for a
# household, and every request performs its own cold Keep sync by design.
#
# --no-control-socket: gunicorn 25+ opens a Unix control socket under $HOME by default.
# Nothing here uses `gunicornc`, so the socket is a moving part (and one more failure to
# read past in the log) for no benefit.
ENV PORT=8080
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 30 --no-control-socket wsgi:app
