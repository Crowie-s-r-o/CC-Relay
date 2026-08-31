---
name: Claude Tab Prompt Correlation
description: Task 1152 incident analysis, exact tab-expansion correlation, and privacy-safe terminal diagnostics.
type: incident
tags: [relay, claude, terminal, prompt-correlation, diagnostics]
---

# Claude tab prompt correlation

> [!important]
> Claude Code's interactive composer can persist each pasted tab as four ASCII spaces. Relay must
> treat that complete transport transform as the same submitted prompt, while continuing to reject
> partial, truncated, and generally whitespace-normalized candidates.

## Task 1152 evidence

Task 1152 failed twice on August 31, 2026 in Claude session
`750b09f2-c632-41fd-9240-61f6ba905a73`.

- The stored task request contained 39,508 characters.
- `taskPrompt()` appended the non-interactive notice, producing 39,907 delivered characters.
- The delivered value contained 30 tab characters in copied tables.
- Both top-level Claude user records contained 39,997 characters and were byte identical.
- Every tab became exactly four spaces. Replacing all 30 tabs with four spaces reproduced both
  transcript records byte for byte. The 90-character length increase was the complete difference.
- Claude produced a valid final assistant record on both attempts. The retry's final text contained
  3,283 characters and was visible in Terminal.app.

The terminal executor compared the transcript and `UserPromptSubmit` value only with the literal
delivered prompt. The mismatch latched `unmatchedSubmissionObserved`, correctly disabled every
further paste and submit action, but also kept `transcriptCorrelated` false. Relay therefore ignored
the assistant final as belonging to an unproven turn, displayed zero AI messages, and failed after
the 80-second submission window. This preserved duplicate-execution safety but lost a completed
answer from the task UI.

After the fix was proven, task 1152 was recovered without another Claude run. A bounded one-time
repair required the task to remain failed with the exact correlation error, required exactly one
latest-attempt prompt with `tab-expanded` evidence, required exactly one following text final and a
turn-duration boundary, then restored that 3,283-character response. The repair completed the
failed attempt, created its result artifact, removed the stale error artifact, and recorded the
recovery explicitly in both task events and `task.claude.transcript_recovered` diagnostics. A later
user follow-up legitimately reopened the same task row while retaining the recovered response.

## Exact transport fix

`submittedPromptMatchKind()` in `src/claude-transcript-tail.mjs` checks two complete forms:

1. The sanitized prompt byte for byte, preserving the existing `exact` result.
2. Only when the expected prompt contains tabs, the whole prompt with every tab replaced by four
   ASCII spaces, reported as `tab-expanded`.

There is no generic whitespace folding. One space, eight spaces, a changed field, a truncation, or a
partial expansion still fails. The raw form remains valid because busy-session queue records are
captured before composer rewriting and a future Claude version may preserve tabs. Attachment-derived
forms apply the same tab transform after their existing complete image-chip and slash-boundary
rewrites.

> [!note]
> Two distinct source prompts that differ only by a literal tab versus four spaces are already
> indistinguishable after this Claude terminal transport. Accepting the observed complete form does
> not create a broader collision than the provider composer itself creates.

## Diagnostic event chain

The shared `relay-diagnostics.jsonl` now records the Claude lifecycle from dispatch to completion:

- `task.claude.run.started`
- `task.claude.run.mode_selected`
- `task.claude.terminal.prompt_injected`
- `claude.hook.registered`, `claude.hook.activated`, and `claude.hook.received`
- `task.claude.terminal.prompt_correlated`
- `task.claude.terminal.prompt_correlation_mismatch`
- `task.claude.terminal.final_observed`
- `task.claude.terminal.completed`
- `task.claude.run.completed` or `task.claude.run.failed`
- `claude.hook.deactivated`

Prompt and response bodies remain excluded. Correlation records contain only task and session IDs,
evidence source, match kind, character, byte, line, and tab counts, process-keyed HMAC-SHA256
fingerprints, and common prefix and suffix lengths. Hook boundary records contain only prompt or
final character counts and whether a prompt ID was present. The HMAC key exists only in memory, so a
copied log cannot be used for offline guessing of short prompt text. These fields are enough to
identify a deterministic transport rewrite without copying private task content into diagnostics.

For a future mismatch, compare the `expected` and `actual` shapes in
`task.claude.terminal.prompt_correlation_mismatch`. Matching fingerprints prove channel agreement;
different fingerprints plus the edge lengths localize whether the change is near the start, middle,
or end. `tabExpandedEdges` immediately exposes another tab conversion without logging text.

## Verification

Synthetic regression coverage proves:

- exact tab expansion matches and reports `tab-expanded`;
- a partial expansion and changed content remain rejected;
- a full terminal turn anchors the expanded transcript prompt, mirrors the assistant response, and
  completes with zero guarded submit actions;
- mismatch diagnostics contain shapes and hashes but no prompt body;
- hook diagnostics include boundary lengths but no prompt or response body;
- a diagnostics callback that throws cannot interrupt hook delivery, terminal execution, or runner
  completion;
- the focused Claude terminal, execution runner, and hook bridge suites pass 266 of 266 tests, and
  all 1,763 repository tests pass;
- a read-only replay of the production transcript finds both original 39,997-character prompt
  records as `tab-expanded`, isolates one 3,283-character final and its turn-duration boundary, and
  confirms that the result artifact remains while the later follow-up runs.

See [[claude-terminal-visibility]], [[claude-terminal-live-output]], [[diagnostics]],
[[claude-image-prompt-correlation]], and [[claude-continuation-compaction-recovery-review]].

#relay #claude #terminal #prompt-correlation #diagnostics
