import { Plugin, ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { ChildProcess, spawn } from "child_process";

const VIEW_TYPE = "pi-chat-view";

// ─── Chat View ───────────────────────────────────────────────────────────────

class PiChatView extends ItemView {
  private pi: ChildProcess | null = null;
  private stdoutBuf = "";
  private msgId = 0;

  // DOM refs
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;

  // Streaming state — accumulate tokens into the current assistant bubble
  private currentAssistantEl: HTMLElement | null = null;

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Pi Chat";
  }
  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-chat-container");

    // Status bar at top
    this.statusEl = contentEl.createDiv({ cls: "pi-chat-status" });
    this.setStatus("starting", "Starting Pi…");

    // Scrollable message list
    this.messagesEl = contentEl.createDiv({ cls: "pi-chat-messages" });

    // Input area
    const inputRow = contentEl.createDiv({ cls: "pi-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "pi-chat-input",
      attr: { placeholder: "Message Pi…", rows: "3" },
    });
    const sendBtn = inputRow.createEl("button", {
      text: "Send",
      cls: "pi-chat-send",
    });

    sendBtn.addEventListener("click", () => this.sendMessage());
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.spawnPi();
  }

  async onClose(): Promise<void> {
    this.killPi();
  }

  // ─── Pi process lifecycle ────────────────────────────────────────────────

  private spawnPi(): void {
    // Vault root as cwd so pi sees the vault's files.
    const adapter = this.app.vault.adapter as any;
    const vaultPath: string = adapter.getBasePath?.() ?? ".";

    console.log('v1');

    // Spawn through a login shell so macOS picks up PATH from the user's
    // shell profile (the Electron process often does not inherit it).
    const isWin = process.platform === "win32";
    const shell = isWin ? undefined : process.env.SHELL || "/bin/zsh";
    const args = isWin
      ? ["--mode rpc"]
      : ["-l", "-c", `source ~/.zshrc 2>/dev/null; pi --mode rpc`];
    const cmd = isWin ? "pi" : shell!;

    console.log(`[pi-chat] spawning: ${cmd} ${args.join(" ")}  cwd=${vaultPath}`);

    try {
      this.pi = spawn(cmd, args, {
        cwd: vaultPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err: any) {
      this.setStatus("error", `Spawn failed: ${err.message}`);
      this.addSystemMessage(
        `Failed to start Pi. Is it installed and on your PATH?\n\n${err.message}`
      );
      return;

    }


    this.pi.stdout!.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.pi.stderr!.on("data", (chunk: Buffer) => {
      // stderr is diagnostic — log but don't render unless it's an error
      const text = chunk.toString("utf8");
      console.log("[pi-chat stderr]", text);
      
    });

    this.pi.on("error", (err) => {
      console.error("[pi-chat] process error:", err);
      this.setStatus("error", `Pi error: ${err.message}`);
      this.addSystemMessage(`Pi process error: ${err.message}`);
    });

    this.pi.on("exit", (code, signal) => {
      console.log(`[pi-chat] exited code=${code} signal=${signal}`);
      this.setStatus("stopped", `Pi stopped (code ${code})`);
      this.pi = null;
    });

    // Give pi a moment to start, then mark ready.
    // (There is no explicit "ready" event in pi's RPC — it just starts
    // accepting JSONL on stdin once it's initialized.)
    setTimeout(() => {
      if (this.pi && !this.pi.killed) {
        this.setStatus("ready", "Connected to Pi");
      }
    }, 2000);
  }

  private killPi(): void {
    if (this.pi && !this.pi.killed) {
      console.log("[pi-chat] killing pi");
      this.pi.kill("SIGTERM");
      this.pi = null;
    }
  }

  // ─── JSONL parsing ───────────────────────────────────────────────────────

  private onStdout(chunk: Buffer): void {
    this.stdoutBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, nl);
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleEvent(msg);
      } catch {
        console.log("[pi-chat] raw (not JSON):", line);
      }
    }
  }

  // ─── Event routing ───────────────────────────────────────────────────────
  //
  // We don't know pi's exact event schema ahead of time. Strategy:
  // 1. Log EVERY event to console so you can inspect the real shapes.
  // 2. Try several known/likely patterns for extracting streamed text.
  // 3. Render tool calls as system messages.
  // 4. Anything unrecognized → log only.

  private handleEvent(msg: Record<string, any>): void {
    console.log("[pi-chat event]", JSON.stringify(msg).slice(0, 300));

    const type = msg.type ?? msg.kind ?? "";

    // ── Pi's streaming wrapper ──────────────────────────────────────────
    if (type === "message_update") {
      const ae = msg.assistantMessageEvent;
      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
        this.appendAssistantText(ae.delta);
      }
      return;
    }

    // ── Tool usage narration ────────────────────────────────────────────
    if (type === "tool_call" || type === "tool_use" || type === "tool_result") {
      const name = msg.toolName ?? msg.tool ?? msg.name ?? "tool";
      const status = type === "tool_result" ? "✓" : "…";
      this.addSystemMessage(`🔧 ${name} ${status}`);
      return;
    }

    // ── Turn complete ───────────────────────────────────────────────────
    if (type === "turn_end" || type === "agent_end" || type === "done") {
      this.currentAssistantEl = null;
      return;
    }

    // ── Error ───────────────────────────────────────────────────────────
    if (type === "error") {
      const errMsg = msg.message ?? msg.error ?? JSON.stringify(msg);
      this.addSystemMessage(`⚠️ ${errMsg}`);
      return;
    }

    // ── extension_ui_request (approvals, questions) ─────────────────────
    // For this POC we just auto-confirm so pi doesn't hang.
    if (type === "extension_ui_request") {
      console.log("[pi-chat] auto-confirming ui request:", msg.id, msg.method);
      this.addSystemMessage(
        `🔔 ${msg.method}: ${msg.title ?? msg.message ?? ""} [auto-confirmed]`
      );
      if (this.pi && msg.id) {
        const response = JSON.stringify({
          type: "extension_ui_response",
          id: msg.id,
          confirmed: true,
        });
        this.pi.stdin!.write(response + "\n");
      }
      return;
    }

    // ── Unrecognized — log only ─────────────────────────────────────────
    // Check console to discover new event types.
  }

  // ─── Sending ─────────────────────────────────────────────────────────────

  private sendMessage(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;

    if (!this.pi || this.pi.killed) {
      new Notice("Pi is not running. Reopen the sidebar to reconnect.");
      return;
    }

    this.inputEl.value = "";
    this.addUserMessage(text);
    this.currentAssistantEl = null;

    const payload = JSON.stringify({
      type: "prompt",
      id: `msg-${++this.msgId}`,
      message: text,
    });
    console.log("[pi-chat] sending:", payload);
    this.pi.stdin!.write(payload + "\n");
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  private addUserMessage(text: string): void {
    const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-user" });
    row.createDiv({ cls: "pi-chat-label", text: "You" });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }

  private appendAssistantText(text: string): void {
    if (!this.currentAssistantEl) {
      const row = this.messagesEl.createDiv({
        cls: "pi-chat-msg pi-chat-assistant",
      });
      row.createDiv({ cls: "pi-chat-label", text: "Pi" });
      this.currentAssistantEl = row.createDiv({ cls: "pi-chat-content" });
    }
    // Append text; use textContent for safety (no HTML injection).
    this.currentAssistantEl.textContent += text;
    this.scroll();
  }

  private addSystemMessage(text: string): void {
    const row = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-system",
    });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }

  private setStatus(
    state: "starting" | "ready" | "error" | "stopped",
    text: string
  ): void {
    this.statusEl.setText(text);
    this.statusEl.className = `pi-chat-status pi-chat-status-${state}`;
  }

  private scroll(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

// ─── Plugin entry point ──────────────────────────────────────────────────────

export default class PiChatPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new PiChatView(leaf));

    this.addCommand({
      id: "open-pi-chat",
      name: "Open Pi Chat",
      callback: () => this.activateView(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
        leaf = rightLeaf;
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }
}
