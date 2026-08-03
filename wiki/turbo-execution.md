---
name: Forward-Planning Turbo
description: Machine-readable planning and dependency-aware execution across multiple Codex terminals.
type: architecture
---

# Forward-Planning Turbo

Forward-planning turbo is the second composer workflow beside Execute. It uses one selected Codex terminal exclusively as a read-only planner and one or more other live Codex terminals in the same workspace as execution workers. The default fleet is three workers, which means four connected terminals in total. Both composer workflows expose Plan council as an optional checkbox rather than a separate category.

## Defaults

- Planner: GPT-5.6-Sol at high effort
- Workers: GPT-5.6-Luna at high effort
- Worker count: 3

The UI prefers models whose IDs contain `sol` and `luna`. If either model is unavailable, it falls back to the account default or first available model. Effort also falls back to a supported value.

## Plan contract

The planner returns JSON rather than Markdown. CC Relay validates this structure before any write-capable worker begins:

```json
{
  "version": 1,
  "summary": "Coordination summary",
  "sharedContext": "Contracts shared by every worker",
  "tasks": [
    {
      "id": "stable-task-id",
      "title": "Task title",
      "instructions": "Complete implementation scope",
      "dependsOn": ["another-task-id"],
      "ownedPaths": ["src/example.mjs"],
      "verification": ["npm test"]
    }
  ]
}
```

Validation rejects duplicate IDs, missing IDs, unknown dependencies, self-dependencies, cycles, incomplete tasks, and plans with fewer tasks than configured workers.

## Scheduler

CC Relay owns execution order. It maintains pending, active, and completed graph nodes. Any node whose `dependsOn` entries are complete may be assigned to a free worker terminal. When a worker finishes, CC Relay marks the node complete, unlocks dependents, and reuses that terminal for another ready node. Independent roots run concurrently up to the selected worker count.

The shared Codex bridge tracks active turns by terminal thread ID. This is required because the normal CC Relay queue still has one running parent task while turbo owns multiple concurrent child turns.

> [!important]
> Worker terminals must be distinct from the planner and must use the planner's exact workspace path. Workers share one working tree, so the planner must prefer disjoint file ownership and encode unavoidable ordering through dependencies.

## Stable CC Relay identity and queue resources

Codex CC Relay identity is global across workspaces and SQLite-backed by thread ID. A new Codex thread receives one monotonically increasing positive `relay_number` and immutable `relay_name` formatted as `CC Relay n`. Numbers are never reordered from `updatedAt`, recycled after disconnect, or reassigned to another thread. Reconnecting the same thread reuses its stored identity. Codex thread API objects expose `relayNumber` and `relayName`; Claude sessions remain unchanged. The UI and task history read these fields directly and never infer a number from discovery array order. See [[project-workspaces]] and [[task-history]].

Turbo reserves every worker CC Relay, a planner that is still actively preparing a graph, and a look-ahead planner whose `plannerBusy` is true. The normal queue is sequential per terminal and its FIFO barriers are scoped by exact project path. During an executing Turbo parent only, queued direct Codex Execute tasks in that project may cross queued exclusive entries to fill otherwise unreserved Relays. They cannot use a reserved worker, planner, or active direct-task terminal, and the scheduler never starts a second Plan council, Claude, or Turbo parent during this exception. Other projects retain their independent queue heads and may dispatch eligible direct Codex tasks. Once Turbo ends, the normal project FIFO and exclusive barriers return.

## Pipelined lifecycle

Turbo graph state is persisted in `turbo-plan.json` and follows six explicit stages:

| Stage | Parent task | Meaning |
| --- | --- | --- |
| `planning` | `queued` | A read-only planner turn is producing the graph. The parent keeps its queue position and remains reorderable and cancellable. |
| `reviewing` | `queued` | The first provider's graph is valid and the selected second provider is correcting it in read-only mode. The Codex planner CC Relay is reserved only when Codex owns the active stage. |
| `ready` | `queued` | The graph passed validation and is ready for workers. When the parent reaches the front of the queue, execution reuses this graph and skips the planner. |
| `executing` | `running` | The parent has started and CC Relay is dispatching dependency-ready graph nodes to worker terminals. |
| `complete` | `complete` | Every graph node finished successfully and the parent result is recorded. |
| `failed` | `failed` or retryable | Planning or worker execution failed. A failed or partial graph is never treated as ready. |

