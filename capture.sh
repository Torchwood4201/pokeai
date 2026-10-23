#!/usr/bin/env bash
# Capture desktop and mobile proof screenshots without touching the source tree.
set -euo pipefail

: "${CAPTURE_URL:?Set CAPTURE_URL to the exact preview URL}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to a directory outside the project}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURE_DIR_ABS="$(realpath -m "$CAPTURE_DIR")"
export RUNTIME_DIR="${RUNTIME_DIR:-/home/runner/work/_temp/omgithub-runtime}"

timed() {
  /usr/bin/time -p "$@"
}

case "$CAPTURE_DIR_ABS/" in
  "$PROJECT_DIR"/*)
    echo "[capture] CAPTURE_DIR must be outside the project: $CAPTURE_DIR_ABS" >&2
    exit 1
    ;;
esac

echo "[capture] url=$CAPTURE_URL out=$CAPTURE_DIR_ABS"
timed mkdir -p "$CAPTURE_DIR_ABS"
timed node "$PROJECT_DIR/scripts/capture.mjs"
timed test -s "$CAPTURE_DIR_ABS/final-desktop.png"
timed test -s "$CAPTURE_DIR_ABS/final-mobile.png"
echo "[capture] wrote final-desktop.png and final-mobile.png"
