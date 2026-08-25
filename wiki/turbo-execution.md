---
name: Forward-Planning Turbo
description: Fresh per-prompt planning followed by one resumable execution session, with queue-level concurrency.
type: architecture
---

# Forward-Planning Turbo

Forward-planning Turbo is the second composer workflow beside Execute. In the current automatic pool it is a two-stage pipeline for each prompt: one fresh read-only planning terminal produces a machine-readable graph, closes, and then one different fresh execution terminal receives the complete graph. The executor may coordinate internal Codex sub-agents, but CC Relay never divides one Turbo prompt among several native execution terminals.

The numeric setting controls concurrent Turbo executions across the project queue. With the default value of three, up to three already-planned prompts may have one executor each while one additional planner prepares the next prompt. This is a planning lane plus three execution lanes, not a four-terminal fleet for one task. Both composer workflows expose Plan council as an optional checkbox rather than a separate category.

## Defaults

- Planner: GPT-5.6-Sol at high effort
- Executor: GPT-5.6-Luna at high effort
- Concurrent executions: 3

The UI prefers models whose IDs contain `sol` and `luna`. If either model is unavailable, it falls back to the account default or first available model. Effort also falls back to a supported value.

## Plan contract

The planner returns JSON rather than Markdown. CC Relay validates this structure before the write-capable executor begins:

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

Validation rejects duplicate IDs, missing IDs, unknown dependencies, self-dependencies, cycles, and incomplete tasks. Automatic Turbo requires at least one complete graph step. It does not require one graph node per concurrency lane because lanes belong to separate parent prompts.

## Scheduler

CC Relay owns the parent pipeline order. A queued prompt can enter planning as soon as its project has a free Codex slot and no other planner for that project is active. After validation, the parent remains queued with `ready` graph state. It enters execution when the number of running Turbo parents is below that task's concurrent execution setting and provider capacity is available.

Concurrency changes preserve Turbo FIFO. A queued parent with a lower count starts a new execution batch after the current batch drains; later Turbo parents cannot jump past it by carrying a higher count. Direct Codex and Claude tasks may still use their free provider capacity while that batch boundary waits.

The executor receives the original objective, planner summary, shared context, and complete JSON graph in one turn. All graph steps are attributed to that one execution thread for visibility. The executor owns integration, resolves overlaps, runs full verification, and performs the non-interactive final verification pass. It can use internal sub-agents when that helps, keeping coordination inside one Codex conversation rather than multiplying native windows.

> [!important]
> The planning and execution conversation IDs must be different. Both use the exact project workspace. A new Turbo prompt starts a new planner conversation, and its executor always starts another fresh conversation. Retry and explicit continuation are the only resume paths.

## Stable CC Relay identity and queue resources

Codex CC Relay identity is global across workspaces and SQLite-backed by thread ID. A new Codex thread receives one monotonically increasing positive `relay_number` and immutable `relay_name` formatted as `CC Relay n`. Numbers are never reordered from `updatedAt`, recycled after disconnect, or reassigned to another thread. Reconnecting the same thread reuses its stored identity. Codex thread API objects expose `relayNumber` and `relayName`; Claude sessions remain unchanged. The UI and task history read these fields directly and never infer a number from discovery array order. See [[project-workspaces]] and [[task-history]].

Each active automatic Turbo parent reserves one Codex execution slot. One queued preparation may reserve another Codex planning slot for the project. The task's configured count limits how many planned Turbo parents may execute concurrently, while the project Codex maximum remains the physical capacity boundary. Submission therefore requires a Codex maximum of at least `concurrentExecutions + 1` so the planning lane cannot be starved by the full execution set.

Direct Codex and Claude Execute tasks remain provider-capacity work. They may run beside automatic Turbo whenever their own provider has a free slot. In particular, an active Codex Turbo executor must not block a queued Claude task when the project still has Claude capacity. Plan council and legacy persistent exclusive workflows retain their own serialization rules.

## Pipelined lifecycle

Turbo graph state is persisted in `turbo-plan.json` and follows six explicit stages:

