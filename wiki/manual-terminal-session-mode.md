---
name: Manual Terminal Session Mode
description: Direct automatic tasks that stay open across unlimited turns and complete only through Task Activity.
type: architecture
tags:
  - relay
  - terminal
  - session
  - queue
  - ui
---

# Manual Terminal Session Mode

**Terminal session mode** turns the selected project's retained-terminal choice into a durable workspace for new direct Execute tasks. The terminal and task stay open after every turn. The operator can send another command or request in the same task row and provider conversation as many times as needed, then press **Complete session** in Task Activity to finish the task explicitly.

> [!important]
> Task completion and native terminal closure are separate operations. **Complete session** changes the task to `complete` but never closes a retained terminal. **Close terminal** keeps its existing exact-ownership guard and never completes the task.

Plan council and Forward-planning Turbo do not become manual sessions. When the same project choice is enabled for those workflows, their tasks still complete automatically and only their terminal fleets remain connected. The composer labels that case **Keep workflow terminals open** so the two contracts are not confused.

## Submission boundary

The browser sends `manualCompletion: true` only when all of these are true:

- the backend advertises `capabilities.manualSessionTasks`
- the composer is in direct Execute mode with no Plan council
- the task uses the automatic disposable terminal pool
- the selected project's retention switch is enabled

The server independently requires a disposable task, `keepTerminalOpen = true`, and `mode = 'execute'`. `RelayDatabase.createTask()` performs the final provider check and persists `manual_completion = 1` only for direct Codex or Claude work. This layered validation prevents Plan council, Turbo, breakdown, legacy persistent routing, and malformed API requests from entering the manual lifecycle.

The project preference remains `projects.keep_terminal_open`. Each task snapshots two related but distinct facts:

- `keep_terminal_open`: retain the prepared terminal at the final turn outcome
- `manual_completion`: keep the task open between turns until explicit completion

The additive task column is `manual_completion INTEGER NOT NULL DEFAULT 0`. Normalization exposes it as a boolean, task history import understands the column, and older databases migrate without rewriting existing rows.

## Durable lifecycle

| Event | Persisted status | `finished_at` | Queue behavior |
|---|---|---|---|
| New session submitted | `queued` | `null` | Waits for an ordinary project and provider slot |
| A turn is active | `running` | `null` | Owns the exact task terminal and conversation |
| An active Codex goal finishes an intermediate turn | `running` | `null` | Adopts the provider-created successor and keeps live steering available |
| The complete provider turn chain succeeds | `open` | `null` | Retains the terminal and accepts another message |
| A turn fails or is stopped | `open` | `null` | Records the error, performs no automatic retry, and accepts a corrected message |
| CC Relay restarts during a turn | `open` | `null` | Records the interrupted turn and preserves the session task |
| Operator presses Complete session | `complete` | current time | Emits the normal completion transition without closing the terminal |

`TaskQueue.beginTask()` preserves the first `started_at` across later turns, so the card's **Open** duration describes the full workspace lifetime. Each follow-up still appends its prompt and response evidence to the same task. The task alternates only between `open` and `running` until manual completion.

For Codex, one Relay run can contain several app-server turns when the thread carries an active `/goal`. `turn/completed` is only a provider-turn boundary. Relay keeps the task `running` across the automatic handoff and changes it to `open` only after app-server explicitly reports the thread settled. See [[provider-plan-and-goal-visibility]].

Manual sessions never enter the automatic retry loop. A failed command is useful session context, and replaying it automatically could repeat destructive work. The task returns to `open`, keeps the error in its record, and lets the operator send a corrected message or finish the session.

`recoverInterruptedTasks()` validates the complete manual-session predicate before recovering a running row to `open`. Ordinary running tasks retain the existing `interrupted` outcome.

## Explicit completion

`POST /api/tasks/:id/complete-session` delegates to `TaskQueue.completeSession(taskId)`. The queue accepts only a validated manual session whose status is `open` and which has no active turn. It then:

1. sets `status = 'complete'`
2. writes `finished_at`
3. clears the task-level error
4. preserves the latest result artifact
5. records that manual completion does not close a retained terminal
6. broadcasts the ordinary task change

The completion action is a final boundary. A completed manual session cannot accept another same-task message. Its conversation stays readable and any retained native terminal remains independently closable.

The button is enabled only while the task is `open`. During a turn it reads **Turn in progress**. After completion it reads **Session complete** and remains disabled. The status message distinguishes an open retained terminal from one that was already closed, so it never claims a missing window is still connected.

## Operator interface

Manual session tasks deliberately look different from retained tasks that still complete automatically:

