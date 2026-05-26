#!/usr/bin/env bash
#
# Start all watchers for the dev loop:
#   - @educator-agency/shared: tsc --watch
#   - @educator-agency/plugin: esbuild --watch
#
# Pi itself is launched from inside Obsidian by the plugin, so no daemon here.
# Use Ctrl-C to stop both watchers.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev -w @educator-agency/shared &
npm run dev -w @educator-agency/plugin &

wait
