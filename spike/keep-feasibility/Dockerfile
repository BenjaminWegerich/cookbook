# Gate 2 probe: authenticate to Google Keep once from a Cloud Run datacenter IP, then exit.
#
# Deployed as a Cloud Run *job* rather than a service: there is no HTTP surface to expose,
# nothing to keep warm, and scale-to-zero is the default. The point is the origin of the
# request - Gate 2 asks whether Google serves the private Keep API and accepts the master
# token from a datacenter network, over days.
#
# Build context is this spike directory. The file sits at the context root because
# `gcloud builds submit --tag` has no flag to point at a Dockerfile elsewhere - it always
# looks for one named `Dockerfile` at the top of the uploaded source:
#   gcloud builds submit --tag IMAGE .
FROM python:3.14-slim

# Unbuffered, so each run's JSON record reaches Cloud Logging as it is printed. stdout is
# the only durable log here: the container filesystem is discarded when the job exits.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, so this layer survives changes to the probe code.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# keep-spike.py owns the authentication call and the "rejected vs blocked" diagnosis;
# gate2-healthcheck.py adds the sampling, the egress-IP reading and the record format;
# mint-in-cloud.py tests the untested hypothesis (mint a token from the cloud, then use it);
# entrypoint.sh runs the probe by absolute path and prints diagnostics around it.
COPY keep-spike.py gate2-healthcheck.py mint-in-cloud.py entrypoint.sh ./

# Modes are set explicitly rather than inherited, because COPY PRESERVES the source file
# modes. The development machine's umask produced 0600 files, so the non-root `probe` user
# could not read them and the container died with:
#
#   python: can't open file '/app/gate2-healthcheck.py': [Errno 13] Permission denied
#
# which the runtime reports only as "exit code 2". Setting the modes here makes the image
# independent of whoever builds it.
RUN chmod 0755 /app \
 && chmod 0644 /app/requirements.txt /app/keep-spike.py /app/gate2-healthcheck.py \
 && chmod 0644 /app/mint-in-cloud.py \
 && chmod 0755 /app/entrypoint.sh

# Never run as root. The process holds a credential granting full access to the throwaway
# Google account, so it gets no privileges it does not need.
RUN useradd --create-home --uid 10001 probe
USER probe

# Exec form with an absolute path: no shell, no PATH lookup, no working-directory assumption.
ENTRYPOINT ["/app/entrypoint.sh"]