- the Launchpad project state reads **Session open** while at least one manual task is `open`
- Queue summary reports the number of open terminal sessions separately from waiting tasks
- open sessions sort after running work and before queued work
- the task card has a cool-blue terminal rail, **Terminal session**, **Manual finish**, an explicit **Terminal** state badge, `status-open`, and an **Open** duration
- the global Task monitor retains the card while the session is `open`; it leaves only after **Complete session**
- the monitor card carries a persistent text state: **Session running** during a Relay turn, **Terminal idle** or **Terminal busy** for a connected open workspace, **Terminal closed** after window loss, and **Session idle** before a terminal has been bound
- Task Activity is labeled **Session details** and uses a blue top rail
- the session strip is titled **Terminal session workspace** and contains the manual badge, live terminal state, **Complete session**, and the independent **Close terminal** control
- the continuation dock is labeled **Terminal session** and uses **Send command** while the task is open
- while a Codex goal is automatically continuing, the dock remains enabled as **Updates current** and messages steer the exact successor turn, including messages submitted during the brief handoff
- Task Activity calls protocol boundaries **Turn started** and **Turn finished**, never **Session finished**
- after manual completion, the continuation composer is removed so the completed task cannot silently reopen

At widths below 640px, the manual session split reserves enough height for the complete control and state message before the terminal pane. The terminal remains the larger working surface without covering the completion boundary.

The design extends the existing Instrument Sans, Source Serif 4, and JetBrains Mono system with a cool blue operator-workspace treatment. It avoids reusing Claude orange, destructive red, running purple, or the teal live-retention safety latch. Color is never the only distinction: every state has persistent words and accessible labels.

## Terminal loss and restart behavior

The task lifecycle does not depend on the native window remaining visible. If a retained terminal was closed or cannot be rediscovered, the task remains `open`. The session strip reports **Terminal closed**, and the next message relaunches the saved conversation through the existing disposable-resume path. The operator may also complete the task without relaunching the terminal.

An open manual session survives a CC Relay restart as an ordinary persisted row. If the restart occurred during a turn, recovery writes an interruption error but restores `open`. If the session was already idle and open, no recovery mutation is needed.

## Compatibility

- An older backend without `manualSessionTasks` keeps the project setting as terminal retention only. The renderer explains that a restart is required for manual task completion and does not send `manualCompletion`.
- `/api/status.runningTasks` remains running-only for older renderers. Current backends add `monitoredTasks`, and the current renderer also merges valid `open` manual sessions from `/api/tasks` when that additive feed is absent. This keeps mixed backend and renderer versions honest while preventing duplicate cards.
- Existing retained direct tasks have `manual_completion = false`; their automatic completion and later **Continue session** behavior do not change.
- Pressing **Stop auto-close** during a running automatic task sets only `keep_terminal_open`. It does not retroactively convert that task to manual completion. See [[live-terminal-retention]].
- Plan council and Turbo always keep automatic task outcomes, even when their terminals are retained.

## Validation

- Queue tests prove three successful turns stay in one row, preserve the original start time, retain only once, and complete only through the explicit method.
- Failure coverage proves a failed manual turn returns to `open`, retains its terminal, and never schedules an automatic retry.
- Recovery coverage proves an interrupted manual turn returns to `open` with no `finished_at`.
- Route and renderer tests pin capability gating, the explicit endpoint, final continuation rejection, state wording, card treatment, both themes, and the narrow split.
- Monitor tests prove a successful turn transitions from **Session running** to **Terminal idle** without removing the card, invalid open rows stay excluded, explicit completion removes the card, the refresh signature follows status and response changes, and light and dark state chips carry words as well as color.
- Codex app-server tests prove an active goal keeps one Relay run alive across automatic turns, steering waits through the handoff and targets the exact successor, stale completions cannot close it, missed notifications reconcile through `thread/read`, and ambiguous reads cannot create a false finish.
- A temporary live backend and database exercised `open` to `complete` through the actual browser button. The pass covered 1440 by 1000 and 600 by 900 layouts, light and dark themes, the enabled project setting, the open and complete detail states, and zero browser console warnings or errors.
- The complete repository test suite passes 1,572 tests after the goal-handoff correction.

## Files

- `src/database.mjs`
- `src/queue.mjs`
- `src/server.mjs`
- `src/artifacts.mjs`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `public/task-time.js`
- `test/database.test.mjs`
- `test/queue.test.mjs`
- `test/session-tasks-api.test.mjs`
- `test/session-tasks-ui.test.mjs`
- `test/task-time.test.mjs`
- `test/composer-workflows.test.mjs`
- `test/task-detail-modal.test.mjs`

See [[session-tasks]], [[retained-terminal-sessions]], [[project-terminal-settings]], [[same-task-session-continuation]], and [[terminal-close-review]].

#relay #terminal #session #queue #manual-completion #ui
