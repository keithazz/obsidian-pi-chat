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
# Node / frontend (e.g. Next.js, Vitest)
# ---------------------------------------------------------------------------
# if [ -f package.json ] && [ ! -d node_modules ]; then
#   echo "==> Installing JS dependencies"
#   npm ci            # or: pnpm install --frozen-lockfile / yarn install --immutable
# fi

# ---------------------------------------------------------------------------
# Python / backend (e.g. FastAPI, pytest)
# ---------------------------------------------------------------------------
# if [ -f pyproject.toml ]; then
#   echo "==> Installing Python dependencies"
#   command -v uv >/dev/null 2>&1 || pip install --quiet uv
#   uv sync --frozen   # or: pip install -e ".[dev]" / poetry install --no-root
# fi

# ---------------------------------------------------------------------------
# System packages needed for BUILDING/LINTING only (not runtime services).
# Keep this minimal — if you find yourself installing a database here, that's a
# signal the work needs manual verification rather than sandbox verification.
# ---------------------------------------------------------------------------
# sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends <pkg>

# ---------------------------------------------------------------------------
# Sanity check (optional): confirm the unit-test tooling is callable so a session
# doesn't discover a missing toolchain mid-task. Do NOT run the full suite here.
# ---------------------------------------------------------------------------
# npx vitest --version >/dev/null 2>&1 || echo "WARN: vitest not available"
# uv run pytest --version >/dev/null 2>&1 || echo "WARN: pytest not available"

echo "==> Sandbox provisioning complete"
