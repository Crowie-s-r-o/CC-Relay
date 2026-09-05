---
name: Task History Persistence
description: How CC Relay persists task records and presents project-scoped queue and history views.
type: architecture
---

# Task History Persistence

Task-list search is documented separately in [[task-search]]. It uses the same project boundary and canonical prompt and response extraction described here, and deliberately searches beyond the currently selected History period without changing that saved display preference.

CC Relay stores tasks, outcomes, and task events in the local SQLite database. Desktop builds keep the database under Electron's stable per-user application data directory, while `npm start` uses `.data/relay.sqlite` in the repository.

The apparent loss of older tasks after project workspace support was introduced was a presentation issue, not data loss. The queue list filtered tasks by the active project's exact working-directory path. Tasks created from a parent workspace therefore disappeared when a nested project was selected.

## Project-wide task scope

The selected Launchpad project is always the outer boundary for the queue and history. Switching projects immediately replaces the visible task cards, queue counts, history ledger, and statistics with tasks whose stored `repo_path` matches the selected project. Project paths use normalized exact matching.

Inside a selected project, Queue and History always show tasks from every CC Relay. The obsolete **All Relays** queue-header button and its **This CC Relay** alternative were removed. Selecting a legacy live terminal chooses an execution target only and never narrows task visibility.

Project-wide visibility never spans projects. The underlying SQLite records remain global and are not deleted or moved when the visible project changes. `tasksForScope()` now applies only the normalized exact project path and ignores legacy relay-scope arguments.

> [!important]
> Project composer snapshots do not store task scope. Restoring a prompt, workflow, provider, or selected execution terminal cannot alter which tasks are visible.

> [!important]
> Filter by normalized exact project path. A CC Relay ID may have tasks in more than one project, so filtering only by `thread_id` can leak cards from another workspace. `test/task-history.test.mjs` verifies that even legacy relay-scope arguments still return every Relay in the selected project.

Every task card begins its footer metadata with the assigned CC Relay. Connected Codex sessions use their visible `CC Relay n` label. Disconnected or historical sessions fall back to the persisted `thread_name`, so ownership remains visible even when the original CC Relay is no longer connected. Claude tasks use a Claude session label, and Turbo tasks without one owning session use **Multiple Relays**.

> [!note]
> CC Relay identity is global and persisted per Codex thread. The API exposes immutable `relayNumber` and `relayName` fields; reconnecting a thread reuses them, while a new thread receives the next number. Never derive a number from the current terminal array or recycle a disconnected number. Persisted `thread_name` remains the durable display fallback for historical tasks.

> [!important]
> Do not duplicate task records into browser storage. SQLite remains the source of truth for
> prompts, status, results, events, completion review state, and restart recovery. Browser storage
> holds display preferences and a best-effort unfinished-status baseline for completion sounds,
> never the authoritative Ready for review stack. See [[launchpad-completion-notifications]].

The desktop app used to copy finished localhost rows into its own SQLite database through **Import localhost**. That action was removed on August 13, 2026, so desktop and localhost histories are now independent with no transfer path. Rows imported before removal keep their origin columns and stay in desktop history. See [[localhost-task-import]].

## Date ledger and statistics

The task panel has separate **Queue** and **History** views. Queue remains the operational surface with reordering, assignment, and parallel selection. History is read-only and groups task cards by their local creation date.

Every task card now has a dedicated lifecycle row with **Started** and **Completed** dates. The same labeled values appear in the Task Activity header alongside the labeled creation date. Queued work shows **Not started** and **Not completed**; running work shows its start date and **Not completed**; every terminal outcome uses the persisted `finished_at` value for Completed, including failed, interrupted, and cancelled tasks.

> [!note]
> This presentation reuses the existing SQLite `started_at` and `finished_at` fields. It does not add a second browser-side date source or infer lifecycle dates from task creation, events, duration, or status.

After any successful composer submission, CC Relay switches to **Queue**, selects the newly created task card, and opens that task in Task Activity. This applies equally to Execute, Plan council, Turbo, normal Enter, and **Run now** submissions. Project-wide visibility ensures idle routing to another CC Relay cannot hide the new task.

