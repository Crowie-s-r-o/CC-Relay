---
name: Continuation Input Ship Review
description: Adversarial review of immediate same-session follow-ups with a strict no-queue contract.
type: review
---

# Continuation Input Ship Review

### Executive Summary

**Ticket confidence: High**

The **Continue session** dock now has one invariant: it never creates or queues a task. A running Codex task uses `turn/steer` against its exact active turn. A running interactive Claude task uses exact terminal steering. A finished Codex or Claude task starts the next turn immediately against the exact original session while reusing the source task row and event rail. Busy, disconnected, unsupported, or older-backend states disable or reject submission visibly.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | Finished-task submission uses `/api/tasks/:id/follow-up`, `buildSessionFollowUp()`, and `TaskQueue.startFollowUp()` without `queue.enqueue()`. Running Codex uses exact task, thread, and turn steering. Running Claude uses exact task, session, terminal, process, screen, and prompt-evidence steering. |
| Regression risk (UI / backend / contracts) | Green | The renderer no longer changes task selection or queue view after a follow-up. Tests prove task count and source prompt remain unchanged, same-thread conflicts reject, and old backends cannot use the ordinary task fallback. |
| Gap risk (edge cases, error handling, completeness) | Amber | The singleton HTTP server still lacks an isolated route-level integration test. Live UI verification covered hot-loaded assets against the running older backend, but the backend was not restarted while active tasks were executing. |
| Code quality (maintainability as safety) | Green | Presentation and request selection remain centralized. The direct runtime path has explicit session, workspace, status, resource, provider, retry, and restart-recovery guards. |
| Unit tests | Green | The complete 264-test repository suite passes. Focused tests cover direct dispatch, task-count invariance, busy races, provider behavior, retry rejection, and interrupted-process recovery. |
| Performance & scalability (if applicable) | Green | A finished follow-up performs one bounded task scan for session conflicts and reuses existing runner/event infrastructure. It adds no polling loop, task row, queue position, or retry timer. |

### Top 3 Risks

1. The direct HTTP route is structurally covered but not exercised through an isolated server factory. A future route-ordering change could therefore require source-contract tests to catch it.
2. Reusing one task means its status, start and finish timestamps, and result represent the latest turn. The complete event rail remains the multi-turn history, but consumers that assume one task equals one turn must follow the new contract.
3. Running Claude steering depends on an owned interactive terminal. Headless turns reject live updates and require a normal continuation after completion.

### Top Improvements

- Export an isolated server factory and assert through HTTP that `/follow-up` returns the source ID while task count remains constant.
- Add an Electron interaction test against a restarted current backend for completed Codex and Claude sessions, including selection changes during submission.
- Add an isolated route test and a restarted live-terminal smoke test for Claude steering, including ambiguous Apple Event delivery.

### Recommendation

**Ship after CC Relay restarts safely**

---

### Confirmed Issues

1. The completed-task route intentionally called `queue.enqueue()` and created a linked task. It now launches the next turn with the source task ID and never creates a row.
2. The older-backend compatibility path called `POST /api/tasks`, which could still queue a follow-up. It was removed. Missing `taskDirectFollowUp` now shows **Restart required** and keeps Send disabled.
3. A failed direct follow-up exposed the generic Retry action, which could queue the source task's original prompt. Follow-up terminal failures now carry a persistent marker, generic Retry is hidden and rejected, automatic retry is disabled, and restart recovery preserves the marker.
4. Provider runners could wait if the session became busy after server validation. Immediate follow-ups now perform a final provider-level busy check and fail without waiting or starting another turn.

### Suspected Issues & Edge Cases

- A renderer reload still loses an unsent in-memory draft. This predates the change and does not create queue work.
- The route returns `202` after immediate dispatch begins, not after the provider turn completes. A later provider failure stays on the same task, retains the prior successful result, records the attempted user message and failure, and cannot auto-retry.
- Two clients can submit against the same source around a status transition. JavaScript queue mutation is synchronous, so one finished-task request reserves the source task before another scheduler action. Later running-turn updates are serialized against the exact active Codex or interactive Claude turn.
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

