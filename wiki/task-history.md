---
name: Task History Persistence
description: How Relay persists task records and exposes cross-project history after restart.
type: architecture
---

# Task History Persistence

Relay stores tasks, outcomes, and task events in the local SQLite database. Desktop builds keep the database under Electron's stable per-user application data directory, while `npm start` uses `.data/relay.sqlite` in the repository.

The apparent loss of older tasks after project workspace support was introduced was a presentation issue, not data loss. The queue list filtered tasks by the active project's exact working-directory path. Tasks created from a parent workspace therefore disappeared when a nested project was selected.

## Task scope control

The queue follows the selected live terminal session. Selecting another terminal immediately changes task cards and queue counts to tasks whose stored `thread_id` matches that session.

The queue heading also has a persistent task-scope toggle:

- **All history** shows tasks from every project and is the default after upgrade.
- **This session** restricts the list to the selected terminal session.
- **This project** is used as the fallback when no live session is selected.

The choice is stored in `localStorage` as `relay.showAllTaskHistory`. Selecting a live terminal switches back to **This session** automatically. Project selection continues to determine terminal and prompt workspace independently of the task-history scope.

> [!important]
> Do not duplicate task records into browser storage. SQLite remains the source of truth for prompts, status, results, events, and restart recovery. Browser storage holds only the display preference.

## Files

- `src/database.mjs`
- `src/server.mjs`
- `public/app.js`
- `public/index.html`
- `public/style.css`

## Parallel Codex batches

Queue task checkboxes can combine two or more waiting tasks into one command for the currently selected Codex terminal. Relay does not execute those tasks itself and does not route them through Claude. It creates one replacement Codex task whose prompt contains an ordered numbered list and explicit instructions to delegate independent items to sub-agents, wait for every result, verify the combined work, and return one consolidated summary.

The selected tasks must share the selected Codex terminal's workspace. Their image attachments are copied into the replacement task before the original queued records are removed.

> [!important]
> The selected terminal is the source of truth. Do not add a second terminal selector to the parallel batch bar or restore Claude-specific routing.

## Priority submission shortcut

Ctrl+Enter submits the composer as a priority task. Relay assigns it a queue position before every task that is still waiting. It starts immediately when the queue is idle, or becomes next when another task is already running. It never interrupts active work. Enter keeps normal append-to-queue behavior, and Shift+Enter inserts a newline.

The client sends `runNow: true`, `TaskQueue.enqueue()` records a priority event, and `RelayDatabase.createTask()` chooses a position below the current minimum queued position. This applies consistently to Execute, Plan council, and Forward-planning turbo.

#relay #tasks #history #persistence #sqlite
