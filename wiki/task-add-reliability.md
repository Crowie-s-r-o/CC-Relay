---
name: Task Add Reliability
description: Why adding a task used to stall or fail, and the guarantees that now replace that behavior.
type: diagnostics
tags:
  - relay
  - queue
  - reliability
  - providers
---

# Task Add Reliability

Adding a task must always work and must feel instant. It previously did neither: submissions
could take seconds, and they could fail outright with a message claiming the chosen session was
gone when it was in fact open. Both symptoms came from provider probes sitting directly on the
request path.

## The contract

> [!important]
> `POST /api/tasks` performs local validation only. It never rejects because a session is busy,
> because another task is running, because discovery is mid-refresh, or because the queue is
> paused. The only rejections left are genuinely invalid input: an empty prompt, an unsupported
> mode or provider, a bad or reused submission UUID, image limits, and a session CC Relay has never
> seen at all.

If the referenced session cannot be confirmed live at add time, the task is still accepted and
queued, bound to its provider, session id, and workspace. The session is re-resolved at dispatch.
If it really is gone by then, that one task fails with a clear message. A transient discovery
blip now costs a retry inside a queued task instead of costing the user their prompt.

## Root causes found

### 1. Synchronous Claude CLI probes on every request path

`src/claude-runtime-status.mjs` used `execFileSync` for both `claude --version` and
`claude auth status --json`, **with no timeout**. The add path called it with a forced refresh,
so every Claude, Plan council, and Turbo submission paid two blocking subprocess spawns. Because
the probe was synchronous it blocked the whole Node event loop, delaying every other request and
SSE delivery at the same time. `GET /api/status` (polled every two seconds) and `GET /api/threads`
(every four seconds) hit the same probe whenever the five-second cache expired, which is the
"secondary backend pause" measured at roughly 448 ms in [[renderer-performance]].

Now: `ClaudeRuntimeStatus.current()` is a pure cache read that never spawns anything. A background
interval refreshes it using bounded asynchronous probes. The same treatment was applied to the
Codex probe, which additionally used to run exactly once at module load, so a single failed probe
at boot disabled Codex until CC Relay was restarted.

### 2. Session discovery blanked its own cache on any error

`ClaudeSessionRegistry` cached an empty list whenever `claude agents --json` failed for any
reason: a spawn `EAGAIN` under load, the ten-second probe timeout, a JSON hiccup. Every live
Claude session then appeared to vanish, and the add path turned that into a hard rejection.

> [!warning]
> A failed probe tells you nothing about the sessions. It must never erase what was already
> known. A probe that **succeeds** and omits a session is different: that is real evidence the
> terminal closed, and it still removes the session immediately.

The registry now keeps its last known good list and sets a `stale` marker plus `lastError`.

### 3. The add path forced cold probes

`readConnectedSession()` deliberately bypassed the cache, so every add spawned a fresh Claude
CLI process and was exposed to cause 2. The Codex equivalent was worse: `listConnectedThreads()`
performs one `thread/read` round trip **per connected terminal**, so an add with several
terminals open cost several round trips.

Both providers now expose a warm-cache lookup for the add path (`findSession`,
`findConnectedThread`) and keep the forced variant (`readConnectedSession`,
`readConnectedThread`) for dispatch, where current truth actually matters. Codex thread discovery
is now cached and deduplicated the same way Claude discovery already was.

`CodexAppServer.listModels()` was the other cold round trip on the add path, and an easy one to
miss because it is model validation rather than session discovery. It is a **paginated** JSON-RPC
call, so a submission could pay more than one wire round trip (30 second timeout each) before the
task was ever created, on the Codex execute, Plan council, and Turbo branches. Models change
rarely, so it is now cached for a minute with last-known-good on failure.

### 4. Poll storm amplified by parallelism

`src/claude-terminal-executor.mjs` polls session liveness every 800 ms while a Claude turn runs,
and each poll forced a discovery spawn. With per-session parallel execution this scales with the
number of running Claude tasks, raising spawn-failure probability, which tripped cause 2, which
broke task-add. Fixing the registry is what makes that concurrency safe.

## Resolution order at add time

1. The warm live cache for that provider.
2. The registry's last known good entry.
3. The workspace recorded on that session's most recent task (`latestTaskForThread`).

Only a session that matches none of the three is rejected, because then there is genuinely
nothing to bind the task to.

## Claude authentication is not a transient gate

Adding work is blocked on authentication only by a **confident negative**: a completed probe that
actually reported a signed-out CLI. A probe that is still pending at startup, or that errored, is
not confident and does not block the add. This is what makes a submission made seconds after
launch succeed instead of failing on an unwarmed cache.

## Scaling note

`GET /api/status` rebuilds the running-task feed every two seconds. It used to re-read and
re-parse a window of up to 1000 events **per running task**, which was affordable only while
exactly one task ran at a time. It now remembers the last computed update per task and reads only
events appended since then, so an unchanged task costs one indexed `MAX(id)` lookup. See
[[parallel-project-queues]] for the concurrency model that made this necessary.

## Related

[[parallel-project-queues]], [[renderer-performance]], [[diagnostics]], [[task-history]],
[[parallel-claude-review]], [[automatic-retry-safety]].

#relay #queue #reliability #providers
