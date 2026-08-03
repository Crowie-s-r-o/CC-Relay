---
name: Resumed Council Claude Submit Review
description: Task 341 incident analysis and ship review for held revision paste recovery after a transient busy sample.
type: review
tags:
  - relay
  - claude
  - terminal
  - plan-council
  - recovery
---

# Resumed Council Claude Submit Review

## Executive Summary

**Ticket confidence: Medium**

Task 341 proved two independent faults in the guarded submit path used by a resumed Plan council revision:

1. The first retry sent an empty Terminal `do script` as its recovery Return. The Apple Event reported success, but Claude Code 2.1.220 kept the 293-line paste in its composer and wrote no transcript record.
2. The second retry briefly reported `busy` while the relaunched TUI was settling. `ClaudeTerminalExecutor.watchTurn()` latched that one sample as a permanent turn start. It therefore suppressed submit recovery, then interpreted four idle samples with no transcript growth as a human-input pause.

The executor now sends a nonempty trailing-space command whose Terminal-appended Return submits the held paste. Busy discovery remains a liveness signal, but only post-injection transcript bytes are durable submission evidence. If a transient busy sample returns to idle with the transcript still unchanged, CC Relay performs the guarded submit instead of emitting `claude/input-required`. An unreadable transcript remains uncertainty and suppresses the action.

Task 341 itself recovered when Return was pressed manually at 23:44:04 local time. Its prompt record appeared at that exact time, Claude resumed one second later, and the Plan council completed at 23:50:21 with a 38,226-character final plan. The source fix passed all 64 focused terminal tests and all 711 repository tests.

The remaining gap is the external Terminal.app and Claude Code boundary. CC Relay is currently running from `dist/mac-arm64/CC Relay.app`, and the packaging contract forbids replacing that output bundle while it is running. The patched package therefore still needs a normal quit, rebuild, relaunch, and one live held-paste smoke test.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `src/claude-terminal-executor.mjs` now separates transcript-confirmed submission from transient busy liveness, retries the held paste only while the exact session is idle, and resets the post-nudge confirmation window. Task 341's timestamps and transcript prove the original prompt was valid and only Return was missing. |
| Regression risk (UI / backend / contracts) | Green | No renderer, HTTP, database, queue, artifact, permission, or capability contract changed. Existing Claude terminal execution and Plan council both use the corrected executor. |
| Gap risk (edge cases, error handling, completeness) | Amber | The nonempty Terminal recovery action is not yet proven against a rebuilt packaged app and Claude Code 2.1.220. Terminal.app and Claude expose no atomic composer-state API. |
| Code quality (maintainability as safety) | Green | Submission evidence, busy liveness, transcript-readability gating, timeout handling, and input-pause handling remain explicit in one watcher. Comments name the task 341 failure shape. |
| Unit tests | Green | The focused suite has 64 passing tests. A task 341 regression recreates idle, transient busy, unchanged transcript, guarded submit, and completion. Existing question, cancellation, identity change, partial transcript, long-busy, and inactivity cases remain covered. Full suite: 711 passed. Adequate UNIT tests: Yes. |
| Performance and scalability | Green | The change adds no new polling loop. Each affected turn retains O(1) session reads, transcript stats, and at most one submit Apple Event. |

## Change Mapping

### `src/claude-terminal-executor.mjs`

Responsibility: relaunch the exact owned Claude terminal, inject one prompt, mirror its transcript, detect human-input pauses, cancel safely, and return the final response.

Behavior changes:

- `defaultSubmit()` uses one trailing space instead of an empty string. Terminal receives a nonempty Apple Event and appends the distinct Return.
- `watchTurn()` tracks `transcriptStarted` rather than latching any busy sample as `started`.
- Busy status refreshes the inactivity clock and blocks a submit while currently busy, but does not permanently suppress later recovery.
- Post-injection transcript size or parsed records confirm submission.
- An unreadable transcript never authorizes Return.
- A late nudge receives the remaining normal confirmation interval from the nudge time instead of failing immediately against the original injection deadline.
- `claude/input-required` requires transcript-confirmed work followed by idle observations.

