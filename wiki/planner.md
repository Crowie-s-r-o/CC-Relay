---
name: Planner
description: Per-project plan library with a dependency-aware AI breakdown, iterative refinement, and orchestrated plan runs that execute steps through the existing queue.
type: architecture
---

# Planner

The Planner is a per-project library of saved implementation plans plus an AI-assisted breakdown that turns a plan into a dependency graph of reviewable task proposals, and a **plan run** that executes those steps through the ordinary queue as their dependencies complete. It is reached from a **Planner** button in the composer heading and opens as a modal that follows the Terminal Settings dialog pattern. Like every operational surface, it is scoped to the selected Launchpad project. See [[project-workspaces]] and [[interface-layout]].

Planner v1 saved a plan and produced a flat list of `{title, prompt}` proposals the user queued by hand. v2 makes the Planner an orchestrator: the breakdown declares dependencies, a run enqueues each step exactly when it becomes runnable, independent steps fan out across provider slots, and refinement revises a breakdown instead of restarting it. Current UI chooses Codex or Claude for each operation and uses the selected project's disposable terminal pool.

## Data model

Four additive SQLite tables live in `src/database.mjs` (new-table migrations plus one additive column, no destructive `ALTER`):

- `plans` - `id`, `repo_path` (the same project scope key tasks bind to), `name`, `content`, `created_at`, `updated_at`.
- `plan_breakdowns` - `id`, `plan_id` (foreign key, `ON DELETE CASCADE`), `task_id` (the linked queue task), `provider`, `session_id`, `session_label`, `guidance`, `status`, `parsed`, `raw_response`, `proposals_json`, `notes_json`, `error`, timestamps.
- `plan_runs` - `id`, `plan_id` (cascade), `breakdown_id`, `provider`, `session_id`, `session_label`, `session_source`, `prefer_idle_terminal`, `terminal_lifecycle`, `terminal_layout_json`, `model`, `effort`, `status`, `error`, timestamps, `finished_at`.
- `plan_run_steps` - `id`, `run_id` (cascade), `proposal_id`, `position`, `title`, `prompt`, `depends_on_json`, `task_id`, `status`, `error`, timestamps.

A plan can accumulate several breakdown attempts; the newest row is the plan's current breakdown, and every row carries its 1-based `attempt` ordinal. Proposals are stored as JSON on the breakdown row (`[{ id, title, prompt, dependsOn }]`) so review edits persist independently of the plan brief.

`notes_json` is added through `ensureTableColumn`, so a `plan_breakdowns` table created by a v1 backend gains it on the next start with its existing rows intact.

## Breakdown contract v2

`buildBreakdownPrompt` asks for `{"tasks":[{"id","title","prompt","dependsOn":[]}]}` and tells the model that independence is load-bearing, because CC Relay really does run independent steps at the same time in different sessions.

`parseBreakdownResult` stays tolerant and never invents work:

- Code fences are stripped, a bare array or an object under `tasks`/`proposals`/`items` is accepted, and an object embedded in prose is extracted.
- A missing title is derived from the prompt; an entry with no prompt is dropped.
- A missing `dependsOn` becomes `[]`.
- A declared reference resolves to an internal proposal id. **Stored dependencies are always internal ids, never the model's labels.** A bare 1-based index is accepted as a fallback for a model that ignores ids.
- An unknown reference and a self-reference are pruned.
- A cycle is broken deterministically: steps are walked in list order and their references in declared order, and an edge is accepted only when it does not close a cycle against the edges accepted so far. The dropped edge is always the one that closes the loop, and a valid forward reference survives. Steps are never dropped or merged to fix a graph.

Every pruned or broken edge records a note on the breakdown row: `{ code, message, proposalId, ref }` with `code` one of `unknown-dependency`, `self-dependency`, `cycle-dropped`. The Planner shows them so a vanished dependency is explained rather than silent.

