// Custom RPC vocabulary layered on top of pi's protocol.
// See docs/ARCHITECTURE.md §4.1.
//
// Extension → plugin rides on ctx.ui.notify with AGENCY:: sentinel.
// Plugin → extension rides on pi.registerCommand / prompt slash commands.

export const AGENCY_SENTINEL = "AGENCY::";
export const AGENCY_PROTOCOL_VERSION = 1;

export type AutonomyMode = "step-by-step" | "per-lesson" | "autonomous";

// Extension → plugin (rides on notify.message)
export type ExtensionToPluginMessage =
  | { kind: "loaded"; protocolVersion: number }
  | { kind: "mode-acknowledged"; mode: AutonomyMode; effectiveAt: string }
  | { kind: "proposal"; proposalId: string; path: string;
      operation: "create" | "modify" | "delete" | "rename";
      before: string; after: string; beforeHash: string;
      skill: string; turnId: string }
  | { kind: "edit-made"; editId: string; turnId: string; skill: string;
      operation: "create" | "modify" | "delete" | "rename";
      path: string; summary: string;
      // Optional in-memory snapshot for the post-hoc diff view (task 08).
      // Omitted when the file is too large to ship over the notify channel;
      // the activity card then falls back to opening the file directly.
      before?: string; after?: string };

// Plugin → extension (slash commands; this is the union of payloads carried by them)
export type PluginToExtensionCommand =
  | { name: "agency-set-mode"; mode: AutonomyMode }
  | { name: "agency-revert"; editId: string }
  | { name: "agency-rejection-reason"; requestId: string; reason: string };

export function encodeExtensionMessage(msg: ExtensionToPluginMessage): string {
  const { kind, ...rest } = msg;
  return `${AGENCY_SENTINEL}${kind}::${JSON.stringify(rest)}`;
}

export function tryDecodeExtensionMessage(notifyMessage: string): ExtensionToPluginMessage | null {
  if (!notifyMessage.startsWith(AGENCY_SENTINEL)) return null;
  const without = notifyMessage.slice(AGENCY_SENTINEL.length);
  const sep = without.indexOf("::");
  if (sep === -1) return null;
  const kind = without.slice(0, sep);
  const jsonStr = without.slice(sep + 2);
  try {
    const rest = JSON.parse(jsonStr);
    return { kind, ...rest } as ExtensionToPluginMessage;
  } catch {
    return null;
  }
}

export function formatSlashCommand(cmd: PluginToExtensionCommand): string {
  switch (cmd.name) {
    case "agency-set-mode":
      return `/${cmd.name} ${encodeURIComponent(cmd.mode)}`;
    case "agency-revert":
      return `/${cmd.name} ${encodeURIComponent(cmd.editId)}`;
    case "agency-rejection-reason":
      return `/${cmd.name} ${encodeURIComponent(cmd.requestId)} ${encodeURIComponent(cmd.reason)}`;
  }
}

const VALID_AUTONOMY_MODES: AutonomyMode[] = ["step-by-step", "per-lesson", "autonomous"];

export function parseSlashArgs<C extends PluginToExtensionCommand["name"]>(
  name: C,
  argsString: string
): Extract<PluginToExtensionCommand, { name: C }> | null {
  const parts = argsString.trim().split(/\s+/).filter(Boolean).map(p => decodeURIComponent(p));

  switch (name) {
    case "agency-set-mode": {
      const mode = parts[0] as AutonomyMode;
      if (!mode || !VALID_AUTONOMY_MODES.includes(mode)) return null;
      return { name: "agency-set-mode", mode } as Extract<PluginToExtensionCommand, { name: C }>;
    }
    case "agency-revert": {
      const editId = parts[0];
      if (!editId) return null;
      return { name: "agency-revert", editId } as Extract<PluginToExtensionCommand, { name: C }>;
    }
    case "agency-rejection-reason": {
      const requestId = parts[0];
      const reason = parts.slice(1).join(" ");
      if (!requestId || !reason) return null;
      return { name: "agency-rejection-reason", requestId, reason } as Extract<PluginToExtensionCommand, { name: C }>;
    }
    default:
      return null;
  }
}
