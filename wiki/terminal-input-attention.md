---
name: Terminal Input Attention
description: Native macOS centering and sound behavior when Claude or Codex asks for user input.
type: behavior
---

# Terminal Input Attention

> [!important]
> When a CC Relay-driven Claude or Codex turn requests user input on macOS, CC Relay now re-verifies the exact native Terminal.app window, centers that window on its current display without resizing it, restores and fronts it, and plays one system alert sound.

## Trigger contract

Claude uses the existing [[claude-terminal-input]] state transition. After a turn has produced transcript bytes, sustained idle without a final assistant record emits `claude/input-required`. `ClaudeTerminalExecutor` requests native attention once for that pause. If Claude becomes busy and later pauses again, the new pause may request attention again.

Codex requests attention when its app-server client receives either supported user-input server request:

- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

The Codex protocol replies remain unchanged. CC Relay still returns `{ answers: {} }` for tool questions and `{ action: "cancel" }` for MCP elicitation. Native attention is a side effect and does not invent an answer or change approval behavior.

## Native safety contract

`ProjectLauncher.requestTerminalAttention()` accepts the connected provider thread, not a front-window guess.

1. The thread must already be bound to a CC Relay-owned or runtime-recovered terminal.
2. `TerminalRuntimeResolver` resolves the live provider process again. Claude uses its current session pid. Codex uses the exact proxy socket client and process.
3. The resolved process must map to the tracked Terminal window, one exact TTY, and one tab.
4. CC Relay reads that exact window's current bounds and selects the visible display with the greatest overlap.
5. The new bounds preserve width and height while centering the window in that display's visible frame.
6. The final AppleScript checks the same window id, tab count, and TTY again, plays one alert, restores the window, applies the centered bounds, moves it to Terminal index 1, and makes it frontmost.

> [!warning]
> Never replace this with `front window`, a stale TTY, or a provider-only project match. macOS can recycle Terminal window and TTY identities. An unverifiable identity skips attention and records a diagnostic without moving any window.

The native action is best effort. Claude transcript monitoring does not await it, so a slow or blocked AppleScript cannot pause task completion, cancellation, or input-resume detection. Native display queries and attention actions are bounded.

## Diagnostics

- `task.codex.input_requested`
- `terminal.attention.completed`
- `terminal.attention.skipped`
- `terminal.attention.failed`

Skip reasons distinguish an unowned terminal, unsupported platform, disconnected Codex thread, and unverified runtime identity.

## Platform boundary

This behavior currently targets macOS Terminal.app, which is the visible terminal execution path used on this machine. Windows and other platforms skip native centering. A future Windows implementation must preserve the same exact-process and fail-closed identity contract.

## Files and verification

- `src/project-launcher.mjs`
- `src/claude-terminal-executor.mjs`
- `src/claude-execution-runner.mjs`
- `src/codex-app-server.mjs`
- `src/server.mjs`
- `test/project-launcher.test.mjs`
- `test/claude-terminal-executor.test.mjs`
- `test/codex-app-server.test.mjs`
- `test/composer-workflows.test.mjs`

The full Node suite passes 727 tests. Focused tests prove centering, size preservation, restore and front behavior, one alert command, identity mismatch refusal, nonblocking Claude monitoring, both Codex request types, and unchanged Codex fallback responses. The generated AppleScript also compiles with `osacompile`.

> [!note]
> This is backend behavior and needs a normal CC Relay restart. The implementation session found active tasks on the running backend, so it deliberately did not restart or interrupt them.

See [[terminal-input-attention-review]], [[claude-terminal-visibility]], [[terminal-close-review]], and [[diagnostics]].

#relay #terminal #attention #claude #codex #macos
