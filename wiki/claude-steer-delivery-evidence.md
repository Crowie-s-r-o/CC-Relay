---
name: Claude Queued Prompt Delivery Evidence
description: A busy Claude session queues a prompt instead of submitting it and records the exact text in a queue-operation record, which is why steer confirmation always timed out and why an opening prompt could be pasted twice, plus the amended evidence contract that confirms both without weakening any negative.
type: review
tags:
  - relay
  - claude
  - terminal
  - steering
---

# Claude Queued Prompt Delivery Evidence

> [!important]
> Text typed into a **busy** Claude session is never submitted. Claude Code queues it and writes a
> `queue-operation` record whose `content` is the injected text **byte for byte**, with no
> queued-message framing, no composer rewrite, and no truncation. It is not a `user` record, so
> `userPromptRecordText()` returned the empty string for it and the entire evidence contract was
> blind to it. Task 85 burned three live updates in six minutes timing out at
> `steerAcceptanceTimeoutMs` against evidence that had already been written 1.4 to 8.3 seconds
> after each request. **Timing was never the problem.** The budget is unchanged.

> [!important]
> The same mechanism can hit a task's **opening prompt**, with a worse outcome. A queued paste
> leaves the composer EMPTY, which is byte for byte what a lost paste leaves behind, so the recovery
> schedule read it as a lost paste and pasted the whole prompt a second time into a session that was
> already holding it. The queue record breaks that tie. See
> **The opening prompt** below.

## The defect

`relay-diagnostics.jsonl` for task 85 on 2026-07-31, session `917fd23a`:

| Requested | Failed | Result |
| --- | --- | --- |
| 12:38:37.109Z | 12:39:04.305Z | `deliveryUncertain: true` |
| 12:42:56.670Z | 12:43:24.320Z | `deliveryUncertain: true` |
| 12:43:59.817Z | 12:44:27.036Z | `deliveryUncertain: true` |

Zero `task.claude.steer.completed`. Codex completed 2 of 2 in the same window. The receiving agent
acted on all three messages, so delivery worked and only the evidence never matched. The renderer
side of that failure is [[continuation-input-review]]; this page is the upstream cause it named as
still open.

## The captured queued form

