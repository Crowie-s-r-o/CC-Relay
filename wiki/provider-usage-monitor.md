---
name: Provider Usage Monitor
description: Authenticated Claude and Codex subscription-window monitoring in the global header.
type: architecture
---

# Provider Usage Monitor

CC Relay exposes subscription runway without asking for an API key or reading provider credential files. `GET /api/status` includes a cached `providerUsage` snapshot and advertises `capabilities.providerUsage`. The renderer turns that snapshot into four percentage-used bars:

1. Claude current session, the five-hour window
2. Claude current week across all models
3. Claude current week for Fable
4. Codex current week

The background monitor refreshes both providers every 30 seconds. Status requests only read the in-memory snapshot, so opening or polling the interface never starts a CLI process. Overlapping refresh requests share one promise. A successful sample records `checkedAt`; a later failure preserves the sample as `stale`. A provider with no successful sample settles as `unavailable`.

## Claude source

Claude Code exposes its five-hour and all-model weekly windows in status-line JSON, but it does not expose the Fable-specific weekly window there or through `claude auth status --json`. The authenticated `/usage` screen is the single installed-CLI surface that can contain all three requested values. Newer Claude builds can omit the distinct Fable row while Fable itself remains active.

`ClaudeUsageProbe` runs the already resolved Claude binary with `--safe-mode`, `--ax-screen-reader`, and `--no-chrome` inside a private macOS Expect pseudo-terminal. It answers the folder-trust prompt only for CC Relay's controlled data directory, opens `/usage`, captures the accessible text, and closes the session. One random Claude session ID is reused for every refresh during the CC Relay process lifetime, so periodic sampling does not create a new conversation each time. Claude can first paint a persisted snapshot and then replace it after the live request. The probe therefore allows the live repaint to settle, and the parser reads every row from only the final complete usage frame. It never combines a Fable row from one frame with five-hour and weekly rows from another.

When the final frame contains no distinct Fable allowance but does contain the all-model weekly window, Relay publishes that weekly window as `fableWeekly` with `shared: true`. The Fable meter shows the shared percentage and reset countdown, and its tooltip says that Claude reported no separate Fable allowance. This is subscription-runway fallback, not a model-availability claim. A real model-specific Fable row always takes precedence.

The pseudo-terminal output is held only in a bounded in-memory buffer. It is not returned by the status endpoint or written to diagnostics. OAuth credentials remain inside Claude Code. The current bridge is macOS-only because it depends on `/usr/bin/expect`; other platforms report Claude usage as unavailable instead of attempting a weaker credential path.

## Codex source

`CodexAppServer.readRateLimits()` calls the authenticated `account/rateLimits/read` method on CC Relay's existing Codex app-server connection. The normalizer selects `rateLimitsByLimitId.codex`, then selects the exact 10,080-minute window. Other limit IDs, including model-specific buckets such as Spark, cannot replace the requested Codex weekly value. Reset timestamps stay as provider epoch seconds until the renderer formats them for the local locale.

This request keeps ChatGPT authentication inside the Codex app-server. CC Relay stores neither a token nor a usage history.

> [!important]
> `account/rateLimits/read` deliberately sends JSON-RPC `params: null`. The shared request diagnostic must therefore use optional access for `threadId`, `model`, and `effort`. Directly reading `params.threadId` throws before the WebSocket write, leaves Codex weekly usage unavailable, and later produces an unrelated request timeout. The regression test exercises the real request serializer with null params instead of mocking `request()`.

## Status contract

The cached response has this shape:

```json
{
  "providerUsage": {
    "claude": {
      "status": "ready",
      "checkedAt": "2026-08-12T21:00:00.000Z",
      "fiveHour": { "usedPercent": 3, "resetsAt": null, "resetLabel": "1:20am (Europe/Bratislava)" },
      "weekly": { "usedPercent": 77, "resetsAt": null, "resetLabel": "Aug 13 at 2pm (Europe/Bratislava)" },
      "fableWeekly": { "usedPercent": 87, "resetsAt": null, "resetLabel": "Aug 13 at 2pm (Europe/Bratislava)" }
    },
    "codex": {
      "status": "ready",
      "checkedAt": "2026-08-12T21:00:00.000Z",
      "weekly": { "usedPercent": 6, "resetsAt": 1786743600, "resetLabel": null }
    }
  }
}
```

Provider status is `checking`, `ready`, `stale`, or `unavailable`. Claude's own **Showing last-known usage** response is also mapped to `stale` and does not advance `checkedAt`. A missing non-Fable window after its provider has responded renders as unavailable, not as a perpetual loading state. A missing Fable-specific window uses the shared Claude week described above. Old backends without the capability render all four bars as unavailable.

