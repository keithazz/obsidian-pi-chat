# Educator Agency

Monorepo for the Educator Agency — a multi-agent co-creation tool for educators
built on Obsidian and the [pi](https://github.com/earendil-works/pi) coding
agent runtime.

For the product vision and architectural detail, see
[docs/PRD.md](docs/PRD.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Packages

| Package | Purpose |
|---|---|
| [`packages/plugin`](packages/plugin) | Obsidian community plugin — UI shell that spawns pi in RPC mode and renders the agency. |
| [`packages/agency`](packages/agency) | Vault-installable artifact: the `agency-control` pi extension, default skills, `PEDAGOGY.md`, `style.css`. |
| [`packages/shared`](packages/shared) | TypeScript types for the custom RPC vocabulary that rides on top of pi's protocol. |

These three are co-versioned because a schema change in any one of them is a
coordinated change across all three.

## Prerequisites

- **Node.js** ≥ 18 and **npm** ≥ 9 (for workspaces).
- **Pi** installed and on `$PATH` (`pi --version` works in your terminal).
- **Obsidian** desktop (the plugin uses `child_process`; mobile is out of scope).
- Pi must be authenticated with at least one LLM provider (`pi`, then `/login`).

## First-time setup

```sh
npm install
npm run build              # initial build so dist/ exists for symlinks
npm run link-dev-vault     # creates dev-vault/ and symlinks the plugin + agency
```

This creates a self-contained dev vault at `./dev-vault/` (gitignored). Open
that folder as a vault in Obsidian, then:

1. **Settings → Community plugins → Turn on community plugins.**
2. **Install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin**
   (one-time): clone or download it into
   `dev-vault/.obsidian/plugins/hot-reload/` and enable it. From then on,
   every esbuild rebuild reloads the plugin automatically.
3. **Enable Pi Chat (POC)** in the installed-plugins list.

## Dev loop

```sh
npm run dev
```

This starts:

- `tsc --watch` for `packages/shared` (RPC type updates flow into both
  consumers).
- `esbuild --watch` for `packages/plugin` (bundles into
  `packages/plugin/dist/`, where the symlink in the dev vault picks it up).

Edits flow as:

| Edit | Reload path |
|---|---|
| `packages/plugin/src/**` | esbuild rebuilds → Hot Reload reloads the plugin in Obsidian. |
| `packages/agency/skills/**` (markdown) | Picked up by pi on next skill activation. No restart. |
| `packages/agency/extensions/agency-control.ts` | Requires pi restart. Use the plugin's "Restart pi" command (todo) or reopen the chat view. |
| `packages/shared/src/**` | `tsc --watch` emits new types; the next plugin rebuild incorporates them. |

## What lives outside the repo

| Thing | Where it lives | Why |
|---|---|---|
| Test markdown notes | `dev-vault/` (gitignored) | Test data, not source. |
| LLM API keys | `~/.pi/` (pi's auth file) | Pi's responsibility; never in repo. |
| Pi itself | User's `$PATH` | Separate distribution channel. |
| Your *real* vault | Your filesystem | Never touched by dev. |

## Smoke test

After the dev loop is running:

1. Open `dev-vault/` in Obsidian.
2. Command palette → **Open Pi Chat**.
3. Status bar should read "Connected to Pi" after ~2 seconds.
4. Send `List the files in the current directory.` — pi should stream a
   response.

The plugin auto-confirms `extension_ui_request` events for now (approval
gating is a later phase). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full target architecture.

## What this does NOT yet do

- No approval gating / diff view (the `agency-control` extension is a stub).
- No skills bundled yet.
- No history sidebar.
- No autonomy mode switcher.
- No settings UI.
