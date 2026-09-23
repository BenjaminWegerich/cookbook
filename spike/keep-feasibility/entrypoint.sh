#!/bin/sh
# Entrypoint for the Gate 2 probe.
#
# Two deliberate choices here, both from a real failure:
#
# 1. The probe is invoked by ABSOLUTE path. An earlier version used the relative
#    "gate2-healthcheck.py", and the container exited with code 2 - which is what python
#    returns for `can't open file ... [Errno 2] No such file or directory` - because the
#    working directory was not what the Dockerfile assumed. Absolute paths make that
#    impossible.
#
# 2. Diagnostics are printed before and after the run, so a future failure explains itself in
#    Cloud Logging instead of surfacing only as an opaque exit code.
set -u

echo "gate2-probe: cwd=$(pwd) user=$(id -un)"
echo "gate2-probe: /app contains: $(ls -1 /app 2>/dev/null | tr '\n' ' ')"

python /app/gate2-healthcheck.py \
  --from-env \
  --no-log-file \
  --host-label "${HOST_LABEL:-cloud-run}"
code=$?

echo "gate2-probe: finished with exit code ${code} (0 = ok, 1 = non-ok outcome, 2 = startup error)"
exit "${code}"
