# 09 — The `ask_user` tool

> Lets the agent pause and ask the educator a question that isn't a write approval — works in every autonomy mode, including autonomous.

## Why

ARCHITECTURE §3.2 ("ask_user tool the agent can call when it needs human input that isn't a write approval") and §5.4 ("Agent-initiated questions are mode-independent ... autonomous mode does not suppress agent questions, because that would make autonomous mode brittle"). Without this, agents in autonomous mode have no way to clarify scope, ask for missing pedagogical preferences, etc., and have to guess — producing wrong outputs.

Decision D4 commits to "registered tool" rather than a synthetic prompt-engineering pattern.

## What to do

### Register the tool in the extension

In `packages/agency/extensions/agency-control.ts`:

```ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai"; // for Google compatibility

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
        description: "Optional finite set of choices. If provided, the educator picks one of these; if omitted, the educator types a free-form response.",
      })
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if (!ctx.hasUI) {
      // headless mode — there is no user to ask
      throw new Error("ask_user called without a UI available");
    }
    const answer = params.options && params.options.length > 0
      ? await ctx.ui.select(params.question, params.options)
      : await ctx.ui.input(params.question, "Type your answer…");

    if (answer === undefined) {
      // user cancelled
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
```

### Plugin side

The plugin already needs to handle `extension_ui_request{method:"select"|"input"}` from task 05. This task adds no new plugin code beyond verifying both `select` and `input` paths work for the `ask_user` flow:
- `select` → renders an options card (task 05).
- `input` → renders a single-line input card (task 05).

If task 05 had only stubbed `input`/`select`, this task is the moment to finish them.

### Behaviour across modes

- **All three modes**: `ask_user` works the same way. Autonomous mode does not suppress it. Decision D9 + ARCHITECTURE §5.4 both reinforce this.
- The agent's own `tool_call` for `ask_user` is *not* gated by the per-write gate (it's not a write). The extension's `tool_call` hook should auto-allow tools of class `"unknown"`-but-on-the-allowlist; alternatively, add `ask_user` to the class table from task 03 as its own class `"ask"` and auto-allow it.

Suggested addition to the class table in task 03:

```ts
TOOL_CLASS_TABLE["ask_user"] = "ask"; // never gated; agent-initiated dialog
```

and in the `decide` function:

```ts
if (klass === "ask") return "allow"; // the dialog itself surfaces UI
```

### Prompt guidance

The `promptSnippet` and `promptGuidelines` above are intentionally restrictive — without them, models tend to over-use ask_user as a crutch. The guidelines tell them to prefer defensible defaults. Revisit after observing real use.

## Acceptance

- In all three modes, asking the agent "Should I emphasise theory or practice in the next lesson? Use ask_user to decide" produces:
  - In step-by-step or per-lesson or autonomous: a single options card "Theory / Practice / Both" (if the agent passes options) or a free-form input card (if it doesn't). The user's response appears as the tool result; the agent continues based on it.
- Cancelling the card returns a "(user declined)" result to the agent, which should recover gracefully (apologise, ask differently, or pick a default).
- No autonomy mode suppresses or auto-answers the question.

## Files touched

- `packages/agency/extensions/agency-control.ts` (register `ask_user`, add `"ask"` class)
- (No plugin changes if task 05 implemented `select`/`input` fully; this is a verification step otherwise.)

## Out of scope

- Multiselect `ask_user` (single-choice in v1; the `select` UI maps onto pi's `select` dialog which is single-choice).
- Time-bounded ask_user (`ctx.ui.select` supports `timeout`; we don't expose it as a tool parameter for v1 — defaulting to no timeout).
- Skill-specific prompt guidance for ask_user (lives in skill files; no skills yet).

## Depends on

- 02 (codec — not strictly required for ask_user itself, but the extension must already be loaded with the slash-command + notify scaffolding)
- 05 (plugin renders `select` and `input` cards)

## Notes

- `ask_user` is the first place the architecture genuinely commits to bidirectional turn-time conversation. Once it exists, the temptation will be to abuse it (use it instead of actually thinking). Pi's promptGuidelines give us a knob to dampen that; if the dampening is insufficient in practice, the right place to harden it is in the orchestrator skill once that exists.
- Pi's `ctx.ui.select` and `ctx.ui.input` are both blocking dialog methods. While the agent is waiting on the answer, no other tool calls in the same assistant message can complete (sibling parallel tool calls would be unusual for an `ask_user` invocation anyway).
- If pi's tool-execution timeout fires before the user responds (typically several minutes), the agent will receive an error; that's acceptable Phase-1 behaviour. No timer surfacing in the UI yet.
