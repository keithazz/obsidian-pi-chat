// Custom RPC vocabulary layered on top of pi's protocol.
// See docs/ARCHITECTURE.md §4.1.
//
// These ride on pi's existing JSONL message stream as `notify`-style payloads
// with a project-specific `kind` discriminator. They are NOT pi's native event
// types — those are defined by pi itself.

export type AutonomyMode = "step-by-step" | "per-lesson" | "autonomous";

export interface SetAutonomyMode {
  kind: "set_autonomy_mode";
  mode: AutonomyMode;
  pathOverrides?: Record<string, "allow" | "ask" | "deny">;
  externalApis?: Record<string, "allow" | "ask" | "deny">;
}

export interface RevertRequest {
  kind: "revert_request";
  editId: string;
}

export type PluginToExtension = SetAutonomyMode | RevertRequest;

export interface EditMade {
  kind: "edit_made";
  editId: string;
  turnId: string;
  skill: string;
  operation: "create" | "modify" | "delete" | "rename";
  path: string;
  summary: string;
  beforeRef: string | null;
  afterRef: string | null;
}

export interface ModeAcknowledged {
  kind: "mode_acknowledged";
  mode: AutonomyMode;
  effectiveAt: string;
}

export type ExtensionToPlugin = EditMade | ModeAcknowledged;

export type AgencyRpcMessage = PluginToExtension | ExtensionToPlugin;
