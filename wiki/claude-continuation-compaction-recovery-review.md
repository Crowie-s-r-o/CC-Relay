---
name: Claude Continuation Compaction Recovery Review
description: Task 15 incident analysis and adversarial review of exact prompt delivery, compaction handling, and verified terminal questions.
type: review
tags: [relay, claude, terminal, continuation, compaction, review]
---

# Claude continuation compaction recovery review

> [!important]
> A Claude continuation is not started merely because the terminal reports busy or its transcript grows. CC Relay now requires the exact delivered prompt through `UserPromptSubmit` or a matching top-level user transcript record. Compaction records are explicitly non-correlating, and **Input needed** requires a real `AskUserQuestion` tool event.

## Incident evidence

Task 15 on July 29, 2026 provided a complete reproducer:

1. CC Relay recorded `claude/started` at `16:00:59Z` immediately after terminal injection.
2. Claude submitted `/compact` at `16:01:00Z`.
3. The transcript wrote a `compact_boundary`, compact summary, restored files, and other metadata through `16:02:19Z`.
4. The old watcher treated that activity as the continuation turn, then emitted `claude/input-required` at `16:02:23Z` even though Claude had asked no question.
5. The exact continuation prompt did not appear in the transcript until `16:07:28Z`, after a manual Return.
6. Claude then performed the requested work and CC Relay recorded the completed result at `16:10:31Z`.

The transcript proves three former assumptions false:

- Arbitrary post-injection bytes are not prompt delivery evidence.
- A transient or compaction-related busy state is not prompt delivery evidence.
- Idle without a final response is not proof that Claude asked a question.

## Change map

| File | Responsibility | Safety change |
|---|---|---|
| `src/claude-hook-bridge.mjs` | Builds token-scoped loopback hook settings | Adds `UserPromptSubmit`, `PreCompact`, and `PostCompact` alongside text, tool, and stop hooks. |
| `src/claude-transcript-tail.mjs` | Reads and classifies appended Claude JSONL records | Extracts only top-level user prompt text, rejects compact summaries and tool results, normalizes line endings and trailing whitespace, and requires the complete delivered prompt. |
| `src/claude-terminal-executor.mjs` | Injects, verifies, monitors, and finalizes a terminal turn | Separates pasted, submitted, processing-confirmed, compacting, and question-pending states. Correlates hook events by `prompt_id`, bounds unverified processing at five minutes, and sends at most one guarded submit action. |
| `test/claude-hook-bridge.test.mjs` | Hook configuration contract | Proves the three new lifecycle hooks use the expected loopback HTTP shape. |
| `test/claude-terminal-executor.test.mjs` | Deterministic terminal state-machine coverage | Recreates task 15, partial unrelated JSONL writes, stale prompt hooks, real questions, false busy resumes, and the bounded unverified-prompt path. |

The downstream path was regression-checked end to end:

1. `public/app.js` sends **Continue session** to the existing follow-up endpoint.
2. `src/server.mjs` validates the source task and exact session.
3. `src/queue.mjs` runs the follow-up under the same task without queue fallback.
4. `src/claude-execution-runner.mjs` resolves the owned terminal.
5. `ClaudeTerminalExecutor.runTurn()` installs or reuses the session hook URL, injects once, and verifies delivery.
6. Existing event rendering keeps `claude/progress`, `claude/started`, `claude/input-required`, and `claude/input-resumed` compatible.

No API response, database schema, authorization rule, environment variable, or renderer state contract changed.

## Functional execution trace

### Normal continuation

1. CC Relay verifies the exact session, process, TTY, one-tab terminal window, workspace, and idle state.
2. It records the transcript offset before injection.
3. It pastes the fully decorated prompt once and emits `deliveryState: injected`.
4. A matching `UserPromptSubmit` proves that Claude received the complete prompt. The raw task text without its delivery footer is not accepted as an exact match.
5. The matching transcript prompt becomes the durable stream anchor. Only records after that anchor can become task output.
6. Hook events are filtered to the current `prompt_id`. The transcript prompt id overrides a delayed hook id from an older turn.
7. A final response plus stable idle completes the same task and conversation.

### Resume compaction before submission

1. `/compact`, `PreCompact`, `compact_boundary`, compact summary, restored attachments, and `PostCompact` can all occur after injection.
2. These signals keep the watcher live but do not mark the continuation submitted.
3. When compaction finishes and the terminal is idle, CC Relay waits one quiet parsing interval for partial JSONL data.
4. It re-verifies the exact terminal and sends one guarded whitespace-plus-Return action.
5. Only the exact continuation prompt or its exact hook event changes the delivery state.

### Real terminal question

1. A current-turn `PreToolUse` hook for `AskUserQuestion` records the pending question.
2. Sustained idle can emit one `claude/input-required` only while that verified question remains pending.
3. Busy status alone does not claim that the user answered.
4. Matching `PostToolUse`, `PostToolUseFailure`, or a transcript tool result clears the question and emits `claude/input-resumed`.
5. Generic idle with no question emits a quiet diagnostic and keeps checking.

### Failure and retry safety

- A prompt with no current transcript anchor or processing hook cannot occupy a busy or compacting terminal for more than five minutes.
- Timeout-boundary transcript records are drained before the timeout decision.
- Every ambiguous failure after injection is non-retryable, so the queue cannot paste the prompt twice.
- Cancellation, unreadable transcripts, terminal identity changes, process loss, and transcript shrinkage remain fail-closed.