Only a persisted `ready` graph can bypass planning. Missing, malformed, `planning`, or `failed` state is prepared again on demand. The parent task does not become `running` merely because look-ahead planning has started.

## Look-ahead eligibility

Look-ahead starts only while at least one Turbo parent is in `executing` worker phase. Candidates are queued Turbo parents ordered by ascending execution `position`, then task ID. CC Relay starts a candidate only when its planner thread is free, is not one of the active worker threads, and is not already preparing another candidate. Different free planner threads may prepare different queued parents concurrently; preparation on one planner thread is serialized.

Planning ahead does not reserve or reorder a queue slot. Pause prevents new dispatch and new look-ahead work while allowing an already-started planner turn to settle. A queued task remains reorderable and cancellable while its graph is `planning` or `ready`.

## Cancellation, retry, and shutdown

Cancelling a queued task with an active plan preparation cancels only that parent's planner child turns, then marks the parent cancelled. Cancelling a running Turbo parent cancels only its worker and planner children. Deletion waits until active preparation is cancelled or settled. Retrying a failed, cancelled, or interrupted task clears its prior outcome and graph artifact, returning it to the normal queue.

On restart, running parents are marked interrupted. A queued graph left in `planning` is not executable and is prepared again; a validated `ready` graph may be reused. During shutdown CC Relay cancels active workers and planner preparations, waits briefly for their promises, and preserves the existing graceful SQLite and task-state shutdown path.

## Persistence and visibility

Turbo configuration is stored in the task's `turbo_json` database column. Runtime graph state is stored under the task artifact directory as `turbo-plan.json`. The task API returns this as `turboPlan`, and the task inspector renders graph nodes, dependencies, worker assignments, and current status.

Queued Turbo parents expose a compact `turboPlanSummary` containing only lifecycle `status`, `summary`, and graph `taskCount`. The complete task detail endpoint continues to return `turboPlan`. The queue keeps its canonical `queued` or `running` badge and adds a secondary marker: **Forward plan** while awaiting preparation, **Planning ahead** for an active queued preparation, **Plan ready** for a queued validated graph, and **Workers running** while a parent executes. Complete and failed variants communicate terminal outcomes without replacing the canonical task status. While a running Turbo parent dispatches workers, its planner terminal is visually idle unless it is already preparing another queued Turbo parent.

Graph progress presentation is DOM-free in `public/turbo-graph.js`. It treats `complete` and `failed` packages as terminal progress, reports pending dependency state as ready or blocked, and resolves worker ownership from persisted thread ID, stored title, plan worker slot, numeric worker, then a neutral `Worker n` fallback. The parent manifest keeps planner and ordered worker descriptors separate so the renderer can apply live CC Relay numbering and color classes only to connected threads.

`test/turbo-graph-integration.test.mjs` exercises the real `ArtifactStore` and `TurboRunner` with held worker turns. It verifies that assignments remain attached to running and completed packages, failed packages retain their error and worker identity, and disconnected history preserves stored titles without inventing a CC Relay number.

Each dispatched graph package persists the numeric `worker` slot for backward compatibility plus `workerThreadId` and `workerTitle`. Ready-plan reuse clears stale assignment and result fields before dispatch. On worker start the package becomes `running`; on success it becomes `complete` with its result; on rejection it becomes `failed` with a bounded error while retaining the worker identity. Presentation resolves ownership in this order: `workerThreadId`, `plan.workers[worker - 1]`, `workerTitle`, then neutral `Worker n`. A connected thread may be rendered as **CC Relay n** with its live relay color. A missing or historical thread is always rendered by its stored neutral title and never receives a guessed CC Relay number.

Graph progress reports total, pending, running, complete, and failed package counts. Complete and failed are terminal states for progress accounting, while the visible completion bar is labeled by complete packages over total packages. Empty active graphs are an indeterminate planning state, never `0 / 0 complete`. Until at least one package exists, the detail panel says **Planning dependency graph**, shows an animated planning sweep and skeleton tickets, and exposes an indeterminate accessible progressbar. A running Turbo parent with a missing graph artifact remains visually in **Planning graph** because worker execution cannot begin without a validated plan. See [[interface-layout]].

