---
name: Embedded Terminal Review
description: Adversarial review and real CLI verification of the task-owned PTY inside Electron.
type: review
tags: [relay, terminal, electron, review]
---

# Embedded Terminal Review

## Executive Summary

**Ticket confidence: High for new macOS Codex and Claude task sessions.** The actual CLI now runs in an owned PTY, displayed and controlled through xterm.js inside Relay. This supersedes [[in-app-terminal-review]], whose read-only mirror did not meet the requested behavior. [[embedded-original-terminal]] records the complete contract and compatibility boundaries.

Validation on September 5, 2026 includes 2,001 passing repository tests, release metadata validation for 0.2.37, and clean whitespace checks. Actual installed Codex ran inside an isolated Electron window using the production host, launcher, task resolver, and WebSocket bridge. Direct keystrokes changed that same CLI's composer; Backspace edited it. Resizing, Escape, dark/light 1600/380 layouts, docking, all message filters, and reconnecting retained the same launch and conversation. No external window endpoint was called and no provider turn was submitted. A separate actual Claude CLI launch proved interactive session discovery, descendant PID verification, and unsent terminal input.

The extra pass fixed Unicode paste chunk boundaries, protected CLI Escape from the dialog's default close action, and removed stale instructions to use a Relay composer that is hidden in an interactive terminal. A real-time 30 ms test fixture was also made deterministic with its existing mock clock after parallel load consumed its evidence window.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Real Codex and Claude processes accept input in their owned PTYs. Codex Electron verification covers direct keys, resize, reconnect, and view switching. |
| Regression risk (UI / backend / contracts) | Green | The existing native path remains for legacy sessions. Existing queue, Claude executor, launch, ownership, startup, and terminal window suites pass. |
| Gap risk (edge cases, error handling, completeness) | Amber | Existing native sessions cannot be moved safely; OpenCode remains headless; Windows has contract coverage without hardware verification. These limits are explicit. |
| Code quality (maintainability as safety) | Green | Transport, renderer, and WebSocket access are isolated modules. Provider execution retains existing settings, transcript, and session binding logic. |
| Unit tests | Green | Real OS PTY tests verify ANSI snapshots, raw keys, resize, ancestry, reconnect, and process exit. Socket tests cover origin, stale identity, duplicates, and competing views. |
| Performance & scalability | Green | Bounded scrollback, parser backpressure, bounded frames/input/output queues, and one active renderer per launch. No screen polling for an attached PTY. |

## Top 3 Risks

1. **Terminal ownership changes during attachment.** `TaskOriginalTerminal.connection` and `terminal-websocket.mjs` recheck the exact task/project/provider/session/launch on output, input, and idle ticks. A changed identity closes the socket. Pending startup identities belong only to their persisted launching task and expire at binding.
2. **A second provider process is mistaken for the launched Claude process.** `EmbeddedTerminalHost.ownsProcess` proves ancestry from the live PTY shell, and `ProjectLauncher.resolveEmbeddedClaudeTerminal` retains the original PID latch for launch settings. The executor's existing pre-injection checks and no-double-delivery behavior remain active.
3. **Compatibility is mistaken for complete platform migration.** A legacy external terminal is explicitly read-only. New task sessions must be started by the updated app. Windows ConPTY is wired and tested through platform contracts, but the review does not claim Windows hardware validation or an OpenCode TUI.

## Top Improvements

Add Windows hardware verification for startup, native helper packaging, paste, resize, and shutdown before advertising full Windows validation. A future OpenCode interactive transport requires a real provider session attachment, not a rendering of its JSON event stream. Keep first-run CLI dialogs available through the pending task terminal so unknown prompts remain operable without broad automatic acceptance.

## Recommendation

**Ship with Mitigations.** Apply the change through an updated app and start new task sessions. Preserve already running native sessions; do not cancel or duplicate them to migrate their display. Retain the documented headless and Windows verification limits.

## Confirmed Issues

Resolved during implementation:

- Task selection could restore an old activity preference. `selectTask` now defaults each different task to its original terminal without overriding choices during refreshes of the same task.
- A missing original terminal silently substituted Relay events. `syncTerminalWindowSurface` now keeps an explicit unavailable state until the operator chooses activity.
- The npm node-pty prebuild lacked execute permission on macOS `spawn-helper`. The postinstall preparation restores that bit before packaging; native assets are unpacked from ASAR.
- Startup dialogs had no task-visible session before conversation binding. The exact task-owned temporary launch target now exposes that CLI and retires upon binding.

No unresolved high-confidence regression was found in the implemented macOS task path.

## Suspected Issues & Edge Cases

An interactive provider can display its first frame before its input handlers settle. The Claude smoke check reproduced this with the current first-run trust dialog; the successful check waited for startup, selected the exact test workspace, and confirmed it. Relay's existing strict trust classifier deliberately does not approve an unknown dialog layout. The original terminal remains directly operable while startup is pending.

Network closure during a paste has the usual terminal ambiguity: input already sent cannot be rolled back. The renderer never automatically replays input after reconnecting. Terminal output is untrusted VT data; no hyperlink or clipboard escape addon is installed, and it is never inserted as HTML.

## Regression Risks

Task-owned launches now run inside the app instead of a separate native window. Their PTYs end with their owning app, including retained terminals. Existing native project launches preserve their previous behavior. Claude settings restarts still use the same terminal, and Windows relaunch commands now use cmd quoting. The activity composer is hidden only for an interactive original terminal; conversation filters retain it.

## Performance Risks

Host state is bounded by 2,000 scrollback rows per terminal and validated dimensions capped at 500 by 250. Snapshot creation is linear in the bounded terminal buffer and occurs only on attachment. Live work is proportional to output bytes. Task authorization queries occur only for attached views, not every background terminal. Slow clients are disconnected instead of accumulating unbounded queued output.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for the implemented macOS transport and ownership changes. Existing executor suites exercise delivery and settings behavior, while new tests cover the actual PTY and socket boundary. Hardware tests remain missing for Windows, and no live provider model turn was submitted during verification. That distinction is deliberate: the live checks prove terminal identity and input, while existing executor tests cover task submission and completion.

## Positive Improvements

The UI is driven by the provider's own CLI, so new provider menus and editing behavior do not require Relay to reproduce them. Input and output use one exact owned process, and switching display modes cannot launch a duplicate conversation. The old read-only mirror is identified honestly, and activity is an explicit operator choice.

Local verification artifacts are under `/tmp/relay-pty-qa/`: `electron-extra.log`, `claude-smoke.log`, `pty-inline.png`, `pty-reconnected.png`, and dark/light desktop/compact screenshots. The test Electron windows, PTYs, proxy servers, and CLI processes were shut down. Existing long-lived application servers were left untouched.
