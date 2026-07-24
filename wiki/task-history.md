---
name: Task History Persistence
description: How Relay persists task records and presents project-scoped queue and history views.
type: architecture
---

# Task History Persistence

Relay stores tasks, outcomes, and task events in the local SQLite database. Desktop builds keep the database under Electron's stable per-user application data directory, while `npm start` uses `.data/relay.sqlite` in the repository.

The apparent loss of older tasks after project workspace support was introduced was a presentation issue, not data loss. The queue list filtered tasks by the active project's exact working-directory path. Tasks created from a parent workspace therefore disappeared when a nested project was selected.

## Task scope control

The selected Launchpad project is always the outer boundary for the queue and history. Switching projects immediately replaces the visible task cards, queue counts, history ledger, and statistics with tasks whose stored `repo_path` matches the selected project. Project paths use normalized exact matching.

Inside a selected project, the queue heading has a two-state task-scope control:

- **This Relay** restricts the project task list to the selected terminal session.
- **All Relays** shows tasks from every Relay in the selected project.

**All Relays** always means every Relay inside the selected project. It never spans projects. The underlying SQLite records remain global and are not deleted or moved when the visible project changes.

The internal broad-scope value remains `workspace` for compatibility, but queue scope is intentionally not persisted. Relay starts in **All Relays**, and project or provider changes restore **All Relays**. Selecting a live terminal changes only the execution target and never narrows the task list. **This Relay** activates only through the explicit scope control and lasts for the current project and provider context.

> [!important]
> Project composer snapshots must not store task scope. Restoring a prompt, workflow, provider, or selected execution terminal must never restore a stale Relay-only queue filter.

> [!important]
> Apply the project filter before the Relay filter. A Relay ID may have tasks in more than one project, so filtering only by `thread_id` can leak cards from the previously selected workspace. `tasksForScope()` owns this ordering and has regression coverage in `test/task-history.test.mjs`.

Every task card begins its footer metadata with the assigned Relay. Connected Codex sessions use their visible `Relay n` label. Disconnected or historical sessions fall back to the persisted `thread_name`, so ownership remains visible even when the original Relay is no longer connected. Claude tasks use a Claude session label, and Turbo tasks without one owning session use **Multiple Relays**.

> [!note]
> Relay identity is global and persisted per Codex thread. The API exposes immutable `relayNumber` and `relayName` fields; reconnecting a thread reuses them, while a new thread receives the next number. Never derive a number from the current terminal array or recycle a disconnected number. Persisted `thread_name` remains the durable display fallback for historical tasks.

> [!important]
> Do not duplicate task records into browser storage. SQLite remains the source of truth for prompts, status, results, events, and restart recovery. Browser storage holds only the display preference.

## Date ledger and statistics

The task panel has separate **Queue** and **History** views. Queue remains the operational surface with reordering, assignment, and parallel selection. History is read-only and groups task cards by their local creation date.

After any successful composer submission, Relay switches to **Queue**, restores **All Relays** within the selected project, selects the newly created task card, and opens that task in Task Activity. This applies equally to Execute, Plan council, Turbo, normal Enter, and **Run now** submissions. It ensures idle routing to another Relay cannot leave the new task hidden behind **This Relay** scope.

## Idempotent composer submission

The task form acquires `state.submitting` before its first asynchronous idle-routing wait. A second click, Enter event, or programmatic submit during that window returns immediately. The button disables and shows its existing starting label for the complete routing and request lifetime.

Every composer intent receives a UUID v4 `submissionId`. The intent signature includes workflow, provider, explicitly selected session, prompt, execution settings, Plan council or Turbo settings, attachment identities, and priority choice. Relay retains the same UUID after an ambiguous failure while that intent stays unchanged. This matters when the server committed a task but its response was lost, or when a later idle-routing pass chooses a different destination. Successful acceptance clears the pending intent, so deliberately submitting the same prompt later remains valid.

The task API requires a valid UUID. SQLite stores it in `tasks.submission_id` behind a unique partial index. `TaskQueue.enqueue()` returns an existing matching task before checking live terminal availability or writing artifacts, so repeated delivery cannot create a second task, event set, attachment set, or queue position. Reusing one UUID for a different prompt, mode, or provider fails closed. The API returns the original task with `duplicateSubmission: true` and records `api.task.enqueue.duplicate` diagnostics.

> [!important]
> This is intent idempotency, not prompt deduplication. Two deliberate submissions after the first succeeds receive different UUIDs even when their prompt text is identical.

