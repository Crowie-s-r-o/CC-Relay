---
name: Plan Council Capacity Scheduling Review
description: Task 364 incident analysis and adversarial review of same-project disposable Plan council capacity sharing.
type: review
tags:
  - relay
  - queue
  - plan-council
  - capacity
  - review
---

# Plan Council Capacity Scheduling Review

## Executive Summary

**Ticket confidence: High**

Task 364 exposed a real scheduler defect. Agreau had Codex usage 1 of 3 and Claude usage 0 of 1, so the disposable Plan council's atomic requirement of one Codex and one Claude fit. `TaskQueue.runnableTasks()` nevertheless stopped at the legacy `projectActive.length > 0` drain barrier before `DisposableTerminalPool.canRun()` could approve it.

The scheduler now separates two concerns:

1. `sharedExclusiveAvailable` still permits only one Plan council or Turbo workflow globally, matching the singleton fields in `PlanCouncilRunner`.
2. A disposable Plan council may share its own project with disposable Execute and Planner breakdown tasks when the complete active plus selected reservation set fits both provider limits.

Legacy persistent Plan councils and Turbo keep their project-draining barriers. The focused regression initially failed in the exact reported state and passes after the change. All 738 repository tests pass.

> [!important]
> The running CC Relay process cannot load this source change without a restart. Task 364 left the queue only after task 363 finished under the old scheduler, then failed later in its Claude draft because the terminal turn did not start. That provider-stage failure is separate from queue eligibility. Restart CC Relay after active tasks finish, then retry task 364 from its saved council checkpoint.

## Change Mapping

| File | Responsibility and behavior |
|---|---|
| `src/queue.mjs` | Owns synchronous runnable selection. It now recognizes capacity-managed disposable councils, preserves their global workflow slot, includes active and same-pass reservations in provider accounting, and keeps legacy barriers conservative. |
| `test/plan-council-capacity-scheduling.test.mjs` | Reproduces the task 364 limits, both full-provider boundaries, the reverse direction with a running council, and one-pass admission around a council. |
| `test/breakdown-scheduling.test.mjs` | Clarifies that the existing same-project drain assertions cover legacy persistent councils. |
| `wiki/disposable-terminal-pools.md`, `wiki/plan-council.md`, `wiki/parallel-project-queues.md` | Record the atomic requirement, global serialization, thread reservations, and same-project capacity contract. |
| `wiki/project-workspaces.md`, `wiki/task-history.md`, `wiki/planner.md`, `wiki/hot.md` | Reconcile the user-visible pool contract and prior exclusive-barrier decisions with the new current-versus-legacy distinction. |

The blast radius is backend queue selection and pool accounting. There is no API shape, database schema, migration, renderer, authentication, permission, environment variable, or artifact-format change.

## Functional Execution Trace

1. The composer posts a disposable Plan council through the existing task route.
2. `TaskQueue.enqueue()` persists it as queued and calls `schedule()`.
3. `runNext()` calls `runnableTasks()` synchronously.
4. `runnableTasks()` groups queued and active tasks by exact `repo_path`.
5. For a disposable council, `canShareProjectWithCouncil()` permits only disposable single-session peers.
6. `DisposableTerminalPool.canRun()` counts exact existing allocations, active task requirements, and every task already selected in this scheduling pass.
7. If Codex and Claude limits both fit, the council is added to `runnable`; `sharedExclusiveAvailable` becomes false immediately.
8. `runTask()` synchronously records the task as running before `DisposableTerminalPool.prepare()` awaits the first native launch, so later capacity checks see the reservation.
9. `prepare()` launches Claude and Codex, persists both conversation IDs, and releases every partial allocation if launch preparation fails.
10. `reservedThreadIds()` protects both council conversations once bound. Normal completion, failure, cancellation, or interruption releases the exact launches.

Boundary behavior:

