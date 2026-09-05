---
name: Embedded Original Terminal
description: Task-owned interactive CLI terminals hosted inside Relay using a PTY and xterm.js.
type: architecture
tags:
  - relay
  - terminal
  - electron
---

# Embedded Original Terminal

> [!important]
> **September 5: finished tasks now reveal Conversation when their terminal is gone.**
> The terminal pane always fills the remaining height, with no draggable height separator or
> inset card. Retained live terminals stay visible. See [[terminal-review-full-height]].

> [!important]
> The previous [[original-terminal-default]] change was insufficient. Reading Terminal.app contents into a `pre` was a read-only mirror, and saved activity preferences could still select the event ledger. The operator requires the CLI's actual interactive session inside Relay, including its own composer and keyboard controls.

## Launch and execution

`DisposableTerminalPool` supplies the persisted task ID when it launches a terminal. `ProjectLauncher` uses `EmbeddedTerminalHost` for those task-owned Codex and Claude launches. No Terminal.app, conhost window, Apple Event, or native foreground action is involved in that launch. The host uses node-pty, backed by Unix PTYs on macOS and ConPTY on Windows. A login shell retains the existing CLI command and PATH behavior and remains available for Claude's guarded settings restart.

Codex keeps its per-launch remote app-server reservation and exact conversation binding. The UI is the actual Codex TUI connected to that server, not a reconstruction from app-server notifications. Claude keeps its real interactive process and transcript/hook execution path. Its discovered PID must descend from the exact live PTY shell before the executor can use it. First-launch settings remain tied to the first verified provider PID. Native terminal identities retain their old verification path for compatibility.

Before a conversation is registered, the task can attach to a temporary `launch:<uuid>` target. That target requires the exact persisted task ID, provider, project, live owned launch, and queued/running state. It stays valid through provider registration until the pool saves the task assignment. The socket then accepts one transition to the persisted conversation while keeping every other ownership field fixed. The renderer keeps the same terminal instance and socket for the exact task and launch, so registration does not hide or recreate the terminal. The startup address remains resolvable only through that task's current targets and the exact launch. This exposes the CLI's own trust and login screens. The embedded binding window is 60 seconds; a timeout remains an execution failure, not permission to type into an arbitrary terminal. See [[terminal-startup-continuity]].

> [!important]
> Every pool path that saves a task conversation must immediately call `ProjectLauncher.confirmTaskTerminalBinding()` for its exact allocation. Provider binding alone is too early: a Plan council can wait for its second provider before saving either conversation. Once confirmed, the pending target cannot bypass a later task reassignment. Bound PTYs also require the launching task's exact ID. Turbo candidates include the saved planner, executor, and Claude council conversations.

## Rendering and input

`public/embedded-terminal.js` attaches xterm.js directly to `/api/tasks/:id/terminal` over a same-origin WebSocket. Output is the PTY's original VT stream, preserving colors, cursor positioning, alternate buffers, and interactive editing. Keystrokes and binary mouse reports go to that same PTY. Resize events change its real rows and columns. Relay's continuation composer is hidden for this interactive surface; the provider's own composer accepts input.

> [!important]
> Keep terminal padding on `.embedded-terminal .xterm`, not on `.embedded-terminal`. The fit addon reads the outer container's computed size and subtracts only the xterm element's padding. Padding on the outer border box advertises more columns and rows than are visible, clipping long output at the right edge and leaving insufficient space for the final row. Desktop insets remain 16px by 18px; compact insets remain 4px. See [[terminal-long-output-review]].

The legacy `.xterm-viewport` background is transparent so those insets show the container's active theme. Xterm's current scroll surface supplies the terminal cell background; leaving the legacy viewport's default black fill produces a black border in light mode.

`scripts/verify-terminal-rendering.cjs` runs the full renderer in isolated Electron against the production terminal host and WebSocket bridge with a synthetic PTY. It checks long paragraphs, paths, Unicode, blank lines, exact text after reflow, light/dark desktop and compact geometry, docking, reconnecting, manual scroll during new output, app zoom, and repeated resizes. It saves screenshots and measurements, exits nonzero on failure, and closes its window, sockets, host, and HTTP server. It never submits provider work or attaches to an existing session.

The host keeps a bounded headless xterm buffer and serializes its terminal state for reconnects. This is terminal emulation, not provider UI emulation. Device query replies come from the host even when no view is attached; the browser suppresses duplicate replies. Output parsing applies backpressure. The socket limits payloads, input rate, and queued output. One renderer controls a launch at a time. A second view detaches the first without stopping the CLI.

Closing the expanded dialog reparents the same terminal into the task panel. Switching to Relay activity, Conversation, My messages, or AI messages disconnects only the view. The CLI keeps running, and returning restores its terminal state. Hiding the page also disconnects the view. Task cancellation, terminal close, and application shutdown retain exact ownership cleanup; shutdown waits for the PTY process to exit. Embedded terminals end when their owning app exits, including retained terminals.

## Ownership boundary

The HTTP screen endpoint discovers terminal metadata, but does not launch a replacement process. The WebSocket requires a matching loopback Origin and Host on the server's actual port. The task, project, provider, conversation, and launch are rechecked before output or input and while idle. No renderer-supplied executable, native handle, PID, or TTY is accepted. Rebinding, deletion, or loss of ownership closes the socket. This prevents a stale pane from typing into a different task.

The server uses an explicit allowlist for local xterm assets. No CDN, renderer framework, bundler, or configuration environment variable was added. node-pty uses its N-API build; its native assets are unpacked from Electron's ASAR. `scripts/prepare-pty.mjs` restores the executable bit missing from the npm package's macOS `spawn-helper` prebuild before packaging.

## Compatibility and limits

- The behavior applies to newly launched task terminals, including manual-completion task sessions and workflow workers. The older explicit project launcher and already running external terminals keep their native ownership path.
- Existing external Terminal.app sessions cannot be safely moved into a new PTY. They are labeled as a legacy read-only screen. Restart the updated app and create a new task session to use the interactive terminal.
- OpenCode's current runner and any Claude headless fallback have no original interactive TUI. They report that explicitly. The operator can choose Relay activity and message filters, and finished tasks without a terminal automatically show Conversation for review.
- Every different selected task first checks Original terminal; finished tasks without one switch to Conversation. An explicit view choice remains in effect during refreshes of that same task. Old saved activity preferences cannot override a new task's default.
- macOS receives real CLI and Electron verification. Windows uses the ConPTY implementation and focused platform contract tests; it has not been tested on Windows hardware.

See [[embedded-terminal-review]], [[claude-launch-settings]], [[terminal-window]], and [[terminal-conversation-filters-review]]. The upstream implementations are documented by [node-pty](https://github.com/microsoft/node-pty), [xterm addons](https://xtermjs.org/docs/guides/using-addons/), and [the serialize addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize).
