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

The shortcut label is **Run now**. Ctrl+Enter submits the composer as a priority task. Relay assigns it a queue position before every task that is still waiting and starts it immediately on an available Relay. If its assigned Relay is already active, it waits without interrupting that work. Enter keeps normal append-to-queue behavior, and Shift+Enter inserts a newline. The three shortcut hints render as separately spaced groups rather than one dot-separated sentence.

The client sends `runNow: true`, `TaskQueue.enqueue()` records a priority event, and `RelayDatabase.createTask()` chooses a position below the current minimum queued position. This applies consistently to Execute, Plan council, and Forward-planning turbo.

## Terminal assignment

Queued Codex execute tasks can move to another connected terminal in the same workspace. Each task card exposes an **Assign** control when another eligible terminal exists, and the same task can be dragged onto a numbered Relay terminal card. Running, completed, Plan council, Turbo, and Claude tasks cannot be reassigned.

The server validates the task status, provider, mode, live terminal connection, and normalized workspace path before changing `thread_id`, `thread_name`, and `thread_source`. It also updates the persisted task artifact and records a queue event.

> [!important]
> Reassignment never moves work to another workspace and never interrupts a running task.

The composer offers **Use an idle Relay when available** above the terminal list. This preference is stored under `relay.preferIdleTerminal`. For direct Codex execution, the selected terminal remains the route when it is idle. When it is active, Relay uses the first idle Codex terminal in the current workspace.

Direct Codex tasks execute concurrently across distinct Relay terminals and sequentially within each terminal. Claude execution, Plan council, and Turbo remain exclusive queue entries because their runners manage provider-wide or multi-terminal state. An exclusive entry at the head of the waiting queue starts only after active direct Codex tasks finish, and later direct tasks do not jump past it.

Queue status exposes both the backward-compatible `activeTaskId` and the complete `activeTaskIds` list. Cancellation is addressed by task ID so stopping work on one Relay does not interrupt another Relay.

#relay #tasks #history #persistence #sqlite
