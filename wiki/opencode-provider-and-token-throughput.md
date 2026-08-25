---
name: OpenCode Provider and Token Throughput
description: Headless OpenCode execution, native session statistics, and live token speed across supported providers.
type: architecture
tags:
  - relay
  - opencode
  - providers
  - telemetry
  - task-activity
---

# OpenCode Provider and Token Throughput

OpenCode is the third direct **Execute** provider beside Codex and Claude. It participates in the
ordinary automatic queue, receives an independent per-project capacity limit, exposes its configured
model catalog, persists its native session ID, and streams provider messages, tools, errors, and
token statistics into Task Activity.

Plan council, Turbo, Planner breakdown, and Standup remain Codex and Claude workflows. OpenCode is
also headless, so **Keep task terminals open**, manual terminal sessions, live steering, and the
interactive continuation dock do not apply. Retrying the same OpenCode task resumes its saved native
session. Switching its retry to another provider starts a fresh conversation while preserving the
Relay task record.

## Detection and model catalog

`OpenCodeRuntimeStatus` performs two native probes:

1. `opencode --version` proves that the CLI can start.
2. `opencode models` proves that at least one model provider is configured and supplies model IDs
   for the composer and retry picker.

The command resolver checks the process `PATH`, `~/.opencode/bin`, `~/.local/bin`, and common
Homebrew or system binary locations. A confirmed missing result causes the next refresh to resolve
the command again, allowing an installation made while Relay is running to become available. The
status refreshes every 15 seconds. Provider and model identifiers are passed through as native
`provider/model` values, including providers whose model segment contains additional slashes.

OpenCode authentication and provider credentials stay in OpenCode. Relay neither creates an API key
nor reads those credentials. An installed CLI with no configured model remains visible as requiring
sign-in or provider setup.

## Execution lifecycle

For a fresh task Relay starts a detached child process in the selected repository with the equivalent
of:

```text
opencode run --format json --auto --dir <project> [--model <provider/model>] [--variant <effort>] [--file <attachment>] <prompt>
```

For a retry with a saved native conversation, Relay also supplies `--session <session-id>`. The
standard non-interactive Relay instruction is appended to the prompt so OpenCode can complete without
asking the unavailable operator for input.

The disposable pool reserves a virtual OpenCode allocation before spawn and releases it at every
terminal outcome. Cancellation terminates the owned process group. Stream records and native export
data have explicit byte and time limits, so a malformed or stalled provider cannot grow memory or
hold cancellation indefinitely.

The JSON stream is authoritative during the run:

- `text` becomes an OpenCode assistant message.
- `tool_use` becomes a provider tool lifecycle item.
- `step_finish` contributes native token usage.
- `error` becomes a task-level provider error.

Some OpenCode versions can complete without including the final step or text record in the live JSON
stream. Relay detects missing finish evidence, a zero token total, or a missing final response and
performs one bounded `opencode export <session-id>` reconciliation. Only assistant messages observed
in this run or created after this run began are eligible, so historical session tokens cannot leak
into the current attempt. The export is a fallback, not the live statistics source.

## Native token usage contract

Codex, Claude, and OpenCode normalize direct provider telemetry into one cumulative event:

```json
{
  "type": "provider/token-usage",
  "provider": "opencode",
  "source": "native",
  "cumulative": true,
  "usage": {
    "inputTokens": 100,
    "outputTokens": 20,
    "reasoningTokens": 5,
    "cacheReadTokens": 30,
    "cacheWriteTokens": 4,
    "totalTokens": 159
  }
}
```

OpenCode emits a new cumulative event for each native `step_finish`. Step IDs are folded before the
total is recomputed, so a repeated stream record cannot count the same step twice. Codex uses
`thread/tokenUsage/updated`. Claude folds native assistant message usage by message ID, which also
prevents repeated stream records from increasing the total.

Relay trusts a provider's explicit total when present. If the provider omits it, Relay sums input,
output, reasoning, cache-read, and cache-write tokens. This deliberately represents all native tokens
reported as used, not output generation alone.

## Speed calculation

The visible rate is calculated as:

```text
tokens per second = latest cumulative native total / elapsed task seconds
```

For example, 600 cumulative tokens after 10 seconds displays 60 tokens/s. If no new token event
arrives by 20 seconds, the running display becomes 30 tokens/s. The denominator updates once per
second while the task runs, so OpenCode speed remains live between native step boundaries.

Completed tasks use `finished_at` as the fixed endpoint. A manually open Codex or Claude session
without `finished_at` uses its latest native token event, preventing an idle saved session from
appearing slower over time. A minimum positive duration avoids division by zero for very fast runs.

Only events that satisfy all of these conditions can drive the metric:

- the event is `provider/token-usage`;
- `source` is exactly `native`;
- the event is cumulative;
- its provider matches the task provider;
- its timestamp is not older than the current `started_at` attempt.

This excludes estimates, another provider's telemetry, and usage retained from an earlier retry.
The newest valid cumulative event appears as **tokens/s** in both Task Activity and the global
running-task monitor. Native usage rows are folded as telemetry rather than counted as conversation,
command, or file signals.

`opencode stats` is intentionally not used for a single task's speed. It represents broader OpenCode
history, while the JSON step records and bounded session export identify the current Relay attempt.

## Implementation and coverage

- `src/opencode-runtime-status.mjs`
- `src/opencode-runner.mjs`
- `src/token-usage.mjs`
- `src/disposable-terminal-pool.mjs`
- `src/queue.mjs`
- `src/running-task-feed.mjs`
- `public/token-throughput.js`
- `public/event-stream.js`
- `public/app.js`
- `test/opencode-runtime-status.test.mjs`
- `test/opencode-runner.test.mjs`
- `test/token-usage.test.mjs`
- `test/token-throughput.test.mjs`
- `test/token-throughput-ui.test.mjs`

See [[provider-installation-detection]], [[disposable-terminal-pools]], [[task-activity-overview]],
[[interface-layout]], and [[opencode-token-throughput-review]].

#relay #opencode #providers #telemetry #task-activity
