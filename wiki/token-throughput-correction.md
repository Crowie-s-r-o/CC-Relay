---
name: Token Throughput Correction
description: Why Relay's first tokens-per-second metric was inflated and how current-attempt input, output, and rate accounting now work.
type: incident
tags:
  - relay
  - telemetry
  - codex
  - task-activity
  - correction
---

# Token Throughput Correction

## Outcome

Relay now reports cumulative native input and output totals for the current task attempt. Its visible
rate is cumulative output tokens divided by elapsed attempt seconds. Input tokens, cached context,
reasoning detail, and the provider total remain usage evidence, but they are not generation speed.
Conversation cards separately sum native input, output, and active duration across all attempts under
one task ID. See [[conversation-card-metrics]].

## What went wrong

The original implementation divided `usage.totalTokens` by task wall time. That total includes input
processing, and long agentic runs repeatedly send a large context window. Real tasks therefore showed
rates above 200 and 400 tokens/s even though their latest responses contained only hundreds of output
tokens.

Codex exposed a second accounting error. Its `thread/tokenUsage/updated` payload has:

```text
total = thread-wide cumulative usage
last  = exact usage for the latest upstream response
```

Relay selected `last` and marked the resulting event `cumulative: true`. Live evidence falsified that
assumption: input followed the latest context size, output moved backward between events, and the
supposed cumulative record for task 1107 reached 203,566 input tokens with only 108 output tokens.
The displayed number was therefore neither task consumption nor output speed.

## Correct accounting

For the first Codex usage update in an attempt:

```text
pre-attempt baseline = thread total - latest response
attempt usage        = thread total - pre-attempt baseline
```

The baseline stays fixed for the rest of that provider turn. A goal successor first adds the completed
turn's attempt usage, then derives a new turn baseline. A resumed conversation derives its baseline
from the first new response, so historical conversation usage cannot leak into the current Relay
attempt.

Claude still folds exact assistant usage by message ID. OpenCode still folds exact `step_finish`
usage by step ID. Both already produced monotonic current-attempt totals.

## Follow-up attempt boundaries

A direct follow-up reuses the task ID and event rail. Automatic tasks replace `started_at` with the
new run time, but manual terminal sessions intentionally preserve their first `started_at` so the
card continues to describe the complete workspace lifetime. Using that task-level timestamp as the
only token boundary allowed a manual follow-up to inherit the preceding turn's cached usage until
the provider emitted its first new token event. Its output rate also used the complete session age
instead of the new attempt age.

`TaskQueue.beginTask()` now records a `relay/task-attempt-started` event for every run and stamps each
native token snapshot with the same `attemptStartedAt` value. Task Activity resets at that boundary,
and the global monitor clears its incremental cached snapshot as soon as it sees the boundary. The
first provider event then restores input, output, and rate from only the new attempt. A long event
window can omit the start event safely because each later cumulative snapshot carries the boundary
itself.

> [!important]
> `tasks.started_at` remains the lifecycle timestamp. Do not change manual sessions to overwrite it
> on each message. `task_attempts` owns exact provider boundaries. Cards sum those attempt durations
> for conversation runtime while lifecycle dates continue to answer when the task started and ended.

The UI calculation is:

```text
average output tokens/s = cumulative output tokens / elapsed attempt seconds
```

Task Activity shows exact current-attempt input and output counts beside that rate. Hover detail also
names reasoning, cache-read, cache-write, and provider-total values. The compact global task monitor
shows that current-attempt rate alongside lifetime conversation provider-total and output counts.
The separate macOS Crowie title-bar counter sums provider-total deltas observed on the current local
calendar day. See [[daily-token-usage]].

> [!note]
> This is average task throughput, not instantaneous decoder speed. Tool execution and idle intervals
> remain in the denominator.

> [!warning]
> Persisted Codex token events from before this correction claimed cumulative semantics while carrying
> latest-response data. Relay does not rewrite them because a continued thread does not retain enough
> pre-attempt baseline evidence for a safe migration.

## Implementation

- `src/token-usage.mjs` derives and subtracts the Codex pre-attempt baseline.
- `src/codex-app-server.mjs` retains that baseline across one turn and resets it at a goal successor.
- `src/queue.mjs` records and stamps the exact provider-attempt boundary.
- `src/running-task-feed.mjs` clears cached prior-turn usage when a follow-up begins.
- `public/token-throughput.js` uses cumulative output as the rate numerator.
- `public/app.js` shows input, output, and the average output rate with full native detail on hover.
- Focused provider, feed, throughput, and UI coverage passes 127 tests.
- The completed extra verification aligned the thinking-token card with the same cumulative native
  snapshot and covered baseline reset across a Codex goal successor.
- The complete repository suite passes 1,727 tests. `npm run release:check` confirms v0.2.24 metadata,
  and `git diff --check` is clean.
- The August 27 follow-up regression passes 90 focused checks and all 1,747 repository tests.

See [[opencode-provider-and-token-throughput]], [[opencode-token-throughput-review]],
[[task-activity-overview]], and [[interface-layout]].

#relay #telemetry #codex #task-activity #correction
