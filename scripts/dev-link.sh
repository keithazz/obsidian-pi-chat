#!/usr/bin/env bash
#
# Wire the in-repo dev vault to the workspace packages via symlinks.
#
#   <repo>/dev-vault/.obsidian/plugins/educator-agency  →  packages/plugin/dist
#   <repo>/dev-vault/agency                              →  packages/agency
#
# Idempotent: safe to re-run. Replaces existing symlinks pointing elsewhere.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_VAULT="$REPO_ROOT/dev-vault"
PLUGIN_ID="$(node -p "require('$REPO_ROOT/packages/plugin/manifest.json').id")"
PLUGIN_DIST="$REPO_ROOT/packages/plugin/dist"
AGENCY_DIR="$REPO_ROOT/packages/agency"

mkdir -p "$DEV_VAULT/.obsidian/plugins"
mkdir -p "$PLUGIN_DIST"   # may not exist before first build

link() {
  local target="$1" linkname="$2"
  if [[ -L "$linkname" ]]; then
    rm "$linkname"
  elif [[ -e "$linkname" ]]; then
    echo "error: $linkname exists and is not a symlink; refusing to overwrite" >&2
    exit 1
  fi
  ln -s "$target" "$linkname"
  echo "linked: $linkname → $target"
}

link "$PLUGIN_DIST" "$DEV_VAULT/.obsidian/plugins/$PLUGIN_ID"
link "$AGENCY_DIR"  "$DEV_VAULT/agency"

cat <<EOF

Dev vault ready at: $DEV_VAULT

Next:
  1) Open this folder as a vault in Obsidian.
  2) Settings → Community plugins → enable.
  3) Install the "Hot Reload" community plugin for auto-reload on rebuild.
  4) Enable "$PLUGIN_ID" once it appears in the installed plugins list.
EOF