> [!warning]
> The database column, unique index, and API requirement are backend changes. Restart Relay before relying on server-side duplicate protection. A refreshed new renderer can lock its own button against an older backend, but that older process cannot enforce UUID uniqueness.

See [[duplicate-submission-review]].

## Same-session task continuation

Task Activity includes a **Continue session** dock for direct Codex and Claude tasks. When the selected Codex task is running, the dock uses `POST /api/tasks/:id/steer` and Codex `turn/steer` to add the message to that exact active turn. No task record or queue position is created, Task Activity remains on the running task, and the accepted user message appears in its event rail. The request includes the expected active turn ID so a completion race fails visibly instead of routing the message elsewhere.

When the source task is no longer running, `POST /api/tasks/:id/follow-up` starts the next provider turn immediately against the exact original `thread_id`. Relay reuses the source task row and event rail, keeps the stored original prompt unchanged, records the follow-up as a user-message event, and updates that task with the latest turn outcome. It does not call `queue.enqueue()`, create `continued_from_task_id`, change task selection, or increase the task count. `/api/tasks/:id/continue` is retained only as a direct-behavior alias for clients that already use that path.

The server requires the exact original session to remain connected, idle, and in the same workspace. A queued or running task that reserves the session blocks submission. If the provider becomes busy between validation and dispatch, the immediate runner rejects instead of waiting. A failed, cancelled, or interrupted follow-up is marked as a same-session follow-up so automatic retry and the generic Retry action cannot place the source prompt in the queue. The user can send it again only through **Continue session**.

When the original session is offline or busy, the input remains editable so a draft is not lost, while Send stays disabled with the exact reason. Relay never moves a follow-up to another terminal, waits behind other work, creates fresh hidden context, or falls back to `POST /api/tasks`. Plan council and Turbo tasks do not expose the dock because they span multiple providers or terminals rather than one coherent conversation. Enter sends and Shift+Enter inserts a line break.

The continuation dock accepts PNG, JPEG, and WebP images through a minimal **Add images** file control or clipboard paste. It shows only the selected count and a **Clear images** action. Text and image drafts are retained independently per selected task while navigating Task Activity and are cleared only after the provider accepts the follow-up. The existing per-request limits apply: 99 images, 5 MB per image, and 20 MB total.

Finished Codex and Claude follow-ups validate images through `decodeImageAttachments()`, append them to the existing task's artifact list with new non-colliding `image-n` IDs, and pass only the newly attached images to that provider turn. Earlier task images remain visible in Task Activity but are not resent. Running Codex steering stages the new files, sends them as `localImage` entries in the same `turn/steer` `UserInput[]`, and commits them only after Codex accepts the exact active turn. A rejected steer removes the staged files and database metadata so resubmission cannot duplicate them.

> [!important]
> Follow-up images require `/api/status` to advertise `capabilities.taskFollowUpAttachments`. A newer renderer must disable the image control against an older backend because older follow-up routes ignore an unknown `attachments` field. Never silently send image-bearing follow-ups without this capability gate.

Static UI assets can update while an older Relay backend is still running. A finished task requires `/api/status` to advertise `capabilities.taskDirectFollowUp`. Without it, the renderer shows **Restart required** and disables Send, even when text is present. This gate intentionally rejects the old ordinary-task compatibility route. A running Codex task can still steer when `capabilities.taskSteering` is available because that route already has a no-queue contract.

> [!important]
> Every **Continue session** submission is immediate and never creates or queues a task. Running Codex updates steer the current turn. Finished Codex and Claude tasks start the next turn in the same task and session. A busy session rejects the send. Running Claude turns do not support live steering yet, so Relay keeps the draft editable but disables submission until the turn finishes.

History supports day, Monday-to-Sunday week, and calendar-month periods with previous, next, and today navigation. Its scope follows the existing project and Relay filters, so statistics describe either one explicitly selected Relay or all Relays in the selected project. The selected view and period are browser display preferences under `relay.taskView` and `relay.historyPeriod`; the selected date resets to the current period when the app loads.

The summary reports tasks created in the selected period, successful completions, success rate across terminal outcomes, and recorded runtime from tasks that have both `started_at` and `finished_at`. An activity strip uses six four-hour buckets for a day, seven daily buckets for a week, and one bucket per calendar day for a month.

> [!important]
> Period boundaries use the browser's local calendar rather than UTC. Weeks start on Monday. Use exclusive end boundaries so midnight tasks appear in exactly one period.

> [!note]
> Success rate is `complete / (complete + failed + interrupted + cancelled)`. Queued and running tasks remain visible and count toward total tasks, but they do not enter the success-rate denominator. Runtime excludes unfinished tasks so it remains stable while the history view is open.