## Optional graph review council

Forward-planning can optionally add a two-provider graph council. The user selects **Codex -> Claude** or **Claude -> Codex**. The first provider authors the version-1 execution graph and the second independently checks and corrects it in read-only mode. `src/turbo-plan-council.mjs` owns a FIFO queue around the shared Claude runner for both Claude author and reviewer stages, while Codex uses the selected planner CC Relay. Every stage must return valid JSON; malformed or incomplete output is rejected before workers can receive it.

> [!note]
> Product intent distinguishes this from Execute planning. Execute is one large reviewed plan followed by one executor, which may use sub-agents. Each queued Forward-planning Turbo parent should instead receive its own higher-model plan, optionally through a council, then dispatch the resulting packages to smaller worker models or terminals. The current Turbo runner implements per-parent graph planning and multi-terminal dispatch, but its optional council is only a two-stage author/corrected-graph exchange. It does not return reviewer suggestions to the original author for a third revision stage.

The Turbo council toggle is off by default. When enabled, `turbo_json.council` persists the selected `order` plus author and reviewer provider, model, and effort settings. A queued graph is reusable only when the completed council configuration matches the task. The lifecycle is `planning` for the author stage, `reviewing` for the second provider, `ready` only after the corrected graph validates, then `executing`, `complete`, or `failed`. Disabled council tasks keep the original Codex planning path and never require Claude availability. Execute retains the existing Claude-author, Codex-review, and Claude-revision plan route behind its optional checkbox.

The composer reuses the Execute Plan council visual language without making council the only way to choose a planner. Its **Planning route** is always visible. With council off, it shows one unnumbered Codex planner node with selectable planning model and effort, while the Claude node, connector, and provider-order control stay hidden. Enabling council expands the same route to two bordered provider nodes with numbered author and reviewer roles. A compact **Codex first / Claude first** control swaps both node order and runtime role. The selected Codex planning settings are preserved across both states. Worker model, effort, and count remain separate execution settings. The question-mark disclosure explains the latency and Claude sign-in requirement. Requests carry the single planner settings in every Turbo submission and add the selected order plus generic author and reviewer settings only when council is enabled.

> [!important]
> Do not hide `#turbo-council-route` when council is disabled. Its `data-enabled="false"` state is the single-planner presentation and intentionally hides only the second provider and review connector. Hiding the whole route removes the only visible Turbo planner model selector even though the non-council runtime already accepts and persists `plannerModel` and `plannerEffort`.

Cancellation is parent scoped. A queued review rejects immediately with `cancelled: true`; an active review calls the matching Claude runner cancellation and lets its settled promise advance the queue. Success, failure, cancellation, and synchronous runner errors all release the queue so later parents cannot be wedged. See [[turbo-plan-council]] and `test/turbo-plan-council.test.mjs`.

TurboRunner records council configuration and compact author and reviewer audit metadata in `turbo-plan.json`. It does not copy the provider event stream into the artifact. For Codex-first, the planner CC Relay is released while serialized Claude review runs. For Claude-first, the Codex planner remains free during Claude authoring and becomes reserved only for the Codex review stage. Council-enabled `task.md` files identify the selected route and both role settings.

Queue preparation entries separate `plannerBusy` from `councilStage`. `plannerBusy` follows the provider that owns the current stage rather than the complete preparation lifetime. This lets Codex-first release its CC Relay during Claude review and Claude-first leave the CC Relay free until Codex review begins. Non-council preparations retain the original same-thread exclusion.

## Files

- `src/turbo-runner.mjs`
- `src/codex-app-server.mjs`
- `src/database.mjs`
- `src/relay-runner.mjs`
- `src/server.mjs`
- `src/artifacts.mjs`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `public/turbo-state.js`
- `public/turbo-council-state.js`
- `test/turbo-runner.test.mjs`
- `test/turbo-state.test.mjs`
- `test/turbo-graph-integration.test.mjs`

#relay #turbo #codex #parallel #dag #scheduler
