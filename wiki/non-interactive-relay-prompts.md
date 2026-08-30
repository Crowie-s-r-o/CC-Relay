---
name: Non-interactive CC Relay Prompts
description: Delivery-time instructions that keep CC Relay-launched turns autonomous, require a final verification pass, and require process cleanup.
type: behavior
---

# Non-interactive CC Relay Prompts

> [!important]
> Every prompt CC Relay delivers to Codex or Claude now ends with a short orchestrator notice that no answers can be provided. The provider must not ask questions, request approval, or wait for input. It should make reasonable assumptions and continue autonomously, or report a blocker and end the run when progress is impossible.
> Before finishing, it must perform one extra verification pass and fix any issue it finds.
> Its final cleanup sentence is: `When done, stop all processes you started.`

## Completion depth

Task 806 ran for 30 minutes and 27 seconds before Codex returned a normal final answer. Relay did not stop it on a duration or event limit. The `70/70 signals` label was the number of visible grouped signals out of the total grouped signals, not a quota.

Relay does not impose a wall-clock ceiling on Codex Execute turns. The completion-depth instruction therefore extends useful work instead of holding a finished provider turn open behind an arbitrary timer. Every delivered task now requires one additional verification pass before completion. Simple tasks can still finish promptly, while implementation work should use that pass to revisit the requested outcome, tests, regressions, and documentation and continue fixing anything uncovered.

## Delivery contract

The notice is added at the final provider boundary rather than when a task is saved:

- `CodexAppServer.run()` adds it to every `turn/start`.
- `CodexAppServer.steer()` adds it to every live follow-up sent through `turn/steer`.
- `taskPrompt()` adds it to visible and headless Claude Execute turns after any reference-image instructions.
- `ClaudeRunner.run()` adds it to isolated read-only Claude stages used by Plan council and Turbo workflows.

`withRelayNonInteractiveInstruction()` is idempotent, so a prompt that already carries the exact notice is not decorated twice. The added completion-depth sentence remains on the same logical line as the rest of the notice, preserving the three-line shape of a one-line Claude live follow-up and its existing guarded paste-delivery contract.

This placement preserves the canonical prompt in the database, prompt history, task artifacts, retry identity, and continuation events. Task Activity uses that canonical record when no provider echo exists. When a completed follow-up has both Relay's provisional receipt and a later provider echo, the conversation keeps only the provider event and shows its delivery-time notice. See [[terminal-conversation-filters]].

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

Focused coverage proves direct Codex delivery, live Codex steering, Claude Execute delivery with attachments, fresh Claude initialization, isolated Claude planning stages, the extra verification pass, process cleanup guidance, and idempotent decoration. The focused provider set passes 327 tests. The complete repository suite passes 1,577 tests with no failures, skips, or cancellations, `release:check` is green for v0.2.14, and `git diff --check` is clean.

> [!note]
> This is backend behavior. A running CC Relay process must be restarted normally before newly dispatched turns receive the notice.

See [[task-history]], [[same-task-session-continuation]], [[claude-terminal-input]], and [[terminal-input-attention]].

#relay #prompts #non-interactive #verification #claude #codex #process-cleanup
