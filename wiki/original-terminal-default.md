---
name: Original Terminal Default
description: In-app original terminal screen, task-scoped reads, and retained conversation input.
type: architecture
tags: [relay, terminal, macos, renderer]
---

# Original Terminal Default

> [!warning]
> Superseded by [[embedded-original-terminal]]. The read-only mirror described below did not satisfy the requirement for the actual interactive CLI inside Relay. It remains only as compatibility for previously launched external sessions. New task terminals use a real PTY and direct keyboard input. Unavailable terminals no longer switch automatically to the event ledger.

As of September 5, 2026, **Original terminal** displays the task's actual terminal screen inside CC Relay. **Show original terminal** opens the existing [[terminal-window]] dialog, with the screen and the same continuation composer inside it. In the expanded dialog that button becomes **Refresh screen**. Selecting a task, selecting a view, and refreshing never request an OS foreground action.

> [!important]
> This corrects the earlier September 5 native-window handoff. The operator explicitly requested the terminal inside CC Relay. The historical implementation and its Windows console ownership work remain documented in [[original-terminal-review]]. Do not reconnect the renderer to `/terminal/open`.

The screen uses the exact original Terminal.app tab contents, not reconstructed Relay events. Terminal.app still owns the running CLI and its PTY. This is a read-only screen with Relay's existing task-scoped follow-up and live-update composer, not a second terminal emulator or a new provider conversation. Raw CLI keyboard shortcuts and menus remain outside the embedded screen.

## Renderer behavior

`terminalMode` still defaults to `native`, with `activity` restoring the event ledger. `terminalWindowView` keeps `all` for Original terminal and `activity`, `conversation`, `mine`, and `ai` for structured views. Preferences retain the shared-record and local-cache contract in [[durable-ui-layout-preferences]].

- Screen requests use `GET /api/tasks/:id/terminal-screen`, optionally with a conversation `threadId` after an explicit workflow choice. The renderer never sends a native window handle or PID.
- Exactly one timer and one pending request belong to the selected visible screen. Successful reads schedule the next poll after one second; failed or connecting reads retry after five seconds. Hidden documents, hidden task panels, and other views abort the fetch and cancel the timer. A terminal chooser waits for the operator.
- Automatic direct-task reads resolve the current saved conversation again, so a retry can acquire a fresh terminal. Only an explicit council or worker selection pins a conversation.
- Late responses cannot update a different task, selected terminal, or view. A failed refresh keeps the last proven screen marked **Last screen · reconnecting**. A first failure shows the activity fallback.
- Screen output is bounded to 250,000 characters and assigned with `textContent`. Active text selection defers DOM replacement. Manual scroll remains stable; a reader at the bottom follows changing output. Opening and closing the dialog restore both native scroll axes through the existing dock record.
- **Copy screen** copies the displayed screen. Activity and message views retain **Copy log**. The continuation form is never hidden just because the original screen is selected; its existing provider and session availability rules still apply.

## Task and native ownership

`TaskOriginalTerminal.read()` uses `taskTerminalCandidates()` and launcher ownership for direct tasks, both council providers, and Turbo planner/workers. It rejects headless OpenCode and headless Claude companion windows. Multiple owned conversations require a choice and stay selectable after a successful read.

Task project, provider, mode, conversation membership, launch ID, and HTTP request liveness are checked before and after reading. `ProjectLauncher.readTerminalScreen()` verifies the tracked launch, window, and TTY, and the native JXA read verifies one tab and its exact TTY in the same read operation. The launcher's post-read comparisons use a captured identity, so mutating the tracked window or TTY in place cannot make stale output pass verification.

> [!note]
> macOS currently supplies native screen reads. Windows and Linux, missing identities, closed terminals, and headless executions use the in-app activity fallback. The legacy native opener endpoint and its Windows safeguards remain for older clients, but the current renderer has no call to that route.

## Layout gotcha

The native dialog contains three visible rows: screen, composer, and status. The inline surface adds its toolbar and therefore needs four. The later inline grid rule must include `:not([data-terminal-window="open"])`; otherwise it competes with the docked rule and assigns the flexible row to the composer, squeezing its text box out of view. A screenshot inspection found this after initial geometry checks incorrectly accepted the outer form's `display: grid`. The corrected Electron check measures the textarea itself.

## Verification

See [[in-app-terminal-review]] for the final review, focused ownership and renderer tests, full repository gates, Electron screenshots, and process cleanup. The renderer smoke uses synthetic provider data in an isolated actual Electron window, and starts no provider task.

## Files

- `public/app.js`, `public/index.html`, `public/style.css`: in-app screen, polling, copy, composer, and modal layout.
- `src/task-original-terminal.mjs`, `src/server.mjs`: task-scoped screen selection and bounded route.
- `src/project-launcher.mjs`: immutable native identity comparisons after reads.
- Terminal-window, original-terminal, native-screen, and project-launcher tests: async, ownership, selection, layout, and fallback regressions.