Downstream consumers:

- `ClaudeExecutionRunner` routes owned macOS terminals into this executor.
- `PlanCouncilRunner` marks Claude draft and revision stages as terminal-required.
- `TaskQueue` receives the same success, cancellation, and non-retryable failure semantics.
- Task Activity receives the existing event types only.

### `test/claude-terminal-executor.test.mjs`

Responsibility: deterministic coverage of terminal execution state, transcript races, identity checks, cancellation, timeouts, and runner routing.

Behavior coverage:

- Adds the exact task 341 transient-busy regression.
- Makes a genuinely started silent turn include durable user transcript evidence.
- Proves a long busy turn still receives no submit action.
- Proves an unreadable transcript receives no submit action.

## Functional Execution Trace

### Normal held-paste recovery

1. `PlanCouncilRunner.runClaudeStage()` creates the revision task with `require_terminal: true`.
2. `ClaudeExecutionRunner.run()` resolves the exact CC Relay-owned macOS terminal and calls `ClaudeTerminalExecutor.runTurn()`.
3. The executor verifies the session, pid, window, tty, workspace, and idle state.
4. It relaunches the same Claude conversation with plan permissions and selected model settings.
5. It records the transcript offset and injects the bracketed-paste prompt exactly once.
6. A brief `busy` report keeps the turn alive but does not confirm that Claude accepted the prompt.
7. When the session returns to idle with no post-injection transcript bytes, CC Relay re-verifies the exact terminal.
8. It rechecks parsed records, raw transcript size, current session status, and cancellation.
9. If the transcript is readable and unchanged while the session remains idle, CC Relay sends one nonempty whitespace-plus-Return action.
10. Transcript growth confirms the turn. Normal mirroring, tool events, human input, completion, and cleanup continue unchanged.

### Real interactive question

1. Claude's accepted prompt creates post-injection transcript bytes.
2. `transcriptStarted` becomes true.
3. When Claude later reports idle without a final record, CC Relay may emit `claude/input-required`.
4. Submit recovery cannot run because the transcript already confirms the turn.
5. Busy status or new transcript bytes resume the watcher.

### Unreadable transcript

1. A transcript stat returns a negative unreadable result.
2. CC Relay does not treat it as growth, shrinkage, or proof of no growth.
3. The guarded submit remains suppressed.
4. A recovered stat can resume normal classification.
5. Continued uncertainty ends through the existing non-retryable inactivity or no-start bound. CC Relay never guesses by pressing Return.

### Cancellation and identity change

- Cancellation is checked at the loop top, during terminal re-verification, and immediately before submit.
- A changed window, tty, pid, missing session, or resolution failure prevents the action.
- Every ambiguous post-injection failure remains non-retryable, so the queue cannot paste the prompt again automatically.

## Regression Hunt

- Before: one busy sample permanently disabled submit recovery. After: only transcript bytes persist as submission evidence.
- Before: busy followed by idle and no transcript could display `Input needed`. After: it is still an unconfirmed submission and enters guarded recovery.
- Before: an empty submit Apple Event could report success without moving the Claude widget. After: the action is nonempty while changing the prompt only by trailing whitespace.
- Before: a nudge delayed by busy status could immediately hit the original submission deadline. After: it receives the remaining configured confirmation interval.
- Unchanged: current busy status suppresses Return.
- Unchanged: any parsed or partial transcript growth suppresses Return.
- Unchanged: an actual question keeps the task and session reserved.
- Unchanged: Plan council failures never enter automatic retry.

## Top 3 Risks

