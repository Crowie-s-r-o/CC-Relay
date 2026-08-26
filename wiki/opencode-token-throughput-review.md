---
name: OpenCode Token Throughput Review
description: Adversarial ship review of OpenCode execution, native token telemetry, and live speed calculation.
type: review
tags:
  - relay
  - opencode
  - review
  - telemetry
---

# OpenCode Token Throughput Review

## Summary

**Recommendation: ship. Confidence: high.**

> [!warning]
> **August 25 correction:** the original throughput conclusion was falsified by live Codex tasks.
> `thread/tokenUsage/updated.last` is one upstream response, not a cumulative task total, and total
> input plus output is not an output-generation speed numerator. Relay now derives current-attempt
> usage from the thread-wide total minus a fixed pre-attempt baseline, and divides cumulative output
> only by task elapsed time. See [[token-throughput-correction]].

> [!warning]
> **August 26 reasoning follow-up:** the original OpenCode launch omitted `--thinking`.
> OpenCode 1.18.23 defaults that option off for non-interactive runs, so session export could contain
> a reasoning part that never reached Relay's JSON stream. Relay now requests thinking records,
> normalizes them into the existing Task Activity reasoning item, and recovers them from export when
> reconciliation is already required. Numeric reasoning usage remains the provider's value and is
> never inferred from the visible text. See [[opencode-provider-and-token-throughput]].

The review traced provider selection, validation, scheduling, process ownership, native session
persistence, token accounting, retry isolation, event rendering, and cleanup. No blocking finding
remains. OpenCode is limited to automatic direct Execute work, while Plan council, Turbo, Planner,
terminal retention, live steering, and the continuation dock retain their existing Codex and Claude
boundaries.

The installed OpenCode 1.18.23 CLI was also checked directly. Relay found it at
`~/.opencode/bin/opencode`, confirmed authentication, loaded nine model choices, and verified the
`run`, `models`, `stats`, and `export` command surfaces used by this implementation.

## Execution Trace

1. The automatic Execute composer selects the OpenCode card, native model, optional variant, project,
   attachments, and priority.
2. The task API rejects persistent OpenCode execution, confirms runtime readiness, validates the model
   catalog, and stores a disposable task without terminal-retention flags.
3. The scheduler checks the project's independent OpenCode limit. The disposable pool reserves one
   virtual slot without launching Terminal.app.
4. `OpenCodeRunner` starts `opencode run --format json --thinking --auto --dir <project>` with bounded streams,
   the Relay non-interactive instruction, attachments, and any saved session, model, or variant.
5. The first valid native session identifier emits `opencode/session`. The queue immediately persists
   it as both the task conversation and provider session, including when a later stream record fails.
6. Text, tools, errors, and `step_finish` records become durable task events. Step identifiers dedupe
   token usage before each cumulative native event is emitted.
7. If the successful stream lacks finish evidence, usage, or final text, one three-second and eight-MB
   `opencode export <session-id>` call reconciles only messages observed in this run or created after
   this attempt started.
8. Completion, failure, cancellation, and interruption all release the virtual pool allocation. A
   retry with the same provider resumes the saved OpenCode session. A provider switch clears every
   provider-specific conversation field.

The telemetry trace is:

```text
native provider usage
  -> normalized provider/token-usage event
  -> task event database and artifact log
  -> latest current-attempt cumulative event
  -> output tokens / elapsed task seconds
  -> Task Activity and global running-task monitor
```

## Findings

All findings below were fixed during review.

1. **High: retained-provider switch could strand OpenCode capacity.** A failed or queued retained
   Codex or Claude task could switch to OpenCode while carrying `keep_terminal_open` and
   `manual_completion`. The queue now clears both fields at edit and retry persistence boundaries,
   database creation refuses them for OpenCode, rollback restores them atomically, and pool retention
   defensively drops virtual allocations.
2. **High: failed first attempts could lose the native session.** Session persistence originally
   waited for successful process exit. A dedicated session event now saves the identifier as soon as
   OpenCode reports it, allowing a safe same-session retry after partial work.