> [!important]
> `validateProposals` re-sanitizes the whole graph on every edit, in this order: unique ids, then prune references to ids that no longer exist, then break cycles. The order matters. Removing a step in the review UI is exactly what leaves a dangling reference behind, and regenerating a duplicate id (Finding 25) is exactly what can orphan a reference to it. Without this, the first user edit would erase the dependency graph.

## Refinement

`POST /api/plans/:id/breakdown/refine` starts a **new** breakdown attempt whose prompt carries the plan, the current proposals **as the user edited them**, and the feedback, instructing the model to revise rather than restart. Prior attempts stay in `plan_breakdowns` and the newest remains current, so the attempt history is a real record.

The model is handed the current proposal ids and asked to echo them for steps that survive. `normalizeProposals` honours an echoed id when it belongs to the previous attempt, so a surviving step keeps its identity and the user's selection across the revision. Ids the user has never seen are always regenerated.

Refinement reuses `breakdownInProgress`, so it cannot race a breakdown that is still running or sitting in the automatic-retry window (Finding 23).

## Plan runs

A run is an explicit action over the proposals the user selected. In automatic mode, `POST /api/plans/:id/run` validates the selected provider, pinned project, terminal lifecycle, and launch layout. The project must match the plan's own `repo_path`. The legacy path still validates a live same-workspace session. Both paths validate that the plan has no other non-terminal run and that model and effort are valid for the provider. Starting a run latches any earlier non-complete run to `stopped`, which is what keeps "at most one non-terminal run per plan" true even though `failed` is derived.

> [!warning]
> A new run is also refused with `409` while the **previous** run still has a step in `queued`, `running`, or `retrying`. The per-step submission id is keyed on the run id, so a second run mints new tasks for the same prompts and the idempotency guard cannot collapse them. Since stop deliberately leaves in-flight tasks alone, stop-then-run-again is exactly the path that would execute a step twice. The user clears it by cancelling the leftover steps or waiting for them to drain.

> [!important]
> Both conflict checks live in `planRuns.startConflict()` and are re-run **inside** `start()`, synchronously, immediately before the write. The route's own check is an early read for a good error message only. Between the route's check and its call to `start()` sit three awaits (the request body, the live session, the model list), so two overlapping submissions from a second tab or a double dispatch can both clear a route-level guard; only a guard next to the write can decide. `stepsInFlight` reads the live task rows rather than the persisted step statuses for the same reason: it has to be correct without a preceding reconcile pass. Latching earlier runs to `stopped` happens only after the check passes, so a refused start leaves the existing run exactly as it was.
>
> `POST /api/plans/:id/breakdown` and `/breakdown/refine` have the same guard-before-await shape with a smaller blast radius (a duplicate read-only planning turn), and both call `requireNoBreakdownInProgress` a second time immediately before creating the row.

> [!important]
> The run engine (`src/plan-run.mjs`) is a **reconciler, not a runner**. It owns no processes and no scheduling. A step whose dependencies are all complete is enqueued as an ordinary `mode: 'execute'` task through the same `queue.enqueue` path the composer uses. An automatic run copies `terminal_lifecycle` and `terminal_layout_json`, leaves the task thread empty, and lets the disposable pool assign a fresh provider instance. A legacy run carries `preferIdleTerminal` for dispatch-time routing. Everything after enqueue belongs to the queue.

Every pass recomputes the entire run from database state, so re-entry, a missed event, and a restart all converge on the same answer.

### The double-enqueue guard

Each step's submission id is `sha256("relay-plan-step:<planId>:<runId>:<proposalId>")` shaped as a version 4 UUID. Because it is a pure function of plan, run, and step, any repeated enqueue collapses onto the task the queue already created through its existing submission-id idempotency guard.

Three things make re-entry safe together, and all three are deliberate:

1. `queue.enqueue` emits `changed` **synchronously**, which re-enters this reconciler through the server listener while the enqueue loop is still running. The coordinator holds a per-run guard set so only one pass per run is ever in flight.
2. The reconciler enqueues from the **step snapshot** (`title`, `prompt`, `depends_on_json` frozen at run start), never from the live proposal. `enqueue` throws when a submission id repeats with a different prompt, so reading the live proposal would turn a mid-run proposal edit into a bogus step failure.
3. The enqueue predicate is `status === 'waiting' && task_id IS NULL && every dependency complete`. The `task_id IS NULL` clause is what stops a deleted task from being resurrected under the same deterministic id.

