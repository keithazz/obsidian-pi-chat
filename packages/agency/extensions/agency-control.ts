import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  encodeExtensionMessage,
  parseSlashArgs,
  AGENCY_PROTOCOL_VERSION,
} from "@educator-agency/shared";

export default function (pi: ExtensionAPI) {
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
