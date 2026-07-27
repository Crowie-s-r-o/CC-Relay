---
name: Disposable Terminal Pools
description: Per-project Claude and Codex instance limits, fresh task terminals, exact cleanup, and conversation resume.
type: architecture
tags:
  - relay
  - terminal
  - codex
  - claude
  - queue
  - continuation
---

# Disposable Terminal Pools

New Relay work uses a per-project disposable terminal pool. The composer chooses a provider and project, not an already open terminal. When the task reaches a runnable queue position and capacity is available, Relay opens the required native Claude or Codex terminal windows, binds each launch to the session that appeared from it, runs the work, and closes those exact windows when the task reaches a terminal outcome.

The left composer panel exposes **Codex max instances** and **Claude max instances** for the selected Launchpad project. Both default to 1 and accept whole numbers from 1 through 8. The values are stored on `projects.max_codex_instances` and `projects.max_claude_instances`. Capacity is project-local, so a running Codex task in one project does not consume another project's Codex limit.

`GET /api/status?projectPath=` advertises `capabilities.disposableTerminalPools`, `capabilities.resumableDisposableSessions`, and a `terminalPool` snapshot:

```json
{
  "repoPath": "/project",
  "limits": { "codex": 3, "claude": 2 },
  "active": { "codex": 1, "claude": 0 }
}
```

The renderer keeps the former live-terminal picker and launch controls only as compatibility UI for an older backend. A current backend hides those controls and shows the instance limits instead.

## Task lifecycle

Automatic tasks persist `terminal_lifecycle = 'disposable'` and their requested launch layout in `terminal_layout_json`. A fresh task starts with no `thread_id`. This is intentional and distinguishes a new conversation from a continuation.

The lifecycle is:

1. The queue checks the complete provider requirement against the selected project's limits and currently reserved work.
2. `DisposableTerminalPool.prepare()` launches each required provider through `TerminalLaunchCoordinator`.
3. Each launch receives a fresh native `launchId`. Codex binding uses the shared proxy's launch reservation. Claude binding uses the fresh session UUID, or the saved conversation UUID for a resume.
4. The bound conversation IDs and display names are persisted on the task before the runner starts.
5. The ordinary runner executes the task and persists its result, error, session ID, events, and artifacts.
6. `DisposableTerminalPool.release()` closes every exact Relay-owned native launch in reverse order, whether the task completed, failed, was cancelled, or Relay interrupted it.

Cleanup uses `ProjectLauncher.closeOwnedLaunch(launchId)`, not a title, working directory, process-name search, or whichever session happens to have the same provider. Relay never closes a manually opened terminal as part of this lifecycle.

If exact native cleanup fails, the allocation remains counted. Relay records the failure and refuses to pretend that capacity was released. A later reconciliation drops the retained allocation only after the exact launch is no longer tracked.

## Provider requirements

`disposableTerminalRequirements()` computes the atomic capacity needed before a task may start:

- Direct Execute and Planner breakdown: one instance of the chosen provider.
- Execute Plan council: one Claude author instance and one Codex reviewer instance.
- Turbo without council: one Codex planner plus the configured Codex worker count.
- Turbo with terminal-driven council: the Turbo Codex fleet plus one Claude instance.

A task whose requirement is larger than the project's configured maximum is rejected when it is submitted. Lowering limits is also refused when it would strand a disposable task that is already queued.

Plan council and Turbo allocate their complete fleet before execution begins. Partial launch failure closes every launch that was already created for that task.

## Conversation resume

When a fresh task binds successfully, its persisted `thread_id` becomes the durable conversation ID. After the terminal closes, **Continue session** remains available for finished direct Claude and Codex tasks.

A continuation creates a linked disposable queue task with `continued_from_task_id` and the same saved conversation ID. When capacity becomes available, Relay opens a new native terminal and runs:

```text
claude --dangerously-skip-permissions --resume <conversation-id>
codex resume <conversation-id> --dangerously-bypass-approvals-and-sandbox --cd <project> --remote ws://127.0.0.1:4769
```

The new terminal receives its own native launch ID while the provider conversation keeps its original ID. Relay binds and later closes the new launch independently.

Only one queued or running task may own a saved disposable conversation. The API checks this before enqueue, `TaskQueue.enqueue()` enforces it again after asynchronous route validation, retries enforce it, and the scheduler serializes duplicate legacy rows defensively. This prevents two terminals from resuming and mutating the same conversation concurrently when a project's maximum is greater than 1.

Running Codex retains live `turn/steer` behavior. Running Claude still waits for the current turn to finish before it can continue. Finished legacy persistent tasks retain the immediate same-terminal follow-up path.

## Planner and reviewed-plan execution

Planner breakdown, refinement, flat queueing, and orchestrated plan runs use provider choices in automatic mode. Plan runs persist their terminal lifecycle and layout on `plan_runs`; each dependency-ready step is then enqueued without a preselected thread and receives its own disposable terminal.

Executing a completed reviewed plan works the same way. The user chooses Claude or Codex, Relay creates a linked Execute task in the original project, and the terminal exists only for that task.

## Compatibility

Existing task rows default to `terminal_lifecycle = 'persistent'`. Their stored assignments, manual terminal selection, idle routing, reassignment, and immediate same-session follow-up behavior remain available in the backend. This additive compatibility is required for task history and safe restart recovery.

The current composer creates disposable work whenever the backend advertises the capability. Refreshing static assets against an older in-memory backend keeps the legacy controls and does not send new lifecycle fields. A normal Relay restart activates the new pool.

## Files and coverage

- `src/disposable-terminal-pool.mjs`
- `src/project-launcher.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/queue.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `src/plan-run.mjs`
- `public/index.html`
- `public/app.js`
- `public/task-continuation-state.js`
- `test/disposable-terminal-pool.test.mjs`
- `test/project-launcher.test.mjs`
- `test/terminal-launch-coordinator.test.mjs`
- `test/queue.test.mjs`
- `test/plan-run-integration.test.mjs`
- `test/task-continuation-state.test.mjs`

See [[project-workspaces]], [[task-history]], [[planner]], [[plan-council]], [[claude-terminal-visibility]], and [[terminal-close-review]].

#relay #terminal #codex #claude #queue #continuation
