---
name: Project Queue Isolation Review
description: Adversarial review of cross-project scheduling and stale backend detection.
type: review
tags:
  - relay
  - queue
  - projects
  - review
---

# Project Queue Isolation Review

## Executive Summary

**Ticket confidence: High**

The current scheduler isolates FIFO barriers, queue positions, pause state, and dispatch eligibility by exact `repo_path`. The reported Argeau wait came from a backend process started on July 17, 2026, before the project-scoped scheduler was loaded. Static browser assets had refreshed, but Node was still executing the old global scheduler.

Live task history proved the sequence:

1. Argeau Plan council task 184 entered the queue at 21:08:53 while CC Relay task 183 was running.
2. The old scheduler did not start task 184 until task 183 was cancelled at 21:22:17.
3. Task 184 then started, reached its Claude author stage, and failed at 21:22:18 with `Claude Code stopped with code 1.`
4. Its automatic retry returned to waiting at 21:22:23 and was again held behind CC Relay task 185 by the old backend.

The backend now advertises `capabilities.projectQueueIsolation`. A browser connected to an older backend labels the affected project card and queue summary with a restart instruction instead of presenting the wait as normal scheduling. [[project-workspaces]] and [[task-history]] describe the scheduling contract.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | `TaskQueue.runnableTasks()` groups queued and active work by `repo_path`; `test/queue.test.mjs` proves a CC Relay direct task and Argeau Plan council are active together. |
| Regression risk (UI / backend / contracts) | Green | `projectQueueIsolation` is an additive capability. Older backends remain supported and receive only explanatory UI. |
| Gap risk (edge cases, error handling, completeness) | Amber | Activation requires a normal backend restart. Task 184 also has a separate Claude code-1 failure that queue isolation cannot fix. |
| Code quality (maintainability as safety) | Green | `projectQueueRestartRequired()` is one DOM-free decision shared by project cards and queue summary. |
| Unit tests | Green | Cross-project dispatch, project pause, stale capability, paused state, local activity, and upgraded runtime states are covered. |
| Performance & scalability | Green | The new helper is constant time. Existing project rendering performs one linear task scan per project, unchanged in order of growth. |

**Are there adequate UNIT tests? Yes.** The tests exercise the exact reported concurrency direction, the reverse direction, project pause isolation, and all branches of the stale-runtime warning.

## Top 3 Risks

1. **Old process remains authoritative until restart.** `src/server.mjs` and `src/queue.mjs` cannot hot-reload into PID 87246. Static UI refresh alone cannot change queue dispatch.
2. **Shared Claude capacity is intentionally global.** `ClaudeRunner` accepts one active plan stage, so two Claude-backed councils still serialize even when they belong to different projects. Direct Codex work on another CC Relay remains independent.
3. **Task 184 has an execution failure after dispatch.** Its first author attempt exited with code 1. After restart, the task may start promptly but still require separate Claude diagnostics.

## Top Improvements

1. Restart CC Relay after active work finishes so the project-scoped scheduler becomes authoritative.
2. Preserve the precise Claude failure message in retry history so a queued retry does not hide its previous execution error.
3. Consider a first-class backend-update banner if development continues to hot-refresh renderer files while keeping Node alive for several days.

## Recommendation

**Ship with Mitigations.** The code is safe and the scheduling invariant is covered. Restart CC Relay after active tasks finish, then recheck task 184 independently of its Claude failure.

## Confirmed Issues

- The live backend began on July 17 while current scheduler files were modified on July 20.
- The live `/api/status` response lacked `projectQueueIsolation` and other newer capability flags.
- Task 184 was held by the old global barrier, then separately failed in Claude after it finally dispatched.

## Suspected Issues & Edge Cases

- A browser may briefly render task data and status from adjacent polling cycles. The warning can disappear on the next poll, but it cannot alter scheduling or start work.
- Cross-project exclusive task arbitration still shares singleton provider resources. This is deliberate resource serialization, not a shared project queue.

## Regression Risks

- Before: an older backend displayed only `1 task waiting`, which suggested that current project isolation was broken.
- After: only an unpaused project with queued work, no local running task, another project running, and no capability flag receives the restart explanation.
- Paused projects retain pause semantics and do not receive a false restart warning.

## Performance Risks

No material risk. `projectQueueRestartRequired()` is O(1). The surrounding checks use existing task arrays and add one O(n) scan during each normal render.

## Test Gaps

- There is no automated process-level test that starts an intentionally old backend and serves current static assets. The pure compatibility-state test covers the resulting contract without maintaining a second server fixture.
- The Claude code-1 failure from task 184 is outside this ticket and needs its own reproduction if it persists after restart.

## Positive Improvements

- The API now explicitly identifies project-scoped scheduling support.
- Project cards and queue summary communicate the same compatibility state.
- The exact reported CC Relay-running plus Argeau-council scenario is asserted through both tasks in `activeTaskIds`.

#relay #queue #projects #review
