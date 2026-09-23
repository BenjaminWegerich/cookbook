#!/usr/bin/env bash
# Run the repository-local Google Cloud SDK without touching your PATH or shell rc files.
#
#   ./gcloud.sh auth login
#   ./gcloud.sh billing accounts list
#   ./gcloud.sh run jobs describe keep-gate2-probe --region europe-west3
#
# Why this exists: the SDK lives unpacked in `.tools/` inside this repository, so a bare
# `gcloud` is not on your PATH and `command not found` is the expected result - nothing was
# ever installed system-wide, deliberately, so the repo stays self-contained.
#
# Paths are resolved from this script's own location, so it works from any working
# directory, unlike an `export PATH="$PWD/..."` line.
#
# Credentials go to gcloud's normal location (~/.config/gcloud), not into the repository.
# To keep them inside the repository instead (handy if another tool needs to share the
# session), set CLOUDSDK_CONFIG before calling.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${GCLOUD_SDK_DIR:-$HERE/.tools/google-cloud-sdk}"

if [[ ! -x "$SDK/bin/gcloud" ]]; then
  cat >&2 <<EOF
No gcloud SDK found at:
  $SDK

Re-download it (about 85 MB, no sudo required):

  cd "$HERE"
  mkdir -p .tools && cd .tools
  curl -sSL -o gcloud.tar.gz \\
    https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
  tar -xzf gcloud.tar.gz && rm gcloud.tar.gz
EOF
  exit 1
fi

exec "$SDK/bin/gcloud" "$@"
