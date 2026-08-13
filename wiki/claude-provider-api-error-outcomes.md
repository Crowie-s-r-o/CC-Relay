---
name: Claude Provider API Error Outcomes
description: Claude final responses beginning with API Error are failed provider outcomes, never successful task results.
type: incident
tags:
  - relay
  - claude
  - provider-error
  - task-status
  - retry
---

# Claude Provider API Error Outcomes

On August 13, 2026, Task 713 exposed a false-success path. Claude emitted the same
`API Error: 529 Overloaded` message twice, then its interactive turn reached a normal idle and
exit-zero boundary. The terminal executor returned that message as `finalResponse`,
`ClaudeExecutionRunner.run()` emitted `claude/completed`, and the queue stored both the API error as
the result and `status: complete`.

> [!important]
> A Claude provider API error is not a task result. If the effective final response begins with
> `API Error:`, Relay must fail the execution before emitting `claude/completed`. The task card,
> completion alert system, history, and result artifact must therefore never treat that turn as
> successful.

## Outcome boundary

`claudeApiErrorResponse()` in `src/claude-execution-runner.mjs` checks the effective final response
after either the interactive terminal path or the headless stream path returns, but before the
runner emits its completion event. The match is case-insensitive and anchored to the beginning of
the trimmed response.

This intentionally does not latch every earlier message containing the words `API Error`. Claude
can recover internally and later produce a real result, and a successful report can legitimately
discuss an API error it fixed. Only the final response decides the provider outcome.

## Retry safety

- An interactive terminal API error is non-retryable. The exact prompt crossed the terminal
  submission boundary, so [[automatic-retry-safety]] still forbids an automatic replay. Relay
  stores a failed outcome and directs the operator to retry manually after the provider recovers.
- A headless exit-zero API error remains retryable. This matches the existing behavior for a
  headless stream result explicitly marked as a provider error, and the queue's bounded automatic
  retry cap remains the final guard.

The distinction preserves the no-double-execution rule in [[claude-terminal-visibility]] while
keeping transient headless recovery consistent.

## Verification

Regression coverage proves that:

- the exact exit-zero 529 response is detected;
- a successful result that merely discusses `API Error: 529` is accepted;
- neither terminal nor headless false-success emits `claude/completed`;
- terminal failure is non-retryable while headless failure is transient;
- the existing queue failure and [[task-completion-alerts|completion notification]] contracts stay
  green.

The focused provider, queue, and completion-notification suites pass 106 tests, and
`npm run release:check` is green for v0.2.6. A complete run reached 1,454 of 1,454 immediately
after this fix. A later full rerun picked up concurrent task-search changes in the shared worktree
and found one unrelated stale assertion in `test/project-layout.test.mjs`; this scoped change did
not touch that renderer or test.

See [[task-history]], [[automatic-retry-safety]], and [[claude-terminal-visibility]].

#relay #claude #provider-error #task-status #retry