Task card selection and completion review are deliberately independent visual states. Selection owns the complete project-colored outline and tinted card surface. Every unviewed completion has a prominent rose **Ready for review** badge and left rail. The operational Queue also groups unstarred unread completions below running work. Search and History preserve their own result order inside the starred and unstarred display groups. The unread card background rule is limited to `:not(.selected)` so it cannot replace the stronger selection treatment. Opening the task acknowledges only that completion and immediately returns it to its normal Today or Past position. The counted **Ready for review** view shows only unread completions across all dates and removes each opened task while keeping its detail visible. **Mark reviewed** remains the explicit project-wide bulk acknowledgement. See [[task-review-visibility]].

The review distinction is persisted on the task row as `completion_reviewed` and exposed as
`ready_for_review`. Review writes carry the exact displayed `finished_at`, including bulk review,
so a retry or continuation that finishes again while acknowledgement is in flight remains visible
as a new outcome. An additive schema upgrade treats pre-column completions as reviewed, then
imports any still-reachable legacy unread IDs once. See
[[launchpad-completion-notifications]].

> [!note]
> The review divider and the per-card badge both identify unread completions in Queue. The badge has its own line so it remains prominent without crowding task metadata. Light and dark themes use matching review colors in the final Launchpad stylesheet.

## Starred display group

The persistent `tasks.starred` boolean creates one stable **Starred** group at the top of Queue,
History, search, and the active-task monitor. Existing operational, date, relevance, and monitor
order remains intact inside each star group. The state is project-bounded only by the normal task
scope, so switching Launchpads immediately replaces both starred and unstarred cards. A starred
completion awaiting review carries its word badge because it no longer sits beneath the ordinary
**Ready for review** divider; the rose rail and accessible label remain unchanged.

> [!important]
> Starred order is a display property. It cannot change a queued task's persisted `position`,
> scheduler priority, FIFO barriers, provider capacity, or next runnable selection. **Run now** is
> still the only composer shortcut that inserts work ahead of the waiting queue.

Queued drag and arrow controls operate only inside the card's current star group. The immutable
reorder snapshot still contains every queued ID in execution order, while `visibleTaskIds` contains
only starred or only unstarred tasks. Merging the reordered subset back into its original slots
preserves the other group's execution positions. See [[task-starring]].

Task Activity selection is remembered independently for each Launchpad during the current browser session. Switching from Alpha to Beta and back reopens Alpha's previously selected task instead of discarding the selection. Restoration is bounded by the incoming project's normalized exact path, and missing or deleted tasks fall back to the existing running-task recovery or the empty detail state. This state is intentionally not persisted across an application restart. See [[project-workspaces]].

## Idempotent composer submission

The task form acquires `state.submitting` before its first asynchronous idle-routing wait. A second click, Enter event, or programmatic submit during that window returns immediately. The prompt keyboard handler checks this active-submission state before interpreting a disabled button as a readiness failure. The button disables and shows its existing starting label for the complete routing and request lifetime.

> [!important]
> A disabled composer button can mean either **submission in progress** or **submission unavailable**. Repeated Enter while `state.submitting` is true must be a quiet no-op. It must not replace **Adding task** with a missing-terminal error. The screenshot attached to task 274 exposed this false failure message. The earlier prompt shown in that screenshot never reached the task API, while the later report task 274 validated, persisted, and started in milliseconds on the same CC Relay.

Every composer intent receives a UUID v4 `submissionId`. The intent signature includes workflow, provider, explicitly selected session, prompt, execution settings, Plan council or Turbo settings, attachment identities, and priority choice. CC Relay retains the same UUID after an ambiguous failure while that intent stays unchanged. This matters when the server committed a task but its response was lost, or when a later idle-routing pass chooses a different destination. Successful acceptance clears the pending intent, so deliberately submitting the same prompt later remains valid.

The task API requires a valid UUID. SQLite stores it in `tasks.submission_id` behind a unique partial index. `TaskQueue.enqueue()` returns an existing matching task before checking live terminal availability or writing artifacts, so repeated delivery cannot create a second task, event set, attachment set, or queue position. Reusing one UUID for a different prompt, mode, or provider fails closed. The API returns the original task with `duplicateSubmission: true` and records `api.task.enqueue.duplicate` diagnostics.

> [!important]
> This is intent idempotency, not prompt deduplication. Two deliberate submissions after the first succeeds receive different UUIDs even when their prompt text is identical.

> [!warning]
> The database column, unique index, and API requirement are backend changes. Restart CC Relay before relying on server-side duplicate protection. A refreshed new renderer can lock its own button against an older backend, but that older process cannot enforce UUID uniqueness.

See [[duplicate-submission-review]].