1. `src/claude-terminal-executor.mjs`, `defaultSubmit`: the whitespace-plus-Return action has deterministic unit coverage at the dependency boundary but no rebuilt packaged-app proof against Claude Code 2.1.220.
2. `src/claude-terminal-executor.mjs`, `watchTurn`: a real turn that becomes idle without writing any transcript byte is indistinguishable from a held paste. The exact idle, identity, readable-unchanged transcript, one-shot action, and non-retryable policy mitigate this, but the external TUI contract is not atomic.
3. `src/claude-terminal-executor.mjs`, transcript evidence: any post-injection metadata byte still counts as durable start evidence, matching the prior partial-growth safety rule. A future Claude version that writes unrelated metadata after paste but before submit could suppress recovery.

## Top Improvements

1. After CC Relay quits normally, rebuild the macOS package, launch it, and force one large-paste recovery against the installed Claude version.
2. Add a diagnostic field naming the initial evidence source: transcript record, transcript bytes, current busy, or submit nudge. This would shorten future TUI compatibility investigations.
3. Replace heuristic composer inference if Claude or Terminal later exposes a supported exact input-state API.

## Recommendation

**Ship with Mitigations**

The state-machine correction is deterministic, preserves fail-closed identity and cancellation behavior, and has adequate unit coverage. Activate it only after a safe package rebuild and relaunch. Keep the one live large-paste recovery as the release smoke check.

## Confirmed Issues

- Empty `do script` reported success during task 341's first retry but produced no Claude prompt record.
- One transient busy sample during task 341's second retry suppressed the guarded submit permanently.
- The unchanged composer was incorrectly presented as `Input needed`.
- The manual Return created the first revision prompt record and immediately resumed execution.

## Suspected Issues and Edge Cases

- Claude or Terminal versions may vary in how they treat trailing whitespace before Return.
- A very fast real `AskUserQuestion` with no prompt transcript bytes would remain ambiguous.
- Unrelated transcript metadata written after injection may still suppress recovery.

## Regression Risks

- Direct Claude Execute tasks share this executor, so they now recover from the same transient-busy held-paste state.
- Busy-only long turns still remain alive, but if they later become idle without any transcript bytes they become eligible for the guarded action.
- The nudge timeout can extend beyond the original injection-relative deadline when busy status delayed the safe action. The extension is bounded and applies only once.

## Performance Risks

No material risk. Work remains constant per poll and one-shot per turn. No database query, DOM update, new process, or unbounded allocation was added.

## Test Gaps

- No packaged macOS live recovery after this patch.
- No Windows impact because this terminal executor is macOS-only.
- No atomic composer-state fixture exists outside the real Claude TUI.

## Positive Improvements

- Human-input status now requires evidence that the prompt actually entered the transcript.
- A process-settling busy blip can no longer wedge a resumed Plan council.
- Transcript stat failures explicitly fail closed before Return.
- A delayed safe nudge receives time to prove success.
- The recovery Apple Event is nonempty and still changes model input only by harmless trailing whitespace.

See [[plan-council]], [[claude-terminal-input]], [[claude-terminal-submit-review]], [[claude-terminal-visibility]], and [[diagnostics]].

## July 29 task 15 supersession

> [!important]
> Task 15 disproved this review's earlier assumption that any post-injection transcript byte is durable submission evidence. `/compact`, its generated summary, and restored context grew the transcript while the actual continuation stayed in Claude's composer for more than five minutes. The current contract requires the exact complete delivered prompt in `UserPromptSubmit` or a top-level transcript user record. Busy and unrelated bytes are liveness only, and **Input needed** requires a current unresolved `AskUserQuestion`. See [[claude-continuation-compaction-recovery-review]] for the superseding incident trace, implementation, tests, and release recommendation.

## July 30 task 39 supersession

> [!important]
> Task 39 disproved this review's one-shot recovery rule. The nonempty trailing-space action is
> still correct, but a single attempt 1.5 seconds after injection is far too early: a 201-line paste
> with image attachments was still settling, so that Return was swallowed exactly like the pasted
> one and the latch made recovery impossible. The guarded action is now a bounded schedule of up to
> four attempts with backoff inside an 80-second window, each re-proving the complete safety
> contract. See [[claude-held-paste-multi-attempt-submit]].

#relay #claude #terminal #plan-council #review