| Stage | Parent task | Meaning |
| --- | --- | --- |
| `planning` | `queued` | A read-only planner turn is producing the graph. The parent keeps its queue position and remains reorderable and cancellable. |
| `reviewing` | `queued` | The first provider's graph is valid and the selected second provider is correcting it in read-only mode. The Codex planner CC Relay is reserved only when Codex owns the active stage. |
| `ready` | `queued` | The graph passed validation. The planning terminal is already closed, and the parent is waiting for an execution lane. |
| `executing` | `running` | One fresh execution terminal owns the complete graph. Other ready Turbo parents may execute in their own single sessions up to the configured concurrency. |
| `complete` | `complete` | Every graph node finished successfully and the parent result is recorded. |
| `failed` | `failed` or retryable | Planning or execution failed. A failed or partial graph is never treated as ready. |

Only a persisted `ready` graph can bypass planning. Missing, malformed, `planning`, or `failed` state is prepared again on demand. The parent task does not become `running` merely because look-ahead planning has started.

## Look-ahead eligibility

Automatic look-ahead does not require another Turbo parent to be running. Candidates are queued Turbo parents ordered by ascending execution `position`, then task ID. CC Relay prepares at most one candidate per project at a time when a Codex slot is physically free. Every candidate gets a fresh planner terminal, so a completed plan never leaves an idle planner window waiting for the next task.

Legacy persistent Turbo retains its selected-session look-ahead behavior for stored task compatibility. That path still waits for an executing legacy parent and protects its manually selected planner and worker thread IDs.

Planning ahead does not reserve or reorder a queue slot. Pause prevents new dispatch and new look-ahead work while allowing an already-started planner turn to settle. A queued task remains reorderable and cancellable while its graph is `planning` or `ready`.

## Cancellation, retry, and shutdown

Cancelling a queued task with active preparation cancels only that parent's planner turn, then marks the parent cancelled. Cancelling a running automatic Turbo parent cancels only its single executor turn. Deletion waits until active preparation is cancelled or settled. Retrying a failed, cancelled, or interrupted task clears its prior outcome and graph artifact, returning it to the normal queue.

On restart, running parents are marked interrupted. A queued graph left in `planning` is not executable and is prepared again; a validated `ready` graph may be reused. During shutdown CC Relay cancels active executors and planner preparations, waits briefly for their promises, and preserves the existing graceful SQLite and task-state shutdown path.

## Persistence and visibility

Turbo configuration is stored in the task's `turbo_json` database column. Runtime graph state is stored under the task artifact directory as `turbo-plan.json`. The task API returns this as `turboPlan`, and the task inspector renders graph nodes, dependencies, executor assignment, and current status. `turbo.plannerThreadId` records the planning conversation. Once execution starts, `turbo.executionThreadId` and the task's canonical `thread_id` record the final executor conversation.

Queued Turbo parents expose a compact `turboPlanSummary` containing only lifecycle `status`, `summary`, and graph `taskCount`. The complete task detail endpoint continues to return `turboPlan`. The queue keeps its canonical `queued` or `running` badge and adds a secondary marker: **Forward plan** while awaiting preparation, **Planning ahead** for active queued preparation, **Plan ready** for a validated graph, and **Executor running** while the parent executes. The task card also shows Planning and Execution as separate stages, their model and effort, and the queue-level concurrency setting.

Graph progress presentation is DOM-free in `public/turbo-graph.js`. It treats `complete` and `failed` packages as terminal progress and reports pending dependency state as ready or blocked. During current automatic execution, every graph package resolves to the same persisted executor thread. The older worker-slot resolution order remains for historical and legacy persistent task rendering.

`test/turbo-graph-integration.test.mjs` exercises the real `ArtifactStore` and `TurboRunner` with held worker turns. It verifies that assignments remain attached to running and completed packages, failed packages retain their error and worker identity, and disconnected history preserves stored titles without inventing a CC Relay number.

Each graph package persists numeric `worker = 1` for backward compatibility plus the exact `workerThreadId` and `workerTitle` of the sole executor. Ready-plan reuse clears stale assignment and result fields. When execution begins, all packages become `running` under that executor. They become `complete` together after the executor returns, or `failed` with a bounded error if the execution turn fails. A connected thread may be rendered as **CC Relay n** with its live relay color. A missing or historical thread is always rendered by its stored neutral title and never receives a guessed CC Relay number.

