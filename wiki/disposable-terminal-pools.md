---
name: Disposable Terminal Pools
description: Per-project Claude, Codex, and OpenCode limits, fresh execution, exact cleanup, and conversation resume.
type: architecture
tags:
  - relay
  - terminal
  - codex
  - claude
  - opencode
  - queue
  - continuation
---

# Disposable Terminal Pools

New CC Relay work uses a per-project disposable execution pool. The composer chooses a provider and project, not an already open terminal. When the task reaches a runnable queue position and capacity is available, CC Relay opens the required native Claude or Codex terminal window and binds its conversation, or reserves a virtual OpenCode allocation and starts a headless native process. Relay releases the exact allocation when the task reaches a terminal outcome.

The left composer panel exposes **Codex max instances**, **Claude max instances**, and **OpenCode max instances** for the selected Launchpad project. All three default to 1 and accept whole numbers from 1 through 8. The values are stored on `projects.max_codex_instances`, `projects.max_claude_instances`, and `projects.max_opencode_instances`. Capacity is project-local, so a running provider task in one project does not consume another project's limit.

`GET /api/status?projectPath=` advertises `capabilities.disposableTerminalPools`, `capabilities.resumableDisposableSessions`, and a `terminalPool` snapshot:

```json
{
  "repoPath": "/project",
  "limits": { "codex": 3, "claude": 2, "opencode": 2 },
  "active": { "codex": 1, "claude": 0, "opencode": 1 }
}
```

The renderer keeps the former live-terminal picker and launch controls only as compatibility UI for an older backend. A current backend hides those controls and shows the instance limits instead.

## Task lifecycle

Automatic tasks persist `terminal_lifecycle = 'disposable'` and their requested launch layout in `terminal_layout_json`. A fresh task starts with no `thread_id`. This is intentional and distinguishes a new conversation from a continuation.

The ordinary single-session lifecycle is:

1. The queue checks the complete provider requirement against the selected project's limits and currently reserved work.
2. `DisposableTerminalPool.prepare()` launches each required Codex or Claude provider through `TerminalLaunchCoordinator`. OpenCode receives a virtual allocation without Terminal.app ownership.
3. Each terminal launch receives a fresh native `launchId`. Codex binding uses the shared proxy's launch reservation. Claude binding uses the fresh session UUID, or the saved conversation UUID for a resume. OpenCode reports its native session ID from the JSON event stream.
4. The bound conversation IDs and display names are persisted on the task before the runner starts.
5. The ordinary runner executes the task and persists its result, error, session ID, events, and artifacts.
6. By default, `DisposableTerminalPool.release()` closes every exact CC Relay-owned native launch in reverse order and releases every virtual OpenCode allocation, whether the task completed, failed, was cancelled, or CC Relay interrupted it.
7. When the task snapshots `keep_terminal_open = true`, the final prepared launch is promoted through `DisposableTerminalPool.retain()` instead. It leaves pool capacity and bulk shutdown cleanup without losing exact ownership. See [[retained-terminal-sessions]].

Automatic Turbo uses just-in-time stage launches instead of `prepare()` opening a fleet. Its lifecycle is:

1. The queued parent opens one fresh Codex planner with the selected planner model and effort.
2. The planner returns a valid graph, then `finishTurboStage()` closes or retains that exact planning launch.
3. The parent remains queued in `ready` state until an execution lane is free.
4. The running parent opens one different fresh Codex execution terminal with the selected execution model and effort.
5. The complete graph is sent once to that executor. It may use internal sub-agents, but no additional native worker terminal is created for the prompt.
6. The executor launch closes or is retained at its outcome. Its conversation ID is persisted as `turbo.executionThreadId` and can be resumed from Task Activity.