## Files

- `src/database.mjs`
- `src/server.mjs`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `public/task-continuation-state.js`
- `public/task-history.js`
- `public/task-routing.js`
- `src/task-continuation.mjs`
- `test/task-continuation-state.test.mjs`
- `test/task-continuation.test.mjs`
- `test/task-history.test.mjs`
- `test/task-routing.test.mjs`

## Parallel Codex batches

Queue task checkboxes can combine two or more waiting tasks into one command for the currently selected Codex terminal. Relay does not execute those tasks itself and does not route them through Claude. It creates one replacement Codex task whose prompt contains an ordered numbered list and explicit instructions to delegate independent items to sub-agents, wait for every result, verify the combined work, and return one consolidated summary.

The selected tasks must share the selected Codex terminal's workspace. Their image attachments are copied into the replacement task before the original queued records are removed.

> [!important]
> The selected terminal is the source of truth. Do not add a second terminal selector to the parallel batch bar or restore Claude-specific routing.

## Priority submission shortcut

The shortcut label is **Run now**. Ctrl+Enter submits the composer as a priority task assigned to the currently selected Relay, even when **Use an idle Relay when available** is enabled. Relay assigns it a queue position before every task that is still waiting. If the selected Relay is already active, it waits without interrupting that work. Enter keeps normal append-to-queue behavior and may still use idle-Relay routing when that preference is enabled. Shift+Enter inserts a newline. The three shortcut hints render as separately spaced groups rather than one dot-separated sentence.

The client sends `runNow: true`, `TaskQueue.enqueue()` records a priority event, and `RelayDatabase.createTask()` chooses a position below the current minimum queued position in the same project. This applies consistently to Execute, Plan council, and Forward-planning turbo without moving tasks in other Launchpads.

> [!note]
> Priority intent and idle routing are deliberately separate: **Run now** changes queue priority but never changes the selected Relay assignment.

## Project queue isolation

Queue order is scoped by `repo_path`. New and retried tasks append after tasks in the same project, priority tasks move ahead of waiting tasks in that project, and reorder requests include the selected project path. The server loads the complete queued set only for that path and rejects task IDs from any other project.

## Editing waiting tasks

A task whose persisted status is still `queued` exposes **Edit** in Task Activity. The editor changes the request text and regenerates the compact task title, while preserving queue position, provider, model, effort, terminal assignment, workflow configuration, and reference images. The canonical `task.md` artifact is rewritten with the new request and its existing attachment list.

`PATCH /api/tasks/:id` is guarded by `capabilities.queuedTaskEditing`. The database update includes `status = 'queued'` in its write condition, so a task that starts while the editor is open rejects the save. Turbo work with an active forward preparation also rejects editing because its planner may already have consumed the old request. Editing a queued Turbo task with a completed look-ahead plan invalidates that plan so execution cannot use a graph built from stale text.

> [!important]
> Editing never changes queue position or routing. Do not implement it as delete plus re-enqueue, because that would change task identity, ordering, artifacts, and submission history.

The backend publishes `capabilities.projectQueueIsolation`. A missing flag means the renderer may be newer than the active Node scheduler. When an unpaused project has queued work, no local running task, and another project is running, the UI shows a restart instruction on both the project card and queue summary. This compatibility message never changes task state or bypasses shared provider constraints. See [[project-queue-isolation-review]].

Pause state is also stored per project. The status response exposes paused project paths so switching Launchpads immediately renders the correct control state. Pausing one project filters only its waiting tasks from scheduling; already running work is not interrupted, and other project queues remain runnable.

> [!important]
> Queue and History never expose a cross-project overview. A selected Launchpad is required, and a missing path returns an empty task set as a fail-closed transient state.

## Composer routing authority

The visibly selected workflow and provider are authoritative when the task form is submitted. The composer exposes only Execute and Forward-planning Turbo as workflow tabs. Relay requires exactly one workflow tab whose visual `selected` class and `aria-selected="true"` state agree. Execute also requires one provider tab with the same agreement. The submission is rejected if rendered selection and in-memory state differ.

> [!important]
> **Execute + Codex** constructs `mode: execute` with `provider: codex` while its Plan council checkbox is off. The same visible workflow constructs the internal `mode: plan` with `provider: council` only when the user explicitly checks Plan council. Never infer council intent from an ambiguous or inconsistent composer selection.