### Statuses

Step: `waiting`, `queued`, `running`, `retrying`, `complete`, `failed`, `cancelled`, `blocked`.
Run: `running`, `stopped`, `complete`, `failed`.

> [!important]
> `blocked` and the `failed` run status are **derived every pass, never latched**. A step is blocked exactly while it has no task yet and some dependency is currently failed, cancelled, or itself blocked; propagation runs to a fixpoint because a valid dependency may point at a later position. That is what makes the ordinary task retry the un-block mechanism: the user retries the failed step's task through the normal Task Activity retry, the step re-arms, its dependents un-block, and the run derives back to `running` with no extra bookkeeping.

The queue keeps ownership of retries. A step whose task failed with an automatic retry already scheduled is `retrying`, not `failed` (the `queue.pendingRetryTaskIds()` pattern from `breakdownInProgress`), so it stays in flight and does not block anything. Only a failure with nothing scheduled counts. An `interrupted` task, which recovery produces after a restart and which never auto-retries, is treated as failed-with-no-retry. A task row the user deleted is also a failure, deliberately not a reason to enqueue the step again.

### Stop

`POST /api/plans/:id/run/stop` means **enqueue nothing further**. Steps already queued or running are left alone and stay individually cancellable through the normal task cancel. `stopped` is the one latched status: counts keep updating as in-flight steps drain, but the run never derives back into running, complete, or failed. Stop is idempotent, so a second press during the drain is a no-op rather than an error.

Deleting a plan calls `release()` first, which stops **every** run of that plan and cancels their still-queued step tasks. Leaving that to `ON DELETE CASCADE` would orphan queued tasks that nothing owns any more, and older latched runs can hold them too.

### Restart safety

`server.listen` calls `queue.start()` and then `planRuns.reconcileAll()`, in that order. `recoverInterruptedTasks()` marks tasks that died with the server as `interrupted` without emitting any queue change, so nothing else would tell a run its steps are gone. Reconciling after recovery turns each interrupted step into failed-no-retry, blocks its dependents, and lets the user retry. A wave that completed while CC Relay was down is enqueued on that same boot pass.

`GET /api/plans/:id` also reconciles an active run. That is a repair path, idempotent and guarded by the deterministic submission id, and it is the same role the visible-page refresh plays for the task list.

## Breakdown scheduling is no longer exclusive

A breakdown runs as an ordinary `mode: 'breakdown'` queue task on the chosen provider. Automatic work launches a disposable terminal when capacity is available. `RelayRunner.run` falls through to the provider runner by `task.provider`, exactly like direct execution.

> [!important]
> v1 scheduled a breakdown as an exclusive head, which froze its whole project and consumed the shared exclusive slot that Plan council and Turbo depend on. That tradeoff is **revoked**. `TaskQueue.isSingleSessionTask` now classifies direct Codex, direct Claude, and breakdown work together, and it replaces `isDirectExecutionTask` at all five scheduling and reservation sites: `reservedThreadIds()`, `sharedExclusiveAvailable`, the project-active guard, the exclusive-head check, and the head-of-line `break` in the per-project dispatch loop. A breakdown now serializes only on its own session.

Reserving the running breakdown's own session in `reservedThreadIds()` is the load-bearing half of that change: without it, dropping exclusivity would let a second task start on the session a breakdown is already using.

Plan council and Turbo remain non-single-session and still hold `sharedExclusiveAvailable`, so only one such workflow starts globally. Current disposable Plan councils have one additional capacity-managed exception: they may share their own project with disposable single-session work when all provider requirements fit. Legacy persistent councils and Turbo retain the project-draining barrier. `test/breakdown-scheduling.test.mjs` pins the legacy behavior, while `test/plan-council-capacity-scheduling.test.mjs` pins current pool behavior.