## Same-session task continuation

Task Activity includes a **Continue session** dock for direct Codex and Claude tasks. When the selected task is running, the dock uses `POST /api/tasks/:id/steer`. Codex delegates to `turn/steer` with the expected active turn ID. Interactive Claude delegates to the exact active task watcher, re-proves its owned terminal identity and empty composer, then accepts only exact hook or transcript prompt evidence. No task record or queue position is created, Task Activity remains on the running task, and the accepted user message appears in its event rail.

When a disposable source task is no longer running, `POST /api/tasks/:id/follow-up` reuses that exact task row and original conversation ID. When a provider slot is free, the pool launches a new native terminal in the same project and resumes Claude with `--resume` or Codex with `codex resume`. The new terminal receives a new native launch ID, but the provider keeps the saved conversation ID. CC Relay runs the follow-up under the source task ID, keeps Task Activity selected there, and closes or retains the new launch according to the task's existing retention setting.

`TaskQueue.startFollowUp()` synchronously revalidates the source status, saved conversation identity, active task reservations, and provider capacity after the route's asynchronous model and provider checks. A busy conversation or full pool rejects visibly with the task unchanged. Continuations never wait in the queue, never move to another conversation, and never start a second concurrent resume of the same ID.

Finished legacy persistent tasks retain the former immediate path. Their follow-up starts against the exact connected original `thread_id`, reuses the source task row and event rail, and rejects when that terminal is offline or busy. `/api/tasks/:id/continue` remains an alias for clients that already use that path.

The input stays editable while submission is unavailable, and Send is disabled with **Conversation busy**. A full provider pool rejects the submitted request visibly and leaves the finished task unchanged so the user can send again after capacity frees. A disposable task whose terminal closed remains resumable as long as it established a conversation ID. A task cancelled before binding does not falsely advertise resume. Plan council and Turbo tasks do not expose the dock because they span multiple conversations. Enter sends and Shift+Enter inserts a line break.

The continuation dock accepts PNG, JPEG, and WebP images through a minimal **Add images** file control or clipboard paste. It shows only the selected count and a **Clear images** action. Text and image drafts are retained independently per selected task while navigating Task Activity and are cleared only after the provider accepts the follow-up. The existing per-request limits apply: 99 images, 5 MB per image, and 20 MB total.

> [!important]
> Follow-up image reads finish asynchronously. `ContinuationAttachmentDrafts` serializes additions
> for each task and gives every task a cancellation generation. **Clear images**, an accepted
> dispatch, or an authoritative retry restore invalidates older reads, so a delayed `FileReader`
> completion cannot resurrect cleared images. A completed add updates only its original task and
> repaints the dock only when that task is still selected.

Finished-task continuations validate images through `decodeImageAttachments()`, append new non-colliding `image-n` IDs to the source task, and pass only the newly attached images to that turn. Earlier task images remain visible but are not resent. Running Codex steering stages the new files, sends them as `localImage` entries in the same `turn/steer` `UserInput[]`, and commits them only after Codex accepts the exact active turn. Running interactive Claude references only the new staged paths in its live prompt. A definite rejection removes staged files and metadata; an uncertain post-injection result retains them because Claude may already have received the paths.

The upper **Prompts** disclosure is task-level conversation history. `GET /api/tasks/:id` returns the canonical original request plus every CC Relay-marked finished-turn follow-up and running-turn steering message. This query is independent of the terminal console's bounded 500-event window, so old prompts do not disappear from the top of a long-running task. The disclosure opens automatically when a task has more than one prompt. Copy preserves the complete ordered user-authored text but omits generated display headings and numbers.

> [!important]
> Follow-up images require `/api/status` to advertise `capabilities.taskFollowUpAttachments`. A newer renderer must disable the image control against an older backend because older follow-up routes ignore an unknown `attachments` field. Never silently send image-bearing follow-ups without this capability gate.

Static UI assets can update while an older CC Relay backend is still running. A finished task requires `/api/status` to advertise `capabilities.taskDirectFollowUp`. Without it, the renderer shows **Restart required** and disables Send, even when text is present. This gate intentionally rejects the old ordinary-task compatibility route. A running Codex task requires `capabilities.taskSteering`; a running Claude task separately requires `capabilities.claudeTaskSteering`.

