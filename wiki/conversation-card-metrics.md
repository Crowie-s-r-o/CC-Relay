---
name: Conversation Card Metrics
description: Lifetime token and active runtime accounting for one task conversation across follow-ups and retries.
type: architecture
tags:
  - relay
  - telemetry
  - task-history
  - continuation
  - interface
---

# Conversation Card Metrics

## Outcome

Queue, History, and global running-task cards show compact **In** and **Out** token totals for the complete task conversation. The capsule color reflects combined input plus output volume. The duration beside it is the sum of actual execution time from every attempt under that task ID.

One attempt means any provider run attached to the task, including the initial request, direct follow-ups, manual terminal turns, and automatic or operator-initiated retries. Idle time between attempts is not execution time and is not added to the duration.

## Persistent accounting

SQLite stores one `task_attempts` row per attempt with:

- its exact start and finish timestamps;
- the resulting active duration in milliseconds;
- cumulative native input and output totals for that attempt;
- the last snapshot for each provider execution stream.

`TaskQueue.beginTask()` opens the attempt before provider execution. Every success, failure, interruption, or retry boundary closes it with one shared finish timestamp before the task outcome is exposed. A new follow-up or retry opens another row instead of replacing prior accounting.

Provider usage events are cumulative within their stream. Relay stores only each snapshot's incremental delta, so repeated updates do not double count earlier tokens. Provider, phase, Turbo worker, graph task, worker thread, conversation, and session identity separate concurrent streams inside one attempt.

The task API returns the aggregate as `conversation_metrics`:

```text
attempt_count
duration_ms
input_tokens
output_tokens
token_observed
active_attempt_started_at
```

Completed-attempt duration is persisted. While a task is running, the renderer adds elapsed time from `active_attempt_started_at` to the persisted total. This keeps the card ticking without counting a follow-up's waiting gap. `tasks.started_at` and `tasks.finished_at` remain lifecycle dates for the Started and Completed fields.

> [!important]
> Conversation duration is active provider runtime, not wall-clock age from the first request to the latest answer. A one-hour gap followed by a 20-second follow-up adds 20 seconds.

For existing databases, startup reconstructs attempt rows only for tasks that do not already have them. It uses stored attempt-boundary events, token snapshots, outcome events, and lifecycle timestamps as a best-effort legacy fallback. Historical rows are never duplicated on later starts.

## Card presentation

The heat level uses combined input plus output tokens:

| Level | Combined tokens | Accent |
| --- | ---: | --- |
| Quiet | 0 to 49,999 | teal |
| Steady | 50,000 to 199,999 | blue |
| Heavy | 200,000 to 499,999 | violet |
| Intense | 500,000 or more | rose |

The card always keeps separate **In** and **Out** values. Compact labels such as `1.3k` preserve card density, while hover text and accessible labels expose exact counts and the named heat level. The capsule appears only after a native cumulative usage snapshot has been observed. Color is redundant with the numeric totals and text label.

The same scale is used in light and dark themes. It colors only the telemetry capsule, preserving existing project, status, selection, and review semantics on the rest of the card. At the narrowest running-task width, the current-attempt output-rate badge hides first and the lifetime input/output totals remain visible.

Task Activity keeps its current-attempt input, output, and average output-rate evidence from [[token-throughput-correction]]. Its task duration and the conversation cards use the lifetime active-runtime aggregate.

## Implementation and verification

- `src/database.mjs` owns attempt persistence, aggregation, restart recovery, and legacy backfill.
- `src/queue.mjs` opens and closes attempts at provider execution boundaries.
- `public/task-conversation-metrics.js` owns compact labels and heat classification.
- `public/task-time.js` owns cumulative active-runtime formatting.
- `public/app.js`, `public/task-history.js`, and `public/task-activity-overview.js` consume the same aggregate.
- `test/database.test.mjs` covers multiple follow-up attempts and legacy event backfill.
- `test/task-time.test.mjs` proves that completed turns plus an active follow-up sum without idle gaps.
- `test/task-conversation-metrics.test.mjs` and `test/token-throughput-ui.test.mjs` cover labels, thresholds, both card surfaces, and both themes.

See [[same-task-session-continuation]], [[task-history]], [[token-throughput-correction]], and [[interface-layout]].

#relay #telemetry #task-history #continuation #interface