## Parse tolerantly, never invent tasks

When the breakdown task settles, `syncPlanBreakdown` in `src/server.mjs` (hooked into the queue `changed` listener) reconciles the breakdown row against the linked task through the pure `breakdownUpdateForTask(task, breakdown, { knownIds })`.

> [!important]
> A breakdown task uses the ordinary automatic-retry path, so its status can legitimately move `failed -> running -> complete`. `breakdownUpdateForTask` is therefore a reconciler, not a one-shot finalizer: it computes the desired state on every call and writes proposals **only on the transition into `complete`**. This self-heals a transient failure and never overwrites proposals the user has already edited, removed, or reordered. Regression coverage lives in `test/plan-breakdown.test.mjs`.

If nothing parseable comes back, the breakdown completes with zero proposals and `parsed = 0`; the raw response is surfaced in the Planner instead of creating any task. CC Relay never creates tasks from unparseable output.

### Deleting a breakdown task is allowed and fails the attempt

A breakdown task looks like any other queue card, and users delete queued tasks freely. Deleting one stays allowed; `breakdownUpdateForDeletedTask` marks the breakdown row `failed` with an explanatory error so the plan recovers and the user can start another attempt.

> [!warning]
> Without that rule the deletion was a **silent, permanent plan lockout**. `syncPlanBreakdown` found no task, returned false forever, and the row stayed `pending`; `breakdownInProgress` then reported true for good, so every breakdown, refine, and run route for that plan refused work until the plan itself was deleted. The same lockout was reachable through the parallel Codex batch, which deleted its source tasks after bundling them. That route now accepts `mode: 'execute'` tasks only: a breakdown, a Plan council, and a Turbo task each carry machinery their owner still tracks by task id, and bundling one deletes that task out from under it.

The rule is scoped: `breakdownUpdateForDeletedTask` only touches a `pending` or `running` row, so a completed breakdown's proposals are never disturbed by its task being cleaned out of the queue.

## API

All routes bind to `127.0.0.1`, validate their inputs, and return `404` for unknown ids. `GET /api/status` advertises `capabilities.planner` and `capabilities.plannerV2`.

- `GET /api/plans?projectPath=` - plans for a project, each with a light breakdown summary and a run summary `{ id, status, counts, updatedAt }`.
- `POST /api/plans` - create `{ projectPath, name, content }`.
- `GET /api/plans/:id` - a plan plus its latest breakdown and its latest run; reconciles an active run.
- `PATCH /api/plans/:id` - update `name` and/or `content`.
- `DELETE /api/plans/:id` - delete the plan; cascades breakdowns and runs, best-effort cancels an active breakdown task, and releases the run.
- `POST /api/plans/:id/breakdown` - start a breakdown with `{ provider, projectPath, terminalLifecycle: "disposable", terminalLayout, guidance }`, or legacy `{ threadId, provider, guidance }`.
- `POST /api/plans/:id/breakdown/refine` - start a revising attempt with `{ feedback, provider, projectPath, terminalLifecycle, terminalLayout }`, or a legacy session assignment.
- `PATCH /api/plans/:id/breakdown` - replace the latest breakdown's proposals (edit, remove, reorder, re-link).
- `POST /api/plans/:id/breakdown/queue` - queue selected proposals on a provider pool, or a legacy live session, as ordinary tasks with no dependency orchestration.
- `POST /api/plans/:id/run` - accepts selected proposal IDs plus the same automatic provider/project/lifecycle fields, or legacy session and idle-routing fields; `409` when a run is already in progress or the previous run still has steps in flight.
- `POST /api/plans/:id/run/stop` - `409` when there is no active run.

Every route that sends work goes through `resolvePlannerTaskSession`. Automatic requests validate a pinned same-project path and Claude readiness when needed, then create a synthetic no-thread destination for queue persistence. Legacy requests delegate to `requirePlanSession` for live-session validation.

The run view returned by the run routes and embedded in `GET /api/plans/:id`:

