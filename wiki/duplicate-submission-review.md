---
name: Duplicate Submission Ship Review
description: Adversarial validation of composer locking and persistent task idempotency.
type: review
---

# Duplicate Submission Ship Review

### Executive Summary

**Ticket confidence: High**

The lag duplicate represented by tasks 210 and 211 came from setting `state.submitting` only after asynchronous idle routing. Two submit events could enter the handler before the first request acquired its lock. Relay now locks before that await, assigns one stable UUID to the unchanged composer intent, requires that UUID at the task API, and enforces uniqueness in SQLite. Repeated delivery returns the original task and does not repeat artifacts, events, queue positions, or scheduling.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `public/app.js` rejects a second submit while locked and retains one UUID through ambiguous retries. `src/server.mjs`, `src/queue.mjs`, and `src/database.mjs` enforce the same identity through the complete creation path. |
| Regression risk (UI / backend / contracts) | Green | Execute, Plan council, Turbo, Enter, and Run now use the same guarded form path. Deliberate later submissions remain valid because success clears the pending intent. |
| Gap risk (edge cases, error handling, completeness) | Green | Missing and malformed IDs fail closed. Matching retries can return an existing task even if idle routing changes or the original terminal later becomes unavailable. Reuse for different work is rejected. |
| Code quality (maintainability as safety) | Green | One browser latch, one queue idempotency gate, and one database uniqueness constraint provide independent defenses without prompt-based heuristics. |
| Unit tests | Green | Focused tests cover lock ordering, UUID propagation, database uniqueness, repeated enqueue, changed-prompt rejection, and rerouting to another terminal. All 275 repository tests pass. Adequate UNIT tests: Yes. |
| Performance & scalability (if applicable) | Green | Submission lookup and uniqueness are indexed O(log n). The browser signature uses attachment IDs and metadata rather than copying up to 20 MB of base64 data. |

### Change Mapping

- `public/app.js` owns the form lifecycle. It locks synchronously, snapshots the intent, retains a pending UUID after failure, and clears it after acceptance.
- `src/server.mjs` owns the HTTP contract. It validates UUID v4 input, returns a matching persisted task early, rejects mismatched reuse, and records duplicate diagnostics.
- `src/queue.mjs` owns artifact and scheduling side effects. It returns an existing matching task before terminal checks or filesystem writes.
- `src/database.mjs` owns persistence. It migrates `submission_id`, creates a unique partial index, and resolves tasks by submission ID without exposing the key in task responses.
- `test/composer-workflows.test.mjs`, `test/database.test.mjs`, and `test/queue.test.mjs` protect the cross-layer contract.

The blast radius is fresh task creation from Execute, Plan council, and Turbo. Follow-ups, reviewed-plan execution, queue retry, assignment, and parallel bundling do not use the fresh composer endpoint and retain their existing guards.

### Functional Execution Trace

1. The submit event returns immediately when another submission is active.
2. Synchronous validation and execution-setting capture complete before Relay constructs an intent signature.
3. An unchanged failed intent reuses its previous UUID. A changed intent receives a new UUID.
4. Relay locks the button before idle routing can wait up to three seconds.
5. `POST /api/tasks` requires and validates the UUID.
6. A persisted matching UUID returns its original task before session or model revalidation. This makes response-loss retries safe even when routing state changed.
7. New work passes normal provider validation and reaches `TaskQueue.enqueue()`.
8. The queue repeats the idempotency lookup before terminal and artifact side effects.
9. SQLite uniquely inserts the UUID. The new task receives exactly one queue position and one initial event.
10. Successful response clears the prompt and pending intent. Failures unlock the form but retain the unchanged intent UUID.

Null or empty prompts still fail through existing validation. Missing, malformed, duplicated, delayed, or reordered requests fail closed or resolve to the original task. No authentication or permission behavior changed. Database and artifact errors still delete a partially created task, allowing the same UUID to retry safely.

### Regression Hunt

- Deliberately repeating identical prompt text remains supported because idempotency follows the submit intent UUID, not content alone.
- Idle routing can choose a different terminal on retry without defeating idempotency. Prompt, workflow, and provider must still match the original persisted task.
- Attachment signature work is bounded by attachment count and small metadata. Full image data is copied only into the existing request body.
- Old renderers cannot call the upgraded task endpoint without a submission UUID. Relay serves its renderer and backend together, and the error explicitly requests a refresh.

### Top 3 Risks

1. The running backend must restart before `tasks.submission_id` and its unique index exist.
2. Independently opened browser clients create independent intent UUIDs. Relay does not guess that two deliberate actions from different clients are one intent.
3. A caller that reuses an existing UUID with changed model settings but the same prompt, workflow, and provider receives the original task. The official client changes its intent signature and UUID when settings change, so this is limited to custom API misuse.

### Top Improvements

1. Add a delayed-response browser E2E test that clicks and presses Enter repeatedly against one in-flight request.
2. Expose an idempotent-submission capability if renderer and backend versions are ever distributed independently.
3. Add a small Task Activity or diagnostic notice when a response resolves through `duplicateSubmission: true` if field troubleshooting needs it.

See [[task-history]] and [[diagnostics]].

#relay #queue #idempotency #review #ship
