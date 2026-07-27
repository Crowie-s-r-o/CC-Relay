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

## Semantic revision: the intent excludes runNow

> [!important]
> The submission signature no longer includes `runNow`. The UUID identifies the **intent**,
> meaning the prompt and the routing that will carry it, not the queue-position hint
> attached to one attempt.

The original signature carried `runNow`, which left a live duplicate hazard. `runNow` is
read from `state.prioritySubmit` and reset to `false` before the POST, and the Enter
handler rewrites it from `event.ctrlKey` on every keypress. So this sequence minted two
UUIDs for one piece of work:

1. The user presses Ctrl+Enter. `runNow` is `true`. The POST is sent.
2. The response is lost, or the request times out. This is ambiguous: the task may well
   have been created. The composer correctly retains prompt, attachments, and pending
   intent.
3. The user presses plain Enter to retry the identical prompt. `runNow` is now `false`, so
   the signature differs, so `resolveSubmissionId` mints a fresh UUID.
4. If step 1 actually landed, the server sees an unknown UUID and creates a second task.

That is precisely the failure the guard exists to prevent, reached through the guard's own
key. Excluding `runNow` closes it: the retry reuses the original UUID and the server
returns the original task.

This cannot collide two deliberate separate submissions. The pending intent is retained
**only** through ambiguous failures and is cleared on success, so deliberately resending
the same prompt after an accepted task is new work with its own UUID. The regression-hunt
note above about repeating identical prompt text still holds for the same reason.

`preferIdleTerminal` is excluded on the same grounds. It is a routing preference the server
may or may not honour, not part of the work being sent.

Identity now lives in `public/submission-intent.js` as two pure functions,
`submissionIntentSignature` and `resolveSubmissionId`, so the rule is unit tested rather
than asserted against handler source text. `test/submission-intent.test.mjs` covers the
Ctrl+Enter, ambiguous failure, plain Enter retry sequence directly, plus the changed-intent
cases that must still mint a new UUID and the success-clears-intent case.

> [!note]
> Risk 3 in the list above is unchanged in kind but slightly wider: a caller reusing an
> existing UUID with a different `runNow` and the same prompt, workflow, provider, and
> settings now also receives the original task. That is the intended trade, since the
> alternative is a duplicate row.

## The deliberate resend, and why a duplicate 200 is not always a success

Retaining the intent through failures creates a second-order case the original design did
not cover:

1. The user submits prompt P. The response is lost, but the server **did** create task N.
2. The user never retries. Task N runs and finishes.
3. Much later the user deliberately submits the identical prompt, wanting a second run.

The retained intent still matches, so the server correctly returns finished task N with
`duplicateSubmission: true` and a 200. Treated as an ordinary success, the browser cleared
the composer, selected a finished task, and ran nothing. The user's second run silently did
not happen.

The composer now branches on the returned task's state, using the shared
`isFinishedTaskStatus` from `public/task-history.js` rather than a second hand-written
list:

- **Finished** (`complete`, `failed`, `interrupted`, `cancelled`): not a success. Relay
  drops the pending intent so the very next submission mints a fresh UUID and genuinely
  runs, keeps the prompt and its attachments, selects the existing task, and shows an
  informational notice naming it: *This exact prompt was already accepted as task N, which
  has finished. Press Enter again to run it as a new task.*
- **Still waiting or running**: this is the same live task the user asked for. Selecting it
  and clearing the composer stays correct, with a quiet note saying which task it resolved
  to.

No server change was needed; the 200 already carries both the flag and the task state.

> [!note]
> The composer alert gained a third kind, `notice`, styled from `--signal-soft` rather than
> the danger palette. An informational outcome must not be painted as an error the user
> caused. See [[interface-layout]].

## Abort copy must not claim the request was not sent

The client timeout aborts the browser's wait; it does not stop the server. The original
copy said *Nothing was sent, so you can send it again*, which is false: with the 45 second
task-submit budget the task may well be persisted and already running. The shared `api()`
helper now says only *It may still be processing the request*, which is also correct for
cancel, retry, delete, pause, and reorder, since those share the helper. Task creation
passes its own `timeoutMessage`, and its reassurance is earned rather than assumed: *The
task may still have been created. Sending it again is safe and will not create a
duplicate*, which holds precisely because the retained UUID resolves to the original task.

See [[task-history]], [[interface-layout]], and [[diagnostics]].

#relay #queue #idempotency #review #ship