```json
{
  "id": 3, "planId": 1, "breakdownId": 7, "status": "running",
  "provider": "codex", "sessionId": "automatic:codex",
  "sessionLabel": "Automatic Codex instance", "terminalLifecycle": "disposable",
  "preferIdleTerminal": false, "model": "sol", "effort": "high",
  "createdAt": "...", "updatedAt": "...", "finishedAt": null, "error": null,
  "counts": { "total": 3, "waiting": 1, "queued": 1, "running": 1,
              "retrying": 0, "complete": 0, "failed": 0, "cancelled": 0, "blocked": 0 },
  "steps": [{ "proposalId": "...", "title": "...", "position": 1,
              "dependsOn": [], "taskId": 42, "status": "running", "error": null }]
}
```

## Review before run

Proposals render in the Planner for inline title/prompt editing, dependency editing, removal, and reordering, each persisted through `PATCH /api/plans/:id/breakdown`. Nothing auto-executes: only an explicit **Run plan** (orchestrated) or **Queue selected tasks** (flat) action creates work. From the moment a step is enqueued it is indistinguishable from a composer-created task, which is exactly why cancel, retry, steering, and Task Activity all work on it unchanged.

## Frontend

- Entry point: a keyboard-accessible **Planner** button in the composer heading (`queue-heading-button` treatment), always visible, never hover-only.
- Modal: `#planner-modal`, a sibling of the task editor **outside** `#task-form` (avoiding the nested-form gotcha in [[diagnostics]]), reusing the `terminal-settings-card` shell with `planner-*` classes only. It deliberately avoids the protected `plan-council-option` / `council-route` / `council-node` / `council-connector` classes that `test/composer-workflows.test.mjs` counts. The dialog is `min(1400px, 100vw - 32px)`: a wave of steps with editable prompts and a dependency picker is unusable in the former 1060px shell.
- Pure logic lives in two DOM-free modules: `public/planner-state.js` (v1 status machine and flat proposal transforms, `test/planner-state.test.mjs`) and `public/planner-board.js` (waves, dependency guards, run presentation, `test/planner-board.test.mjs`).

### The dependency board

Proposals are grouped into execution **waves** by `computeWaves`: steps with no unmet dependency are wave 1, steps depending only on wave 1 are wave 2, and so on. Steps caught in a cycle are reported separately as `unresolvable` and rendered in a **Cannot run** group rather than folded into a final wave that would look dispatchable. Each step is a compact dispatch ticket reusing the Turbo `.turbo-graph-*` visual language without borrowing its selectors: a state port, a mono step number, an editable title, a status chip, and quiet move/remove controls. Dependencies appear as a plain sentence (`Runs after steps 2 and 3`) recomputed from the current index at render time, so reordering can never leave a stale step number behind. There is no canvas and no graph library.

Status colors follow the established semantic palette: running is purple, complete green, failed red, blocked amber, cancelled neutral gray. Orange is never borrowed, it stays Claude identity. `retrying` uses the running tone with its own label and inset ring because it is work still in flight, not a failure.

### Editing

Inline title and prompt editing, remove, reorder, **+ Add step**, and a checkbox dependency picker all persist through the same `PATCH /api/plans/:id/breakdown`, which always carries `dependsOn` on every proposal. Two client-side guards keep the payload a self-consistent DAG so the server never has to prune behind the user's back: removing a step also drops every reference to it (`pruneDanglingDependencies`), and an edge that would close a cycle is shown unavailable rather than offered and refused (`dependsOnTransitively`). Editing is disabled per step while the run owns it: `stepEditingLocked` locks `queued`, `running`, and `retrying` always, and `complete` only while the run is still live, so a failed step stays editable for the next run.

Manual **+ Add step** requires a completed breakdown, because `PATCH` returns `409` unless the breakdown status is `complete`. `plannerProposalsEditable()` mirrors that exact server rule, so the whole board goes read-only whenever the latest attempt is not complete and the board can never offer an edit that would come back as a conflict. `updatePlannerRunProgress` applies the same rule, or the next poll would silently unlock it.

