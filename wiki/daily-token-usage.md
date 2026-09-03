---
name: Daily Token Usage Ledger
description: Local-day provider token totals in the macOS Crowie title bar and the accounting contract behind them.
type: architecture
tags:
  - relay
  - telemetry
  - claude
  - codex
  - opencode
  - electron
---

# Daily Token Usage Ledger

## Outcome

The macOS desktop title bar places compact `Today In N Out N` counters beside Crowie. They show the
native input and output tokens observed during the current local calendar day across Claude, Codex,
and OpenCode. Clicking the counter opens a per-project breakdown with input, output, and the complete
provider-reported total. Hover detail gives the exact all-provider counts and provider split.

This is consumption telemetry, not subscription allowance or generation speed:

- [[provider-usage-monitor]] shows percentage used in provider subscription windows.
- [[token-throughput-correction]] shows current-attempt output tokens per elapsed second.
- The title-bar counter shows the provider token total assigned to today.

## Counting contract

Provider usage arrives as cumulative snapshots. Summing those snapshots directly would count the
same tokens repeatedly, so `RelayDatabase` folds every native cumulative stream and persists only
its increase in `task_token_usage_deltas`. A stream is scoped by provider, workflow phase, worker,
graph task, and native thread or session identity within one task attempt.

For each snapshot:

```text
delta = current cumulative total - previous cumulative total
```

An identical snapshot records a zero delta. If a provider stream restarts and its cumulative values
move backward, the current snapshot becomes the first delta of the restarted stream. Follow-up and
retry attempts have independent folds through `attemptStartedAt`.

Each delta keeps the event observation timestamp and a server-local `YYYY-MM-DD` date. When a run
crosses midnight, only the increase first observed after midnight belongs to the new day. The earlier
cumulative amount stays on the preceding day.

The visible title uses the separate `inputTokens` and `outputTokens` fields. The breakdown also keeps
`usage.totalTokens`, which is not necessarily their sum: a provider total can contain cache reads,
cache creation, reasoning, or another provider-classified token category. Task cards use the same
provider total for their `Total` capsule and keep generated output in `Out`.

Project grouping joins each daily delta through its task's exact `repo_path`. A matching saved project
supplies the display name; an unpinned or historical path falls back to the path itself. Groups are
ordered by descending provider total, then name and path for a stable tie break.

## Claude correction

Claude assistant usage reports uncached input and output separately from cache reads and cache
creation. Treating only `input_tokens + output_tokens` as the total can therefore understate a
cache-heavy turn by millions of tokens. Relay normalizes and sums all native Claude categories by
assistant message ID, then emits one monotonic provider-total snapshot.

Claude sub-agents have a second usage path. When an Agent completes, Relay reads that agent's saved
native transcript and sums assistant usage once per message ID, including cache categories. A resumed
agent reuses the same transcript identity, and the transcript fold starts at Relay's exact provider
attempt boundary, so earlier turns cannot re-enter a continuation total. Only newly accumulated usage
advances the parent total. The completed inline Agent result's `usage` and `totalTokens`, or a background notification's
combined `subagent_tokens` or `total_tokens`, remain fallbacks when the detailed trace is unavailable.
Duplicate enqueue and remove notifications cannot add a completion twice. Field and total maxima
preserve the strongest native evidence and prevent a later smaller report from moving the cumulative
stream backward.

> [!important]
> Do not infer Claude total usage from uncached input and output alone. Preserve cache-read,
> cache-creation, reasoning, reported-total, and completed sub-agent evidence through normalization.

## Persistence and backfill

`task_token_usage_deltas` has one row per accepted `provider/token-usage` event. It stores the task,
provider, observation time, local usage date, input delta, output delta, and provider-total delta.
The event ID is the primary key, so replaying or reopening the database cannot duplicate a row.

On upgrade, Relay rebuilds the ledger from stored native cumulative events and their recorded task
attempt boundaries. The rebuild and its migration marker commit in one transaction, so an
interrupted rebuild leaves neither and the next start retries safely. Later native events write the
event and delta atomically, letting normal startups trust the marker without reparsing the complete
JSON history. Estimated and non-native usage events are excluded.

Historical limits remain explicit. Relay can backfill only usage present in saved native token
events. A task recorded before token telemetry existed cannot be estimated. Claude sub-agent totals
that were not converted into token events by an older Relay build are also not reconstructable from
the normalized event history; new completions are counted from the first run on this implementation.

## Status and renderer contract

`GET /api/status` returns `dailyTokenUsage` and advertises
`capabilities.dailyTokenUsage`. The response contains the local date, exact input, output, and total
sums, plus provider and project breakdowns. `public/task-conversation-metrics.js` owns compact labels
and tooltip copy, while `public/app.js` updates the title-bar button and its project panel on the normal
status refresh. The panel closes on Escape or an outside pointer action and returns keyboard focus to
the title-bar button after Escape.

`Today 0` means the current backend has recorded no native usage on this local day. `Today --` means
the renderer is connected to an older backend without the capability and needs a CC Relay restart.

> [!important]
> Keep provider total separate from the visible input and output counts. Cache-heavy Claude work can
> make total much larger than input plus output, and collapsing these categories would hide the exact
> distinction this control is designed to expose.

## Verification

- `test/database.test.mjs` covers cumulative deltas, duplicate snapshots, follow-up attempts,
  historical backfill, non-native exclusion, provider totals, and a run crossing local midnight.
- `test/claude-execution-runner.test.mjs` covers cache categories, message deduplication, detailed
  sub-agent transcript totals, inline and background fallbacks, resumed agents, duplicate
  notifications, and non-regressing sub-agent data.
- `test/task-conversation-metrics.test.mjs` covers compact daily input and output labels, provider and
  project detail, empty and unavailable states, cache-heavy Claude totals, and task-card heat levels.
- `test/daily-token-usage-ui.test.mjs` and `test/desktop-icon.test.mjs` protect the status capability,
  renderer refresh, accessible title-bar markup, Crowie lockup, and desktop styling.
