# Reference docs (evergreen, must track code)

Data models, API contracts, and conventions. These MUST match the code — a reference doc
that lies is worse than none. Updated during EXECUTE sessions in the same PR as the code
change that affects them.

- [architecture.md](./architecture.md) — full technical architecture (components, RPC,
  state ownership, autonomy modes, history, trust model, tradeoffs, open questions).
- [conventions.md](./conventions.md) — orientation: package ownership, load-bearing
  invariants, coding conventions, verification tier, things-not-to-do.
- [navigation-api.md](./navigation-api.md) — the read-only vault navigation tool surface
  (**draft**, seeded from code; verify before relying on it).
