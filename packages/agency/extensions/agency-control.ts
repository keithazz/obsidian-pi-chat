import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ToolCallEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import {
  encodeExtensionMessage,
  parseSlashArgs,
  AGENCY_PROTOCOL_VERSION,
  type AutonomyMode,
} from "@educator-agency/shared";
import { registerNavigationTools } from "./navigation-tools";

export type ToolClass =
  | "read-only"
  | "edit"
  | "create"
  | "bash"
  | "external-service"
  | "ask"
  | "unknown";

export const TOOL_CLASS_TABLE: Record<string, ToolClass> = {
  read: "read-only",
  ls: "read-only",
  grep: "read-only",
  find: "read-only",
  edit: "edit",
  write: "create",
  bash: "bash",
  ask_user: "ask", // never gated; agent-initiated dialog
};

interface ClassificationInput {
  toolName: string;
  input: Record<string, unknown>;
  fileExistsOnDisk: (absolutePath: string) => boolean;
  cwd: string;
}

// Extension point: return true for paid external-service tools (e.g. Synthesia) once registered.
function isExternalServiceTool(_toolName: string): boolean {
  return false;
}

export function classifyTool(call: ClassificationInput): ToolClass {
  if (isExternalServiceTool(call.toolName)) return "external-service";
  return TOOL_CLASS_TABLE[call.toolName] ?? "unknown";
}

const DANGEROUS_BASH = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*777/i,
];

function decide(
  klass: ToolClass,
  m: AutonomyMode,
  event: { toolName: string; input: unknown },
): "allow" | "ask" | "deny" {
  if (klass === "read-only") return "allow";
  if (klass === "ask") return "allow"; // the dialog itself surfaces UI
  if (klass === "external-service" || klass === "unknown") return "ask";
  if (klass === "bash") {
    if (m === "autonomous") {
      return DANGEROUS_BASH.some((p) =>
        p.test(String((event.input as Record<string, unknown>).command ?? "")),
      )
        ? "ask"
        : "allow";
    }
    return "ask"; // step-by-step, per-lesson
  }
  // edit, create
  // NOTE: ARCHITECTURE §5.1 specifies that per-lesson should ask on delete/rename,
  // but pi's edit tool only mutates content, not paths. The delete/rename subclass
  // is reserved for a future custom tool. For Phase 1, per-lesson auto-allows all edit/create.
  if (m === "step-by-step") return "ask";
  return "allow"; // per-lesson, autonomous
}

