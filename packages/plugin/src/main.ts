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
  private statusDotEl!: HTMLElement;
  private providerEl!: HTMLElement;
  private modelEl!: HTMLElement;

  // Streaming state — accumulate tokens into the current assistant bubble
  private currentAssistantEl: HTMLElement | null = null;
  private currentThinkingEl: HTMLElement | null = null;
  private currentToolCallArgsEl: HTMLElement | null = null;

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
    const statusBar = contentEl.createDiv({ cls: "pi-chat-status" });
    this.statusDotEl = statusBar.createSpan({ cls: "pi-chat-status-dot pi-chat-status-starting" });
    const metaEl = statusBar.createSpan({ cls: "pi-chat-status-meta" });
    this.providerEl = metaEl.createSpan({ cls: "pi-chat-status-provider", text: "—" });
    metaEl.createSpan({ cls: "pi-chat-status-sep", text: " · " });
    this.modelEl = metaEl.createSpan({ cls: "pi-chat-status-model", text: "—" });

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
      this.setStatus("error");
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
      this.setStatus("error");
      this.addSystemMessage(`Pi process error: ${err.message}`);
    });

    this.pi.on("exit", (code, signal) => {
      console.log(`[pi-chat] exited code=${code} signal=${signal}`);
      this.setStatus("stopped");
      this.pi = null;
    });

    // Give pi a moment to start, then mark ready and fetch session state.
    setTimeout(() => {
      if (this.pi && !this.pi.killed) {
        this.setStatus("ready");
        this.pi.stdin!.write(JSON.stringify({ type: "get_state", id: "init-state" }) + "\n");
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

    // ── RPC responses ──────────────────────────────────────────────────
    if (type === "response") {
      if (msg.command === "get_state" && msg.success && msg.data?.model) {
        const m = msg.data.model;
        if (m.provider) this.setProvider(m.provider);
        if (m.id) this.setModel(m.id);
      }
      return;
    }

    // ── Live model change ──────────────────────────────────────────────
    if (type === "model_change") {
      if (msg.provider) this.setProvider(msg.provider);
      const modelId = msg.modelId ?? msg.model;
      if (modelId) this.setModel(modelId);
      return;
    }

    // ── Pi's streaming wrapper ──────────────────────────────────────────
    if (type === "message_update") {
      const ae = msg.assistantMessageEvent;

      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
        this.appendAssistantText(ae.delta);
        return;
      }

      if (ae?.type === "thinking_start") {
        this.startThinkingTrace();
        return;
      }

      if (ae?.type === "thinking_delta" && typeof ae.delta === "string") {
        this.appendThinkingText(ae.delta);
        return;
      }

      if (ae?.type === "thinking_end") {
        this.endThinkingTrace(ae.content ?? "");
        return;
      }

      if (ae?.type === "toolcall_start") {
        const toolContent = ae.partial?.content?.[ae.contentIndex];
        const toolName = toolContent?.name ?? "tool";
        this.startToolCallTrace(toolName);
        return;
      }

      if (ae?.type === "toolcall_delta") {
        this.appendToolCallArgs(ae.delta ?? "");
        return;
      }

      if (ae?.type === "toolcall_end") {
        if (this.currentToolCallArgsEl) {
          const details = this.currentToolCallArgsEl.closest("details");
          if (details) details.removeAttribute("open");
        }
        this.currentToolCallArgsEl = null;
        return;
      }

      return;
    }

    // ── Turn complete ───────────────────────────────────────────────────
    if (type === "turn_end" || type === "agent_end" || type === "done") {
      this.currentAssistantEl = null;
      this.currentThinkingEl = null;
      this.currentToolCallArgsEl = null;
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
    this.currentThinkingEl = null;
    this.currentToolCallArgsEl = null;

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

  private startThinkingTrace(): void {
    const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-trace pi-chat-thinking" });
    const details = row.createEl("details", { cls: "pi-chat-trace-details" });
    details.setAttribute("open", "");
    details.createEl("summary", { cls: "pi-chat-trace-summary", text: "Thinking…" });
    this.currentThinkingEl = details.createDiv({ cls: "pi-chat-trace-content" });
    this.scroll();
  }

  private appendThinkingText(delta: string): void {
    if (this.currentThinkingEl) {
      this.currentThinkingEl.textContent = (this.currentThinkingEl.textContent ?? "") + delta;
      this.scroll();
    }
  }

  private endThinkingTrace(content: string): void {
    if (this.currentThinkingEl) {
      const hasAccumulated = !!this.currentThinkingEl.textContent?.trim();
      if (!hasAccumulated) {
        this.currentThinkingEl.setText(content || "(encrypted reasoning)");
      }
      const details = this.currentThinkingEl.closest("details");
      if (details) details.removeAttribute("open");
    }
    this.currentThinkingEl = null;
    this.scroll();
  }

  private startToolCallTrace(toolName: string): void {
    const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-trace pi-chat-toolcall" });
    const details = row.createEl("details", { cls: "pi-chat-trace-details" });
    details.setAttribute("open", "");
    const summary = details.createEl("summary", { cls: "pi-chat-trace-summary" });
    summary.createSpan({ text: "🔧 " });
    summary.createSpan({ cls: "pi-chat-trace-tool-name", text: toolName });
    this.currentToolCallArgsEl = details.createDiv({ cls: "pi-chat-trace-args" });
    this.scroll();
  }

  private appendToolCallArgs(delta: string): void {
    if (this.currentToolCallArgsEl) {
      this.currentToolCallArgsEl.textContent = (this.currentToolCallArgsEl.textContent ?? "") + delta;
      this.scroll();
    }
  }

  private addSystemMessage(text: string): void {
    const row = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-system",
    });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }

  private setStatus(state: "starting" | "ready" | "error" | "stopped"): void {
    this.statusDotEl.className = `pi-chat-status-dot pi-chat-status-${state}`;
    this.statusDotEl.setAttribute("title", state);
  }

  private setProvider(provider: string): void {
    this.providerEl.setText(provider);
  }

  private setModel(model: string): void {
    this.modelEl.setText(model);
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
