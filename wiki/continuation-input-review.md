---
name: Continuation Input Ship Review
description: Adversarial review of immediate same-session follow-ups with a strict no-queue contract.
type: review
---

# Continuation Input Ship Review

### Executive Summary

**Ticket confidence: High**

The **Continue session** dock now has one invariant: it never creates or queues a task. A running Codex task uses `turn/steer` against its exact active turn. A finished Codex or Claude task starts the next turn immediately against the exact original session while reusing the source task row and event rail. Busy, disconnected, unsupported, or older-backend states disable or reject submission visibly.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | Finished-task submission uses `/api/tasks/:id/follow-up`, `buildSessionFollowUp()`, and `TaskQueue.startFollowUp()` without `queue.enqueue()`. Running Codex still uses exact task, thread, and turn steering. |
| Regression risk (UI / backend / contracts) | Green | The renderer no longer changes task selection or queue view after a follow-up. Tests prove task count and source prompt remain unchanged, same-thread conflicts reject, and old backends cannot use the ordinary task fallback. |
| Gap risk (edge cases, error handling, completeness) | Amber | The singleton HTTP server still lacks an isolated route-level integration test. Live UI verification covered hot-loaded assets against the running older backend, but the backend was not restarted while active tasks were executing. |
| Code quality (maintainability as safety) | Green | Presentation and request selection remain centralized. The direct runtime path has explicit session, workspace, status, resource, provider, retry, and restart-recovery guards. |
| Unit tests | Green | The complete 264-test repository suite passes. Focused tests cover direct dispatch, task-count invariance, busy races, provider behavior, retry rejection, and interrupted-process recovery. |
| Performance & scalability (if applicable) | Green | A finished follow-up performs one bounded task scan for session conflicts and reuses existing runner/event infrastructure. It adds no polling loop, task row, queue position, or retry timer. |

### Top 3 Risks

1. The direct HTTP route is structurally covered but not exercised through an isolated server factory. A future route-ordering change could therefore require source-contract tests to catch it.
2. Reusing one task means its status, start and finish timestamps, and result represent the latest turn. The complete event rail remains the multi-turn history, but consumers that assume one task equals one turn must follow the new contract.
3. Running Claude turns still lack a safe provider steering protocol. Relay intentionally disables live submission until that turn finishes.

### Top Improvements

- Export an isolated server factory and assert through HTTP that `/follow-up` returns the source ID while task count remains constant.
- Add an Electron interaction test against a restarted current backend for completed Codex and Claude sessions, including selection changes during submission.
- Add running-Claude steering only when Claude exposes an exact active-turn protocol with equivalent task and turn identity checks.

### Recommendation

**Ship after Relay restarts safely**

---

### Confirmed Issues

1. The completed-task route intentionally called `queue.enqueue()` and created a linked task. It now launches the next turn with the source task ID and never creates a row.
2. The older-backend compatibility path called `POST /api/tasks`, which could still queue a follow-up. It was removed. Missing `taskDirectFollowUp` now shows **Restart required** and keeps Send disabled.
3. A failed direct follow-up exposed the generic Retry action, which could queue the source task's original prompt. Follow-up terminal failures now carry a persistent marker, generic Retry is hidden and rejected, automatic retry is disabled, and restart recovery preserves the marker.
4. Provider runners could wait if the session became busy after server validation. Immediate follow-ups now perform a final provider-level busy check and fail without waiting or starting another turn.

### Suspected Issues & Edge Cases

- A renderer reload still loses an unsent in-memory draft. This predates the change and does not create queue work.
- The route returns `202` after immediate dispatch begins, not after the provider turn completes. A later provider failure stays on the same task, retains the prior successful result, records the attempted user message and failure, and cannot auto-retry.
- Two clients can submit against the same source around a status transition. JavaScript queue mutation is synchronous, so one finished-task request reserves the source task before another scheduler action. A later request sees the running task and can only steer its exact Codex turn or reject for Claude.
- A renderer that has not reloaded its JavaScript can retain the old behavior until refresh. Newly loaded assets are safe against the older backend because the new capability gate disables finished-task Send.

### Regression Risks

- Follow-ups no longer produce `continued_from_task_id` lineage cards. This is intentional because no new task exists.
- History task totals no longer increase for conversation turns. The source task duration and result advance to the latest turn, while its event rail retains earlier messages and outcomes.
- `/api/tasks/:id/continue` remains as an alias but now has immediate direct semantics. Clients that expected a `201` response with a new task ID must move to the no-queue contract.
- Finished-task submissions bypass global and project queue pause because they are not queue work. Session resource checks still prevent collisions.

### Performance Risks

No material performance risk was found. Conflict detection is O(n) over local task metadata per submitted finished-task follow-up. Provider work, event persistence, cancellation, and completion reuse existing paths.

### Test Gaps

There is no isolated HTTP integration test or restarted-Electron completed-turn test. The live browser did verify that current assets against the older running backend show **Restart required**, keep the textarea editable, and keep Send disabled even after text is entered. Queue, database, renderer-state, source-contract, Codex app-server, and Claude runner tests cover the core invariant.

**Are there adequate UNIT tests? Yes.** The full 264-test suite passes, including same-row dispatch, unchanged task count, preserved original prompt, user-message persistence, same-thread rejection, busy-provider rejection, no automatic retry, blocked manual retry, and restart recovery.

### Positive Improvements

- Both active-turn corrections and next-turn follow-ups now stay in the exact original session without generating future duplicate work.
- A dedicated capability prevents hot-loaded UI assets from calling an unsafe older backend route.
- The same Task Activity view remains selected and receives the follow-up prompt, provider events, result, and errors.
- Busy states are explicit and never promise delayed delivery.
- Follow-up failures remain recoverable through the same direct input without exposing a queue-based retry trap.

### Follow-up Image Addendum

The dock now supports image-bearing same-session messages without weakening the no-queue contract. Finished Codex and Claude turns receive only the new follow-up images. Running Codex uses the installed app-server schema's `TurnSteerParams.input: UserInput[]` support for `localImage`; rejected exact-turn steering rolls staged files back. The renderer requires the new `taskFollowUpAttachments` capability so an older backend can never discard images silently.

#relay #review #continuation #steering #codex #claude #no-queue