function renderPlainTextSummary(event: { toolName: string; input: unknown }): string {
  const input = event.input as Record<string, unknown>;
  switch (event.toolName) {
    case "bash":
      return `Command: ${String(input.command ?? "(none)")}`;
    case "edit": {
      const edits = Array.isArray(input.edits) ? input.edits.length : 1;
      return `${String(input.path ?? "unknown")}: ${edits} edit block(s)`;
    }
    case "write":
      return `${String(input.path ?? "unknown")}: ${String(input.content ?? "").length} chars`;
    default:
      return JSON.stringify(input);
  }
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function resolveAbsolute(cwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

function readFileOrEmpty(absolutePath: string): string {
  try {
    return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
  } catch {
    return "";
  }
}

// Approximate first-occurrence sequential application — close enough for a preview.
// Pi's edit tool may apply differently (reverse-order, fuzzy match), but the preview
// only needs to show the user roughly what is being proposed. The actual write is
// performed by replacing the edits with a single full-content edit on accept.
function applyEditsApprox(
  before: string,
  edits: ReadonlyArray<{ oldText: string; newText: string }>,
): string {
  let out = before;
  for (const e of edits) {
    if (!e.oldText) {
      // pi treats empty oldText as "append" (rough approximation)
      out = out + e.newText;
      continue;
    }
    const idx = out.indexOf(e.oldText);
    if (idx === -1) continue;
    out = out.slice(0, idx) + e.newText + out.slice(idx + e.oldText.length);
  }
  return out;
}

interface ProposalContent {
  proposalId: string;
  path: string;
  operation: "create" | "modify";
  before: string;
  after: string;
  beforeHash: string;
}

function buildProposalForEdit(
  event: ToolCallEvent,
  cwd: string,
): ProposalContent | null {
  if (event.toolName === "edit") {
    const input = event.input as { path: string; edits: { oldText: string; newText: string }[] };
    if (!input.path) return null;
    const abs = resolveAbsolute(cwd, input.path);
    const before = readFileOrEmpty(abs);
    const after = applyEditsApprox(before, input.edits ?? []);
    return {
      proposalId: randomUUID(),
      path: input.path,
      operation: "modify",
      before,
      after,
      beforeHash: sha256Hex(before),
    };
  }
  if (event.toolName === "write") {
    const input = event.input as { path: string; content: string };
    if (!input.path) return null;
    const abs = resolveAbsolute(cwd, input.path);
    const before = readFileOrEmpty(abs);
    const operation: "create" | "modify" = existsSync(abs) ? "modify" : "create";
    return {
      proposalId: randomUUID(),
      path: input.path,
      operation,
      before,
      after: input.content ?? "",
      beforeHash: sha256Hex(before),
    };
  }
  return null;
}

function summariseChange(before: string, after: string): string {
  // Intentionally lightweight (task 08). Reports net line delta against the
  // on-disk pre-image observed at tool_call time, not the proposal stage-time
  // before (which could be stale if the user edited under Obsidian).
  if (before.length + after.length > 200_000) {
    return `${before.length} → ${after.length} bytes`;
  }
  const beforeLineCount = before === "" ? 0 : before.split("\n").length;
  const afterLineCount = after === "" ? 0 : after.split("\n").length;
  const delta = afterLineCount - beforeLineCount;
  if (delta > 0) return `+${delta} lines`;
  if (delta < 0) return `−${Math.abs(delta)} lines`;
  return `${afterLineCount} lines`;
}

interface PendingEdit {
  path: string;
  existedBefore: boolean;
  before: string;
}

function applyAcceptedContent(event: ToolCallEvent, before: string, decided: string): void {
  if (event.toolName === "edit") {
    // Convert any number of edits into a synthetic single full-content edit so the
    // user's (possibly modified) decided content lands verbatim when pi runs the tool.
    (event.input as { edits: { oldText: string; newText: string }[] }).edits = [
      { oldText: before, newText: decided },
    ];
  } else if (event.toolName === "write") {
    (event.input as { content: string }).content = decided;
  }
}

export default function (pi: ExtensionAPI) {
  // Default per decision D9; session-scoped, non-persistent.
  // To persist across /reload: pi.appendEntry("agency-mode", { mode }) + restore in session_start.
  let mode: AutonomyMode = "step-by-step";
  let lastRejection: { requestId: string; reason: string } | null = null;

  // Captures the pre-write file state per toolCallId so the tool_result handler
  // can compute the operation kind (create vs modify) and a change summary.
  const pendingEdits = new Map<string, PendingEdit>();

  pi.on("session_start", async (_event, ctx) => {
    mode = "step-by-step";
    pendingEdits.clear();
    registerNavigationTools(pi);
    ctx.ui.notify(
      encodeExtensionMessage({ kind: "loaded", protocolVersion: AGENCY_PROTOCOL_VERSION }),
      "info",
    );
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      const input = event.input as { path?: string };
      if (input.path) {
        const abs = resolveAbsolute(ctx.cwd, input.path);
        pendingEdits.set(event.toolCallId, {
          path: input.path,
          existedBefore: existsSync(abs),
          before: readFileOrEmpty(abs),
        });
      }
    }

    const klass = classifyTool({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
      fileExistsOnDisk: (p) => existsSync(p),
      cwd: ctx.cwd,
    });
    const decision = decide(klass, mode, event);
    console.log("[agency-control] tool_call", event.toolName, "→", klass, "→", decision);

    // pendingEdits is consumed by `tool_result`. Blocked tool calls never reach
    // `tool_result`, so drop the entry now to keep the map bounded.
    const dropPending = () => pendingEdits.delete(event.toolCallId);

    if (decision === "allow") return undefined;
    if (decision === "deny") { dropPending(); return { block: true, reason: "Denied by policy" }; }

    // decision === "ask"
    if (!ctx.hasUI) {
      // Fail closed in headless / print mode — no UI to prompt.
      dropPending();
      return { block: true, reason: "No UI available to confirm" };
    }

    // Edit/create proposals use the two-step staged-payload codec (D7): stage the
    // before/after content via `notify`, then drive the user decision through an
    // `editor` dialog whose prefill references the staged payload by id.
    if (klass === "edit" || klass === "create") {
      const proposal = buildProposalForEdit(event, ctx.cwd);
      if (!proposal) {
        dropPending();
        return { block: true, reason: "Could not stage proposal (missing path)" };
      }

      const skill = "agent"; // D8: Phase 1 has no skills installed.
      const turnId = ctx.sessionManager.getLeafId() ?? "";

      ctx.ui.notify(
        encodeExtensionMessage({
          kind: "proposal",
          proposalId: proposal.proposalId,
          path: proposal.path,
          operation: proposal.operation,
          before: proposal.before,
          after: proposal.after,
          beforeHash: proposal.beforeHash,
          skill,
          turnId,
        }),
        "info",
      );

      const title = `${proposal.operation} ${proposal.path}`;
      const decided = await ctx.ui.editor(
        title,
        `AGENCY::proposal-ref::${proposal.proposalId}`,
      );

      if (decided === undefined) {
        dropPending();
        const reason = lastRejection?.reason ?? "Rejected by user";
        lastRejection = null;
        return { block: true, reason };
      }

      applyAcceptedContent(event, proposal.before, decided);
      return undefined;
    }

    // Plain-text confirm for bash, external-service, unknown.
    const title = `${event.toolName} — ${klass}`;
    const message = renderPlainTextSummary(event);

    const ok = await ctx.ui.confirm(title, message);
    if (!ok) {
      dropPending();
      const reason = lastRejection?.reason ?? "Rejected by user";
      lastRejection = null;
      return { block: true, reason };
    }
    return undefined;
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    const pending = pendingEdits.get(event.toolCallId);
    pendingEdits.delete(event.toolCallId);

    if (event.isError) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (!pending) return;

    const abs = resolveAbsolute(ctx.cwd, pending.path);
    const after = readFileOrEmpty(abs);
    const operation: "create" | "modify" =
      event.toolName === "write"
        ? pending.existedBefore
          ? "modify"
          : "create"
        : "modify";

    // Ship the pre/post snapshot for the plugin's post-hoc diff view, but only
    // for reasonably-sized files — large notifies bloat the RPC stream and the
    // MergeView UX degrades anyway. Above the cap, the activity card falls back
    // to opening the file directly.
    const SNAPSHOT_BYTE_CAP = 200_000;
    const includeSnapshot = pending.before.length + after.length <= SNAPSHOT_BYTE_CAP;

    ctx.ui.notify(
      encodeExtensionMessage({
        kind: "edit-made",
        editId: randomUUID(),
        turnId: ctx.sessionManager.getLeafId() ?? "",
        skill: "agent", // D8: Phase 1 has no skills installed.
        operation,
        path: pending.path,
        summary: summariseChange(pending.before, after),
        ...(includeSnapshot ? { before: pending.before, after } : {}),
      }),
      "info",
    );
  });

  pi.registerTool({
    name: "ask_user",
    label: "Ask the user",
    description:
      "Ask the educator a question that you genuinely need to answer before proceeding. " +
      "Use sparingly: only when ambiguity or a missing preference cannot be resolved by reading " +
      "the vault or by making a defensible default choice. The user's response is returned as " +
      "the tool result.",
    promptSnippet: "Ask the educator a clarifying question when needed.",
    promptGuidelines: [
      "Prefer making a sensible default choice and continuing over calling ask_user. Use ask_user only when the choice meaningfully changes the output and cannot be made without educator input.",
      "When using ask_user, phrase the question concisely and offer concrete options if there's a small finite set.",
    ],
    parameters: Type.Object({
      question: Type.String({
        description: "The question to put to the educator. Concise; one sentence is ideal.",
      }),
      options: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional finite set of choices. If provided, the educator picks one of these; if omitted, the educator types a free-form response.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        throw new Error("ask_user called without a UI available");
      }
      const answer =
        params.options && params.options.length > 0
          ? await ctx.ui.select(params.question, params.options)
          : await ctx.ui.input(params.question, "Type your answer…");

      if (answer === undefined) {
        return {
          content: [{ type: "text", text: "(The user declined to answer.)" }],
          details: { cancelled: true },
        };
      }
      return {
        content: [{ type: "text", text: String(answer) }],
        details: { answer: String(answer) },
      };
    },
  });

  pi.registerCommand("agency-set-mode", {
    description: "Set the agency's autonomy mode",
    handler: async (args, ctx) => {
      const parsed = parseSlashArgs("agency-set-mode", args);
      if (!parsed) return ctx.ui.notify("Invalid mode argument", "warning");
      mode = parsed.mode;
      ctx.ui.notify(
        encodeExtensionMessage({ kind: "mode-acknowledged", mode, effectiveAt: new Date().toISOString() }),
        "info",
      );
    },
  });

  pi.registerCommand("agency-revert", {
    description: "Revert a prior agency-authored edit",
    handler: async (_args, ctx) => {
      // Implementation deferred to the history work item; stub for now.
      ctx.ui.notify("Revert not yet implemented", "warning");
    },
  });

  pi.registerCommand("agency-rejection-reason", {
    description: "Stash the educator's reason for rejecting the last tool confirmation",
    handler: async (args, _ctx) => {
      const parsed = parseSlashArgs("agency-rejection-reason", args);
      if (!parsed) return;
      lastRejection = { requestId: parsed.requestId, reason: parsed.reason };
    },
  });
}