> [!important]
> `capabilities.resumableDisposableSessions` is the explicit promise that a finished disposable task may relaunch its saved conversation while preserving task identity. Running Codex updates steer the current app-server turn. Running interactive Claude updates steer the exact owned terminal turn when `claudeTaskSteering` is present. Headless Claude turns reject live updates. Finished legacy tasks still use immediate same-terminal follow-up.

For keep-terminal-open tasks, Task Activity replaces the flat Prompts disclosure with a paired prompt-and-response conversation history and a session strip carrying live terminal state and a **Close terminal** action; `GET /api/tasks/:id` additionally returns `responses` for that pairing. See [[session-tasks]].

History supports day, Monday-to-Sunday week, and calendar-month periods with previous, next, and today navigation. Its statistics always describe every CC Relay in the selected project. The selected view and period are browser display preferences under `relay.taskView` and `relay.historyPeriod`; the selected date resets to the current period when the app loads.

The summary reports tasks created in the selected period, successful completions, success rate across terminal outcomes, and recorded active runtime from terminal tasks. Runtime sums every persisted provider attempt under the task ID, including follow-ups and retries, and excludes idle gaps between them. Legacy tasks without attempt accounting fall back to their persisted lifecycle timestamps. An activity strip uses six four-hour buckets for a day, seven daily buckets for a week, and one bucket per calendar day for a month. See [[conversation-card-metrics]].

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

Eligible legacy persistent queue task checkboxes can combine two or more waiting tasks into one command for the currently selected Codex terminal. CC Relay does not execute those tasks itself and does not route them through Claude. It creates one replacement Codex task whose prompt contains an ordered numbered list and explicit instructions to delegate independent items to sub-agents, wait for every result, verify the combined work, and return one consolidated summary. Disposable tasks never expose this destructive replacement action; increase the project Codex maximum or use Turbo instead.

The selected tasks must share the selected Codex terminal's workspace. Their image attachments are copied into the replacement task before the original queued records are removed.

> [!important]
> For eligible legacy rows, the selected terminal is the source of truth. Do not add a second terminal selector to the parallel batch bar or restore Claude-specific routing.

## Planner breakdowns as queue work

The [[planner]] runs an AI task breakdown as an ordinary `mode: 'breakdown'` queue task on the chosen Codex or Claude provider. In current automatic mode, the task launches a disposable terminal only when it receives a project slot. It appears in Queue and History like any other work and follows the same project scope, cancellation, and retry rules. It is **not** exclusive: `isSingleSessionTask` groups it with direct Codex, Claude, and OpenCode execution. Plan council and Turbo remain globally workflow-exclusive, while a current disposable Plan council has the documented same-project capacity-sharing exception.

Its parsed proposals are reviewed in the Planner and only become normal `mode: 'execute'` tasks through an explicit user action: **Queue selected tasks** for a flat batch, or **Run plan** for a dependency-ordered plan run that enqueues each step as its dependencies complete. Both use the same `queue.enqueue` path as the composer, so a plan-run step is indistinguishable from a composer task in Queue, History, and Task Activity, including cancel and retry. Nothing in a breakdown auto-executes.

## Priority submission shortcut

The shortcut label is **Run now**. Ctrl+Enter submits the composer as a priority task and CC Relay assigns it a queue position before every task that is still waiting in the project. It does not bypass the project's provider instance limits or interrupt active work. Enter keeps normal append-to-queue behavior. Shift+Enter inserts a newline. A legacy persistent submission remains pinned to its selected CC Relay and opts out of idle routing when prioritized.

The client sends `runNow: true`, `TaskQueue.enqueue()` records a priority event, and `RelayDatabase.createTask()` chooses a position below the current minimum queued position in the same project. This applies consistently to Execute, Plan council, and Forward-planning turbo without moving tasks in other Launchpads.

> [!note]
> Priority and capacity are deliberately separate. **Run now** changes queue position, never the provider instance limit.

## Project queue isolation

Queue order is scoped by `repo_path`. New and retried tasks append after tasks in the same project, priority tasks move ahead of waiting tasks in that project, and reorder requests include the selected project path. The server loads the complete queued set only for that path and rejects task IDs from any other project.

## Editing waiting tasks

A task may receive an optional operator-written name at submission. Queue cards, the running-task rail, Task Activity, and task artifacts use the canonical persisted `title`; blank names retain the prompt-derived fallback. A waiting card exposes **Rename**, and the existing Task Activity editor can change the name and request together. See [[task-naming]].