> [!important]
> On macOS, opening a Terminal.app window and sending its provider command are separate steps.
> `ProjectLauncher` first opens an empty tab and waits for that exact tab's shell-ready `busy`
> transition before sending Claude or Codex input. If startup does not settle within the bounded
> wait, no provider command is sent and the exact owned launch is returned for pool cleanup. This
> prevents slow Fish startup from consuming Return while leaving a long provider command held at
> the shell prompt. See [[claude-fable-reviewed-plan-execution]].

OpenCode does not use this native terminal startup path. `OpenCodeRunner` owns one detached headless
process group, streams newline-delimited JSON, and terminates that group on cancellation or bounded
stream failure. OpenCode cannot be retained as a terminal or converted to manual session mode. See
[[opencode-provider-and-token-throughput]].

Cleanup uses `ProjectLauncher.closeOwnedLaunch(launchId)`, not a title, working directory, process-name search, or whichever session happens to have the same provider. CC Relay never closes a manually opened terminal as part of this lifecycle.

If exact native cleanup fails, the allocation remains counted. CC Relay records the failure and refuses to pretend that capacity was released. A later reconciliation drops the retained allocation only after the exact launch is no longer tracked.

Positive proof that the exact native target is already gone is a successful reconciliation, not a cleanup failure. On macOS, Terminal.app reporting that the tracked window ID no longer exists releases the launch. A missing tracked provider PID also allows cleanup to continue against the freshly verified exact window and TTY. On Windows, the equivalent missing `taskkill` target releases the launch. Identity changes, multi-tab windows, unreadable process state, permission failures, and TTY drain failures still keep the allocation counted. See [[terminal-close-review]].

Retention promotion follows the same fail-closed rule. If an exact launch cannot be promoted, its allocation remains counted. Automatic retry attempts are still released normally, and only the final attempt is retained.

## Provider requirements

`disposableTerminalRequirements()` computes the reservation needed by a runnable task:

- Direct Execute: one instance of the chosen Codex, Claude, or OpenCode provider.
- Planner breakdown: one instance of the chosen Codex or Claude provider.
- Execute Plan council: every provider that still owns an unfinished checkpoint stage. A new council needs one Claude and one Codex instance. A final-revision-only resume needs only the original author provider.
- Automatic Turbo planning or execution parent: one Codex slot at a time.
- A Turbo council stage: one additional Claude slot only while Claude owns the active author or review stage.

A task whose requirement is larger than the project's configured maximum is rejected when it is submitted. Turbo applies an additional pipeline configuration check: the Codex maximum must fit one planning lane plus the selected number of concurrent execution lanes. Lowering limits is also refused when it would strand a disposable task that is already queued.

Plan council allocates both provider terminals before a new execution begins. On resume, it reconstructs `plan.json`, `draft.md`, and `review.md` before scheduling and launches only providers that still own unfinished stages. A saved draft plus review opens one fresh author terminal for revision and does not reopen the completed reviewer. Turbo opens only the stage that is about to run. A partial stage launch failure closes that exact launch before capacity is reported free.

If all three provider stages are checkpointed but the final project-local `plan.md` write failed, the council has a zero-provider requirement. It may run without pool capacity, launches no terminal, and retries only the canonical artifact write.

> [!important]
> A disposable Plan council is globally serialized against another Plan council or Turbo parent because `PlanCouncilRunner` still owns one council at a time. It is not a same-project drain barrier for disposable single-session work. A council may start beside running Execute or Planner breakdown tasks, and those tasks may start beside the council, when the combined atomic requirements fit the project's separate Codex and Claude limits. Legacy persistent councils keep the former project-draining barrier.

## Conversation resume

When a fresh task binds successfully, its persisted `thread_id` becomes the durable conversation ID. After the terminal closes, **Continue session** remains available for finished direct Claude and Codex tasks. A completed automatic Turbo task uses the same mechanism for its final execution conversation, never for its read-only planner conversation. OpenCode also persists its native session ID, but currently uses it only when the same task is retried and does not expose the interactive continuation dock.

