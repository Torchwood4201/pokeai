#!/usr/bin/env bash
# Build the static site inside the project and serve it in the foreground.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$PROJECT_DIR/dist"
SOURCE_DIR="$PROJECT_DIR/site"
PORT="${PORT:-3000}"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"

timed() {
  /usr/bin/time -p "$@"
}

echo "[start] project=$PROJECT_DIR port=$PORT"
time -p cd "$PROJECT_DIR"

if [[ ! "$PORT" =~ ^[1-9][0-9]*$ ]]; then
  echo "[start] PORT must be a positive integer" >&2
  exit 1
fi
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "[start] missing source directory: $SOURCE_DIR" >&2
  exit 1
fi

if [[ -f "$PROJECT_DIR/package.json" ]]; then
  if [[ -f "$PROJECT_DIR/package-lock.json" ]]; then
    timed npm ci --no-audit --no-fund
  else
    timed npm install --no-audit --no-fund
  fi
else
  echo "[start] no package.json; static build only"
fi

timed rm -rf "$BUILD_DIR"
timed mkdir -p "$BUILD_DIR"
timed cp -R "$SOURCE_DIR/." "$BUILD_DIR/"
timed test -f "$BUILD_DIR/index.html"

timed mkdir -p "$WEB_DIR"
timed node -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ project: process.argv[2], directory: process.argv[3] }, null, 2) + "\n")' \
  "$WEB_DIR/deployment-output.json" "$PROJECT_DIR" "$BUILD_DIR"
echo "[start] deployment metadata:"
timed cat "$WEB_DIR/deployment-output.json"
echo

timed node "$PROJECT_DIR/scripts/serve.mjs" "$BUILD_DIR" "$PORT"