A task whose persisted status is still `queued` exposes **Edit** in Task Activity. The editor changes the name or request text while preserving queue position, provider, model, effort, terminal assignment, workflow configuration, and reference images. Clearing the name regenerates it from the current request. The canonical `task.md` artifact is rewritten with the new heading, request, and existing attachment list.

`PATCH /api/tasks/:id` is guarded by `capabilities.queuedTaskEditing`. The database update includes `status = 'queued'` in its write condition, so a task that starts while the editor is open rejects the save. Turbo work with an active forward preparation also rejects editing because its planner may already have consumed the old request. Editing a queued Turbo task with a completed look-ahead plan invalidates that plan so execution cannot use a graph built from stale text.

> [!important]
> Editing never changes queue position or routing. Do not implement it as delete plus re-enqueue, because that would change task identity, ordering, artifacts, and submission history.

## Configurable manual retry

A failed, cancelled, or interrupted automatic Execute task opens the execution editor before manual retry. The operator may select Codex, Claude, or OpenCode, a model, and an effort. Keeping the provider preserves its saved conversation ID, while changing providers clears provider-specific conversation fields and starts fresh. Task identity, prompt, title, images, project, and history remain intact. See [[configurable-task-retry]].

Plan council, Turbo, breakdown, legacy persistent, and automatic retry paths keep their workflow-owned configuration. A current renderer gates configurable retry through `capabilities.retryTaskExecutionSettings`; an older backend receives the original bodyless retry request.

The backend publishes `capabilities.projectQueueIsolation`. A missing flag means the renderer may be newer than the active Node scheduler. When an unpaused project has queued work, no local running task, and another project is running, the UI shows a restart instruction on both the project card and queue summary. This compatibility message never changes task state or bypasses shared provider constraints. See [[project-queue-isolation-review]].

Pause state is also stored per project. The status response exposes paused project paths so switching Launchpads immediately renders the correct control state. Pausing one project filters only its waiting tasks from scheduling; already running work is not interrupted, and other project queues remain runnable.

> [!important]
> Queue and History never expose a cross-project overview. A selected Launchpad is required, and a missing path returns an empty task set as a fail-closed transient state.

## Composer routing authority

The visibly selected workflow and provider are authoritative when the task form is submitted. The composer exposes only Execute and Forward-planning Turbo as workflow tabs. CC Relay requires exactly one workflow tab whose visual `selected` class and `aria-selected="true"` state agree. Execute also requires one provider tab with the same agreement. The submission is rejected if rendered selection and in-memory state differ.

> [!important]
> **Execute + Codex** constructs `mode: execute` with `provider: codex` while its Plan council checkbox is off. The same visible workflow constructs the internal `mode: plan` with `provider: council` only when the user explicitly checks Plan council. Never infer council intent from an ambiguous or inconsistent composer selection.

Plan council is an option inside Execute rather than a standalone workflow category. Its switch starts unchecked, and the selectable Claude-first or Codex-first route and readiness details remain hidden until enabled. Enabling it hides direct execution settings, changes the primary action to **Build reviewed plan**, and sends `councilEnabled: true`. The first provider authors and revises; the other provider reviews. Current automatic mode supplies one Claude and one Codex terminal from the project pool. The legacy compatibility path still uses explicit `authorThreadId` for Claude and `threadId` for Codex regardless of which provider owns the author role. Choosing Claude in the ordinary direct-provider flow turns the option off and continues as direct Claude execution. Leaving Execute or successfully submitting also resets the switch.

> [!note]
> A completed Execute Plan council exposes one canonical project-local `plan.md` at `<project-root>/.data/tasks/<task-id>/plan.md` and an **Execute reviewed plan** panel. Its selector chooses Codex or Claude in automatic mode. CC Relay creates a linked disposable Execute task containing the original request, final reviewed plan, canonical path, and copied references. It never implements automatically when planning completes. Failed councils expose **Resume**, relaunch their saved conversations, and keep completed stage checkpoints. See [[plan-council]].

The routing checks live in `public/task-routing.js` and are covered by `test/task-routing.test.mjs`.

## Terminal assignment

Disposable tasks are assigned to a provider pool, not a pre-existing terminal. They cannot be manually reassigned or dragged onto a live session. A queued task has no `thread_id` until its fresh terminal binds, and its launch is governed by project capacity. The automatic renderer does not offer legacy Assign or parallel-bundle controls for these rows.