The dock now supports image-bearing same-session messages without weakening the no-queue contract. Finished Codex and Claude turns receive only the new follow-up images. Running Codex uses the installed app-server schema's `TurnSteerParams.input: UserInput[]` support for `localImage`. Running interactive Claude adds only the new stored image paths to its exact delivered prompt. Definite steering rejection rolls staged files back; uncertain Claude delivery retains them so a possibly accepted prompt never points at deleted files. The renderer requires the new `taskFollowUpAttachments` capability so an older backend can never discard images silently.

### Disposable Resume Addendum

Finished disposable tasks no longer require their old terminal to remain connected. CC Relay preserves the original no-queue contract by checking provider capacity synchronously, relaunching the saved conversation through the disposable pool, and running the turn under the source task ID. A disconnected legacy persistent session still rejects. See [[same-task-session-continuation]].

### Claude Live Steering Addendum

Running direct Claude tasks owned by the macOS interactive terminal executor now accept live updates. Exact task lookup, terminal identity, an empty composer, exact prompt evidence, serialized requests, guarded held-paste submission, and uncertainty-aware attachment handling preserve the no-queue contract. See [[claude-live-steering-review]].

### Unconfirmed Delivery Addendum

**Reported symptom.** A live update sent to a running Claude reached the terminal, but the composer kept the text as though the send had failed.

**Root cause.** Not the success path, which already cleared the input, the per-task draft, and the staged attachments. Claude steering never reached it. `relay-diagnostics.jsonl` recorded three `task.claude.steer.requested` entries for task 85 at 12:38:37, 12:42:56, and 12:43:59, each answered about 27 seconds later by `task.claude.steer.failed` with `deliveryUncertain: true`, and zero `task.claude.steer.completed`. Codex steering completed 2 of 2 in the same log and cleared normally.

The executor sets `{ uncertain: true }` only after it has typed the message into the terminal, and it refuses to send that message again. The server rethrows, so the route answers `422`. `sendError()` serialized `{ error }` alone, so `deliveryUncertain` never reached the renderer and every rejection looked identical. The composer treated delivery as binary, kept the draft for a retry, and the user resent the same work three times in six minutes. Retaining that text was the duplicate-turn trap the no-queue contract exists to prevent.

**Fix.** Delivery now has three states.

- `sendError()` accepts additive fields and carries `deliveryUncertain: true` when the error does. Status code, outcome, and retry policy are unchanged. This is response shape only.
- `api()` copies the flag onto the thrown error so callers never parse error copy.
- `continuationDispatchOutcome()` in [[task-continuation-state]] maps one response to `clearComposer`, `kind`, `message`, and `detail`. Confirmed delivery and unconfirmed delivery both clear the composer and the persisted draft. A failure that provably delivered nothing keeps both.
- Unconfirmed delivery renders as a calm `warning`, sticky across the two-second refresh, with the provider's exact account on the element title because the status row is one truncated line.

**Why clearing an unconfirmed delivery is correct.** CC Relay has already declined to send the message twice over, so the only thing a retained draft can produce is a duplicate turn.

**Where the words go.** Review found one branch that breaks the "the text is always in the terminal" argument: `deliverActiveSteer` sets `injectionStarted` before `inject()`, so an injection that throws having typed nothing is still uncertain. The text is therefore retained rather than deleted, under a `delivered-unconfirmed` marker that `draftInputValue()` maps to an empty string. The textarea stays empty on every rehydration path, the words remain readable in the amber notice as a whitespace-collapsed excerpt with the complete message on the element title, and typing or a later confirmed send replaces the marker outright. There is no restore action: the notice row is a bare `<p>` inside a live region, so a button needs `index.html` markup that is outside this change's scope. The retained copy makes adding one later a small change.

**Still open.** The real defect is upstream: `accepted()` never observes delivery evidence within its 25 second budget, which lives in `claude-terminal-executor.mjs` and `claude-transcript-tail.mjs`. This change makes the renderer correct while that holds, not cured. See [[claude-live-steering-review]] and [[claude-terminal-live-output]].

#relay #review #continuation #steering #codex #claude #no-queue
