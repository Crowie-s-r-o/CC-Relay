---
name: Claude Terminal Live Output
description: Why Claude Task Activity lagged behind Terminal.app and how the low-latency mirror works.
type: architecture
---

# Claude Terminal Live Output

## Diagnosis, July 29, 2026

The visible delay had two independent causes.

First, `ClaudeTerminalExecutor.watchTurn()` slept for up to 800 ms between transcript reads. Every loop also refreshed the live session through `claude agents --json`, which took about 340 to 390 ms on the measured machine. That made even an already-written transcript event take roughly 1.1 to 1.7 seconds to reach Task Activity in an unlucky cycle.

Second, and more importantly, the transcript itself is not a real-time event stream. A completed Claude task supplied 33 tool events that could be correlated between the transcript and Relay's stored events. The delay had a 1.48 second median, an 11.4 second p90, and a 55.4 second maximum. Several adjacent tool events arrived 5 to 12 seconds late. The official [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) confirms that transcript persistence is asynchronous and may lag the in-memory conversation.

The HTTP task APIs were not the main delay in this reproduction. `/api/tasks`, `/api/tasks/:id`, and `/api/status` returned in roughly 1 to 4 ms. The broader full-render backlog in [[renderer-performance]] still matters for large histories, but it cannot explain an event that Claude has not written yet.

## Low-latency design

CC Relay now uses a live hook channel first and the transcript as a durable fallback.

1. `src/claude-hook-bridge.mjs` builds additional Claude settings for `MessageDisplay`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`.
2. New CC Relay-owned Claude sessions receive those settings through Claude's existing `--settings <json>` launch option. A task-specific model or effort relaunch carries the same hook settings.
3. Every session gets a stable random token in a loopback-only URL under `/api/internal/claude-hooks/<token>`. The route validates the token and session id.
4. The route returns HTTP 204 immediately, then dispatches the payload on a microtask. This matters because Claude holds a `MessageDisplay` batch until its hook returns. Relay does not perform rendering, discovery, or another subprocess call before acknowledging it.
5. `MessageDisplay` batches become updating `claude/message` events. `public/event-stream.js` folds batches with the same `liveMessageId` into one console signal.
6. Tool hooks reuse the existing Claude event translator, so Task Activity keeps the established `item/started` and `item/completed` shapes. Payload strings and collections are bounded before storage.
7. `Stop.last_assistant_message` supplies the final result without waiting for the transcript's final assistant record. A Stop with background work or scheduled wakeups does not complete the task early.
8. Settings hooks also run within Claude sub-agents. The parent mirror ignores hook payloads carrying `agent_id`; parent-level launch and completion stay represented by the existing sub-agent signals in [[claude-terminal-visibility]].
9. When the transcript eventually catches up, exact tool ids and normalized completed message text suppress duplicate events.

No new environment variable is required. The hook URL is process-local launch configuration and its capability token is held in memory.

## Transcript fallback

`src/claude-transcript-tail.mjs` now watches the transcript's parent directory with the native filesystem watcher. It covers both appends and creation of a fresh session file. A write wakes the mirror immediately instead of waiting for the fixed 800 ms sleep.

The watcher remains an acceleration only. A timeout still runs cancellation, liveness, input-pause, and inactivity checks when native watching is unavailable or misses an event. Transcript writes can arrive faster than `claude agents --json` completes, so `watchTurn()` drains every write immediately but keeps session discovery on its former cadence. This avoids creating a provider subprocess for every line.

The fallback remains important when:

- a retained or manually recovered terminal was launched before the live-hook build and is not otherwise relaunched;
- managed Claude settings disallow the loopback HTTP URL or permit only managed hooks;
- a future Claude version changes or disables one of the hook events;
- the Relay server is restarting.

In those cases output still mirrors from the transcript, now without Relay's additional fixed polling delay.

## Verification

- The full repository suite passes 797 of 797 tests.
- Focused coverage proves hook buffering, token and session validation, immediate text and tool events, late transcript deduplication, updating message grouping, and native watcher fallback.
- Claude Code 2.1.220 accepts the generated inline `MessageDisplay` HTTP hook settings through `--settings`.
- A real macOS filesystem smoke test woke 63 ms after a scheduled transcript append.
- The source-state comparison measured the original upstream delay as high as 55.4 seconds, establishing why a shorter poll interval alone was insufficient.

> [!important]
> Restart the backend or rebuild and reopen the desktop application before validating. A process that started before these modules changed still uses the old polling implementation and launches terminals without the live hook settings.

See [[claude-terminal-visibility]], [[renderer-performance]], [[diagnostics]], and [[retained-terminal-sessions]].

#claude #terminal #performance #hooks #diagnosis