Legacy persistent Codex and Claude Execute tasks can move to another connected terminal of the same provider in the same workspace. Each legacy task card exposes an **Assign** control when another eligible terminal exists. Claude assignment requires `capabilities.queuedClaudeAssignment`, so refreshed assets do not call an older backend.

The server validates the task status, provider, mode, live terminal connection, and normalized workspace path before changing `thread_id`, `thread_name`, and `thread_source`. It also updates the persisted task artifact and records a queue event.

> [!important]
> Reassignment never moves work to another workspace and never interrupts a running task.

> [!note]
> A legacy direct Claude task whose selected terminal reports busy remains queued with no `started_at` until that session is idle, idle routing finds another destination, or the user assigns another same-workspace Claude CC Relay. Current disposable tasks wait for the project's Claude capacity and launch a fresh terminal. See [[claude-busy-dispatch]].

The legacy composer offers **Use an idle CC Relay when available** above its terminal list. This preference is stored as `projects.prefer_idle_terminal` for the selected project and is never shared with another project. Disposable work does not idle-route because it launches exactly the provider terminal it needs. See [[project-terminal-settings]].

> [!note]
> Task 208 on July 21, 2026 exposed the old Codex-only routing condition and global direct Claude lock while task 207 was running on another Claude UUID. CC Relay now routes within the selected provider and gives each direct Claude session independent runner ownership.

Fresh disposable Execute tasks always start new conversations. Codex and Claude retries or explicit continuations resume their persisted conversation IDs in newly launched terminals. OpenCode retry resumes its persisted native session in a headless process and does not expose the continuation dock. On macOS the owned Claude terminal displays the turn and CC Relay mirrors its transcript into Task Activity. See [[disposable-terminal-pools]], [[opencode-provider-and-token-throughput]], and [[diagnostics]].

> [!important]
> Do not restore background fresh-context execution. A separately created app-server thread is visible in CC Relay Task Activity but not in the selected native terminal, which makes that terminal appear stalled.

> [!important]
> Connection status alone is insufficient for idle routing. A terminal can still report `idle` while persisted tasks are already assigned and waiting for it. `submissionThreadId()` must exclude every thread referenced by a queued or running direct task from the selected provider so consecutive submissions spread across genuinely free Relays.

> [!note]
> A newly launched CC Relay can take a few seconds to join discovery. When idle routing is enabled and the selected CC Relay is busy, submission allows a three-second discovery grace period before falling back to the selected CC Relay. This prevents work from being pinned behind a busy CC Relay when a terminal launch was already in progress. Task 155 on July 20, 2026 exposed the race: enqueue validation ran about two seconds before the new CC Relay joined.

Direct Codex and direct Claude tasks execute concurrently up to the selected project's provider limits. A saved conversation remains sequential even when the limit is higher. Normal FIFO and exclusive barriers are evaluated within each exact `repo_path`: a running Plan council in one project does not block eligible direct work in another project. A current disposable Plan council also shares its own project with disposable direct and breakdown work when the combined one-Claude, one-Codex council requirement fits. It remains globally serialized against another Plan council and against automatic Turbo. Automatic Turbo parents may run concurrently with each other up to their project setting. Legacy persistent councils and Turbo keep their project barriers.

> [!important]
> Treat `mode = execute` with `provider = claude` as direct execution for project scheduling, not as a project-wide exclusive entry. Before launch, reserve one Claude project slot. After binding, reserve its conversation ID as well. `ClaudeExecutionRunner` tracks active processes by task ID and session ID, allowing different conversations to overlap while rejecting duplicate work on one conversation.

Automatic Turbo is capacity-managed rather than a project-wide exclusive parent. Each executing Turbo prompt owns one fresh Codex terminal, and one queued prompt may own a fresh planner terminal. Queued direct Codex, Claude, and OpenCode tasks can run beside them whenever their own provider limit has a free slot. This specifically prevents independent provider work from waiting behind unrelated Codex Turbo work. Ready Turbo parents also run beside each other up to the configured execution count. Plan council and legacy persistent exclusive workflows still block that overlap. See [[turbo-execution]].

Turbo look-ahead is an internal preparation phase, not a second queue lane. It leaves the parent in its existing FIFO `position`, so priority submissions, manual reorder, pause, and direct provider concurrency retain their normal behavior. One automatic planner per project may prepare the earliest unplanned Turbo parent whenever a Codex slot is free. A `ready` parent can start its sole executor when it reaches an eligible queue position and an execution lane is available.