Plan council is an option inside Execute rather than a standalone workflow category. Its switch starts unchecked, and the Claude author, Codex reviewer, Claude revision route and readiness details remain hidden until enabled. Enabling it selects Codex because the route needs a Codex review Relay, hides the direct execution settings, changes the primary action to **Build reviewed plan**, and sends `councilEnabled: true`. It does not disable the provider tabs. Choosing Claude turns the option off and continues as direct Claude execution. Leaving Execute or successfully submitting also resets the switch. The task API still rejects internal `mode: plan` submissions without the explicit flag. A previously submitted Plan council task remains a plan task because task detail shows persisted task configuration, not the next composer submission.

> [!note]
> A completed Execute Plan council exposes one canonical, Git-ignored `plan.md` and an **Execute reviewed plan** panel. Its selector contains all currently opened Codex and Claude Relays in the same workspace. Relay creates a normal linked Execute task containing the original request, final reviewed plan, canonical path, and copied references. It never implements automatically when planning completes. Failed councils expose **Resume** and keep completed stage checkpoints. See [[plan-council]].

The routing checks live in `public/task-routing.js` and are covered by `test/task-routing.test.mjs`.

## Terminal assignment

Queued Codex execute tasks can move to another connected terminal in the same workspace. Each task card exposes an **Assign** control when another eligible terminal exists, and the same task can be dragged onto a numbered Relay terminal card. Running, completed, Plan council, Turbo, and Claude tasks cannot be reassigned.

The server validates the task status, provider, mode, live terminal connection, and normalized workspace path before changing `thread_id`, `thread_name`, and `thread_source`. It also updates the persisted task artifact and records a queue event.

> [!important]
> Reassignment never moves work to another workspace and never interrupts a running task.

The composer offers **Use an idle Relay when available** above the terminal list. This preference is stored under `relay.preferIdleTerminal`. For direct Codex and Claude execution, the selected terminal remains the route only when its connection reports idle and it has no queued or running direct task. Otherwise Relay uses the first terminal of the selected provider in the current workspace that meets both conditions. Claude routing is enabled only when `/api/status` advertises `capabilities.parallelClaudeExecution`, so a refreshed renderer cannot promise parallel routing while an older Node scheduler is still running.

> [!note]
> Task 208 on July 21, 2026 exposed the old Codex-only routing condition and global direct Claude lock while task 207 was running on another Claude UUID. Relay now routes within the selected provider and gives each direct Claude session independent runner ownership.

Execute tasks always resume their assigned Codex or Claude session, including the destination chosen by idle routing. Codex terminal clients display the turn live. Claude's headless resume process streams into Relay Task Activity and updates the same transcript, but the interactive Claude TUI does not redraw that second process's output. See [[diagnostics]].

> [!important]
> Do not restore background fresh-context execution. A separately created app-server thread is visible in Relay Task Activity but not in the selected native terminal, which makes that terminal appear stalled.

> [!important]
> Connection status alone is insufficient for idle routing. A terminal can still report `idle` while persisted tasks are already assigned and waiting for it. `submissionThreadId()` must exclude every thread referenced by a queued or running direct task from the selected provider so consecutive submissions spread across genuinely free Relays.

> [!note]
> A newly launched Relay can take a few seconds to join discovery. When idle routing is enabled and the selected Relay is busy, submission allows a three-second discovery grace period before falling back to the selected Relay. This prevents work from being pinned behind a busy Relay when a terminal launch was already in progress. Task 155 on July 20, 2026 exposed the race: enqueue validation ran about two seconds before the new Relay joined.

Direct Codex and direct Claude tasks execute concurrently across distinct terminal sessions and sequentially within each session. An active direct task from either provider does not block an eligible direct task on another free session. Normal FIFO and exclusive barriers are evaluated within each exact `repo_path`: a running Plan council in one project does not block a head direct task in another project, and a project Plan council may start while direct work is active elsewhere. Plan council and Turbo remain exclusive queue entries, so an exclusive head waits for that project's active direct tasks and later direct tasks do not jump past it. Relay still starts at most one provider-wide or multi-terminal exclusive task globally because those runners own shared resources.

> [!important]
> Treat `mode = execute` with `provider = claude` as direct execution for project scheduling, not as a project-wide exclusive entry. Reserve its `thread_id` exactly like a direct Codex Relay. `ClaudeExecutionRunner` tracks active processes by task ID and session ID, allowing different sessions to overlap while rejecting duplicate work on one session. Cancellation remains scoped to the selected task.