Graph progress reports total, pending, running, complete, and failed package counts. Complete and failed are terminal states for progress accounting, while the visible completion bar is labeled by complete packages over total packages. Empty active graphs are an indeterminate planning state, never `0 / 0 complete`. Until at least one package exists, the detail panel says **Planning dependency graph**, shows an animated planning sweep and skeleton tickets, and exposes an indeterminate accessible progressbar. A running Turbo parent with a missing graph artifact remains visually in **Planning graph** because execution cannot begin without a validated plan. See [[interface-layout]].

## Optional graph review council

Forward-planning can optionally add a two-provider graph council. The user selects **Codex -> Claude** or **Claude -> Codex**. The first provider authors the version-1 execution graph and the second independently checks and corrects it in read-only mode. `src/turbo-plan-council.mjs` owns a FIFO queue around the shared Claude runner for both Claude author and reviewer stages, while Codex uses a fresh planning terminal for its stage. Every stage must return valid JSON; malformed or incomplete output is rejected before the executor can receive it.

> [!note]
> Execute Plan council produces a reviewed plan and waits for the user to choose whether to execute it. Forward-planning Turbo automatically proceeds from its per-parent graph to one fresh executor as queue capacity becomes available. Turbo's optional council remains a two-stage author and corrected-graph exchange. It does not return reviewer suggestions to the original author for a third revision stage.

The Turbo council toggle is off by default. When enabled, `turbo_json.council` persists the selected `order` plus author and reviewer provider, model, and effort settings. A queued graph is reusable only when the completed council configuration matches the task. The lifecycle is `planning` for the author stage, `reviewing` for the second provider, `ready` only after the corrected graph validates, then `executing`, `complete`, or `failed`. Disabled council tasks keep the original Codex planning path and never require Claude availability. Execute retains the existing Claude-author, Codex-review, and Claude-revision plan route behind its optional checkbox.

The composer reuses the Execute Plan council visual language without making council the only way to choose a planner. The planning route is always rendered. With council off, it shows one unnumbered Codex planner node with selectable planning model and effort, while the Claude node, connector, and provider-order control stay hidden. Enabling council expands the same route to two bordered provider nodes with numbered author and reviewer roles. A compact **Codex first / Claude first** control swaps both node order and runtime role. The selected Codex planning settings are preserved across both states. Execution model, effort, and concurrent execution count remain separate settings. The question-mark disclosure explains the latency and Claude sign-in requirement.

Every Turbo submission carries the single planner settings, and it also carries the selected order plus the generic author and reviewer settings unconditionally: `turboCouncilRequest` is spread into the request body whether or not the switch is on, so a disabled council posts `councilEnabled: false` beside populated role fields. The server does not treat that as a contradiction, because `validateTurboCouncilConfig` in `src/turbo-council-config.mjs` returns `{ enabled: false, order }` before it reads a single role field. Do not add a client-side branch that strips those fields; the server ignoring them is the contract.

> [!important]
> Do not hide `#turbo-council-route` when council is disabled. Its `data-enabled="false"` state is the single-planner presentation and intentionally hides only the second provider and review connector. Hiding the whole route removes the only visible Turbo planner model selector even though the non-council runtime already accepts and persists `plannerModel` and `plannerEffort`.

Cancellation is parent scoped. A queued review rejects immediately with `cancelled: true`; an active review calls the matching Claude runner cancellation and lets its settled promise advance the queue. Success, failure, cancellation, and synchronous runner errors all release the queue so later parents cannot be wedged. See [[turbo-plan-council]] and `test/turbo-plan-council.test.mjs`.

TurboRunner records council configuration and compact author and reviewer audit metadata in `turbo-plan.json`. It does not copy the provider event stream into the artifact. For Codex-first, the fresh Codex planner closes before serialized Claude review runs. For Claude-first, no Codex planner exists during Claude authoring; a fresh Codex planning terminal opens only for the Codex review stage and closes when review finishes. Council-enabled `task.md` files identify the selected route and both role settings.

Queue preparation entries separate `plannerBusy` from `councilStage`. `plannerBusy` follows the provider that owns the current stage rather than the complete preparation lifetime. This lets Codex-first release its CC Relay during Claude review and Claude-first leave the CC Relay free until Codex review begins. Non-council preparations retain the original same-thread exclusion.