### Executive Summary

**Ticket confidence: High**

The task 15 failure is corrected at its actual state-machine boundary. Compaction is observed but never confused with continuation delivery. The exact prompt is correlated before transcript output is trusted, structured question evidence is required before **Input needed**, and stale hook output is filtered by prompt id. The full repository suite passes 816 of 816 tests.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | The task 15 regression reproduces `/compact`, compact summary growth, false idle, one guarded submit, exact prompt acceptance, and normal completion. |
| Regression risk (UI / backend / contracts) | Green | Existing API, queue, database, and renderer event types are unchanged. All 816 repository tests pass. |
| Gap risk (edge cases, error handling, completeness) | Amber | A compaction lasting more than five minutes ends safely as a non-retryable failure. Older Claude versions without `prompt_id` have weaker stale-hook filtering. |
| Code quality (maintainability as safety) | Green | Delivery, processing, compaction, transcript correlation, and question state have separate named variables and evidence-specific events. |
| Unit tests | Green | Focused tests cover happy paths, task 15, partial writes, stale hooks, exact full-prompt matching, questions, cancellation, identity changes, timeouts, and no-double-submit behavior. Adequate UNIT tests: Yes. |
| Performance & scalability (if applicable) | Green | Work is linear in each newly appended transcript chunk and hook payload. Prompt comparison is bounded by the existing 100 KB injection limit. |

### Top 3 Risks

1. `ClaudeTerminalExecutor.watchTurn()`: the five-minute processing-verification ceiling can fail an exceptionally slow compaction. The failure is loud and non-retryable, so it cannot duplicate work.
2. `ClaudeTerminalExecutor.consumeHook()`: prompt-id filtering depends on Claude Code 2.1.196 or newer. The verified installation is 2.1.220; older versions fall back to exact transcript anchoring but have weaker live-hook isolation.
3. `ClaudeHookBridge`: a Relay-launched terminal normally receives the stable hook URL at launch or settings relaunch. After a backend restart, a legacy task with no model or effort relaunch can temporarily lose live question hooks; exact transcript delivery and false-input prevention still work.

### Top Improvements

1. After current tasks finish, restart CC Relay and run one live smoke test that forces compaction before a Continue-session prompt.
2. Persist or explicitly refresh the hook registration for legacy no-settings sessions after backend restart.
3. Add a runtime compatibility diagnostic when Claude omits `prompt_id`, so reduced hook isolation is visible.

### Recommendation

**Ship with Mitigations**

Restart CC Relay only after current tasks finish, then perform the one compaction smoke test. The source change is safe to ship now.

### Confirmed Issues

- Task 15's `/compact` record and generated metadata were treated as continuation delivery.
- The old watcher emitted **Input needed** without an `AskUserQuestion`.
- `claude/started` was recorded before the exact prompt had been verified.
- The continuation remained in the terminal until a manual Return at `16:07:28Z`.

### Suspected Issues & Edge Cases

- A Claude build older than 2.1.196 may omit `prompt_id`; exact transcript anchoring remains safe, but pre-transcript live events cannot be isolated as strongly.
- A compaction exceeding five minutes can produce a safe false failure.
- A loopback hook blocked by local policy degrades live observability to transcript correlation.

### Regression Risks

- Before: any transcript byte could permanently suppress submit recovery. After: unrelated growth receives one quiet read and then recovery remains eligible.
- Before: any idle started turn could become **Input needed**. After: only a pending structured question can.
- Before: busy status could imply submission or input resume. After: busy is liveness only.
- Before: a stale same-session hook could be attributed to the current turn. After: current prompt ids filter live events and the transcript anchor is authoritative.

### Performance Risks

No material performance risk was found. Each JSONL byte is still read once, prompt comparison is bounded, hook maps remain bounded, and the guarded submit is one-shot. No new database query, subprocess poll, renderer loop, or unbounded collection was added.

### Test Gaps

- No automated Terminal.app fixture can force Claude Code's real compaction UI and collapsed-paste widget.
- The five-minute production default is tested with a shortened deterministic clock, not wall-clock waiting.
- Older Claude builds without prompt ids are supported conservatively but are not installed in CI.

### Positive Improvements

- Prompt delivery now has exact, inspectable evidence.
- Compaction is a first-class state rather than accidental transcript noise.
- Transcript output cannot be borrowed from another turn before the exact prompt anchor.
- **Input needed** and **Input resumed** both require question-specific evidence.
- Unverified busy state has a separate bounded ceiling.
- Timeout-boundary records are drained before failure.
- The no-double-execution and exact-terminal identity guarantees remain intact.

See [[same-task-session-continuation]], [[claude-terminal-input]], [[claude-terminal-visibility]], [[claude-terminal-live-output]], [[claude-resumed-council-submit-review]], and [[claude-terminal-submit-review]].

## July 30 task 39 supersession

> [!important]
> The exact-prompt evidence contract in this review is unchanged and remains the only proof of
> submission. Only the recovery count changed: "at most one guarded submit action" is now a bounded
> schedule of up to four attempts with backoff inside an 80-second window, each re-proving every
> condition listed here immediately before it is sent. Task 39 also showed that an image-bearing
> prompt can never match the transcript anchor, because Claude Code rewrites pasted image paths into
> attachment chips, leaving the `UserPromptSubmit` hook as its only correlation path. See
> [[claude-held-paste-multi-attempt-submit]].

#relay #claude #terminal #continuation #compaction #review