When the optional Turbo council is enabled, a queued parent may also be `reviewing` while the selected second provider performs the read-only correction pass. The parent remains queued, reorderable, and cancellable. With Codex first, its fresh Codex planner closes before Claude review. With Claude first, no Codex terminal opens during authoring; one fresh Codex planner opens only for review and closes afterward. Neither route changes `activeTaskId`, queue position, or FIFO execution order. See [[turbo-plan-council]].

> [!important]
> `TaskQueue.scheduling` protects only the synchronous dispatch pass. It must not remain true while awaiting the lifetime of running tasks. `runNext()` starts eligible tasks without awaiting their completion, and each `runTask()` schedules another dispatch when it settles. This lets a task enqueued for CC Relay 1 start immediately while CC Relay 2 is already running.

Queue status exposes both the backward-compatible `activeTaskId` and the complete `activeTaskIds` list. Cancellation is addressed by task ID so stopping work on one CC Relay does not interrupt another CC Relay.

## Task list ordering

The operational Queue view ranks running tasks first, completed tasks awaiting review second, open retained sessions third, queued work fourth, and other terminal outcomes last. Queued cards follow ascending execution `position` from top to bottom: the oldest or manually promoted task is at the top, and a normal task appended with Enter appears at the bottom of the queued block. This visual order preserves FIFO execution inside the queued group. Ctrl+Enter remains the explicit **Run now** exception because its priority position is placed below the current minimum queued position, so it may appear at the top of that group. Review-ready and other terminal outcomes remain newest first by task ID instead of retaining obsolete queue positions.

`sortOperationalTasks()` in `public/task-history.js` owns this presentation order and accepts a review-state predicate from the renderer. It returns a copy so rendering cannot mutate the API snapshot. `public/app.js` calls it only for the unfiltered Queue view; History remains date ordered and task search remains relevance ordered. When Task Activity acknowledges a completion, the same predicate becomes false on the rerender and the card leaves the review block without changing SQLite task state or queue position.

> [!important]
> Review priority is a browser presentation state, not scheduler priority. It must never change queued task positions, FIFO barriers, provider capacity, or persisted task status.

> [!important]
> Apply `position` ordering only to queued rows. A completed task's position describes where it once waited and must not determine history recency.

> [!important]
> `mergeProjectQueueOrder()` must merge the visible queued IDs, already ordered by ascending execution position, back into the hidden global queued slots. Send that visible ascending order directly so a scoped reorder cannot silently change execution order for unrelated tasks.

> [!important]
> Every reorder request carries `expectedTaskIds` plus the requested `taskIds`. SQLite compares the expected ascending queued snapshot inside `BEGIN IMMEDIATE` before changing any position. A stale snapshot, task leaving the queue, duplicate, or missing ID rejects atomically and leaves the committed order untouched.

## Deterministic queue dragging

The Queue view is an execution ledger: queued cards and their drag targets are displayed in ascending execution position from top to bottom. A reorder gesture begins only from the card's drag grip; the rest of the card remains available for selection, buttons, and terminal assignment. The grip shows one insertion marker while a valid drop is active, and no task order is mutated during pointer movement.

At drag start, the client captures one immutable snapshot containing the complete global queued ID order and the visible queued IDs for the current project. A drop may permute only the visible IDs, then merges that permutation back into the same original global slots. This preserves hidden tasks from other projects rather than moving unrelated work.

The reorder request includes both `expectedTaskIds` (the captured global queued order) and `taskIds` (the proposed global order). The database compares `expectedTaskIds` with the exact current queued order inside one `BEGIN IMMEDIATE` transaction. A stale snapshot is rejected atomically without changing any positions, after which the client refreshes and asks the user to retry from the latest order. Arrow controls use this same pure reorder transaction, so keyboard and pointer behavior cannot diverge.

This contract is separate from assignment dragging: dropping a queued Codex task onto a numbered CC Relay card changes terminal ownership, while queue-grip dragging changes only execution order. [[turbo-execution]] look-ahead, FIFO barriers, and the **Run now** Ctrl+Enter priority exception remain unchanged.

> [!note]
> Ordinary enqueue and retry append after the largest persisted position, including positions held by completed historical records. `nextQueuedTask()` still selects the smallest queued position; only **Run now** intentionally inserts before waiting work. Regression coverage lives in [[../test/database.test.mjs]] and [[../test/queue.test.mjs]].

#relay #tasks #history #persistence #sqlite