A continuation keeps the source task ID and first checks that the project has a free instance of the required provider. When capacity is available, CC Relay marks that same task running, opens a new native terminal, and runs:

```text
claude --dangerously-skip-permissions --resume <conversation-id> --model <model> --effort <effort> --settings <hooks>
codex resume <conversation-id> --dangerously-bypass-approvals-and-sandbox --cd <project> --remote ws://127.0.0.1:4769 --model <model> -c model_reasoning_effort="<effort>" -c check_for_update_on_startup=false
```

Every interactive Codex launch, fresh or resumed, ends with `-c check_for_update_on_startup=false`
so a pending Codex CLI release cannot stop the TUI on an update prompt before it dials `--remote`.
See [[codex-update-prompt-freeze]].

A direct Execute Claude launch, fresh or resumed, carries the queued turn's model and effort on
that first command, so the terminal opens already configured and `ClaudeTerminalExecutor` no longer
stops and relaunches the process the user just watched open. Plan council also carries its complete
model, effort, plan permission, tool allowlist, and attachment directory settings on the first
process. The skip requires a structured, pid-bound record of what CC Relay itself launched;
Turbo, adopted terminals, and interactive Launchpad launches keep the existing relaunch. See
[[claude-launch-settings]].

A task-owned Codex launch also carries its selected model and reasoning effort on the first native command. Turbo uses this to make the planning terminal visibly match the planner settings and the later execution terminal visibly match the execution settings. The app-server turn still receives the same validated pair, so the terminal and task activity cannot disagree.

The new terminal receives its own native launch ID while the provider conversation keeps its original ID. CC Relay binds and later closes the new launch independently. The follow-up prompt is runtime input only: the task's canonical `prompt` remains the original request, while the accepted follow-up is stored in that task's prompt history and event rail.

When the source task retained its terminal and that conversation is still connected and idle, **Continue session** reuses the exact live terminal instead of opening a resume launch. A manual retry does the same. Closing the retained terminal restores the ordinary resume behavior, and the replacement launch inherits the retention preference. See [[retained-terminal-sessions]].

Manual retry distinguishes a bound provider ID from a durable conversation. If a failed disposable task saved a Claude UUID but the first turn never created a transcript, CC Relay launches `claude --session-id <same-id>` instead of the impossible `--resume`. If a saved Codex thread never created a rollout, CC Relay opens a fresh Codex thread and persists its new ID. Only positive absence authorizes initialization or replacement. Present and unreadable state keep the resume path. An explicit **Continue session** always keeps resume semantics and never silently replaces missing context. See [[disposable-retry-conversation-initialization]].

Continuation submission is immediate and never waits in the queue. `TaskQueue.startFollowUp()` revalidates the source task, active task ownership, saved conversation reservations, and provider capacity synchronously before it changes the task. A busy conversation or full provider pool rejects with nothing launched and no new task. This prevents two terminals from resuming and mutating the same conversation concurrently when a project's maximum is greater than 1.

Running direct Codex retains live `turn/steer` behavior. A Turbo executor must finish its complete graph before continuation becomes available. Running Claude still waits for the current turn to finish before it can continue. Finished legacy persistent tasks retain the immediate same-terminal follow-up path.

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
- `src/opencode-runner.mjs`
- `src/opencode-runtime-status.mjs`
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
- `test/opencode-runner.test.mjs`
- `test/opencode-runtime-status.test.mjs`
- `test/project-launcher.test.mjs`
- `test/terminal-launch-coordinator.test.mjs`
- `test/queue.test.mjs`
- `test/plan-run-integration.test.mjs`
- `test/task-continuation-state.test.mjs`
- `test/task-prompt-history.test.mjs`

See [[project-workspaces]], [[task-history]], [[planner]], [[plan-council]], [[opencode-provider-and-token-throughput]], [[claude-terminal-visibility]], [[claude-launch-settings]], and [[terminal-close-review]].

#relay #terminal #codex #claude #opencode #queue #continuation
