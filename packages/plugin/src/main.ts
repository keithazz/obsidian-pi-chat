import { Plugin, ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { markdown } from "@codemirror/lang-markdown";
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
const VIEW_TYPE_PROPOSAL = "pi-chat-proposal-view";
const PROPOSAL_REF_PREFIX = "AGENCY::proposal-ref::";
const PROPOSAL_STASH_TTL_MS = 5 * 60 * 1000; // 5 minutes (task §Notes)

interface StashedProposal {
  proposalId: string;
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  before: string;
  after: string;
  beforeHash: string;
  skill: string;
  turnId: string;
  receivedAt: number;
}

// ─── Chat View ───────────────────────────────────────────────────────────────

class PiChatView extends ItemView {
  private plugin: PiChatPlugin;
  private vaultPath: string = ".";

  constructor(leaf: WorkspaceLeaf, plugin: PiChatPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  private pi: ChildProcess | null = null;
  private stdoutBuf = "";
  private msgId = 0;

  // Proposal stash for the two-step staged-payload codec (D7).
  // Keyed by proposalId. Entries auto-expire after PROPOSAL_STASH_TTL_MS to bound
  // memory if the extension stages but never follows up with an editor request.
  private proposalStash = new Map<string, StashedProposal>();
  private stashSweepTimer: ReturnType<typeof setInterval> | null = null;

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

    this.stashSweepTimer = setInterval(() => this.sweepStashedProposals(), 60 * 1000);
  }

  async onClose(): Promise<void> {
    this.killPi();
    if (this.stashSweepTimer !== null) {
      clearInterval(this.stashSweepTimer);
      this.stashSweepTimer = null;
    }
    this.proposalStash.clear();
  }

  private sweepStashedProposals(): void {
    const now = Date.now();
    for (const [id, p] of this.proposalStash) {
      if (now - p.receivedAt > PROPOSAL_STASH_TTL_MS) {
        this.proposalStash.delete(id);
      }
    }
  }

  takeStashedProposal(proposalId: string): StashedProposal | undefined {
    const p = this.proposalStash.get(proposalId);
    if (p) this.proposalStash.delete(proposalId);
    return p;
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  respondToProposal(requestId: string, response: { value: string } | { cancelled: true }): void {
    if ("cancelled" in response) {
      this.sendRpc({ type: "extension_ui_response", id: requestId, cancelled: true });
    } else {
      // editor responses carry only { value }; cancellation uses { cancelled: true }.
      this.sendRpc({ type: "extension_ui_response", id: requestId, value: response.value });
    }
  }

  sendRejectionReason(requestId: string, reason: string): void {
    if (!reason) return;
    this.sendControl({ name: "agency-rejection-reason", requestId, reason });
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
    this.vaultPath = vaultPath;

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
          const prefill: string = msg.prefill ?? msg.message ?? "";
          if (typeof prefill === "string" && prefill.startsWith(PROPOSAL_REF_PREFIX)) {
            const requestId = msg.id;
            this.handleProposalEditor(requestId, prefill.slice(PROPOSAL_REF_PREFIX.length), msg.title ?? "")
              .catch((err) => {
                console.error("[pi-chat] proposal editor failed:", err);
                this.sendRpc({ type: "extension_ui_response", id: requestId, cancelled: true });
              });
          } else {
            // Non-proposal editor request — fall back to a multi-line input card.
            this.renderInputCard(msg.id, msg.title ?? "(editor)", prefill, true);
          }
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

  // ─── Proposal MergeView pane (D7) ────────────────────────────────────────

  private async handleProposalEditor(requestId: string, proposalId: string, _title: string): Promise<void> {
    const stashed = this.takeStashedProposal(proposalId);
    if (!stashed) {
      this.addSystemMessage(
        `⚠️ Could not find staged proposal ${proposalId} — extension and plugin may have fallen out of sync. The agent's tool call will be rejected; ask it to retry.`,
      );
      this.respondToProposal(requestId, { cancelled: true });
      return;
    }

    const { workspace } = this.app;
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_PROPOSAL, active: true });
    workspace.revealLeaf(leaf);

    const view = leaf.view;
    if (!(view instanceof ProposalView)) {
      // Should not happen; fail closed.
      this.respondToProposal(requestId, { cancelled: true });
      return;
    }
    view.initialize(this, requestId, stashed);
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
        this.proposalStash.set(msg.proposalId, {
          proposalId: msg.proposalId,
          path: msg.path,
          operation: msg.operation,
          before: msg.before,
          after: msg.after,
          beforeHash: msg.beforeHash,
          skill: msg.skill,
          turnId: msg.turnId,
          receivedAt: Date.now(),
        });
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

// ─── Proposal MergeView ItemView ─────────────────────────────────────────────

class ProposalView extends ItemView {
  private host: PiChatView | null = null;
  private proposal: StashedProposal | null = null;
  private requestId: string = "";
  private answered = false;
  private mergeView: MergeView | null = null;
  private acceptBtn: HTMLButtonElement | null = null;
  private rejectBtn: HTMLButtonElement | null = null;
  private rejectReasonBtn: HTMLButtonElement | null = null;
  private actionsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private mergeContainerEl: HTMLElement | null = null;

  getViewType(): string { return VIEW_TYPE_PROPOSAL; }
  getDisplayText(): string {
    if (!this.proposal) return "Proposal";
    return `${this.proposal.operation} ${this.proposal.path}`;
  }
  getIcon(): string { return "git-pull-request"; }

  async onClose(): Promise<void> {
    if (!this.answered && this.host && this.requestId) {
      this.host.respondToProposal(this.requestId, { cancelled: true });
      this.answered = true;
    }
    this.mergeView?.destroy();
    this.mergeView = null;
  }

  initialize(host: PiChatView, requestId: string, proposal: StashedProposal): void {
    this.host = host;
    this.requestId = requestId;
    this.proposal = proposal;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-chat-proposal-pane");

    // Header bar
    const header = contentEl.createDiv({ cls: "pi-chat-proposal-pane-header" });
    const titleRow = header.createDiv({ cls: "pi-chat-proposal-pane-title-row" });
    titleRow.createSpan({ cls: "pi-chat-proposal-pane-path", text: proposal.path });
    titleRow.createSpan({
      cls: `pi-chat-proposal-pane-badge pi-chat-proposal-pane-badge-${proposal.operation}`,
      text: proposal.operation,
    });
    const provenance = titleRow.createSpan({ cls: "pi-chat-proposal-pane-skill" });
    provenance.setText(`skill: ${proposal.skill || "agent"}`);

    this.actionsEl = header.createDiv({ cls: "pi-chat-proposal-pane-actions" });
    this.acceptBtn = this.actionsEl.createEl("button", {
      cls: "pi-chat-proposal-accept",
      text: "Accept",
    });
    this.acceptBtn.addEventListener("click", () => this.accept());

    this.rejectBtn = this.actionsEl.createEl("button", {
      cls: "pi-chat-proposal-reject",
      text: "Reject",
    });
    this.rejectBtn.addEventListener("click", () => this.reject());

    this.rejectReasonBtn = this.actionsEl.createEl("button", {
      cls: "pi-chat-proposal-reject-reason",
      text: "Reject with reason…",
    });
    this.rejectReasonBtn.addEventListener("click", () => this.startRejectWithReason());

    this.statusEl = contentEl.createDiv({ cls: "pi-chat-proposal-pane-status pi-chat-hidden" });

    this.bodyEl = contentEl.createDiv({ cls: "pi-chat-proposal-pane-body" });
    this.mergeContainerEl = this.bodyEl.createDiv({ cls: "pi-chat-proposal-pane-merge" });

    this.checkStaleHash().catch((err) => console.warn("[pi-chat] stale-hash check failed:", err));
    this.mountMergeView(proposal);
  }

  private mountMergeView(proposal: StashedProposal): void {
    if (!this.mergeContainerEl) return;

    const readOnlyExtensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      lineNumbers(),
      markdown(),
    ];
    const editableExtensions = [
      EditorView.lineWrapping,
      lineNumbers(),
      markdown(),
    ];

    this.mergeView = new MergeView({
      parent: this.mergeContainerEl,
      orientation: "a-b",
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
      a: {
        doc: proposal.before,
        extensions: readOnlyExtensions,
      },
      b: {
        doc: proposal.after,
        extensions: editableExtensions,
      },
    });
  }

  private async checkStaleHash(): Promise<void> {
    if (!this.proposal || !this.host || !this.statusEl) return;
    const vaultPath = this.host.getVaultPath();
    const absPath = path.isAbsolute(this.proposal.path)
      ? this.proposal.path
      : path.join(vaultPath, this.proposal.path);

    let currentHash: string;
    try {
      const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : "";
      currentHash = createHash("sha256").update(content, "utf8").digest("hex");
    } catch (err) {
      console.warn("[pi-chat] stale-hash read failed:", err);
      return;
    }

    if (currentHash !== this.proposal.beforeHash) {
      this.statusEl.empty();
      this.statusEl.removeClass("pi-chat-hidden");
      this.statusEl.addClass("pi-chat-proposal-pane-stale");
      this.statusEl.setText(
        "⚠ The file changed since this proposal was prepared. Accepting will overwrite those changes.",
      );
    }
  }

  private currentRightSideContent(): string {
    return this.mergeView?.b.state.doc.toString() ?? this.proposal?.after ?? "";
  }

  private accept(): void {
    if (this.answered || !this.host) return;
    const value = this.currentRightSideContent();
    this.answered = true;
    this.host.respondToProposal(this.requestId, { value });
    this.renderResolution("accepted");
    this.closePane();
  }

  private reject(): void {
    if (this.answered || !this.host) return;
    this.answered = true;
    this.host.respondToProposal(this.requestId, { cancelled: true });
    this.renderResolution("rejected");
    this.closePane();
  }

  private startRejectWithReason(): void {
    if (!this.actionsEl) return;
    this.actionsEl.empty();
    const textarea = this.actionsEl.createEl("textarea", {
      cls: "pi-chat-proposal-reason-input",
      attr: { placeholder: "Reason for rejecting this proposal…", rows: "2" },
    });
    const submitBtn = this.actionsEl.createEl("button", {
      cls: "pi-chat-proposal-reason-submit",
      text: "Submit rejection",
    });
    const cancelBtn = this.actionsEl.createEl("button", {
      cls: "pi-chat-proposal-reject",
      text: "Cancel",
    });
    submitBtn.addEventListener("click", () => {
      if (this.answered || !this.host) return;
      const reason = textarea.value.trim();
      this.answered = true;
      this.host.respondToProposal(this.requestId, { cancelled: true });
      if (reason) this.host.sendRejectionReason(this.requestId, reason);
      this.renderResolution("rejected");
      this.closePane();
    });
    cancelBtn.addEventListener("click", () => {
      // Restore the standard action row.
      this.actionsEl?.empty();
      this.actionsEl?.appendChild(this.acceptBtn!);
      this.actionsEl?.appendChild(this.rejectBtn!);
      this.actionsEl?.appendChild(this.rejectReasonBtn!);
    });
    textarea.focus();
  }

  private renderResolution(outcome: "accepted" | "rejected"): void {
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.removeClass("pi-chat-hidden");
    this.statusEl.removeClass("pi-chat-proposal-pane-stale");
    this.statusEl.addClass(
      outcome === "accepted" ? "pi-chat-proposal-pane-resolved-ok" : "pi-chat-proposal-pane-resolved-no",
    );
    this.statusEl.setText(outcome === "accepted" ? "✓ accepted" : "✗ rejected");
  }

  private closePane(): void {
    // Small delay so the user sees the resolution pill before the tab vanishes.
    setTimeout(() => this.leaf.detach(), 600);
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
    this.registerView(VIEW_TYPE_PROPOSAL, (leaf: WorkspaceLeaf) => new ProposalView(leaf));
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