While a Turbo parent is executing its graph, the scheduler has a narrow resource-aware exception inside that project: queued direct Codex tasks may use Relays that are not reserved by active direct work, Turbo workers, a planner still preparing its graph, or a look-ahead planner whose `plannerBusy` flag is true. It scans that project's direct tasks across intervening queued Turbo, Plan council, and Claude entries, but never starts another non-direct task or a second exclusive task. Other projects follow their own normal queue heads and FIFO barriers. A direct task targeting a reserved worker or planner remains queued. When Turbo execution ends, the normal project exclusive FIFO barrier returns. See [[turbo-execution]].

Turbo look-ahead is an internal preparation phase, not a second queue lane. It leaves the parent in its existing FIFO `position`, so priority submissions, manual reorder, pause, and direct Codex concurrency retain their normal behavior. A queued Turbo parent may show `planning` or `ready` while another Turbo parent is executing, but it cannot start workers until it reaches the front of the queue.

When the optional Turbo council is enabled, a queued parent may also be `reviewing` while the selected second provider performs the read-only correction pass. The parent remains queued, reorderable, and cancellable. With Codex first, its planner Relay is released during Claude review. With Claude first, the Codex Relay remains free during authoring and is reserved only for its review stage. Neither route changes `activeTaskId`, queue position, or FIFO execution order. See [[turbo-plan-council]].

> [!important]
> `TaskQueue.scheduling` protects only the synchronous dispatch pass. It must not remain true while awaiting the lifetime of running tasks. `runNext()` starts eligible tasks without awaiting their completion, and each `runTask()` schedules another dispatch when it settles. This lets a task enqueued for Relay 1 start immediately while Relay 2 is already running.

Queue status exposes both the backward-compatible `activeTaskId` and the complete `activeTaskIds` list. Cancellation is addressed by task ID so stopping work on one Relay does not interrupt another Relay.

## Task list ordering

The operational Queue view groups running tasks first, queued tasks second, and terminal outcomes last. Queued cards follow ascending execution `position` from top to bottom: the oldest or manually promoted task is at the top, and a normal new task appended with Enter appears at the bottom of the queued block. This visual order matches FIFO execution. Ctrl+Enter remains the explicit **Run now** exception because its priority position is placed below the current minimum queued position, so it may appear at the top. Finished, failed, interrupted, and cancelled tasks remain ordered newest first by task ID instead of retaining their obsolete queue positions.

> [!important]
> Apply `position` ordering only to queued rows. A completed task's position describes where it once waited and must not determine history recency.

> [!important]
> `mergeProjectQueueOrder()` must merge the visible queued IDs, already ordered by ascending execution position, back into the hidden global queued slots. Send that visible ascending order directly so a scoped reorder cannot silently change execution order for unrelated tasks.

> [!important]
> Every reorder request carries `expectedTaskIds` plus the requested `taskIds`. SQLite compares the expected ascending queued snapshot inside `BEGIN IMMEDIATE` before changing any position. A stale snapshot, task leaving the queue, duplicate, or missing ID rejects atomically and leaves the committed order untouched.

## Deterministic queue dragging

The Queue view is an execution ledger: queued cards and their drag targets are displayed in ascending execution position from top to bottom. A reorder gesture begins only from the card's drag grip; the rest of the card remains available for selection, buttons, and terminal assignment. The grip shows one insertion marker while a valid drop is active, and no task order is mutated during pointer movement.

At drag start, the client captures one immutable snapshot containing the complete global queued ID order and the visible queued IDs for the current project and Relay scope. A drop may permute only the visible IDs, then merges that permutation back into the same original global slots. This preserves hidden tasks from other Relays and projects rather than moving unrelated work. Only the explicit unscoped **All Relays** view exposes the global queue.

The reorder request includes both `expectedTaskIds` (the captured global queued order) and `taskIds` (the proposed global order). The database compares `expectedTaskIds` with the exact current queued order inside one `BEGIN IMMEDIATE` transaction. A stale snapshot is rejected atomically without changing any positions, after which the client refreshes and asks the user to retry from the latest order. Arrow controls use this same pure reorder transaction, so keyboard and pointer behavior cannot diverge.

This contract is separate from assignment dragging: dropping a queued Codex task onto a numbered Relay card changes terminal ownership, while queue-grip dragging changes only execution order. [[turbo-execution]] look-ahead, FIFO barriers, and the **Run now** Ctrl+Enter priority exception remain unchanged.

> [!note]
> Ordinary enqueue and retry append after the largest persisted position, including positions held by completed historical records. `nextQueuedTask()` still selects the smallest queued position; only **Run now** intentionally inserts before waiting work. Regression coverage lives in [[../test/database.test.mjs]] and [[../test/queue.test.mjs]].

#relay #tasks #history #persistence #sqlite
