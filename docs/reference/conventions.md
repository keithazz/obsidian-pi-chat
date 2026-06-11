# Conventions & orientation — Educator Agency

> Reference doc — **must track the code.** Orientation for anyone (human or agent) working
> in this monorepo: what each package owns, the load-bearing invariants, and the coding
> conventions. For the full technical architecture see [architecture.md](./architecture.md);
> for product intent see [`docs/product/`](../product/); for decisions see [`docs/adr/`](../adr/).

## What this project is

A multi-agent co-creation tool for educators, built as an Obsidian plugin on top of the
[pi](https://github.com/earendil-works/pi) coding-agent runtime. Three artifacts ship
together and evolve in lockstep:

1. An **Obsidian plugin** — the UI shell.
2. A **pi extension** (`agency-control`) — runtime policy: gating, history, notifications,
   autonomy state.
3. A **set of pi skills** plus templates — the agency itself.

The plugin and the extension talk over a small custom RPC vocabulary layered on top of
pi's protocol. Schema changes are coordinated across all three packages — that is why this
is a monorepo.

## Repo layout

```
packages/
├── plugin/                  # Obsidian plugin — UI shell
│   ├── src/main.ts          # plugin entry; view, pi lifecycle, JSONL transport
│   ├── src/navigation/      # vault-aware navigation service (read-only)
│   ├── manifest.json        # Obsidian plugin manifest (id: pi-chat-poc for now)
│   ├── styles.css
│   ├── esbuild.config.mjs   # bundles to dist/, copies manifest + styles
│   └── tsconfig.json
├── agency/                  # Vault-installable artifact
│   ├── extensions/
│   │   ├── agency-control.ts    # policy logic (gating, history, ask_user, autonomy)
│   │   └── navigation-tools.ts  # registers navigation tools into pi
│   ├── skills/                  # SKILL.md files per agent (empty for now: .gitkeep)
│   ├── PEDAGOGY.md              # default template
│   └── style.css               # default template
└── shared/                  # Co-evolving protocol types
    └── src/rpc.ts              # set_autonomy_mode, edit_made, etc.
    └── src/navigation-rpc.ts   # navigation query/response vocabulary

scripts/
├── dev-link.sh              # one-shot: symlinks plugin + agency into dev-vault/
└── dev.sh                   # parallel watchers for plugin + shared

dev-vault/                   # gitignored; an Obsidian vault used only for testing
```

## Which package owns what

| If the change is about... | Edit in... |
|---|---|
| Chat sidebar, diff view, history sidebar, settings, pi lifecycle, JSONL transport, vault writes from Obsidian, navigation service | `packages/plugin/` |
| Tool-call gating, approval policy, `ask_user`, autonomy state, history recording, external-service gates | `packages/agency/extensions/agency-control.ts` |
| Skill prompts, orchestrator logic, pedagogy templates | `packages/agency/skills/` and `packages/agency/PEDAGOGY.md` |
| The custom RPC schema between plugin and extension | `packages/shared/src/` (then update both consumers) |
| Build, lint, workspaces, dev scripts | repo root + `scripts/` |
| Product intent | `docs/product/` |
| Architectural decisions | `docs/adr/` |

When in doubt, follow the mapping in [architecture.md](./architecture.md) §3 (Components).

## Architectural invariants — do not violate without discussion

These come from [architecture.md](./architecture.md) §4 (Design principles) and §10
(Accepted tradeoffs). They are load-bearing.

- **Skills are mode-agnostic; the orchestrator is mode-aware.** Worker skills must not
  reference "the chat sidebar", "the terminal", or assume their writes will be approved.
  Only the orchestrator reads autonomy mode.
- **Markdown is the canonical medium.** Multimedia is a downstream conversion, never a
  source of truth.
- **The vault is the source of truth.** No staging directories, no shadow folders. Pending
  proposals exist only in in-memory plugin state.
- **The plugin owns vault writes in Obsidian mode.** The extension proposes; the plugin
  writes via Obsidian's vault API. Do not add filesystem writes to the extension on the
  Obsidian path.
- **The agency-control extension is the trust-model surface.** It is the only
  project-authored code that runs inside pi. Keep it auditable.
- **No separate bridge process.** The "bridge" is pi running in RPC mode with the
  extension loaded. Do not introduce a second process to mediate.

## Conventions

- **Imports across packages** use the workspace name:
  `import { AutonomyMode } from "@educator-agency/shared"`. Do not use relative paths
  between packages.
- **RPC additions** (new message kinds between plugin and extension) go in
  `packages/shared/src/` *first*, then both consumers are updated in the same commit. See
  [architecture.md](./architecture.md) §4.1.
- **Plugin output** goes to `packages/plugin/dist/`. The dev vault's plugin directory is a
  symlink to that path. Never write to the dev vault's plugin directory directly.
- **Skill files** are markdown with frontmatter under
  `packages/agency/skills/<skill-name>/SKILL.md`. Skills are mode-agnostic prose; their
  tool surface is whatever the extension permits. See [architecture.md](./architecture.md) §3.3.
- **The manifest `id` is `pi-chat-poc`** for now. Renaming requires re-running
  `npm run link-dev-vault`.
- **Cite architecture section numbers** in commit messages when implementing a specified
  behaviour (e.g. `architecture.md §4.1`).

## Verification tier (important)

**This repository has no automated test runner and no unit tests.** The closest equivalent
to a test suite is the type-checking build:

```sh
npm run build            # fails if either tsc (shared) or esbuild (plugin) errors
```

For the EXECUTE sandbox, "lint + type-check + unit tests" therefore reduces to
**`npm run build` (type-check)** until a test runner is introduced. Anything beyond that —
especially anything touching plugin behaviour — can only be verified by opening
`dev-vault/` in Obsidian and is **out of scope for the sandbox**. If a change touches
plugin behaviour, say so explicitly in the PR's `## Manual testing required` section and
do not claim it works without UI verification.

## What lives outside the repo

Never assume these exist locally or commit anything related to them:

| Thing | Where | Notes |
|---|---|---|
| Real Obsidian vaults | User's filesystem | Never touched by dev. |
| Test markdown notes | `dev-vault/` | Gitignored. Throwaway per developer. |
| LLM API keys | `~/.pi/` (pi's auth file) | Pi's responsibility; never read or write. |
| Pi itself | User's `$PATH` | Installed separately per pi's instructions. |

## Things to not do

- Do not introduce a second process to mediate between Obsidian and pi (architecture.md §1, §10).
- Do not write to the vault from the extension on the Obsidian path.
- Do not bake UI-mode assumptions ("we are in Obsidian", "we are in the terminal") into
  worker skills. Only the orchestrator and the extension may be mode-aware.
- Do not add sandboxing of the agency. architecture.md §9 explicitly rejects this —
  transparency is the trust model.
- Do not commit anything under `dev-vault/`. It is gitignored; treat it as scratch space.
