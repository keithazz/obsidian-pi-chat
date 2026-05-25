# Pi Chat POC — Obsidian ↔ Pi communication smoke test

Minimal Obsidian plugin that opens a right-sidebar chat panel, spawns
`pi --rpc` against the current vault, and streams pi's responses back into the
panel. No approval gating, no extensions, no skills — just two processes
talking to each other.

## Prerequisites

- **Pi** installed and working (`pi --version` in your terminal).
- **Node.js** ≥ 18 and **npm**.
- **Obsidian** desktop (not mobile — this plugin uses `child_process`).
- Pi must be authenticated with at least one LLM provider (`pi`, then
  `/login`).

## Build

```sh
cd pi-chat-poc
npm install
npm run build
```

This produces `main.js` alongside the existing `manifest.json` and
`styles.css`. Those three files are the plugin.

## Install into Obsidian

1. In the vault where you want to test, create the plugin directory:

```sh
mkdir -p /path/to/your/vault/.obsidian/plugins/pi-chat-poc
```

2. Copy (or symlink) the three output files:

```sh
cp main.js manifest.json styles.css \
   /path/to/your/vault/.obsidian/plugins/pi-chat-poc/
```

Or, for faster iteration during development, symlink the whole directory:

```sh
ln -s "$(pwd)" /path/to/your/vault/.obsidian/plugins/pi-chat-poc
```

3. In Obsidian: **Settings → Community plugins → Installed plugins** →
   toggle on **Pi Chat (POC)**.

4. If you don't see it, reload Obsidian (Cmd+R / Ctrl+R).

## Use

Open the command palette (Cmd+P / Ctrl+P) and run **Open Pi Chat**. A sidebar
panel appears on the right.

Type a message and press Enter (or click Send). Pi will respond — tokens
stream into the panel as they arrive.

Try something that exercises pi's file tools:

```
List the files in the current directory.
```

```
Read the first 20 lines of README.md.
```

```
Create a file called hello.md with the content "# Hello from Pi".
```

## What to look for

### Happy path

- Status bar shows "Connected to Pi" after ~2 seconds.
- Your message appears in a blue/accent bubble.
- Pi's response streams in token by token in a grey bubble.
- Tool calls appear as system messages (`🔧 read`, `🔧 write`, etc.).

### Debugging — the console is your friend

**Every RPC event is logged to the developer console.** Open it with
Cmd+Option+I (macOS) or Ctrl+Shift+I (Linux/Windows), look for
`[pi-chat event]`.

**If text doesn't render but events appear in the console:** pi's event
schema doesn't match any of the extraction patterns in `handleEvent()`.
Look at the logged event shape, find the field that contains the streamed
text, and add it to the extraction logic near the top of `handleEvent()`.
This is the single most likely thing you'll need to adjust.

**If nothing appears at all:**

- Check `[pi-chat stderr]` in the console — pi may have failed to start.
- Check `[pi-chat] spawning:` to see the exact command. Is the path right?
- On macOS, Obsidian may not inherit your shell PATH. The plugin spawns
  pi through a login shell (`$SHELL -l -c "pi --rpc"`) to work around
  this, but if your pi is installed somewhere unusual, this might not
  suffice. Check `which pi` in a terminal and compare.

**If pi starts but immediately exits:**

- Pi may be missing auth. Run `pi` interactively in a terminal, `/login`,
  then retry.
- Check `[pi-chat] exited code=...` in the console.

### Extension UI requests (auto-confirmed)

If pi calls a tool that would normally need confirmation (like `write`), the
plugin auto-confirms with `confirmed: true` and logs it. You'll see a system
message like `🔔 confirm: Approve write? [auto-confirmed]`. This is
intentional — approval gating is not part of this POC.

## Development loop

For live rebuilds while editing `main.ts`:

```sh
npm run dev
```

After each rebuild, reload Obsidian (Cmd+R) to pick up the new `main.js`.

## What this does NOT do

- No approval gating / diff view.
- No agency-control extension loaded — this is bare pi.
- No custom skills — uses pi's built-in capabilities.
- No session persistence across sidebar reopens.
- No error recovery / auto-restart on pi crash.
- No settings UI — everything is hardcoded.

These are all Phase 2+ concerns. This POC answers one question: **can the
Obsidian plugin and pi talk to each other with streaming?**

## Cleanup

To remove: delete the `pi-chat-poc` folder from
`.obsidian/plugins/`, disable the plugin in settings, reload Obsidian.
