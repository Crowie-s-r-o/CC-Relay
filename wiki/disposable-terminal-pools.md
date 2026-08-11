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

New CC Relay work uses a per-project disposable terminal pool. The composer chooses a provider and project, not an already open terminal. When the task reaches a runnable queue position and capacity is available, CC Relay opens the required native Claude or Codex terminal windows, binds each launch to the session that appeared from it, runs the work, and closes those exact windows when the task reaches a terminal outcome.

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
6. By default, `DisposableTerminalPool.release()` closes every exact CC Relay-owned native launch in reverse order, whether the task completed, failed, was cancelled, or CC Relay interrupted it.
7. When the task snapshots `keep_terminal_open = true`, the final prepared launch is promoted through `DisposableTerminalPool.retain()` instead. It leaves pool capacity and bulk shutdown cleanup without losing exact ownership. See [[retained-terminal-sessions]].

> [!important]
> On macOS, opening a Terminal.app window and sending its provider command are separate steps.
> `ProjectLauncher` first opens an empty tab and waits for that exact tab's shell-ready `busy`
> transition before sending Claude or Codex input. If startup does not settle within the bounded
> wait, no provider command is sent and the exact owned launch is returned for pool cleanup. This
> prevents slow Fish startup from consuming Return while leaving a long provider command held at
> the shell prompt. See [[claude-fable-reviewed-plan-execution]].

Cleanup uses `ProjectLauncher.closeOwnedLaunch(launchId)`, not a title, working directory, process-name search, or whichever session happens to have the same provider. CC Relay never closes a manually opened terminal as part of this lifecycle.

If exact native cleanup fails, the allocation remains counted. CC Relay records the failure and refuses to pretend that capacity was released. A later reconciliation drops the retained allocation only after the exact launch is no longer tracked.

Positive proof that the exact native target is already gone is a successful reconciliation, not a cleanup failure. On macOS, Terminal.app reporting that the tracked window ID no longer exists releases the launch. A missing tracked provider PID also allows cleanup to continue against the freshly verified exact window and TTY. On Windows, the equivalent missing `taskkill` target releases the launch. Identity changes, multi-tab windows, unreadable process state, permission failures, and TTY drain failures still keep the allocation counted. See [[terminal-close-review]].

Retention promotion follows the same fail-closed rule. If an exact launch cannot be promoted, its allocation remains counted. Automatic retry attempts are still released normally, and only the final attempt is retained.

## Provider requirements

`disposableTerminalRequirements()` computes the atomic capacity needed before a task may start:

- Direct Execute and Planner breakdown: one instance of the chosen provider.
- Execute Plan council: one Claude author instance and one Codex reviewer instance.
- Turbo without council: one Codex planner plus the configured Codex worker count.
- Turbo with terminal-driven council: the Turbo Codex fleet plus one Claude instance.

A task whose requirement is larger than the project's configured maximum is rejected when it is submitted. Lowering limits is also refused when it would strand a disposable task that is already queued.

Plan council and Turbo allocate their complete fleet before execution begins. Partial launch failure closes every launch that was already created for that task.

> [!important]
> A disposable Plan council is globally serialized against another Plan council or Turbo parent because `PlanCouncilRunner` still owns one council at a time. It is not a same-project drain barrier for disposable single-session work. A council may start beside running Execute or Planner breakdown tasks, and those tasks may start beside the council, when the combined atomic requirements fit the project's separate Codex and Claude limits. Legacy persistent councils keep the former project-draining barrier.

## Conversation resume

When a fresh task binds successfully, its persisted `thread_id` becomes the durable conversation ID. After the terminal closes, **Continue session** remains available for finished direct Claude and Codex tasks.

A continuation keeps the source task ID and first checks that the project has a free instance of the required provider. When capacity is available, CC Relay marks that same task running, opens a new native terminal, and runs:

```text
claude --dangerously-skip-permissions --resume <conversation-id> --model <model> --effort <effort> --settings <hooks>
codex resume <conversation-id> --dangerously-bypass-approvals-and-sandbox --cd <project> --remote ws://127.0.0.1:4769 -c check_for_update_on_startup=false
```