The receiving session's transcript (read only) holds **no user prompt record** for any of the three
updates. What it holds instead, at exactly the right moments, are three record shapes. Reproduced
field for field from `917fd23a-6943-4ba5-8e52-77e411cfc92b.jsonl`, Claude Code 2.1.220:

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-07-31T12:44:08.066Z",
  "sessionId": "917fd23a-6943-4ba5-8e52-77e411cfc92b",
  "content": "also when I send a message to running claude through the cc relay it sends it but it leaves it also in the input like it failed to send why? - fix this as well\n\nCC Relay orchestrator notice: this is a non-interactive run and no answers can be provided. Do not ask questions, request approval, or wait for user input. Make reasonable assumptions and proceed autonomously. If progress is impossible, report the blocker and end the run."
}
```

```json
{ "type": "queue-operation", "operation": "remove", "timestamp": "2026-07-31T12:44:35.689Z", "content": "<the same 433 bytes>" }
```

```json
{
  "type": "attachment",
  "parentUuid": "d09552d0-96ce-4f7f-9abd-14f62f042005",
  "isSidechain": false,
  "timestamp": "2026-07-31T12:44:08.066Z",
  "attachment": {
    "type": "queued_command",
    "prompt": "<the same 433 bytes>",
    "commandMode": "prompt",
    "origin": { "kind": "human" },
    "timestamp": "2026-07-31T12:44:08.066Z"
  }
}
```

### Byte replay

The recorded text was stripped of its trailing orchestrator notice and pushed back through the real
builder chain, `taskPrompt({ prompt, attachments: [] })` then `sanitizeInjectedPrompt()`. All three
samples round-trip **exactly**: 562, 562, and 433 bytes, `rebuiltEqual: true`, no carriage returns,
no leading or trailing whitespace difference, no `[Image #N]` chip run, nothing added or removed.

So the answer to "what framing does a queued message get" is **none**. Unlike the composer rewrite
in [[claude-image-prompt-correlation]], the queue path does not transform the text at all. The only
thing that changed is which record type carries it, and `userPromptRecordText()` returns `''` for
all three shapes, which is the whole defect.

### Timing

| Steer | `steer.requested` | `enqueue` written | Delta |
| --- | --- | --- | --- |
| 1 | 12:38:37.109Z | 12:38:38.538Z | 1.43 s |
| 2 | 12:42:56.670Z | 12:42:58.694Z | 2.02 s |
| 3 | 12:43:59.817Z | 12:44:08.066Z | 8.25 s |

Those deltas are measured from the **API request**, and most of the third one is CC Relay's own
pre-injection work: two `verifyTerminalIdentity` round trips and a screen read, all `osascript`.
Latency from typing to record is roughly a second. Every sample lands far inside the 25 second
budget, which is why **no budget change and no late-confirmation state machine were needed**. The
first message was recorded as enqueued 25.8 seconds before CC Relay declared it unconfirmed.

`remove` arrives at consumption: 12:39:26.218, 12:43:30.513, and 12:44:35.689, that is **49.11 s**,
**33.84 s**, and **35.87 s** after their requests. Anything that only ever arrived at consumption
would genuinely have been out of budget on all three.

> [!note]
> The `queued_command` attachment record is **written at consumption but stamped with the enqueue
> timestamp**, and in the capture it sits after its own `remove` record in file order. Its timestamp
> is not a latency measurement and must never be read as one.

### What is still unobserved

Two things were not observed and neither changes the fix. They are named so the next reader does not
mistake them for established facts.

- **Whether `UserPromptSubmit` fires at consumption time for a queued message.** It provably does
  **not** fire at enqueue time: the hook carries the raw submitted text, raw equality against
  `deliveredPrompt` was already checked on that channel, and all three steers still timed out while
  their enqueue records existed within 8.3 seconds. Whether a later hook fires when the queue drains
  is unknown; on those timings it would arrive after the budget either way.
- **Whether an image-bearing queued message records raw paths or the chip rewrite in `content`.**
  All three captured samples had `attachmentCount: 0`. Both forms are correlated, so either answer
  is already covered.

## The amended contract

Two helpers in `src/claude-transcript-tail.mjs`, consumed by `drain()` in
`src/claude-terminal-executor.mjs`.

**`queuedPromptRecordText(record)` is delivery evidence.** It returns `content` for a
`queue-operation` record whose `operation` is exactly `enqueue`, and `''` for everything else,
including a non-string `content` (this repository's own fixtures already produce `content: null`).
An enqueue is the only record that proves the session **accepted** the text.

**`consumedQueuedPromptRecordText(record)` is proof of CONSUMPTION into a turn.** It returns the
prompt of an `attachment` whose `attachment.type` is `queued_command`, and nothing else. That shape
exists only when Claude attaches the queued command to a turn, so unlike `remove` it cannot also
mean "the human deleted it from the queue". It is the only record allowed to declare that a queued
prompt's own turn has begun.

**`releasedQueuedPromptRecordText(record)` is a turn boundary signal and never delivery evidence.**
The superset: the text of a `queue-operation` under any verb that is not `enqueue`, plus everything
`consumedQueuedPromptRecordText` returns. It proves only that the text stopped waiting, which is
true under both dispositions, and that is exactly the strength a suppression release needs.

Correlation itself is unchanged: the value goes through the same `submittedPromptMatches` (raw,
checked first) and `submittedRewrittenPromptMatches` (the image chip rule from
[[claude-image-prompt-correlation]]) pair the user-record channel uses. No new comparison exists.

Two new `promptSubmissionEvidence` values join the four already documented:

| Value | Meaning |
| --- | --- |
| `transcript-queued-prompt` | A live update's enqueue record matched the delivered text exactly |
| `transcript-queued-anchor-normalized` | A live update's enqueue record matched the derived rewritten form |
| `transcript-queued-release` | An opening prompt's consumption record matched the delivered text exactly |
| `transcript-queued-release-normalized` | An opening prompt's consumption record matched the derived rewritten form |

The pair split by channel is deliberate: a live update is confirmed at **enqueue**, because the
caller is waiting on an answer and receipt is what it asked about, while an opening prompt is
anchored at **consumption**, because a turn that has not started has no output to mirror.

### Delivery is not the turn boundary

This is the one design subtlety. An enqueue lands **while the earlier response is still
generating**, so it proves receipt without proving that Claude has started the update. Anchoring on
it immediately would let the previous response's final assistant record become the update's answer,
end the turn, and close the terminal before the update ever ran.

So `acknowledgeSteerPrompt` gained an `anchorsTurnBoundary` option. The queued channel passes
`false`: the request is acknowledged, the steer resolves as delivered, and the request joins
`unanchoredSteers`, which suppresses `lastText` capture and the final-response condition until the
boundary is proven. `releasedQueuedPromptRecordText` then releases it, exactly as a durable user
record releases a directly submitted update. Both releases now run through one
`anchorSteerAtBoundary` helper.

That is also why the ambiguity of `remove` is harmless. Claude uses the same verb whether the queued
message was consumed or a human deleted it from the queue, so it can never be delivery evidence. As
a boundary release it is correct under **both** readings: either way the text is no longer waiting,
and leaving the request suppressed forever would strand the turn until the inactivity ceiling.

## Why it stays collision-proof

Nothing was loosened to a substring, a prefix, or a suffix.

- **Byte equality against the whole delivered prompt is the only gate.** A foreign human message
  typed into the same busy terminal, an `<agent-message>`, and a `<task-notification>` all travel as
  `queue-operation` enqueue records, and none of them is this exact prompt. Every negative the
  user-record channel rejects is rejected here by the same two functions.
- **One enqueue record per queued message.** The mapping to steer requests is 1:1 and
  order-preserving, `acknowledgeSteerPrompt` returns on the first match, and an acknowledged request
  is latched and removed from `pendingSteers`. Steers are serialized through `steeringTail`, so a
  second request is not even injected until the first settles.
- **The consumption records cannot confirm anything.** Because they are boundary-only, one message's
  `remove` or `queued_command` record can never confirm a different request. That is the collision
  that would exist if they were treated as delivery evidence, and it is why they are not.
- **Nothing types twice.** The queued channel only adds an acceptance signal. It has no path to
  `inject()` or `submit()`. Proven live as well: three steers produced exactly three enqueue records,
  and steer 3's enqueue landed after the 6 second nudge, so the guarded submit ran, correctly found
  no held paste in a composer that a queued message leaves empty, and pressed nothing.
- **`deliveryUncertain` still exists.** A steer with no matching enqueue record inside the budget
  still fails uncertain and is still never resent.
- **Scope.** An enqueue record never marks a turn as started, on either channel. That is what keeps
  the currently-running previous turn's final response from being attributed to the queued prompt.
  The `promptAcceptanceTimeoutMs` value, its fail-closed no-retype outcome, and the
  one-queued-or-running-owner-per-conversation rule in `queue.mjs` are unchanged.
- **The sub-agent path is untouched.** `queue-operation` enqueue records are also how backgrounded
  sub-agent task notifications arrive ([[claude-terminal-visibility]]). `drain()` continues **only**
  when acknowledgement actually succeeded, so a non-matching record falls through to
  `consumeClaudeStreamMessage` and still emits `claude/agent-finished`.

## Tests

In `test/claude-terminal-executor.test.mjs`:

- `a queued live update is recorded as a queue-operation carrying the delivered text` pins the
  captured record shapes and the 433-byte identity, asserts that `userPromptRecordText()` sees
  nothing in either shape, and walks the whole battery: `remove`, `dequeue`, the consumption
  attachment, a `null` and a missing `content`, our text without the queue framing, and `null`
  itself all yield no delivery evidence; the release helper accepts every non-enqueue verb and the
  `queued_command` attachment and refuses an enqueue, a foreign attachment type, and a `null`
  prompt. Correlation negatives cover a truncation at each end, an extension, a different message,
  a task notification, an agent message, and the empty string, plus the image variants: raw form,
  cumulative chip form, a truncated chip form, and a text-only prompt against image forms.
- `a live update queued by a busy Claude session confirms on its enqueue record` drives a full turn
  whose only steer evidence is the enqueue record, asserts `transcript-queued-prompt` with zero
  guarded submit actions, and proves the boundary rule: the earlier response finishes and the
  session goes idle **before** the queue drains, and the turn still finalizes on the update's own
  answer.
- `a queued image-bearing live update confirms on the rewritten enqueue record` is the same shape
  with a session-cumulative chip run, asserting `transcript-queued-anchor-normalized`.
- `a queued task notification never confirms a live update and still reports the sub-agent` proves
  the two halves of the safety argument at once: a `<task-notification>` enqueue and a truncated
  copy of our own text confirm nothing, the steer still fails `deliveryUncertain` with nothing typed
  a second time, and `claude/agent-finished` still fires exactly once.
- `a queued live update whose release record never arrives ends on the inactivity ceiling` pins the
  bounded outcome of the residual risk below instead of assuming it: the update stays confirmed
  delivered and the turn fails on `inactivityCeilingMs` rather than finalizing on the earlier
  response.

For the opening prompt:

- `a queued opening prompt stops the empty-composer re-injection` is the duplicate reproduction: the
  prompt is queued, the composer reads empty, and the schedule runs its whole window. It asserts one
  injection, zero submits, no `re-injected` event, one `queued-submission` signal, and no
  `claude/started`, with the earlier response's `end_turn` present in the transcript throughout.
- `a queued opening prompt starts its turn only when Claude takes it off the queue` asserts
  `transcript-queued-release` with zero submit attempts, and that the answer is the queued prompt's
  own, not the earlier response's.
- `a foreign queue record never latches the opening prompt or stops re-injection` feeds a task
  notification, a truncated copy of our prompt, a consumption record for that truncated copy, and a
  `remove` record carrying our exact prompt. None latches and none starts a turn, so normal recovery
  runs unchanged: two injections and one `re-injected` event.
- `a queued opening prompt consumed with no further output stays bounded` covers the state the
  anchor actually creates: the earlier response is drained before the anchor exists, consumption is
  the last record that ever arrives, and the turn ends on the inactivity ceiling with the earlier
  response never appearing in its output.
- `a queued opening prompt that is never taken off the queue fails closed at the acceptance bound`
  pins the unchanged outcome, including the unchanged no-retype sentence, with the session busy
  throughout. It is also the guard against the unbounded state described in residual risk.

Every claim was mutation checked. Flipping `anchorsTurnBoundary` to `true` fails the two steer
boundary tests on the earlier response's text. Making the delivery helper return nothing fails all
three steer positives, the two integration ones by timing out at `steerAcceptanceTimeoutMs`, which
is task 85's failure reproduced in the suite. Dropping `queuedPromptObserved` from
`submissionRecoveryBlocked()` fails the re-injection test. Letting the anchor read
`releasedQueuedPromptRecordText` instead of the consumption helper fails the foreign-record test on
the `remove` shape. Letting the anchor read the enqueue record fails the anchoring test, and making
the latch itself start the turn does not merely fail, it hangs the turn.

The four new `promptSubmissionEvidence` values and the `queued-submission` delivery state are
pass-through only. Nothing in `public/` or the rest of `src/` enumerates, validates, or maps the
existing values, so no renderer or route needed to learn about them.

Full suite: 967 tests passing, 158 of them in `test/claude-terminal-executor.test.mjs`.

## Residual risk

- **Claude stops emitting `enqueue`.** A future version could rename the verb or drop the record.
  The failure mode is exactly the pre-change behavior on both channels: a live update reports
  `deliveryUncertain` and is never resent, and an opening prompt loses its latch and returns to the
  Task 61 duplicate risk it had before. It fails closed and loudly, which is the right direction.
- **Claude stops emitting `queued_command`.** A queued opening prompt then has no anchor and fails
  closed at `promptAcceptanceTimeoutMs` with nothing typed twice, which is pinned by a test.
- **A human deletes the queued opening prompt.** `queuedPromptObserved` never resets, exactly like
  `unmatchedSubmissionObserved`, so recovery stays suppressed for a prompt that is provably gone and
  the turn rides to `promptAcceptanceTimeoutMs`. That is fail-closed and correct: CC Relay cannot
  distinguish deletion from consumption at the `remove` record, and re-pasting into a session the
  operator just intervened in is the worse error. Do not read the foreign-record test's `remove`
  case as proof that `remove` retires the latch; that test passes because the latch was never set.
- **Why `promptProcessingConfirmed` is set at consumption and never at the enqueue.** Setting it
  early removes the `promptAcceptanceTimeoutMs` bound, and a busy session refreshes `lastActivity`
  on every poll by design, so the inactivity ceiling cannot fire either. A queued prompt in a
  permanently busy session would then have **no bound at all** and would hold its project slot and
  native terminal open forever. This was observed: the mutation that anchors at the enqueue does not
  fail the suite, it spins without yielding. The shipped code sets the flag only once consumption
  proves the turn really started, after which an indefinitely busy session is the intentional
  long-running behavior every anchor path shares. The never-consumed test is the guard that keeps
  that state unreachable, and it runs with the session busy throughout for exactly that reason.
- **A human deletes a queued update before it is consumed.** CC Relay reports delivered, because the
  session did accept the text. Nothing can distinguish that from consumption at the transcript level,
  and the alternative, refusing to confirm until consumption, puts confirmation outside the budget
  for every steer.
- **No release record ever arrives.** This is the one case the change trades away, and it is worth
  stating plainly. An acknowledged queued update sits in `unanchoredSteers` suppressing `sawFinal`.
  If nothing ever records the text leaving the queue, the transcript can never complete the turn and
  it ends on `inactivityCeilingMs` as a failure, where before the change it would have completed
  with a result and merely reported the steer uncertain. Two things bound it. The pre-existing hook
  path has the identical shape, because a `user-prompt-hook`-acknowledged steer also waits for a
  durable user record, so this is a new instance of an old risk rather than a new kind. And the
  capture shows `remove` firing on all three samples, with a human deletion emitting the same verb,
  so the release is reliable in both observed dispositions. What is genuinely unobserved is whether
  `remove` fires when a turn is interrupted with a message still queued. The bounded outcome is
  pinned by a test rather than assumed: the update stays confirmed delivered and the turn releases
  its slot on the ceiling.
- **The same steer text sent twice after a genuine timeout.** A late enqueue for the failed first
  attempt could confirm the second. Both messages did reach Claude, and the user-record channel has
  the identical property, so this is not new surface. `drain()` polls continuously, so a record
  written during the first request's own 25 second window is consumed inside it.
- **Sidechain queues.** The helpers do not filter on `isSidechain`. A sub-agent cannot be handed CC
  Relay's exact delivered prompt, so byte equality already excludes it. Named because it was
  considered.

## The opening prompt

`runTurn` proves the session idle before typing, but it can turn busy in that gap. Claude then
queues the paste, and the composer is left **empty**. Task 61 already established what an empty
composer costs: it is byte for byte what a lost paste leaves behind, so the recovery schedule at
`claude-terminal-executor.mjs` reads it as a lost paste and re-delivers the entire prompt into a
session that is already holding it. Task 61's fix was the `unmatchedSubmissionObserved` latch, but
that latch only inspects `user` records, and a queued prompt produces none.

### The latch

An enqueue record carrying this task's exact prompt, in either accepted form, sets
`queuedPromptObserved`. Both recovery guard sites now read `submissionRecoveryBlocked()`, which is
`unmatchedSubmissionObserved || queuedPromptObserved`, so the empty-composer re-delivery, the junk
clear, and every guarded Return are off from that moment.

It is deliberately **not** turn-started evidence. The previous response is still generating when the
enqueue lands, so anchoring there would let its final assistant record become this task's result.
The latch suppresses recovery and nothing else.

The two states are reported apart everywhere, because they are different knowledge.
`unmatchedSubmissionObserved` means CC Relay could not identify what reached the session;
`queuedPromptObserved` means it matched the text byte for byte and knows exactly where it is. The
live signal is `deliveryState: 'queued-submission'` rather than `'unverified-submission'`.

### The anchor

A queued prompt is **never written as a user record at all**. Task 85's three queued messages
produced none in the entire transcript, so waiting for one would strand every queued opening prompt.
The consumption record is therefore both the turn boundary and the anchor: it sets
`transcriptCorrelated`, `promptProcessingConfirmed`, and emits `claude/started` with
`transcript-queued-release`.

Only `queued_command` qualifies. `remove` means the same thing when a human deletes the message from
the queue, and starting a turn on a prompt that was thrown away is strictly worse than timing out.
Correlating at consumption rather than at enqueue also fixes attribution for free: every record
before it belongs to the response that was already running, and `transcriptCorrelated` was false for
all of them.

### If it is never consumed

Nothing changes about the bound or the outcome. `promptProcessingConfirmed` stays false and the turn
fails closed at `promptAcceptanceTimeoutMs`, with nothing typed twice, exactly as before. The only
edit to that path is one message string: a queued prompt is told where it is, because saying CC
Relay "could not verify that Claude received" a prompt it matched byte for byte would invite the
manual resubmission that duplicates it. The timeout value, the `retryable: false`, the "will not
type the prompt again automatically" sentence, and the thrown class are untouched. The same reason
adds a queued branch to the submission-window failure, whose generic guidance ("the terminal may be
holding unsubmitted text, submit or clear it") is actively harmful for a prompt sitting on a queue.

## Files

- `src/claude-transcript-tail.mjs`
- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`

See [[claude-image-prompt-correlation]], [[continuation-input-review]],
[[claude-live-steering-review]], [[claude-terminal-visibility]], and [[hot]].

#relay #claude #terminal #steering