> [!important]
> A newly started breakdown or refinement is the latest attempt but it is `pending` and carries no proposals yet. Adopting it would blank the board: the previous steps, the run bar, and the **only Stop control** would all disappear mid-run, and a failed refinement would leave nothing to recover from, since refine rejects a zero-proposal latest attempt and `PATCH` is closed too. The board therefore keeps showing the last completed attempt, read-only, behind an "attempt N is running" banner, and the run bar is mounted whenever a run exists rather than only when proposals are present. A failed or cancelled attempt adds a recovery block naming its breakdown task with a direct **Open breakdown task #n** action.

> [!warning]
> The parallel batch replaces its selected tasks with one combined Codex task, destroying the original rows. A breakdown task owns state outside the queue, so batching one leaves its plan pointing at a task that no longer exists and bricks the plan. The batch checkbox is offered only for direct `execute` tasks, and the batch selection is pruned against that narrower set so a stale non-execute id cannot survive in `state.parallelTaskIds`. The server rejects them as well; this is the client half.

### Live runs without clobbering edits

> [!important]
> Rendering is split in two and this split is the whole never-clobber guarantee. `renderPlannerBoard()` rebuilds markup and runs **only** when `plannerBoardSignature` changes (proposal ids, order, dependency edges, breakdown attempt, run identity or status, capability). `updatePlannerRunProgress()` is what the 2.5 second poll calls: it writes `textContent` and `dataset` on existing nodes and never touches `innerHTML` except the small state port, and only when that step's status actually changed so a running spinner is not restarted. A wholesale `innerHTML` replacement over a board full of textareas would destroy the caret, the IME composition, and the native undo history on every poll.

Proposal adoption is gated by the pure `shouldAdoptServerProposals`: a background refresh replaces local proposals only when nothing is dirty and no save is on the wire. The one exception is a new breakdown attempt id, which legitimately replaces the list because the user asked for a refinement. `persistProposals` clears a dirty id only when the local value still equals what was sent, so a keystroke landing mid-PATCH stays protected.

The poll follows an active breakdown **or** an active run. Run progress is announced through one dedicated `#planner-run-announce` live region written only when its sentence changes; `#planner-detail` deliberately carries no `aria-live`, because it is rebuilt on every structural change and would otherwise announce the whole dialog on each poll.

A failed step shows its error excerpt and an **Open task #n** action that closes the modal and opens that task in Task Activity. A blocked step names its blocker in plain text (`Blocked by failed step 3`). Because `stopped` is latched and nothing further will be enqueued, a step still `waiting` in a stopped run reads **Not started** rather than implying it is queued behind its dependencies.

### Run controls

The run bar offers a provider picker in automatic mode. It adds no second model picker: model and effort come from the composer's per-provider memory and are stated in plain text. The legacy path keeps its session picker and **Use an idle CC Relay when available** toggle. Consent stays absolute, nothing executes until **Run plan** is pressed. **Stop run** is offered only while the run is running and its copy states that tasks already running continue and stay cancellable from the queue.

> [!important]
> Run plan stays enabled for a `complete`, `failed`, or `stopped` run, but is disabled while the previous run still has a step in `queued`, `running`, or `retrying`. That is the client half of the stop-then-rerun double-execution guard: per-step submission ids are keyed on the run id, so a second run mints new tasks for the same prompts and the queue's idempotency guard cannot collapse them. The button reads **Previous run draining** with a live readable count (`runStartBlockReason`), which counts down on its own because the run counts keep updating during the drain. The server `409` remains the backstop and its message is rendered in the planner status line, never swallowed.

Which steps are checked when an attempt is adopted is decided by the pure `defaultRunSelection`, and it deliberately does two things beyond selecting everything: a step the latest run already **completed** is never auto-selected, so pressing Run plan cannot silently repeat finished work, and a surviving step the user had explicitly unchecked stays unchecked across a refinement. Genuinely new steps, and the first load of a plan, start selected.