- Codex 1 of 3 plus Claude 0 of 1 admits the council.
- Codex 1 of 1 blocks it.
- Claude 1 of 1 blocks it.
- A running council at Codex 1 of 3 and Claude 1 of 1 admits spare Codex work but blocks more Claude work.
- Two councils still cannot start together because the first synchronous selection clears the shared workflow slot.
- A legacy persistent council still waits for its project to drain and still drains it while active.
- A partial council launch remains counted as the full workflow reservation until cleanup proves the exact launch is gone.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | The failing task 364 shape is now admitted through `runnableTasks()`, while both provider-full boundaries remain blocked. |
| Regression risk (UI / backend / contracts) | Green | No external contract changed. Existing queue, pool, Turbo, routing, plan-run, and legacy barrier tests pass. |
| Gap risk (edge cases, error handling, completeness) | Amber | The changed source has not been activated in the live process because active CC Relay tasks must not be interrupted. Restart and retry are still required. |
| Code quality (maintainability as safety) | Green | Current pool sharing is isolated in named predicates and the synchronous selection pass continues to own all reservations. |
| Unit tests | Green | Five focused regressions plus 738 passing repository tests cover happy path, both capacity boundaries, reverse concurrency, same-pass ordering, global council serialization, and legacy behavior. |
| Performance & scalability | Green | Selection remains linear in queued and active tasks apart from the existing pool usage scans. Configured provider limits cap the practical active set at eight per provider per project. |

**Are there adequate UNIT tests? Yes.** The tests reproduce the original false wait, prove that the fix does not bypass either provider limit, cover both scheduling directions, and keep the legacy and global exclusive contracts under the existing suites.

## Top 3 Risks

1. **Deployment state:** `src/queue.mjs` is loaded only at backend startup. A renderer refresh cannot activate the fix.
2. **Global runner ownership:** Removing `sharedExclusiveAvailable` for councils without first making `PlanCouncilRunner` task-keyed would start a second council that the runner rejects.
3. **Reservation coupling:** Future scheduler changes must keep `reservedThreadIds()` and the active plus same-pass list passed to `DisposableTerminalPool.canRun()`. Dropping either creates conversation collision or provider overbooking risk.

## Top Improvements

1. Restart CC Relay after tasks 365 and 366 finish, then retry task 364.
2. Add a queue diagnostic field that names the active wait reason, such as provider capacity, global council slot, legacy barrier, unavailable thread, or project pause.
3. Consider a process-level scheduling test that boots a backend around a prepared database once a safe isolated server fixture exists.

## Recommendation

**Ship with Mitigations**

The source change is safe to ship. The required mitigation is an orderly CC Relay restart after active work completes, followed by a manual retry of task 364. Its later Claude terminal submission failure should be evaluated independently if it repeats after restart.

## Confirmed Issues

- The original same-project barrier ignored otherwise sufficient displayed provider capacity.
- Live timestamps prove task 364 started less than one second after task 363 finished, which confirms it waited for project drain rather than provider capacity.
- Task 364 then reached terminal preparation successfully and failed in the Claude draft stage. The queue did release both disposable terminal instances.
- The running backend still needs a restart before it can use this scheduler change.

## Suspected Issues & Edge Cases

- Mixed current and legacy work is intentionally conservative. A disposable council does not share its project with a persistent single-session task. This can reduce utilization during upgrade history, but it avoids counting a legacy terminal outside the automatic provider pool.
- A capacity-blocked council remains a FIFO barrier for tasks behind it. This preserves existing queue order rather than allowing unrelated work to overtake a workflow that cannot yet reserve its complete fleet.

## Regression Risks

- Before: any same-project active task held a disposable council, even when both provider limits fit.
- After: only disposable single-session peers may share with that council, and every admitted task is included in atomic capacity accounting.
- Unchanged: another Plan council or Turbo parent waits globally.
- Unchanged: legacy persistent councils and Turbo drain their own project according to their established barriers.
- Unchanged: provider-full, paused, unavailable-thread, duplicate-conversation, cleanup-failure, and partial-allocation states remain non-runnable.

## Performance Risks

No material risk was found. `runnableTasks()` already scans queued and active tasks and repeatedly calls pool usage for candidates. The new compatibility predicates are linear in only the active and same-pass tasks for one project. The configured limits keep that set small.

## Test Gaps

- No live backend restart was performed because it would interrupt active user work.
- The separate Claude draft submission failure on task 364 is outside this scheduler change and requires its own retry evidence if it recurs.
- There is no browser test for the active counters changing from Codex 1 of 3, Claude 0 of 1 to Codex 2 of 3, Claude 1 of 1. The counters already read backend pool usage directly, and no renderer contract changed.

## Positive Improvements

- Displayed provider limits now determine current automatic council eligibility as users expect.
- The global singleton runner rule remains explicit and enforced before dispatch.
- Same-pass reservations prevent a council and surrounding direct tasks from collectively exceeding a provider maximum.
- Exact conversation reservations and fail-closed allocation cleanup remain intact.
- Current automatic behavior and legacy compatibility are now documented separately.

See [[plan-council]], [[disposable-terminal-pools]], [[parallel-project-queues]], [[project-workspaces]], and [[task-history]].

#relay #queue #plan-council #capacity #review
