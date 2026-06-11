#!/usr/bin/env bash
# environment/setup.sh
#
# Single source of truth for provisioning the EXECUTE sandbox.
# Deliberately LIGHTWEIGHT: just enough to lint, type-check, and run UNIT tests.
# No databases, no Redis, no browsers, no running services — anything needing those is
# handed to the reviewer via the PR's "Manual testing required" section.
#
# This runs once per environment; Anthropic then snapshots the filesystem and reuses it,
# so KEEP IT IDEMPOTENT and CHECK-BEFORE-INSTALL to stay fast (the cache only persists
# files, not running processes).
#
# Fill in the sections for your stack and delete the rest.

set -euo pipefail

echo "==> Provisioning lightweight sandbox (lint + unit tests only)"

# ---------------------------------------------------------------------------
# Node / TypeScript monorepo (npm workspaces: plugin, agency, shared)
# Lockfile is package-lock.json → use `npm ci` for a deterministic install.
# ---------------------------------------------------------------------------
if [ -f package.json ] && [ ! -d node_modules ]; then
  echo "==> Installing JS dependencies (npm ci)"
  npm ci
fi

# ---------------------------------------------------------------------------
# Sanity check: confirm the type-checking build is callable so a session doesn't
# discover a missing toolchain mid-task. Do NOT run a full build/test here.
#
# NOTE: this repo has NO unit-test runner yet. The verification ceiling is the
# type-checking build — `npm run build` (tsc for shared, esbuild for plugin).
# Everything touching plugin runtime behaviour requires Obsidian and is handed to
# the reviewer via each PR's "Manual testing required" section.
# ---------------------------------------------------------------------------
npx tsc --version >/dev/null 2>&1 || echo "WARN: typescript (tsc) not available"

echo "==> Sandbox provisioning complete"
