// agency-control extension — stub.
//
// This is loaded by pi at session start via:
//   pi --mode rpc --extension <vault>/agency/extensions/agency-control.ts
//
// Responsibilities (see docs/ARCHITECTURE.md §3.2):
//   - Approval gating on tool_call (read-only / edit / create / destructive /
//     external-service classification).
//   - Mode state (set_autonomy_mode RPC from the plugin).
//   - ask_user tool for agent-initiated questions.
//   - Post-execution edit_made notifications in auto-permitting modes.
//   - History recording per accepted write.
//   - External-service gating (Synthesia etc.) on a separate axis.
//
// For Phase 1 this file is intentionally empty — pi loading it without error
// is enough to validate the wiring.

export default function activate(_ctx: unknown): void {
  // no-op
}
