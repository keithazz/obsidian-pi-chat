var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PiChatPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var VIEW_TYPE = "pi-chat-view";
var PiChatView = class extends import_obsidian.ItemView {
  pi = null;
  stdoutBuf = "";
  msgId = 0;
  // DOM refs
  messagesEl;
  inputEl;
  statusEl;
  // Streaming state — accumulate tokens into the current assistant bubble
  currentAssistantEl = null;
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Pi Chat";
  }
  getIcon() {
    return "message-circle";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-chat-container");
    this.statusEl = contentEl.createDiv({ cls: "pi-chat-status" });
    this.setStatus("starting", "Starting Pi\u2026");
    this.messagesEl = contentEl.createDiv({ cls: "pi-chat-messages" });
    const inputRow = contentEl.createDiv({ cls: "pi-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "pi-chat-input",
      attr: { placeholder: "Message Pi\u2026", rows: "3" }
    });
    const sendBtn = inputRow.createEl("button", {
      text: "Send",
      cls: "pi-chat-send"
    });
    sendBtn.addEventListener("click", () => this.sendMessage());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.spawnPi();
  }
  async onClose() {
    this.killPi();
  }
  // ─── Pi process lifecycle ────────────────────────────────────────────────
  spawnPi() {
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter.getBasePath?.() ?? ".";
    console.log("v1");
    const isWin = process.platform === "win32";
    const shell = isWin ? void 0 : process.env.SHELL || "/bin/zsh";
    const args = isWin ? ["--mode rpc"] : ["-l", "-c", `source ~/.zshrc 2>/dev/null; pi --mode rpc`];
    const cmd = isWin ? "pi" : shell;
    console.log(`[pi-chat] spawning: ${cmd} ${args.join(" ")}  cwd=${vaultPath}`);
    try {
      this.pi = (0, import_child_process.spawn)(cmd, args, {
        cwd: vaultPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }
      });
    } catch (err) {
      this.setStatus("error", `Spawn failed: ${err.message}`);
      this.addSystemMessage(
        `Failed to start Pi. Is it installed and on your PATH?

${err.message}`
      );
      return;
    }
    this.pi.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.pi.stderr.on("data", (chunk) => {
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
    setTimeout(() => {
      if (this.pi && !this.pi.killed) {
        this.setStatus("ready", "Connected to Pi");
      }
    }, 2e3);
  }
  killPi() {
    if (this.pi && !this.pi.killed) {
      console.log("[pi-chat] killing pi");
      this.pi.kill("SIGTERM");
      this.pi = null;
    }
  }
  // ─── JSONL parsing ───────────────────────────────────────────────────────
  onStdout(chunk) {
    this.stdoutBuf += chunk.toString("utf8");
    let nl;
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
  handleEvent(msg) {
    console.log("[pi-chat event]", JSON.stringify(msg).slice(0, 300));
    const type = msg.type ?? msg.kind ?? "";
    if (type === "message_update") {
      const ae = msg.assistantMessageEvent;
      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
        this.appendAssistantText(ae.delta);
      }
      return;
    }
    if (type === "tool_call" || type === "tool_use" || type === "tool_result") {
      const name = msg.toolName ?? msg.tool ?? msg.name ?? "tool";
      const status = type === "tool_result" ? "\u2713" : "\u2026";
      this.addSystemMessage(`\u{1F527} ${name} ${status}`);
      return;
    }
    if (type === "turn_end" || type === "agent_end" || type === "done") {
      this.currentAssistantEl = null;
      return;
    }
    if (type === "error") {
      const errMsg = msg.message ?? msg.error ?? JSON.stringify(msg);
      this.addSystemMessage(`\u26A0\uFE0F ${errMsg}`);
      return;
    }
    if (type === "extension_ui_request") {
      console.log("[pi-chat] auto-confirming ui request:", msg.id, msg.method);
      this.addSystemMessage(
        `\u{1F514} ${msg.method}: ${msg.title ?? msg.message ?? ""} [auto-confirmed]`
      );
      if (this.pi && msg.id) {
        const response = JSON.stringify({
          type: "extension_ui_response",
          id: msg.id,
          confirmed: true
        });
        this.pi.stdin.write(response + "\n");
      }
      return;
    }
  }
  // ─── Sending ─────────────────────────────────────────────────────────────
  sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text) return;
    if (!this.pi || this.pi.killed) {
      new import_obsidian.Notice("Pi is not running. Reopen the sidebar to reconnect.");
      return;
    }
    this.inputEl.value = "";
    this.addUserMessage(text);
    this.currentAssistantEl = null;
    const payload = JSON.stringify({
      type: "prompt",
      id: `msg-${++this.msgId}`,
      message: text
    });
    console.log("[pi-chat] sending:", payload);
    this.pi.stdin.write(payload + "\n");
  }
  // ─── Rendering ───────────────────────────────────────────────────────────
  addUserMessage(text) {
    const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-user" });
    row.createDiv({ cls: "pi-chat-label", text: "You" });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }
  appendAssistantText(text) {
    if (!this.currentAssistantEl) {
      const row = this.messagesEl.createDiv({
        cls: "pi-chat-msg pi-chat-assistant"
      });
      row.createDiv({ cls: "pi-chat-label", text: "Pi" });
      this.currentAssistantEl = row.createDiv({ cls: "pi-chat-content" });
    }
    this.currentAssistantEl.textContent += text;
    this.scroll();
  }
  addSystemMessage(text) {
    const row = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-system"
    });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }
  setStatus(state, text) {
    this.statusEl.setText(text);
    this.statusEl.className = `pi-chat-status pi-chat-status-${state}`;
  }
  scroll() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
};
var PiChatPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new PiChatView(leaf));
    this.addCommand({
      id: "open-pi-chat",
      name: "Open Pi Chat",
      callback: () => this.activateView()
    });
  }
  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  async activateView() {
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
};