Every interactive Codex launch, fresh or resumed, ends with `-c check_for_update_on_startup=false`
so a pending Codex CLI release cannot stop the TUI on an update prompt before it dials `--remote`.
See [[codex-update-prompt-freeze]].

A direct Execute Claude launch, fresh or resumed, carries the queued turn's model and effort on
that first command, so the terminal opens already configured and `ClaudeTerminalExecutor` no longer
stops and relaunches the process the user just watched open. The skip requires a structured,
pid-bound record of what CC Relay itself launched; Plan council, Turbo, adopted terminals, and
interactive Launchpad launches keep the existing relaunch. See [[claude-launch-settings]].

The new terminal receives its own native launch ID while the provider conversation keeps its original ID. CC Relay binds and later closes the new launch independently. The follow-up prompt is runtime input only: the task's canonical `prompt` remains the original request, while the accepted follow-up is stored in that task's prompt history and event rail.

When the source task retained its terminal and that conversation is still connected and idle, **Continue session** reuses the exact live terminal instead of opening a resume launch. A manual retry does the same. Closing the retained terminal restores the ordinary resume behavior, and the replacement launch inherits the retention preference. See [[retained-terminal-sessions]].

Manual retry distinguishes a bound provider ID from a durable conversation. If a failed disposable task saved a Claude UUID but the first turn never created a transcript, CC Relay launches `claude --session-id <same-id>` instead of the impossible `--resume`. If a saved Codex thread never created a rollout, CC Relay opens a fresh Codex thread and persists its new ID. Only positive absence authorizes initialization or replacement. Present and unreadable state keep the resume path. An explicit **Continue session** always keeps resume semantics and never silently replaces missing context. See [[disposable-retry-conversation-initialization]].

Continuation submission is immediate and never waits in the queue. `TaskQueue.startFollowUp()` revalidates the source task, active task ownership, saved conversation reservations, and provider capacity synchronously before it changes the task. A busy conversation or full provider pool rejects with nothing launched and no new task. This prevents two terminals from resuming and mutating the same conversation concurrently when a project's maximum is greater than 1.

Running Codex retains live `turn/steer` behavior. Running Claude still waits for the current turn to finish before it can continue. Finished legacy persistent tasks retain the immediate same-terminal follow-up path.

`GET /api/tasks/:id` returns `prompts` separately from the bounded event window. The list starts with the canonical original request and adds CC Relay-marked finished-turn follow-ups and active-turn steering messages in order. This keeps every task prompt visible even after the terminal console exceeds its 500-event display window. See [[same-task-session-continuation]].

## Planner and reviewed-plan execution

Planner breakdown, refinement, flat queueing, and orchestrated plan runs use provider choices in automatic mode. Plan runs persist their terminal lifecycle and layout on `plan_runs`; each dependency-ready step is then enqueued without a preselected thread and receives its own disposable terminal.

Executing a completed reviewed plan works the same way. The user chooses Claude or Codex, CC Relay creates a linked Execute task in the original project, and the terminal exists only for that task.

## Compatibility

Existing task rows default to `terminal_lifecycle = 'persistent'`. Their stored assignments, manual terminal selection, idle routing, reassignment, and immediate same-session follow-up behavior remain available in the backend. This additive compatibility is required for task history and safe restart recovery.

The current composer creates disposable work whenever the backend advertises the capability. Refreshing static assets against an older in-memory backend keeps the legacy controls and does not send new lifecycle fields. A normal CC Relay restart activates the new pool.

## Files and coverage

- `src/disposable-terminal-pool.mjs`
- `src/project-launcher.mjs`
- `src/claude-launch-settings.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/queue.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `src/plan-run.mjs`
- `public/index.html`
- `public/app.js`
- `public/task-continuation-state.js`
- `public/task-prompt-history.js`
- `test/disposable-terminal-pool.test.mjs`
- `test/project-launcher.test.mjs`
- `test/terminal-launch-coordinator.test.mjs`
- `test/queue.test.mjs`
- `test/plan-run-integration.test.mjs`
- `test/task-continuation-state.test.mjs`
- `test/task-prompt-history.test.mjs`

See [[project-workspaces]], [[task-history]], [[planner]], [[plan-council]], [[claude-terminal-visibility]], [[claude-launch-settings]], and [[terminal-close-review]].

#relay #terminal #codex #claude #queue #continuation
