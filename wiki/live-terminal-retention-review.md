---
name: Live Terminal Retention Ship Review
description: Adversarial ship review for the running-task Stop auto-close safety latch.
type: review
tags:
  - relay
  - terminal
  - retention
  - review
---

# Live Terminal Retention Ship Review

### Executive Summary

**Ticket confidence: High**

A running disposable task can now stop automatic terminal closure from Task Activity. The action is a one-way latch for the current run, persists before reporting success, and affects direct Execute, Plan council, and Turbo terminal fleets without changing the project default or another task. Completion, failure, and shutdown read the latest persisted row, so they cannot miss a latch by relying on the task snapshot captured at dispatch.

The adversarial pass found and fixed one concurrency defect before completion. The first renderer draft used one global pending flag and one global feedback value. With several concurrent tasks, an in-flight request for one task could silently suppress the action for another or display feedback under the wrong task. Pending and feedback state are now keyed by task ID, and every write finishes with a serialized fresh snapshot.

No schema migration, environment variable, remote permission, authentication change, or destructive terminal action was added.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `TaskQueue.keepTerminalOpen()` accepts only a task that is running, active in this process, and disposable. It persists the latch and updates both active-task and dispatch-guard copies. Outcome and shutdown paths read the database row. |
| Regression risk | Green | Existing project retention behavior remains unchanged. The new API is capability-gated, older backends show a disabled restart state, and the full repository suite passes 1,067 tests. |
| Gap risk | Amber | The exact instant after a task has finished cannot be rescued, and a terminal still in incomplete preparation cannot be promoted safely during shutdown. Both boundaries fail closed and are explained below. |
| Code quality | Green | Queue policy, route capability, renderer state, and visual treatment remain in their existing layers. Task-keyed `Set` and `Map` state makes concurrent requests explicit. |
| Unit tests | Green | Queue tests cover completion, idempotence, rejection after completion, and promotion before shutdown cancellation. Route and renderer contract tests cover capability, accessibility, themes, local feedback, and motion. |
| Performance and scalability | Green | Each activation performs one constant-time task lookup and update. The renderer refresh reuses the existing task snapshot and only cleans a small task-keyed feedback map. |

### Top 3 Risks

1. A click that loses the event-loop race to final task completion is rejected because the terminal outcome has already been decided. The control is shown only while running, and the fresh snapshot removes it immediately.
2. Shutdown does not retain a terminal whose native identity is still being prepared. Promoting an incomplete or ambiguous launch would weaken terminal ownership safety, so this case remains intentionally unavailable.
3. The native retain behavior is exercised through deterministic terminal-pool fakes rather than a destructive operating-system test. The existing terminal-pool retain suite separately covers exact launch promotion.

### Top Improvements

1. Add a browser-level HTTP integration fixture that drives the real POST route against a temporary database and fake terminal pool.
2. Add a release smoke test that latches a disposable native terminal, completes the task, and proves a neighboring terminal remains unaffected.
3. If operators need more history, add a dedicated retention audit field rather than inferring activation only from the existing queue event.

### Recommendation

**Ship.** The control solves the live safety need, remains scoped to one active task, and preserves exact terminal ownership boundaries.

### Confirmed Issues

- Fixed: process-global pending state could suppress a second concurrent task's control.
- Fixed: process-global feedback could appear under a different selected task.
- Fixed: completion and failure originally read the dispatch snapshot and could release a terminal after a successful live latch.
- Fixed: shutdown originally read only the active in-memory task and could miss the persisted latch.

### Suspected Issues & Edge Cases

- If event insertion fails after the task flag is persisted, the fresh snapshot still shows the authoritative protected state, but the local error text may also report the event failure. This requires a database write failure between two synchronous SQLite operations and does not reverse the safety latch.
- Plan council and Turbo use plural copy because one task can own a fleet. Their retention relies on the existing task-ID terminal-pool grouping.
- Repeated activation requests are idempotent and create only one queue event.

### Regression Risks

- A latched direct task becomes a session task while still running, so its session strip and conversation surface can appear immediately. This is intended and follows the existing `keep_terminal_open` contract.
- The bright cyan and teal control adds one compact action beside Cancel. At narrow widths, the task header wraps without horizontal overflow.
- The control is one-way during a run. Re-enabling automatic close would introduce ambiguity for terminals already promoted into retained ownership.

### Performance Risks

None material. There is no polling interval change, no new background work, and no loop over terminal processes. The extra database reads occur only at terminal outcome or shutdown boundaries.

### Test Gaps

- Automated tests do not close or retain a real Terminal.app or Windows terminal window.
- The route contract is statically pinned and queue behavior is tested directly, but the POST request is not yet exercised through a temporary live HTTP server.

**Are there adequate unit tests? Yes.** The deterministic policy, race boundary, idempotence, shutdown order, capability, renderer state, and accessibility contracts are covered.

### Positive Improvements

- Operators can rescue a valuable running terminal without changing future task behavior.
- The armed state uses text, shape, color, and `aria-pressed`, so color is not the only signal.
- Older backend compatibility is explicit instead of presenting a button that fails on click.
- Fresh post-write snapshots keep queue cards, Task Activity, and session state consistent across concurrent runs.

See [[live-terminal-retention]], [[retained-terminal-sessions]], [[disposable-terminal-pools]], and [[session-tasks]].

#relay #terminal #retention #review