## Compact composer panel, August 12, 2026

The Turbo panel used to stack four layers before the first execution control: a panel header, a second eyebrow-plus-title council header, a two-line bordered council switch, and a tall provider card carrying an icon tile, a display-size provider name, a description paragraph, and two stacked selects. Roughly 450px of chrome sat above the execution model.

The panel top is now three rows:

1. One header row: the **Planning and execution** title, the planning-count chip that reads `1 planner` or `2 providers`, and the readiness chip.
2. One single-line council switch beside its question-mark disclosure.
3. One planner node: identity on the first line, **Model** and **Effort** side by side on the second.

Three descriptions of the old top are therefore retired. The Turbo supporting sentence now lives inside the question-mark disclosure and no longer prints under the switch. The Turbo council eyebrow-plus-title header is gone, while Execute keeps its own **Optional review / Plan council** header. The current header names the two lifecycle stages directly.

> [!important]
> `.turbo-council-config` keeps the shared `.council-config` class so the panel still owns the Plan council component and its `--council-*` tokens, but it must paint no frame of its own inside `.turbo-config`. The light rule that removes the frame is a single class, so both painting `html[data-theme="dark"] .council-config` blocks outrank it; the dark theme restates the removal after the later one. Without that guard the panel is flat only by the coincidence that both surfaces are painted the same color.

> [!warning]
> Execute's provider-order control carries the Turbo class: `class="turbo-council-order plan-council-order"`. Compact Turbo rules for that control must be scoped under `.turbo-config`, or they silently reshape a control in the other workflow. Execute's control keeps the 10px margin, 4px padding, and 28px buttons of the earlier layers.

## Composer panel behavior fixes, August 12, 2026

- **Return no longer queues from the concurrency count.** `#turbo-worker-count` keeps its compatibility ID and is a number field inside the task form. An unguarded Return used to submit the whole form. The field now prevents the default and blurs, which commits the value once through its `change` listener. This mirrors the existing guard on the per-project instance steppers.
- **Automatic pools cap concurrency at seven.** The current pipeline requires capacity for `workerCount` execution lanes plus one planning lane, and `validateInstanceLimit` caps a project at eight instances per provider. In pool mode the field advertises `max="7"` and the renderer clamps state to it. Legacy live-terminal Turbo keeps eight workers for stored compatibility.
- **Capacity advice stays honest at the boundary.** Below the ceiling the readiness chip and submit alert advise raising the project maximum. Above it they advise reducing concurrent executions, because no reachable setting satisfies the request. Queueing more work than currently free capacity remains allowed; the task waits after planning.
- **Refresh ticks no longer fight the panel.** `renderTurboControls` rewrites six selects through `innerHTML` and is re-run by the two-second snapshot refresh and the four-second thread poll, which snapped open dropdowns shut. It now folds every datum the markup is drawn from into one token through `public/turbo-controls-signature.js` and skips the rebuild when the token is unchanged. The fold is recorded after the render body so it describes the settled, normalized panel. Mode and project switches, and a committed worker count that clamps back to the stored value, pass `force: true`.
- **The concurrency count is clamped on commit, not on every keystroke.** Clamping in the `input` handler made a two-digit count impossible to type. The clamp moved to `change`, the render never overwrites the value of the focused field, and a `blur` listener resyncs an abandoned edit.
- **Copy follows the runtime.** The attachment line states that a Turbo prompt sends its images to the planner and executor, and names both Plan council stages when council is on. The lifecycle sentence follows **Keep workflow terminals open**: with retention active it says each finished stage stays connected instead of promising automatic close.

`test/turbo-composer-panel.test.mjs` protects these contracts, including a signature test that changes each input datum in turn and asserts the fold moves. See [[interface-layout]] and [[live-terminal-retention]].

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
- `public/turbo-controls-signature.js`
- `test/turbo-runner.test.mjs`
- `test/turbo-state.test.mjs`
- `test/turbo-composer-panel.test.mjs`
- `test/turbo-graph-integration.test.mjs`

#relay #turbo #codex #parallel #dag #scheduler
