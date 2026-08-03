---
name: Claude Terminal Submit Review
description: Adversarial review of the guarded separate Return added after task 263 left a large Claude paste unsubmitted.
type: review
---

# Claude Terminal Submit Review

### Executive Summary

**Ticket confidence: Medium**

Task 263 proves the original bracketed-paste Apple Event can leave Claude's large-paste placeholder in the composer without starting a turn. The fix adds one guarded separate Return after 1.5 seconds with no busy or transcript evidence. The guard repeats exact terminal identity resolution, drains complete and partial transcript growth, re-reads session state, and checks cancellation. Any uncertainty after the paste is non-retryable.

The code path is safe to ship, but confidence stays Medium until one restarted CC Relay run proves the exact Claude 2.1.218 large-paste widget accepts the separate production Apple Event end to end.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `ClaudeTerminalExecutor.watchTurn` sends at most one separate action and resumes the existing watcher. The focused recovery test completes only after the action. |
| Regression risk (UI / backend / contracts) | Green | No API, database, renderer, or queue contract changed. The new event uses the existing `claude/progress` type. |
| Gap risk (edge cases, error handling, completeness) | Amber | Terminal.app and Claude expose no composer-state query, so readiness is inferred from transcript and session status. The guard closes known races but cannot make the external TUI atomic. |
| Code quality (maintainability as safety) | Green | Submission is dependency-injected, one-shot state is explicit, and all post-paste ambiguity follows one non-retryable policy. |
| Unit tests | Green | 46 focused terminal tests cover held paste recovery, delayed and partial original starts, identity replacement, cancellation, submit failure, and no repeated action. Full suite: 413 of 413. |
| Performance & scalability (if applicable) | Green | One affected turn adds a constant number of registry reads, one identity resolution, and at most one Apple Event. |

### Top 3 Risks

1. `src/claude-terminal-executor.mjs`, `watchTurn`: the original Return can start immediately after the last idle read. A second Return may then arrive while Claude is busy. The mitigation is that the action is sent only once after 1.5 seconds, and a submitted composer is already cleared, so it cannot re-submit the same prompt.
2. `src/claude-terminal-executor.mjs`, `defaultSubmit`: empty `Terminal.doScript` behavior and Claude's large-paste widget are external version-sensitive contracts. A controlled Terminal probe emitted byte `0d`, but a production retry after restart remains required.
3. `src/claude-terminal-executor.mjs`, `defaultInject`: a pre-existing user draft can still merge with CC Relay's paste. This is existing Issue 3 and is outside the task 263 regression.

### Top Improvements

1. Restart CC Relay and retry one large multiline Claude task to validate the production Apple Event path.
2. Keep the `claude/progress` submit-recovery event in diagnostics so future Claude or Terminal changes are distinguishable from session launch failures.
3. Re-run the controlled integration check after Claude CLI upgrades that alter the paste widget or session-status timing.

### Recommendation

**Ship with Mitigations**

Restart CC Relay before validation. Inspect or clear the text left by task 263 before manually retrying so the stale prompt cannot be submitted alongside the retry.

### Confirmed Issues

- Task 263 recorded `claude/started` but no post-injection transcript records and never reached busy state.
- Its exact terminal displayed `[Pasted text #1 +280 lines]`, proving injection succeeded while submission did not.
- The previous implementation used only one `do script` call and treated its appended Return as sufficient.

### Suspected Issues & Edge Cases

- A future Claude modal state could register as idle and absorb both actions. The no-start timeout remains non-retryable and surfaces manual cleanup.
- Cancellation can race with any external Apple Event after the final in-process check. The guard checks immediately before submission and never repeats the action, but no cross-process atomic cancellation primitive exists.

### Regression Risks

- Before: ordinary bracketed-paste turns used one Apple Event. After: they still use one unless there is no start evidence for 1.5 seconds.
- Before: a held paste failed after the submission timeout. After: it receives one guarded recovery attempt, then preserves the same non-retryable failure policy.
- Before and after: non-macOS, unowned direct terminals, and headless Claude execution do not enter this path. A current macOS Plan council does enter it through its required owned author terminal.

### Performance Risks

No material risk. Work is constant per affected turn and occurs only during the initial no-start window.

### Test Gaps

- Automated unit coverage is adequate: **Yes**. It covers the happy path, delayed evidence race, identity mismatch, cancellation, Apple Event failure, single-action idempotency, and queue-safe error classification.
- The remaining gap is a real restarted CC Relay run against the installed Terminal.app and Claude 2.1.218 TUI. Unit doubles cannot prove external Apple Event interpretation.

### Positive Improvements

- Large-paste submission is now verified rather than assumed.
- Partial transcript bytes count as start evidence before a complete JSONL record exists.
- The exact terminal identity is checked again before the post-paste action.
- Ambiguous post-paste failures never enter automatic retry, preventing duplicate turns.

### July 25 Production Addendum

Task 266 did not exercise this fix because CC Relay server pid `33680` started before the guarded-submit executor file was written. Its raw task events had no separate-submit progress event and its error used the previous no-start wording.

The current executor then completed three real turns in the exact affected Terminal.app tab: a fresh `hi`, a resumed exact-`OK` prompt, and a resumed 281-line paste. All three submitted and produced visible transcript responses. The session UUID, window `53148`, and `/dev/ttys015` stayed constant while the verified Claude pid changed. The active process command line proved `--model opus --effort max`.

The 281-line run submitted on the original bracketed-paste Apple Event, so it did not trigger the one-shot separate Return. That particular external branch remains proven by the controlled carriage-return probe and automated race coverage, not by a production trigger. The broader user-facing submission failure is resolved and live-validated through the deterministic settings relaunch described in [[claude-terminal-settings-review]].

Task 341 later exposed two remaining resume-specific gaps: an empty submit Apple Event could
report success without moving Claude Code 2.1.220, and one transient busy sample permanently
suppressed recovery before a false human-input pause. The guarded action is now nonempty, and
transcript bytes rather than sticky busy status prove submission. See
[[claude-resumed-council-submit-review]] for the incident trace and ship review.

Task 15 later superseded that evidence rule. Arbitrary transcript bytes no longer prove
submission; only the exact complete delivered prompt does. Structured `AskUserQuestion`
evidence is also required before CC Relay reports **Input needed**. See
[[claude-continuation-compaction-recovery-review]].

See [[claude-terminal-visibility]], [[diagnostics]], and [[hot]].

#claude #terminal #review #diagnosis
