import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  encodeExtensionMessage,
  parseSlashArgs,
  AGENCY_PROTOCOL_VERSION,
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

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const klass = classifyTool({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
      fileExistsOnDisk: (p) => existsSync(p),
      cwd: ctx.cwd,
    });
    console.log("[agency-control] tool_call", event.toolName, "→", klass);
    return undefined; // never block in this task
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(
      encodeExtensionMessage({ kind: "loaded", protocolVersion: AGENCY_PROTOCOL_VERSION }),
      "info",
    );
  });

  pi.registerCommand("agency-set-mode", {
    description: "Set the agency's autonomy mode",
    handler: async (args, ctx) => {
      const parsed = parseSlashArgs("agency-set-mode", args);
      if (!parsed) return ctx.ui.notify("Invalid mode argument", "warning");
      // Task 04 will store this; for now, just echo.
      ctx.ui.notify(
        encodeExtensionMessage({ kind: "mode-acknowledged", mode: parsed.mode, effectiveAt: new Date().toISOString() }),
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
