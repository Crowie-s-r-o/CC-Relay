---
name: Renderer Performance
description: Known causes of intermittent Relay UI freezes and the required repair boundaries.
type: diagnostics
---

# Renderer Performance

## July 21, 2026 freeze diagnosis

Relay currently performs unbounded full-view refreshes on the browser main thread. The visible freeze is not a single slow text assignment at the DevTools source location. A click into a task calls `selectTask()`, which synchronously calls `renderTasks()` before its first network await. `renderTasks()` replaces the complete task-card subtree and attaches listeners to every new card. The selected Relay workspace had 157 visible queue cards during diagnosis.

Every `loadSnapshot()` also calls `renderTasks()` and then calls `selectTask()` for the selected task, causing the full task list to be rebuilt a second time. The selected task detail then replaces the complete event stream. Before and after that replacement, Relay walks nested output nodes and reads or writes `scrollHeight`, `clientHeight`, `scrollTop`, and disclosure state. These layout reads around large DOM writes are consistent with the forced-reflow warning in Chrome.

The refresh rate amplifies the cost:

- `/api/events` schedules a full `load()` after each 150 ms-debounced change burst.
- Queue output and stderr events each call `changed(task.id)`, so an active task can produce several refresh bursts per second.
- A separate visible-page interval calls the same full `load()` every two seconds.
- Thread discovery polls every four seconds and task durations update every second.

The payloads were already large during the diagnosis: `/api/tasks` returned about 552 KB for 194 tasks, including 157 tasks in the Relay workspace. The selected live task returned about 399 KB for 123 raw events and continued to grow. The list response includes full prompts and results even though queue cards need only summaries.

> [!important]
> The `content.js:18` long-task warnings in the captured Chrome console came from the injected `@eyeo/webext-ad-filtering-solution` extension, not Relay source. Its mutation handling can add work when Relay replaces large DOM subtrees. Disable the ad-filtering extension for `127.0.0.1` as an isolation test, but do not treat that as the root fix: Relay's own click handler also produced 1.2 to 1.4 second long tasks.

## Secondary backend pause

`GET /api/status` calls `ClaudeRuntimeStatus.current()`. On each five-second cache expiry, `readClaudeRuntimeStatus()` uses `execFileSync` for `claude --version` and `claude auth status --json`. A measured cache-expiry request took about 448 ms while normal status requests took about 5 to 11 ms. This blocks the Relay Node event loop and delays requests and SSE delivery, but it does not directly cause Chrome's main-thread click violation.

> [!done]
> **Fixed.** `ClaudeRuntimeStatus.current()` is now a pure cache read that never spawns a process, refreshed by a background interval using bounded asynchronous probes. The probes previously had no timeout at all, so a stalled `claude auth status --json` could hang the server rather than merely slow it. The Codex probe received the same treatment and is no longer captured once at module load. No request handler spawns a provider CLI any more, which also removes this delay from `POST /api/tasks`. See [[task-add-reliability]].

## Required repair order

1. Make the task-list API lightweight and paginate or window terminal task history. Do not return full results and other detail-only data for every card.
2. Eliminate the double `renderTasks()` path in `loadSnapshot()` plus `selectTask()`.
3. Patch only changed task cards and append or patch new task events. Do not replace the full event stream when its revision has not changed.
4. Coalesce SSE updates by revision and use a slow safety poll instead of running the same full refresh from both SSE and a two-second interval.
5. Preserve disclosure and nested scroll state without walking and measuring the complete event DOM on every update.
6. ~~Refresh Claude runtime status asynchronously so CLI checks never block the server request loop.~~ **Done.** Both provider probes are asynchronous, bounded, and background-refreshed; request handlers only read cached values. See [[task-add-reliability]].

> [!warning]
> A CSS-only adjustment, a longer debounce, or disabling the extension alone is insufficient. The renderer must bound payload size, DOM size, and work per update.

## Relevant implementation

- `public/app.js`: `renderEventStream()`, `renderTasks()`, `selectTask()`, `loadSnapshot()`, SSE handling, and polling intervals
- `src/queue.mjs`: per-event task change notifications
- `src/server.mjs`: SSE broadcast and `/api/status`
- `src/claude-runtime-status.mjs`: synchronous CLI status checks

See [[diagnostics]], [[interface-layout]], and [[task-history]].

#relay #performance #renderer #diagnostics
