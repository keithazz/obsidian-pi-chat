# AGENTS.md

> Orientation for AI agents working in this monorepo. Read this first.

## What this project is

A multi-agent co-creation tool for educators, built as an Obsidian plugin on
top of the [pi](https://github.com/earendil-works/pi) coding-agent runtime.
Three artifacts ship together and evolve in lockstep:

1. An **Obsidian plugin** — the UI shell.
2. A **pi extension** (`agency-control`) — runtime policy: gating, history,
   notifications, autonomy state.
3. A **set of pi skills** plus templates — the agency itself.

The plugin and the extension talk to each other over a small custom RPC
vocabulary layered on top of pi's protocol. Schema changes are coordinated
across all three packages — that is why this is a monorepo.

## Read these before doing anything substantive

Order matters:

1. **[docs/PRD/01-basic-requirements.md](docs/PRD/01-basic-requirements.md)** — vision, target users, requirements,
   non-goals. Read this when a request might affect *what* the system does
   for the educator.
2. **[docs/ADR/01-basic-architecture.md](docs/ADR/01-basic-architecture.md)** — components, the
   approval mechanism, the RPC additions, state ownership, distribution,
   trust model, accepted tradeoffs, and open architectural questions.
   Read this when a request affects *how* the system is built. Section
   numbers are stable — cite them in commits and PRs (e.g.
   "ARCHITECTURE §4.1").
3. **[README.md](README.md)** — practical setup and dev-loop instructions.

If a request seems to conflict with PRD or ARCHITECTURE, stop and surface the
conflict rather than silently deviating. Those documents are the contract.

## Repo layout

```
packages/
├── plugin/                  # Obsidian plugin — UI shell
│   ├── src/main.ts          # plugin entry; view, pi lifecycle, JSONL transport
│   ├── manifest.json        # Obsidian plugin manifest (id: pi-chat-poc for now)
│   ├── styles.css
│   ├── esbuild.config.mjs   # bundles to dist/, copies manifest + styles
│   └── tsconfig.json
├── agency/                  # Vault-installable artifact
│   ├── extensions/
│   │   └── agency-control.ts   # STUB. Phase 2+ policy logic goes here.
│   ├── skills/                 # SKILL.md files per agent. Empty for now.
│   ├── PEDAGOGY.md             # default template
│   └── style.css               # default template
└── shared/                  # Co-evolving protocol types
    └── src/rpc.ts              # set_autonomy_mode, edit_made, etc.

docs/
├── PRD/01-basic-requirements.md
└── ADR/01-basic-architecture.md

scripts/
├── dev-link.sh              # one-shot: symlinks plugin + agency into dev-vault/
└── dev.sh                   # parallel watchers for plugin + shared

dev-vault/                   # gitignored; an Obsidian vault used only for testing
```

## Which package owns what

| If the change is about... | Edit in... |
|---|---|
| The chat sidebar, diff view, history sidebar, settings, pi lifecycle, JSONL transport, vault writes from Obsidian | `packages/plugin/` |
| Tool-call gating, approval policy, `ask_user`, autonomy state, history recording, external-service gates | `packages/agency/extensions/agency-control.ts` |
| Skill prompts, orchestrator logic, pedagogy templates | `packages/agency/skills/` and `packages/agency/PEDAGOGY.md` |
| The custom RPC schema between plugin and extension | `packages/shared/src/rpc.ts` (then update both consumers) |
| Build, lint, workspaces, dev scripts | repo root + `scripts/` |
| Product intent | `docs/PRD/01-basic-requirements.md` |
| Architectural decisions | `docs/ADR/01-basic-architecture.md` |

When in doubt, follow the mapping in **ARCHITECTURE §3 (Components)**.

## Architectural invariants — do not violate without discussion

These come from ARCHITECTURE §4 (Design principles) and §10 (Accepted
tradeoffs). They are load-bearing.

- **Skills are mode-agnostic; the orchestrator is mode-aware.** Worker
  skills must not reference "the chat sidebar", "the terminal", or assume
  their writes will be approved. Only the orchestrator reads autonomy mode.
- **Markdown is the canonical medium.** Multimedia is a downstream
  conversion, never a source of truth.
- **The vault is the source of truth.** No staging directories, no shadow
  folders. Pending proposals exist only in in-memory plugin state.
- **The plugin owns vault writes in Obsidian mode.** The extension proposes;
  the plugin writes via Obsidian's vault API. Do not add filesystem writes
  to the extension on the Obsidian path.
- **The agency-control extension is the trust-model surface.** It is the
  only project-authored code that runs inside pi. Keep it auditable.
- **No separate bridge process.** The "bridge" is pi running in RPC mode
  with the extension loaded. Do not introduce a second process to mediate.

## Current state vs. target state

The monorepo is freshly restructured. Several pieces are deliberately stubs:

| Surface | State |
|---|---|
| Chat view, pi lifecycle, JSONL transport | Working POC ([packages/plugin/src/main.ts](packages/plugin/src/main.ts)) — auto-confirms `extension_ui_request`. |
| `agency-control` extension | **Stub** ([packages/agency/extensions/agency-control.ts](packages/agency/extensions/agency-control.ts)). No gating, no history, no `ask_user`. |
| Default skills | **None yet.** `packages/agency/skills/` contains only `.gitkeep`. |
| RPC types | Defined in [packages/shared/src/rpc.ts](packages/shared/src/rpc.ts), not yet imported by the plugin or extension. |
| Diff view, history sidebar, mode switcher, settings UI | Not implemented. See ARCHITECTURE §3.4 for the target. |
| Multimedia producer | Not implemented. Implementation deferred to a separate design pass per ARCHITECTURE §3.5. |

When implementing a new surface, check the corresponding ARCHITECTURE
section first and cite it in the commit message.

## Dev loop (assume the human runs this; you can read its output)

```sh
npm install              # one-shot, after fresh clone or workspace changes
npm run build            # one-shot full build
npm run dev              # parallel watchers: shared (tsc) + plugin (esbuild)
npm run link-dev-vault   # creates dev-vault/ symlinks; safe to re-run
```

End-to-end behaviour is only verifiable by opening `dev-vault/` in Obsidian
and exercising the chat. You cannot test this from a tool-only session.
**If a change touches plugin behaviour, say so explicitly — do not claim
the change works without UI verification.**

Type-check parity with the build is the most you can verify yourself:

```sh
npm run build            # fails if either tsc (shared) or esbuild (plugin) errors
```

## What lives outside the repo

Never assume these exist locally or commit anything related to them:

| Thing | Where | Notes |
|---|---|---|
| Real Obsidian vaults | User's filesystem | Never touched by dev. |
| Test markdown notes | `dev-vault/` | Gitignored. Throwaway per developer. |
| LLM API keys | `~/.pi/` (pi's auth file) | Pi's responsibility; never read or write. |
| Pi itself | User's `$PATH` | Installed separately per pi's instructions. |

## Conventions

- **Imports across packages** use the workspace name:
  `import { AutonomyMode } from "@educator-agency/shared"`.
  Do not use relative paths between packages.
- **Plugin output** goes to `packages/plugin/dist/`. The dev vault's
  plugin directory is a symlink to that path. Never write to the dev
  vault's plugin directory directly.
- **Skill files** are markdown with frontmatter under
  `packages/agency/skills/<skill-name>/SKILL.md`. Skills are
  mode-agnostic prose; their tool surface is whatever the extension
  permits. See ARCHITECTURE §3.3.
- **RPC additions** (new message kinds between plugin and extension) go
  in `packages/shared/src/rpc.ts` *first*, then both consumers are
  updated in the same commit. See ARCHITECTURE §4.1.
- **The manifest `id` is `pi-chat-poc`** for now. A rename is deferred to
  avoid churning Obsidian plugin state mid-development. If you rename it,
  re-run `npm run link-dev-vault`.

## When you find a gap

- A missing **architectural** decision → open it as a new bullet under
  ARCHITECTURE §11 (Open architectural questions) rather than deciding
  silently in code.
- A missing **product** decision → open it under PRD §8 (Open product
  questions).
- A stub that needs filling in for the current task → fill it in and
  call out in the PR that you did so, with a pointer to the
  ARCHITECTURE section that specifies the behaviour.

## Things to not do

- Do not introduce a second process to mediate between Obsidian and pi.
  The architecture explicitly rejects this (ARCHITECTURE §1, §10).
- Do not write to the vault from the extension on the Obsidian path.
- Do not bake UI-mode assumptions ("we are in Obsidian", "we are in the
  terminal") into worker skills. Only the orchestrator and the extension
  may be mode-aware.
- Do not add sandboxing of the agency. ARCHITECTURE §9 explicitly rejects
  this — transparency is the trust model.
- Do not commit anything under `dev-vault/`. It is gitignored for a
  reason; treat it as scratch space.
- Do not delete or rewrite `docs/PRD/01-basic-requirements.md` or `docs/ADR/01-basic-architecture.md`
  without an explicit request. They are the project's contract; propose
  edits as suggestions.
