import { Plugin, ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import {
  AGENCY_SENTINEL,
  AGENCY_PROTOCOL_VERSION,
  tryDecodeExtensionMessage,
  formatSlashCommand,
  type AutonomyMode,
  type ExtensionToPluginMessage,
  type PluginToExtensionCommand,
} from "@educator-agency/shared";

const VIEW_TYPE = "pi-chat-view";

// ─── Chat View ───────────────────────────────────────────────────────────────

class PiChatView extends ItemView {
  private plugin: PiChatPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: PiChatPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  private pi: ChildProcess | null = null;
  private stdoutBuf = "";
  private msgId = 0;

  // DOM refs
  private messagesEl!: HTMLElement;
  private inputRowEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private statusDotEl!: HTMLElement;
  private statusMetaEl!: HTMLElement;
  private gearBtn!: HTMLButtonElement;
  private settingsEl!: HTMLElement;
  private modelsListEl!: HTMLElement;
  private modelSearchEl!: HTMLInputElement;
  private levelsEl!: HTMLElement;

  // Nullable status-bar child refs (built by applySessionMeta)
  private providerEl: HTMLElement | null = null;
  private modelEl: HTMLElement | null = null;
  private thinkingLevelEl: HTMLElement | null = null;
  private modeEl: HTMLElement | null = null;
  private modeNoResponseEl: HTMLElement | null = null;

  // Mode popover + settings button group
  private modePopoverEl: HTMLElement | null = null;
  private modeButtonsEl: HTMLElement | null = null;
  private modePending = false;
  private pendingModeTimeout: ReturnType<typeof setTimeout> | null = null;

  // Settings state
  private settingsOpen = false;
  private availableModels: any[] = [];
  private modelSearch = "";
  private currentProvider = "";
  private currentModelId = "";
  private currentThinkingLevel = "";
  private currentMode: AutonomyMode = "step-by-step";
  private defaultMode: AutonomyMode = "step-by-step";

  // Streaming state
  private currentAssistantEl: HTMLElement | null = null;
  private currentThinkingEl: HTMLElement | null = null;
  private currentToolCallArgsEl: HTMLElement | null = null;

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Pi Chat"; }
  getIcon(): string { return "message-circle"; }

  async onOpen(): Promise<void> {
    this.defaultMode = await this.plugin.getDefaultMode();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-chat-container");

    // ── Status bar ──────────────────────────────────────────────────────
    const statusBar = contentEl.createDiv({ cls: "pi-chat-status" });
    this.statusDotEl = statusBar.createSpan({ cls: "pi-chat-status-dot pi-chat-status-starting" });
    this.statusMetaEl = statusBar.createSpan({ cls: "pi-chat-status-meta", text: "connecting…" });
    this.gearBtn = statusBar.createEl("button", { cls: "pi-chat-gear clickable-icon" });
    setIcon(this.gearBtn, "settings");
    this.gearBtn.addEventListener("click", () => this.toggleSettings());

    // ── Message list ────────────────────────────────────────────────────
    this.messagesEl = contentEl.createDiv({ cls: "pi-chat-messages" });

    // ── Settings panel (hidden until gear click) ────────────────────────
    this.settingsEl = contentEl.createDiv({ cls: "pi-chat-settings pi-chat-hidden" });

    // ── Input row ───────────────────────────────────────────────────────
    this.inputRowEl = contentEl.createDiv({ cls: "pi-chat-input-row" });
    this.inputEl = this.inputRowEl.createEl("textarea", {
      cls: "pi-chat-input",
      attr: { placeholder: "Message Pi…", rows: "3" },
    });
    const sendBtn = this.inputRowEl.createEl("button", { text: "Send", cls: "pi-chat-send" });

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

  // ─── Settings panel ──────────────────────────────────────────────────────

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.messagesEl.classList.toggle("pi-chat-hidden", this.settingsOpen);
    this.inputRowEl.classList.toggle("pi-chat-hidden", this.settingsOpen);
    this.settingsEl.classList.toggle("pi-chat-hidden", !this.settingsOpen);
    this.gearBtn.classList.toggle("is-open", this.settingsOpen);
    this.gearBtn.setAttribute("aria-pressed", String(this.settingsOpen));

    if (this.settingsOpen) {
      this.renderSettingsPanel();
      this.sendRpc({ type: "get_available_models", id: "get-models" });
    }
  }

  private renderSettingsPanel(): void {
    this.settingsEl.empty();

    // Autonomy mode section
    const modeSection = this.settingsEl.createDiv({ cls: "pi-chat-settings-section" });
    modeSection.createDiv({ cls: "pi-chat-settings-heading", text: "Autonomy mode" });
    this.modeButtonsEl = modeSection.createDiv({ cls: "pi-chat-settings-mode-buttons" });
    this.renderModeButtons();

    // Thinking level section
    const thinkingSection = this.settingsEl.createDiv({ cls: "pi-chat-settings-section" });
    thinkingSection.createDiv({ cls: "pi-chat-settings-heading", text: "Thinking level" });
    this.levelsEl = thinkingSection.createDiv({ cls: "pi-chat-settings-slider-wrap" });
    this.renderLevelSlider();

    // Model section
    const modelSection = this.settingsEl.createDiv({ cls: "pi-chat-settings-section" });
    modelSection.createDiv({ cls: "pi-chat-settings-heading", text: "Model" });
    this.modelSearchEl = modelSection.createEl("input", {
      cls: "pi-chat-settings-search",
      attr: { type: "text", placeholder: "Search models…" },
    });
    this.modelSearchEl.value = this.modelSearch;
    this.modelSearchEl.addEventListener("input", () => {
      this.modelSearch = this.modelSearchEl.value;
      this.renderModelList();
    });
    this.modelsListEl = modelSection.createDiv({ cls: "pi-chat-settings-models" });
    if (this.availableModels.length > 0) {
      this.renderModelList();
    } else {
      this.modelsListEl.createDiv({ cls: "pi-chat-settings-empty", text: "Loading…" });
    }
  }

  private renderModeButtons(): void {
    if (!this.modeButtonsEl) return;
    this.modeButtonsEl.empty();
    const modes: AutonomyMode[] = ["step-by-step", "per-lesson", "autonomous"];
    for (const mode of modes) {
      const btn = this.modeButtonsEl.createEl("button", {
        cls: `pi-chat-settings-mode-btn pi-chat-mode-${mode}${mode === this.currentMode ? " is-active" : ""}${this.modePending ? " is-pending" : ""}`,
        text: mode,
      });
      btn.addEventListener("click", () => {
        if (!this.modePending && mode !== this.currentMode) this.requestModeChange(mode);
      });
    }
  }

  private renderModelList(): void {
    this.modelsListEl.empty();
    const q = this.modelSearch.toLowerCase().trim();
    const filtered = q
      ? this.availableModels.filter((m) =>
          m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q),
        )
      : this.availableModels;

    if (filtered.length === 0) {
      this.modelsListEl.createDiv({ cls: "pi-chat-settings-empty", text: "No matches." });
      return;
    }

    for (const m of filtered) {
      const isActive = m.id === this.currentModelId && m.provider === this.currentProvider;
      const item = this.modelsListEl.createDiv({
        cls: `pi-chat-settings-model-item${isActive ? " is-active" : ""}`,
      });
      item.createSpan({ cls: "pi-chat-settings-model-id", text: m.id });
      item.createSpan({ cls: "pi-chat-settings-model-provider", text: m.provider });
      item.addEventListener("click", () => {
        this.sendRpc({ type: "set_model", provider: m.provider, modelId: m.id, id: "set-model" });
      });
    }
  }

  private static readonly THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

  private renderLevelSlider(): void {
    this.levelsEl.empty();
    const levels = PiChatView.THINKING_LEVELS;
    const idx = Math.max(0, levels.indexOf(this.currentThinkingLevel));

    const valueEl = this.levelsEl.createDiv({
      cls: "pi-chat-settings-slider-value",
      text: levels[idx],
    });

    const slider = this.levelsEl.createEl("input", {
      cls: "pi-chat-settings-slider",
      attr: {
        type: "range",
        min: "0",
        max: String(levels.length - 1),
        step: "1",
        value: String(idx),
      },
    });

    const setFill = (i: number) => {
      slider.style.setProperty("--fill-pct", `${(i / (levels.length - 1)) * 100}%`);
    };
    setFill(idx);

    slider.addEventListener("input", () => {
      const i = parseInt(slider.value, 10);
      const newLevel = levels[i];
      valueEl.setText(newLevel);
      setFill(i);
      if (newLevel === this.currentThinkingLevel) return;
      // Optimistic: update local state + status bar immediately
      this.currentThinkingLevel = newLevel;
      this.setThinkingLevel(newLevel);
      // ticks.querySelectorAll(".pi-chat-settings-slider-tick").forEach((el, i) => {
      //   el.classList.toggle("is-active", levels[i] === newLevel);
      // });
      this.sendRpc({ type: "set_thinking_level", level: newLevel, id: "set-thinking" });
    });
  }

  // ─── Pi process lifecycle ────────────────────────────────────────────────

  private spawnPi(): void {
    const adapter = this.app.vault.adapter as any;
    const vaultPath: string = adapter.getBasePath?.() ?? ".";

    const extensionPath = path.join(vaultPath, "agency", "extensions", "agency-control.ts");
    const extensionExists = fs.existsSync(extensionPath);
    if (!extensionExists) {
      this.addSystemMessage(
        `Agency extension not found at \`${extensionPath}\` — run \`npm run link-dev-vault\` or scaffold the agency`
      );
    }

    const isWin = process.platform === "win32";
    const shell = isWin ? undefined : process.env.SHELL || "/bin/zsh";
    const extensionFlag = extensionExists ? ` --extension "${extensionPath}"` : "";
    const args = isWin
      ? extensionExists
        ? ["--mode", "rpc", "--extension", extensionPath]
        : ["--mode", "rpc"]
      : ["-l", "-c", `source ~/.zshrc 2>/dev/null; pi --mode rpc${extensionFlag}`];
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
      this.addSystemMessage(`Failed to start Pi. Is it installed and on your PATH?\n\n${err.message}`);
      return;
    }

    this.pi.stdout!.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.pi.stderr!.on("data", (chunk: Buffer) => {
      console.log("[pi-chat stderr]", chunk.toString("utf8"));
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

    setTimeout(() => {
      if (this.pi && !this.pi.killed) {
        this.setStatus("ready");
        this.sendRpc({ type: "get_state", id: "init-state" });
        // Apply user's preferred default mode for this session
        this.sendControl({ name: "agency-set-mode", mode: this.defaultMode });
      }
    }, 2000);
  }

  private killPi(): void {
    if (this.pi && !this.pi.killed) {
      this.pi.kill("SIGTERM");
      this.pi = null;
    }
  }

  private sendRpc(payload: Record<string, any>): void {
    if (this.pi && !this.pi.killed) {
      this.pi.stdin!.write(JSON.stringify(payload) + "\n");
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
        this.handleEvent(JSON.parse(line));
      } catch {
        console.log("[pi-chat] raw (not JSON):", line);
      }
    }
  }

  // ─── Event routing ───────────────────────────────────────────────────────

  private handleEvent(msg: Record<string, any>): void {
    console.log("[pi-chat event]", JSON.stringify(msg).slice(0, 300));

    const type = msg.type ?? msg.kind ?? "";

    // ── RPC responses ──────────────────────────────────────────────────
    if (type === "response") {
      if (msg.command === "get_state" && msg.success) {
        const m = msg.data?.model;
        this.applySessionMeta(
          m?.provider ?? "—",
          m?.id ?? "—",
          msg.data?.thinkingLevel ?? "—"
        );
      }

      if (msg.command === "get_available_models" && msg.success) {
        this.availableModels = msg.data?.models ?? [];
        if (this.settingsOpen) this.renderModelList();
      }

      if (msg.command === "set_model" && msg.success && msg.data) {
        this.currentProvider = msg.data.provider;
        this.currentModelId = msg.data.id;
        this.setProvider(msg.data.provider);
        this.setModel(msg.data.id);
        if (this.settingsOpen) this.renderModelList();
      }

      return;
    }

    // ── Live model / thinking-level changes ───────────────────────────
    if (type === "model_change") {
      const modelId = msg.modelId ?? msg.model;
      if (msg.provider) { this.currentProvider = msg.provider; this.setProvider(msg.provider); }
      if (modelId) { this.currentModelId = modelId; this.setModel(modelId); }
      if (this.settingsOpen) this.renderModelList();
      return;
    }

    if (type === "thinking_level_change") {
      const level = msg.thinkingLevel;
      if (level) {
        this.currentThinkingLevel = level;
        this.setThinkingLevel(level);
        if (this.settingsOpen) this.renderLevelSlider();
      }
      return;
    }

    // ── Pi's streaming wrapper ──────────────────────────────────────────
    if (type === "message_update") {
      const ae = msg.assistantMessageEvent;

      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
        this.appendAssistantText(ae.delta);
        return;
      }
      if (ae?.type === "thinking_start") { this.startThinkingTrace(); return; }
      if (ae?.type === "thinking_delta" && typeof ae.delta === "string") {
        this.appendThinkingText(ae.delta);
        return;
      }
      if (ae?.type === "thinking_end") { this.endThinkingTrace(ae.content ?? ""); return; }
      if (ae?.type === "toolcall_start") {
        const toolName = ae.partial?.content?.[ae.contentIndex]?.name ?? "tool";
        this.startToolCallTrace(toolName);
        return;
      }
      if (ae?.type === "toolcall_delta") { this.appendToolCallArgs(ae.delta ?? ""); return; }
      if (ae?.type === "toolcall_end") {
        if (this.currentToolCallArgsEl) {
          this.currentToolCallArgsEl.closest("details")?.removeAttribute("open");
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
      this.addSystemMessage(`⚠️ ${msg.message ?? msg.error ?? JSON.stringify(msg)}`);
      return;
    }

    // ── extension_ui_request ────────────────────────────────────────────
    if (type === "extension_ui_request") {
      if (msg.method === "notify") {
        const notifyText: string = msg.message ?? "";
        if (notifyText.startsWith(AGENCY_SENTINEL)) {
          const decoded = tryDecodeExtensionMessage(notifyText);
          if (decoded) {
            this.handleControlMessage(decoded);
          } else {
            console.warn("[pi-chat] malformed agency sentinel:", notifyText);
          }
          if (this.pi && msg.id) {
            this.sendRpc({ type: "extension_ui_response", id: msg.id, confirmed: true });
          }
          return;
        }
        this.addSystemMessage(`🔔 ${msg.title ?? msg.message ?? ""}`);
        if (this.pi && msg.id) {
          this.sendRpc({ type: "extension_ui_response", id: msg.id, confirmed: true });
        }
        return;
      }

      if (!msg.id) {
        console.warn("[pi-chat] extension_ui_request without id, ignoring");
        return;
      }

      try {
        if (msg.method === "confirm") {
          this.renderProposalCard(msg.id, msg.title ?? "", msg.message ?? "");
        } else if (msg.method === "select") {
          this.renderOptionsCard(msg.id, msg.title ?? msg.message ?? "", msg.options ?? []);
        } else if (msg.method === "input") {
          this.renderInputCard(msg.id, msg.title ?? "", msg.message ?? "", false);
        } else if (msg.method === "editor") {
          // Phase 1 fallback: plain textarea; diff view arrives in task 07.
          this.renderInputCard(msg.id, msg.title ?? "(editor)", msg.message ?? "", true);
        } else {
          console.warn("[pi-chat] unknown extension_ui_request method:", msg.method);
          this.sendRpc({ type: "extension_ui_response", id: msg.id, cancelled: true });
        }
      } catch (err) {
        // Fail safe: never deadlock pi if card rendering throws.
        // Closing the plugin without answering loses the pending request; the next pi turn will
        // re-emit it or fail with a tool timeout (Phase 1 accepted limitation).
        console.error("[pi-chat] error rendering proposal card:", err);
        this.sendRpc({ type: "extension_ui_response", id: msg.id, cancelled: true });
      }
      return;
    }
  }

  // ─── Proposal cards ──────────────────────────────────────────────────────

  private renderProposalCard(id: string, title: string, message: string): void {
    const card = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-proposal-card",
      attr: { "data-request-id": id },
    });
    card.createDiv({ cls: "pi-chat-proposal-title", text: title });
    if (message) card.createDiv({ cls: "pi-chat-proposal-message", text: message });
    const actions = card.createDiv({ cls: "pi-chat-proposal-actions" });

    const resolve = (confirmed: boolean, pillText: string) => {
      actions.remove();
      const pill = card.createDiv({
        cls: `pi-chat-proposal-pill ${confirmed ? "pi-chat-proposal-pill-accepted" : "pi-chat-proposal-pill-rejected"}`,
      });
      pill.setText(pillText);
      this.sendRpc({ type: "extension_ui_response", id, confirmed });
    };

    actions.createEl("button", { cls: "pi-chat-proposal-accept", text: "Accept" })
      .addEventListener("click", () => resolve(true, "✓ accepted"));
    actions.createEl("button", { cls: "pi-chat-proposal-reject", text: "Reject" })
      .addEventListener("click", () => resolve(false, "✗ rejected"));

    const rejectReasonBtn = actions.createEl("button", {
      cls: "pi-chat-proposal-reject-reason",
      text: "Reject with reason…",
    });
    rejectReasonBtn.addEventListener("click", () => {
      actions.empty();
      const textarea = actions.createEl("textarea", {
        cls: "pi-chat-proposal-reason-input",
        attr: { placeholder: "Enter reason…", rows: "2" },
      });
      actions.createEl("button", { cls: "pi-chat-proposal-reason-submit", text: "Submit reason" })
        .addEventListener("click", () => {
          const reason = textarea.value.trim();
          actions.remove();
          const pill = card.createDiv({ cls: "pi-chat-proposal-pill pi-chat-proposal-pill-rejected" });
          pill.setText("✗ rejected with reason");
          this.sendRpc({ type: "extension_ui_response", id, confirmed: false });
          if (reason) {
            this.sendControl({ name: "agency-rejection-reason", requestId: id, reason });
          }
        });
      textarea.focus();
    });

    this.scroll();
  }

  private renderOptionsCard(id: string, title: string, options: string[]): void {
    const card = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-proposal-card",
      attr: { "data-request-id": id },
    });
    card.createDiv({ cls: "pi-chat-proposal-title", text: title });
    const actions = card.createDiv({ cls: "pi-chat-proposal-actions" });

    for (const option of options) {
      actions.createEl("button", { cls: "pi-chat-proposal-option", text: option })
        .addEventListener("click", () => {
          actions.remove();
          const pill = card.createDiv({ cls: "pi-chat-proposal-pill pi-chat-proposal-pill-accepted" });
          pill.setText(`✓ ${option}`);
          this.sendRpc({ type: "extension_ui_response", id, confirmed: true, value: option });
        });
    }

    this.scroll();
  }

  private renderInputCard(id: string, title: string, message: string, multiLine: boolean): void {
    const card = this.messagesEl.createDiv({
      cls: "pi-chat-msg pi-chat-proposal-card",
      attr: { "data-request-id": id },
    });
    card.createDiv({ cls: "pi-chat-proposal-title", text: title });
    if (message) card.createDiv({ cls: "pi-chat-proposal-message", text: message });
    const form = card.createDiv({ cls: "pi-chat-proposal-actions pi-chat-proposal-input-form" });

    const inputEl: HTMLInputElement | HTMLTextAreaElement = multiLine
      ? form.createEl("textarea", {
          cls: "pi-chat-proposal-text-input",
          attr: { rows: "4", placeholder: "Enter text…" },
        })
      : form.createEl("input", {
          cls: "pi-chat-proposal-text-input",
          attr: { type: "text", placeholder: "Enter text…" },
        });

    form.createEl("button", { cls: "pi-chat-proposal-submit", text: "Submit" })
      .addEventListener("click", () => {
        const value = inputEl.value.trim();
        form.remove();
        const pill = card.createDiv({ cls: "pi-chat-proposal-pill pi-chat-proposal-pill-accepted" });
        pill.setText("✓ submitted");
        this.sendRpc({ type: "extension_ui_response", id, confirmed: true, value });
      });

    inputEl.focus();
    this.scroll();
  }

  private handleControlMessage(msg: ExtensionToPluginMessage): void {
    switch (msg.kind) {
      case "loaded":
        if (msg.protocolVersion !== AGENCY_PROTOCOL_VERSION) {
          console.warn(`[pi-chat] agency version mismatch: expected ${AGENCY_PROTOCOL_VERSION}, got ${msg.protocolVersion}`);
        }
        console.log("[pi-chat] agency ready");
        break;
      case "mode-acknowledged":
        console.log(`[pi-chat] mode acknowledged: ${msg.mode} at ${msg.effectiveAt}`);
        this.currentMode = msg.mode;
        if (this.pendingModeTimeout !== null) {
          clearTimeout(this.pendingModeTimeout);
          this.pendingModeTimeout = null;
        }
        this.modePending = false;
        this.updateModeDisplay();
        if (this.settingsOpen) this.renderModeButtons();
        break;
      case "proposal":
        console.log(`[pi-chat] proposal received: ${msg.proposalId}`);
        break;
      case "edit-made":
        console.log(`[pi-chat] edit made: ${msg.editId}`);
        break;
      default:
        console.log("[pi-chat] unknown control message kind:", (msg as any).kind);
    }
  }

  private sendControl(cmd: PluginToExtensionCommand): void {
    this.sendRpc({ type: "prompt", id: `ctrl-${++this.msgId}`, message: formatSlashCommand(cmd) });
  }

  // ─── Mode switching ──────────────────────────────────────────────────────

  public requestModeChange(mode: AutonomyMode): void {
    if (this.modePending) return;
    this.modePending = true;
    this.updateModeDisplay();
    this.sendControl({ name: "agency-set-mode", mode });
    // Whatever the user picks becomes the default for future sessions too
    this.defaultMode = mode;
    this.plugin.setDefaultMode(mode).catch(console.error);
    this.pendingModeTimeout = setTimeout(() => {
      this.modePending = false;
      this.pendingModeTimeout = null;
      this.showModeNoResponse();
      this.updateModeDisplay();
    }, 3000);
  }

  private updateModeDisplay(): void {
    if (!this.modeEl) return;
    this.modeEl.className = `pi-chat-status-mode pi-chat-mode-${this.currentMode}${this.modePending ? " is-pending" : ""}`;
    this.modeEl.setText(this.currentMode);
  }

  private showModeNoResponse(): void {
    if (!this.modeNoResponseEl) return;
    this.modeNoResponseEl.removeClass("pi-chat-hidden");
    setTimeout(() => this.modeNoResponseEl?.addClass("pi-chat-hidden"), 3000);
  }

  private toggleModePopover(): void {
    if (this.modePopoverEl) { this.closeModePopover(); return; }
    if (this.modePending) return;
    this.openModePopover();
  }

  private openModePopover(): void {
    const popover = this.contentEl.createDiv({ cls: "pi-chat-mode-popover" });
    this.modePopoverEl = popover;

    const modes: AutonomyMode[] = ["step-by-step", "per-lesson", "autonomous"];
    for (const mode of modes) {
      const item = popover.createDiv({
        cls: `pi-chat-mode-popover-item pi-chat-mode-${mode}${mode === this.currentMode ? " is-active" : ""}`,
        text: mode,
      });
      item.addEventListener("click", () => {
        this.closeModePopover();
        this.requestModeChange(mode);
      });
    }

    if (this.modeEl) {
      const rect = this.modeEl.getBoundingClientRect();
      const containerRect = this.contentEl.getBoundingClientRect();
      popover.style.top = `${rect.bottom - containerRect.top + 2}px`;
      popover.style.left = `${rect.left - containerRect.left}px`;
    }

    const onOutsideClick = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== this.modeEl) {
        this.closeModePopover();
        document.removeEventListener("click", onOutsideClick, true);
      }
    };
    setTimeout(() => document.addEventListener("click", onOutsideClick, true), 10);
  }

  private closeModePopover(): void {
    this.modePopoverEl?.remove();
    this.modePopoverEl = null;
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
    this.sendRpc({ type: "prompt", id: `msg-${++this.msgId}`, message: text });
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
      const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-assistant" });
      row.createDiv({ cls: "pi-chat-label", text: "Pi" });
      this.currentAssistantEl = row.createDiv({ cls: "pi-chat-content" });
    }
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
      if (!this.currentThinkingEl.textContent?.trim()) {
        this.currentThinkingEl.setText(content || "(encrypted reasoning)");
      }
      this.currentThinkingEl.closest("details")?.removeAttribute("open");
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
    const row = this.messagesEl.createDiv({ cls: "pi-chat-msg pi-chat-system" });
    row.createDiv({ cls: "pi-chat-content" }).setText(text);
    this.scroll();
  }

  // ─── Status bar helpers ──────────────────────────────────────────────────

  private setStatus(state: "starting" | "ready" | "error" | "stopped"): void {
    this.statusDotEl.className = `pi-chat-status-dot pi-chat-status-${state}`;
    this.statusDotEl.setAttribute("title", state);
  }

  private applySessionMeta(provider: string, model: string, thinkingLevel: string): void {
    this.currentProvider = provider;
    this.currentModelId = model;
    this.currentThinkingLevel = thinkingLevel;
    this.statusMetaEl.empty();
    this.providerEl = this.statusMetaEl.createSpan({ cls: "pi-chat-status-provider", text: provider });
    this.statusMetaEl.createSpan({ cls: "pi-chat-status-sep", text: " · " });
    this.modelEl = this.statusMetaEl.createSpan({ cls: "pi-chat-status-model", text: model });
    this.statusMetaEl.createSpan({ cls: "pi-chat-status-sep", text: " · thinking: " });
    this.thinkingLevelEl = this.statusMetaEl.createSpan({ cls: "pi-chat-status-thinking", text: thinkingLevel });
    this.statusMetaEl.createSpan({ cls: "pi-chat-status-sep", text: " · mode: " });
    this.modeEl = this.statusMetaEl.createSpan({
      cls: `pi-chat-status-mode pi-chat-mode-${this.currentMode}`,
      text: this.currentMode,
      attr: { title: "Click to change autonomy mode", role: "button", tabindex: "0" },
    });
    this.modeNoResponseEl = this.statusMetaEl.createSpan({
      cls: "pi-chat-mode-no-response pi-chat-hidden",
      text: "(no response)",
    });
    this.modeEl.addEventListener("click", () => this.toggleModePopover());
  }

  private setProvider(provider: string): void {
    if (this.providerEl) this.providerEl.setText(provider);
  }

  private setModel(model: string): void {
    if (this.modelEl) this.modelEl.setText(model);
  }

  private setThinkingLevel(level: string): void {
    if (this.thinkingLevelEl) this.thinkingLevelEl.setText(level);
  }


  private scroll(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

// ─── Plugin entry point ──────────────────────────────────────────────────────

interface PiChatPluginData {
  defaultMode: AutonomyMode;
}

const DEFAULT_PLUGIN_DATA: PiChatPluginData = { defaultMode: "step-by-step" };

export default class PiChatPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new PiChatView(leaf, this));
    this.addCommand({
      id: "open-pi-chat",
      name: "Open Pi Chat",
      callback: () => this.activateView(),
    });

    const autonomyModes: AutonomyMode[] = ["step-by-step", "per-lesson", "autonomous"];
    for (const mode of autonomyModes) {
      this.addCommand({
        id: `pi-chat-set-mode-${mode}`,
        name: `Pi Chat: Set autonomy to ${mode}`,
        callback: () => {
          const view = this.getView();
          if (view) {
            view.requestModeChange(mode);
          } else {
            new Notice("Pi Chat is not open.");
          }
        },
      });
    }
  }

  async getDefaultMode(): Promise<AutonomyMode> {
    const data = (await this.loadData()) as PiChatPluginData | null;
    return data?.defaultMode ?? DEFAULT_PLUGIN_DATA.defaultMode;
  }

  async setDefaultMode(mode: AutonomyMode): Promise<void> {
    const data = ((await this.loadData()) as PiChatPluginData | null) ?? {};
    await this.saveData({ ...data, defaultMode: mode });
  }

  private getView(): PiChatView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf?.view instanceof PiChatView ? (leaf.view as PiChatView) : null;
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
