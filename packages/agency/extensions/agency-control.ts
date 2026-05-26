import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  encodeExtensionMessage,
  parseSlashArgs,
  AGENCY_PROTOCOL_VERSION,
  type AutonomyMode,
} from "@educator-agency/shared";

export type ToolClass =
  | "read-only"
  | "edit"
  | "create"
  | "bash"
  | "external-service"
  | "unknown";

export const TOOL_CLASS_TABLE: Record<string, ToolClass> = {
  read: "read-only",
  ls: "read-only",
  grep: "read-only",
  find: "read-only",
  edit: "edit",
  write: "create",
  bash: "bash",
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

export default function (pi: ExtensionAPI) {
  // Default per decision D9; session-scoped, non-persistent.
  // To persist across /reload: pi.appendEntry("agency-mode", { mode }) + restore in session_start.
  let mode: AutonomyMode = "step-by-step";

  pi.on("session_start", async (_event, ctx) => {
    mode = "step-by-step";
    ctx.ui.notify(
      encodeExtensionMessage({ kind: "loaded", protocolVersion: AGENCY_PROTOCOL_VERSION }),
      "info",
    );
  });

  pi.on("tool_call", async (event, ctx) => {
    const klass = classifyTool({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
      fileExistsOnDisk: (p) => existsSync(p),
      cwd: ctx.cwd,
    });
    const decision = decide(klass, mode, event);
    console.log("[agency-control] tool_call", event.toolName, "→", klass, "→", decision);

    if (decision === "allow") return undefined;
    if (decision === "deny") return { block: true, reason: "Denied by policy" };

    // decision === "ask"
    if (!ctx.hasUI) {
      // Fail closed in headless / print mode — no UI to prompt.
      return { block: true, reason: "No UI available to confirm" };
    }

    const title = `${event.toolName} — ${klass}`;
    const message = renderPlainTextSummary(event);

    const ok = await ctx.ui.confirm(title, message);
    if (!ok) {
      return { block: true, reason: "Rejected by user" };
    }
    return undefined;
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
}
