---
name: Original Terminal Default
description: Native CLI window handoff on macOS and Windows, with retained Relay activity and conversation filters.
type: architecture
tags: [relay, terminal, windows, macos, renderer]
---

# Original Terminal Default

As of September 5, 2026, the inline task surface defaults to **Original terminal**. Explicitly selecting a task or this view foregrounds the existing native CLI window. **Show original terminal** brings it back again. The expanded [[terminal-window]] offers the same handoff, **Relay activity**, **Conversation**, **My messages**, and provider-derived AI messages. **Use Relay activity** restores the current event console and continuation composer. Draft text and attachments survive surface changes.

The original window remains outside Electron, with its real CLI input, keyboard shortcuts, menus and terminal behavior. Relay does not emulate the CLI, send keystrokes when opening it, or create a second conversation. The old renderer text mirror and its 700 ms screen poll were removed. The read-only `/terminal-screen` endpoint remains for compatibility with older renderers.

> [!important]
> **Availability is about the actual execution.** OpenCode uses a headless runner, and Claude execution on Windows also runs headlessly. These tasks use the activity fallback. A headless Claude turn on macOS also falls back. Relay must never present an idle companion CLI window as the terminal doing that headless work. Closed, unowned, ambiguous, or unsupported windows also show recorded activity and messages without launching a replacement.

## UI state and refresh

`terminalMode` is `native` by default and `activity` after an inline activity or message filter is chosen. It rides the existing shared UI preference record and local cache. Old records default to native. `terminalWindowView` independently remembers the expanded view: legacy `all` still means Original terminal, the new `activity` means all Relay events, and the three message views keep their IDs.

The task-load path takes `openOriginal`. Explicit user selection defaults it to true; background snapshots pass false. Rendering and SSE refresh never focus a terminal. Selecting a different task, switching away, or closing the window invalidates an outstanding result and aborts the fetch. The endpoint checks whether the response is still connected before a queued native action. An OS action already issued cannot be undone by aborting its HTTP request.

A failed open leaves Original terminal selected with a short fallback explanation above the live event ledger. It never leaves the task on a blank unsupported screen. The original preference survives a temporary failure. Multi-terminal workflows receive a task-scoped chooser; its DOM stays stable during background refresh so keyboard focus is preserved.

The live event section and toolbar still move into and out of the modal, following the two-slot dock and focus rules in [[terminal-window]]. Message counts and role classification remain owned by [[terminal-conversation-filters]]. The original view hides the Relay composer with a CSS class, preserving its draft and attachment state.

## Ownership and backend contract

`POST /api/tasks/:id/terminal/open` accepts only an optional conversation `threadId`. The server never accepts a native window handle or PID from the browser. `TaskOriginalTerminal` enumerates only persisted task conversations, including the Codex and Claude council columns and Turbo planner/workers, then intersects them with current launcher ownership. Multiple candidates require a choice instead of choosing the selected terminal or guessing a project match.

The task, project, provider, conversation membership, launch ID and request liveness are rechecked immediately before the OS action. The native opener runs on the launcher's existing serialization queue so it cannot race an owned local close or launch.

| Platform | Native operation and evidence |
| --- | --- |
| macOS | Resolve the provider process again, require the tracked Terminal.app window and TTY, reject foreign runtime ownership, then verify one tab and its TTY in the AppleScript that restores and activates that window. No beep, repositioning or input. |
| Windows | New launches explicitly start a separate `conhost.exe` containing `cmd.exe /k <CLI>`. Capture host PID plus creation time as decimal FILETIME text. Opening retains a process handle, validates creation time, requires its actual window, verifies that window's owner PID, restores it and checks foreground success. |

> [!note]
> Windows Terminal can put several sessions in one window, and a pseudoconsole's `GetConsoleWindow` handle may have no visible UI. A shared window or PID alone cannot identify the task's tab. Dedicated console hosts avoid guessing. See Microsoft's [console definitions](https://learn.microsoft.com/en-us/windows/console/definitions) and [GetConsoleWindow contract](https://learn.microsoft.com/en-us/windows/console/getconsolewindow). The CLI inside remains the installed original program.

Windows opening rejects old in-memory launches without a birth timestamp, missing native handles, recycled PIDs, and denied foreground requests. These use the normal activity fallback. The existing [[windows-compatibility]] smoke gate still applies. Linux keeps the structured fallback.

## Verification and gotchas

The deterministic tests cover both OS invocations, creation-time guards, provider/project/conversation binding, stale task and launch replacement, a cancelled request, council selection, Turbo deduplication, headless fallbacks and preference persistence. An isolated actual Electron renderer verified inline native handoff, all three message filters, fallback escaping, draft preservation, modal restoration, dark/light themes and 1600/380 widths.

The first visual pass found that the native inline grid inherited an automatic minimum column width from the status bar, expanding a 462 px pane to 754 px. `grid-template-columns: minmax(0, 1fr)` on native/fallback sections and a bounded notice column fix it. The repeat measured the pane and all native children at 462 px, with the fallback message list remaining over 500 px high at both tested modal widths.

A live macOS smoke check created one empty, minimized Terminal.app window and successfully restored and foregrounded that exact window through `openNativeTerminal`. Cleanup verified the test shell's PID, start time, TTY and idle window before closing it. Shell startup can overwrite a tab's custom title; never use a title alone as cleanup ownership evidence. No real provider task or live user terminal was changed for QA.

Windows behavior is covered by simulated win32 tests, not a native Windows run. No package versions, dependencies, project environment variables, or execution-provider modes changed. See [[original-terminal-review]] for the final audit and validation totals.

## Files

- `src/native-terminal-opener.mjs`: bounded OS foreground operations.
- `src/task-original-terminal.mjs`: task-scoped target selection and fallback outcomes.
- `src/project-launcher.mjs`: launch ownership, Windows process birth capture and guarded opening.
- `src/server.mjs`: capability and task endpoint.
- `public/app.js`, `public/index.html`, `public/style.css`: native handoff, activity/message switches and compact layout.
- `src/ui-preferences.mjs`: additive preference and expanded activity view.
- `test/original-terminal.test.mjs`, existing launcher/window/style/preference/composer suites: regression checks.
