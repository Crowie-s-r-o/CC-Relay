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

The background monitor refreshes both providers every five minutes. Status requests only read the in-memory snapshot, so opening or polling the interface never starts a CLI process. Overlapping refresh requests share one promise. A successful sample records `checkedAt`; a later failure preserves the sample as `stale`. A provider with no successful sample settles as `unavailable`.

## Claude source

Claude Code exposes its five-hour and all-model weekly windows in status-line JSON, but it does not expose the Fable-specific weekly window there or through `claude auth status --json`. The authenticated `/usage` screen is the single installed-CLI surface containing all three requested values.

`ClaudeUsageProbe` runs the already resolved Claude binary with `--safe-mode`, `--ax-screen-reader`, and `--no-chrome` inside a private macOS Expect pseudo-terminal. It answers the folder-trust prompt only for CC Relay's controlled data directory, opens `/usage`, captures the accessible text, and closes the session. One random Claude session ID is reused for every refresh during the CC Relay process lifetime, so periodic sampling does not create a new conversation each time. The parser removes terminal control sequences and keeps the last matching row because Claude can paint a cached frame before its refreshed frame.

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

Provider status is `checking`, `ready`, `stale`, or `unavailable`. A missing individual window after its provider has responded renders as unavailable, not as a perpetual loading state. Old backends without the capability render all four bars as unavailable.

## Header behavior

`public/provider-usage.js` owns the pure presentation mapping. Values below 50 percent are green, values from 50 through 74 percent are yellow, values from 75 through 89 percent are orange, and values from 90 through 100 percent are red. The text percentage remains visible beside every bar, reset details live in its title, and stale values say **Last known value**.

Each meter also shows a live reset countdown below its bar. The five-hour Claude window uses hours and minutes, such as `2h 20m`; the three weekly windows use days and hours, such as `3d 14h`. Codex supplies an epoch timestamp directly. Claude supplies localized English reset copy, so the pure presentation helper parses the known time-only and `Mon DD at time` forms with their IANA timezone suffix. If a future Claude version returns an unknown label shape, the exact reset remains in the tooltip and the countdown stays blank rather than guessing. The normal two-second visible-page status render keeps the countdown current without adding a timer or another provider request.

> [!note]
> Keep the countdown units tied to the window type. The five-hour meter is an operational clock where minutes matter; weekly meters remain compact by rounding remaining time up to whole hours.

The four-meter strip replaces the former header **Pause queue** button and sits immediately after the **Top** or **Bottom** monitor-position control, before the theme control. The redundant **CC Relay online** pill is not rendered. Pause and resume endpoints, stored project pause state, and queue helper support remain in place; only the global header action is removed. See [[interface-layout]] and [[provider-installation-detection]].

## Verification

- `test/provider-usage.test.mjs` covers ANSI parsing, latest-frame selection, session reuse, platform gating, exact Codex bucket selection, refresh deduplication, and stale preservation.
- `test/provider-usage-ui.test.mjs` covers the four-meter contract, online-pill and pause-button removal, exact control order, threshold boundaries, reset copy and countdown units, timezone-aware Claude labels, absent windows, dark mode, and the mobile layout.
- `test/codex-app-server.test.mjs` protects the authenticated rate-limit method and proves its null parameters pass through the actual request serializer.

#relay #providers #usage #claude #codex #header
