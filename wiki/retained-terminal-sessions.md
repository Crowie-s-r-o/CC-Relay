---
name: Retained Terminal Sessions
description: Project-configured automatic terminal sessions that stay open after task outcomes and CC Relay shutdown.
type: architecture
tags:
  - relay
  - terminal
  - session
  - queue
  - continuation
---

# Retained Terminal Sessions

CC Relay automatic terminal work still launches through the disposable pool, but the project terminal-retention switch defaults to disabled for every new project. The switch is available when the backend advertises `capabilities.retainedTerminalSessions`. For direct Execute work the renderer now labels it **Terminal session mode** and adds the explicit task lifecycle from [[manual-terminal-session-mode]]. Plan council and Turbo label the same persisted choice **Keep workflow terminals open** and retain only their automatic workflow terminals.

The project row stores the preference as `projects.keep_terminal_open`. It is never shared with another project. Each automatic task snapshots it as `tasks.keep_terminal_open`, so changing the project switch later cannot change a queued or running task. Planner breakdowns, selected proposals, plan runs, reviewed-plan execution, direct Execute, Plan council, and Turbo all carry the same preference. Plan runs persist it on `plan_runs` and copy it to every released step. A running task can separately latch its own retention through **Stop auto-close** without changing the project or any other task; see [[live-terminal-retention]].

> [!important]
> Retention is a launch lifecycle choice, not a change from automatic work to legacy persistent routing. The task still launches through [[disposable-terminal-pools]], receives an exact native launch ID, and binds its provider conversation before execution.

## Final-outcome lifecycle

After a successfully prepared automatic task reaches its final outcome:

1. `TaskQueue` chooses retention only when `keep_terminal_open` is true and no automatic retry is pending.
2. `DisposableTerminalPool.retain()` promotes every exact launch through `ProjectLauncher.retainOwnedLaunch()`.
3. The launcher clears `closeOnShutdown` and removes the native window or process from bulk shutdown cleanup.
4. The pool drops the task allocation without closing the terminal, so an idle retained window does not consume an active task slot.
5. Exact ownership stays in `ProjectLauncher`, allowing safe explicit close while the current CC Relay process remains alive.

CC Relay shutdown promotes prepared retained tasks before it asks their active turns to cancel. This closes the three-second shutdown timeout race where bulk terminal cleanup could otherwise kill a retained task before its executor settled. A terminal still preparing is not promoted because its native binding may be incomplete; normal preparation cancellation closes it instead.

> [!note]
> Retained windows survive CC Relay exit. After a later CC Relay start, the existing runtime-recovery path rediscovers exact one-tab terminal ownership with `closeOnShutdown: false`.

> [!warning]
> Retained idle windows do not count against project instance limits. A user who leaves the switch enabled can intentionally accumulate terminal windows. The interface tells the user to close native terminal windows when finished.

## Retry and continuation behavior

Automatic retry attempts remain disposable. A retryable failure closes that attempt, launches the next attempt normally, and retains only the final successful or terminally failed session. This prevents several failed attempts from accumulating windows.

For a finished direct task:

- **Continue session** first checks whether its retained conversation is still connected.
- A live idle retained conversation runs the next turn immediately in the same task row and exact terminal.
- If the user already closed the window, CC Relay relaunches the saved conversation under the same task ID and the new launch inherits `keep_terminal_open`.
- **Retry** also reuses a live idle retained direct terminal. It bypasses pool preparation so CC Relay never tries to open the same saved conversation twice.

Plan council and Turbo may retain several windows because their provider requirements are atomic fleets. Their direct terminal conversations stay visible in those native windows, while their workflow-level retry rules remain unchanged.

## Failure safety

Retention promotion is fail-closed. If CC Relay cannot prove and promote an exact launch, that allocation remains in the pool and continues consuming capacity. The task event stream records the failure. CC Relay never drops ownership, broadens the native target, or labels capacity free after an ambiguous promotion.

Partial launch or binding failure never retains a window. `DisposableTerminalPool.prepare()` first performs its existing exact cleanup, and the queue retains only when preparation completed successfully.

## Persistence and compatibility

The additive retention SQLite columns are:

- `projects.keep_terminal_open INTEGER NOT NULL DEFAULT 0`
- `tasks.keep_terminal_open INTEGER NOT NULL DEFAULT 0`
- `plan_runs.keep_terminal_open INTEGER NOT NULL DEFAULT 0`

Direct manual sessions add `tasks.manual_completion INTEGER NOT NULL DEFAULT 0`; see [[manual-terminal-session-mode]].

Project and task normalization expose the values as booleans. An older backend that does not advertise `retainedTerminalSessions` cannot retain task terminals, so refreshed renderer assets keep the switch disabled and do not send the new request field. A backend that has retention but lacks `capabilities.projectTerminalSettings` still applies the selected project's in-memory choice to new tasks immediately. Current backends also persist that choice.

## Files and coverage

- `public/index.html`, `public/style.css`, `public/app.js`
- `public/submission-intent.js`
- `src/database.mjs`
- `src/disposable-terminal-pool.mjs`
- `src/project-launcher.mjs`
- `src/queue.mjs`
- `src/plan-run.mjs`
- `src/server.mjs`
- `test/composer-workflows.test.mjs`
- `test/database.test.mjs`
- `test/disposable-terminal-pool.test.mjs`
- `test/plan-run-integration.test.mjs`
- `test/planner-database.test.mjs`
- `test/project-launcher.test.mjs`
- `test/queue.test.mjs`
- `test/submission-intent.test.mjs`

The complete suite passed at 764 tests on July 28, 2026.

See [[disposable-terminal-pools]], [[terminal-close-review]], [[automatic-retry-safety]], [[task-history]], [[session-tasks]], and [[manual-terminal-session-mode]] for the queue badge, kill action, paired conversation history, and explicit completion lifecycle built on this retention layer.

#relay #terminal #session #queue #continuation