3. **High: a resumed stream could silently change sessions.** Any valid session identifier that does
   not match the requested session now records an error, terminates the child, and fails the task.
4. **Medium: oversized complete JSON records did not stop the child immediately.** Both complete and
   newline-free oversized stdout records now terminate the owned process. Stderr and session export
   retain independent byte and time bounds.
5. **Medium: a missing final stream record could omit usage or response text.** Successful incomplete
   streams now use one bounded native session export, scoped to the current attempt.
6. **Medium: switching providers could expose a stale model catalog.** The renderer reloads OpenCode
   models after each completed runtime probe, and model identifiers preserve additional slash
   segments.
7. **Medium: recovered OpenCode text was absent from response history.** Reconciled and streamed text
   now use `opencode/message`, which feeds Task Activity, search, references, and response history.
8. **Low: OpenCode lifecycle and usage rows could inflate message counts.** Only
   `opencode/message` is a conversation response. Native usage folds into one provider telemetry row,
   while started and session events remain system activity.
9. **Low: retained-terminal UI copy was inaccurate for headless work.** OpenCode disables terminal
   retention controls and explains native headless session persistence instead.

## Calculations

An OpenCode step reporting 100 input, 20 output, 5 reasoning, 30 cache-read, and 4 cache-write tokens
normalizes to 159 used tokens. A second step reporting 40, 10, 2, 8, and 1 normalizes to 61, producing
220 cumulative tokens. Repeating a step with the same native identifier replaces its map entry rather
than adding it again.

For a running task with 600 cumulative native output tokens:

```text
after 10 seconds: 600 / 10 = 60 tokens/s
after 20 seconds: 600 / 20 = 30 tokens/s
```

The one-second UI tick recalculates the denominator between provider steps. A completed task with 800
output tokens and an eight-second lifecycle freezes at 100 tokens/s. Input, cached input, and
cache-write counts remain visible usage totals but do not enter this rate. A retry accepts only usage
events whose provider matches the task and whose timestamp is at or after the current `started_at`,
so an earlier attempt cannot contaminate the displayed rate.

`opencode stats` was inspected but is not used for this calculation. Its native options aggregate by
days, models, and project rather than identifying one current Relay attempt. Live `step_finish` data
is therefore the precise source, with `opencode export` as the final reconciliation source.

## Changes Made

- Added OpenCode runtime detection, model discovery, headless execution, cancellation, session resume,
  and bounded export reconciliation.
- Added an independent per-project OpenCode concurrency limit and virtual pool accounting.
- Added normalized native token events for OpenCode, Codex, and Claude.
- Added live average output-token rendering in Task Activity and the global running-task monitor.
- Added OpenCode response rendering, search and reference history, retry and queued-provider switching,
  installation states, documentation, and regression coverage.
- Added lifecycle defenses for provider switching, virtual allocation retention, stream bounds, and
  mismatched session identifiers.

## Verification

- `npm test`: 1,709 passed, 0 failed.
- `npm run release:check`: release metadata consistent for version 0.2.23.
- Focused queue, runner, pool, event-stream, database, runtime-status, and throughput tests passed.
- OpenCode 1.18.23 direct runtime probe: available, authenticated, nine model choices.
- Native CLI help confirmed `run --format json`, `--auto`, `--dir`, `--session`, `--model`, `--variant`,
  repeated `--file`, aggregate `stats`, and JSON session `export`.

## Remaining Risks

- OpenCode could change its native JSON schema in a future release. Strict event checks and bounded
  fallback behavior make that an observable missing-telemetry condition instead of fabricated usage.
- The global monitor keeps the newest 500 events per incremental cache read. This is sufficient for
  current live polling, but an extreme event burst can omit older display-only context. Task Activity
  still reads the durable task event history.
- Token speed measures provider-reported output tokens over task wall time. It includes tool and idle
  intervals, so it is an average task rate rather than an instantaneous generation benchmark.

See [[opencode-provider-and-token-throughput]], [[provider-installation-detection]],
[[disposable-terminal-pools]], [[task-activity-overview]], and [[token-throughput-correction]].

#relay #opencode #review #telemetry
