---
name: Non-interactive CC Relay Prompts
description: Delivery-time instructions that keep CC Relay-launched turns non-interactive and require process cleanup.
type: behavior
---

# Non-interactive CC Relay Prompts

> [!important]
> Every prompt CC Relay delivers to Codex or Claude now ends with a short orchestrator notice that no answers can be provided. The provider must not ask questions, request approval, or wait for input. It should make reasonable assumptions and continue autonomously, or report a blocker and end the run when progress is impossible.
> Its final cleanup sentence is: `When done, stop all processes you started.`

## Delivery contract

The notice is added at the final provider boundary rather than when a task is saved:

- `CodexAppServer.run()` adds it to every `turn/start`.
- `CodexAppServer.steer()` adds it to every live follow-up sent through `turn/steer`.
- `taskPrompt()` adds it to visible and headless Claude Execute turns after any reference-image instructions.
- `ClaudeRunner.run()` adds it to isolated read-only Claude stages used by Plan council and Turbo workflows.

`withRelayNonInteractiveInstruction()` is idempotent, so a prompt that already carries the exact notice is not decorated twice.

This placement preserves the original prompt in the database, Task Activity, prompt history, task artifacts, retry identity, and continuation events. Only the provider-delivered text is decorated.

## Existing fallback behavior

The notice is preventive guidance, not a new provider state machine. Existing question handling remains as a safety net:

- Codex still answers tool questions with an empty answer object and cancels MCP elicitation.
- Claude still detects an unexpected interactive pause and keeps its existing [[claude-terminal-input]] behavior.
- Existing exact-window attention from [[terminal-input-attention]] remains unchanged.

## Files and verification

- `src/relay-prompt.mjs`
- `src/codex-app-server.mjs`
- `src/claude-execution-runner.mjs`
- `src/claude-runner.mjs`
- `test/relay-prompt.test.mjs`
- `test/codex-app-server.test.mjs`
- `test/claude-execution-runner.test.mjs`
- `test/claude-runner.test.mjs`

The full Node suite passes 1,531 tests. Focused coverage proves direct Codex delivery, live Codex steering, Claude Execute delivery with attachments, fresh Claude initialization, isolated Claude planning stages, process cleanup guidance, and idempotent decoration.

> [!note]
> This is backend behavior. A running CC Relay process must be restarted normally before newly dispatched turns receive the notice.

See [[task-history]], [[same-task-session-continuation]], [[claude-terminal-input]], and [[terminal-input-attention]].

#relay #prompts #non-interactive #claude #codex #process-cleanup