## Header behavior

`public/provider-usage.js` owns the pure presentation mapping. Values below 50 percent are green, values from 50 through 74 percent are yellow, values from 75 through 89 percent are orange, and values from 90 through 100 percent are red. The text percentage remains visible beside every bar, reset details live in its title, and stale values say **Last known value**.

The visible compact labels are **Cla 5h**, **Cla Week**, **Fable**, and **Cod Week**. Their full provider and window names remain on the accessible progress bars and in reset tooltips. A shared Fable fallback keeps its numeric progress semantics and exposes the fallback explanation through accessible value text. Reset countdowns use 9px monospace text so the remaining time stays readable within the fixed header instrument.

Each meter also shows a live reset countdown below its bar. The five-hour Claude window uses hours and minutes, such as `2h 20m`; the three weekly windows use days and hours, such as `3d 14h`. Codex supplies an epoch timestamp directly. Claude supplies localized English reset copy, so the pure presentation helper parses the known time-only and `Mon DD at time` forms with their IANA timezone suffix. If a future Claude version returns an unknown label shape, the exact reset remains in the tooltip and the countdown stays blank rather than guessing. The normal two-second visible-page status render keeps the countdown current without adding a timer or another provider request.

> [!note]
> Keep the countdown units tied to the window type. The five-hour meter is an operational clock where minutes matter; weekly meters remain compact by rounding remaining time up to whole hours.

The four-meter strip replaces the former header **Pause queue** button and sits immediately after the **Top** or **Bottom** monitor-position control, before the theme control. The redundant **CC Relay online** pill is not rendered. Pause and resume endpoints, stored project pause state, and queue helper support remain in place; only the global header action is removed. See [[interface-layout]] and [[provider-installation-detection]].

## Session rollover synchronization

On August 14, the header showed an old Claude session sample of `98%` and `23h 58m` while Claude's live usage screen showed `1%` and `4h 59m`. The desktop status API returned the correct new values on its next sample, proving that the probe and parser were working. The defect had two parts:

1. The five-minute sampling interval kept the expired session snapshot visible too long.
2. The renderer treated every past time-only reset label as tomorrow. Just after a reset, an old label such as `2:20am` therefore became an impossible almost-24-hour countdown for a five-hour window.

`src/provider-usage.mjs` first reduced sampling to once per minute and now samples every 30 seconds while retaining overlap deduplication and cached status reads. `public/provider-usage.js` advances a time-only five-hour reset into the next day only when that candidate is within the window's five-hour horizon. Otherwise it keeps the expired timestamp, and the visible countdown clamps to `0h 0m` until the next provider sample replaces the old percentage and reset label.

> [!important]
> Do not restore unconditional next-day rollover for the five-hour meter. Overnight labels can legitimately point into the next day, but a candidate almost 24 hours away proves that the cached five-hour window has expired.

## Cached-frame and Fable correction

On August 17, Claude Code 2.1.233 exposed the remaining monitor defect in a live desktop run. Consecutive API snapshots moved the five-hour value from `22%` backward to `21%`, then forward to `23%`. The same resumed monitor session alternated between no Fable row and an older `34%` Fable row, while a fresh eight-second `/usage` capture showed `23%`, `48%`, and no distinct Fable allowance. The active Claude header still identified the model as Fable 5.

The cause was row-by-row history parsing. The pseudo-terminal byte stream held both persisted and refreshed paints, and an optional row that disappeared had no later match to replace it. The 500ms close delay could also end the dialog before a slower live repaint. Relay now waits for the repaint, selects the last complete frame first, accepts current Fable label variants such as `Fable 5 only`, and derives the shared weekly fallback only after that selection. A CLI response that explicitly says it could not refresh remains stale rather than receiving a fresh timestamp.

> [!important]
> Never select the newest Claude usage row independently by label. Optional model-scoped rows can disappear between frames, so the frame boundary must be selected before any individual window is parsed.

## Verification

- `test/provider-usage.test.mjs` covers ANSI parsing, final-frame selection, optional-row removal, current Fable label variants, shared fallback, live-repaint settling, session reuse, platform gating, exact Codex bucket selection, the 30-second default, refresh deduplication, and stale preservation.
- `test/provider-usage-ui.test.mjs` covers the four-meter contract, online-pill and pause-button removal, exact control order, threshold boundaries, reset copy and countdown units, timezone-aware Claude labels, expired five-hour rollover, shared Fable presentation, accessible fallback text, absent windows, dark mode, and the mobile layout.
- `test/codex-app-server.test.mjs` protects the authenticated rate-limit method and proves its null parameters pass through the actual request serializer.

#relay #providers #usage #claude #codex #header
