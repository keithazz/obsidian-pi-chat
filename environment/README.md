# environment/

Provisioning for the EXECUTE sandbox.

`setup.sh` is the single source of truth for what the sandbox has installed. It is
deliberately **lightweight**: language runtimes + dev dependencies, enough to lint,
type-check, and run **unit tests** — nothing more.

Wire `setup.sh` in as the setup script for your Claude Code web environment. It runs once,
then the filesystem is snapshotted and reused; it only re-runs when the script or the
network allowlist changes, or after ~7 days. Keep it idempotent and check-before-install.

Things the sandbox intentionally does NOT provide (databases, Redis, browsers, running
services, real migrations) are out of scope and get flagged for the reviewer in each PR's
`## Manual testing required` section. If you're tempted to install a service here, that's
the signal the work needs manual verification instead.