> [!important]
> Only a **complete** attempt may latch `selectionAttemptId`. The live sequence is POST, adopt the new attempt while it is still `pending` with no proposals, then adopt it again once it completes. Latching against the pending attempt reseeds the selection against an empty list and then matches on the completion pass, so every breakdown and refinement would finish with nothing selected and Run plan disabled. `test/planner-board.test.mjs` walks that exact two-step sequence.

Consent is re-validated again at press time by `runnableSelection`, not only when the checkboxes were seeded. A refinement landing mid-run can select steps that were merely in flight at adoption; if the run has since completed them, they are dropped from the request, unchecked in place, and named in the status line.

Both **Refine** and **Run plan** flush pending step edits first, and `flushProposalEdits` **throws** when that save fails. Proceeding would seed the server's older copy and then discard the user's newer edits when the result is adopted; a second tab that already moved the breakdown on is the realistic cause.

Refinement is a feedback textarea plus **Refine breakdown** with a history note naming `breakdown.attempt`. It flushes the current edited steps before starting and is labeled as sending them for revision, so a refinement never silently discards user work.

> [!note]
> Refining is deliberately allowed **while a run is in flight**. The run holds its own step snapshot, so a new attempt cannot corrupt it. An earlier draft disabled Refine during a run, which created a one-way door: recovering from a failed step mid-run would have required Stop, which is latched and cannot be resumed. The only bar is the one the server actually enforces, an attempt already in progress.

> [!important]
> Graceful degradation: the user's running backend can predate this API. When `capabilities.planner` is absent the modal shows **Restart CC Relay to use the Planner**; when `capabilities.plannerV2` is absent the v1 flow stays fully usable, **Queue selected tasks** remains the primary action, dependency pickers are hidden, and Add step and Refine are disabled behind the standing "Restart CC Relay to ..." convention.

## Review decisions

The v1 audit verdict was Ship with Mitigations. Three low-severity findings were fixed and one accepted:

- **Finding 22 (fixed).** `PATCH /api/plans/:id/breakdown` rejects with `409` unless the breakdown status is `complete`. Only a completed breakdown owns editable proposals, so the never-overwrite-user-edits guarantee holds unconditionally.
- **Finding 23 (fixed).** The duplicate-breakdown guard treats a breakdown as in progress when its row is `pending`/`running` **or** its linked task is queued, running, or scheduled for an automatic retry (`queue.pendingRetryTaskIds()`). This closes the 5-second window between a failure and its retry. The decision lives in the pure `breakdownInProgress`, and refinement reuses it.
- **Finding 25 (fixed).** `validateProposals` runs `ensureUniqueProposalIds` inside `sanitizeProposalGraph`, regenerating any duplicate or blank client-supplied proposal id so edit/remove/reorder stay unambiguous.
- **Finding 24 (accepted, documented).** The id routes resolve a plan without re-checking that it belongs to the caller's active project. Accepted for a local, single-user tool bound to `127.0.0.1`: there is no second tenant to leak a plan to, and every route that sends work re-validates that the chosen session's workspace matches the plan's `repo_path` through `requirePlanSession`.

## Files

- `src/database.mjs`
- `src/plan-breakdown.mjs`
- `src/plan-run.mjs`
- `src/queue.mjs`
- `src/server.mjs`
- `public/index.html`
- `public/app.js`
- `public/planner-state.js`
- `public/planner-board.js`
- `public/escape-html.js`
- `public/style.css`
- `test/plan-breakdown.test.mjs`
- `test/plan-dependencies.test.mjs`
- `test/plan-run.test.mjs`
- `test/plan-run-integration.test.mjs`
- `test/breakdown-scheduling.test.mjs`
- `test/planner-database.test.mjs`
- `test/planner-integration.test.mjs`
- `test/planner-state.test.mjs`
- `test/planner-board.test.mjs`
- `test/planner.test.mjs`

## Related

- [[parallel-project-queues]] for per-session scheduling, the exclusive barriers, and dispatch-time idle routing.
- [[automatic-retry-safety]] for the retry bound a step failure depends on.
- [[task-add-reliability]] for why enqueue never blocks on a provider probe.

#relay #planner #plans #breakdown #queue #orchestration
