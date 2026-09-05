---
name: Provider Usage Monitor
description: Authenticated Claude and Codex subscription-window monitoring in the global header.
type: architecture
---

# Provider Usage Monitor

CC Relay exposes subscription runway without asking for an API key or reading provider credential files. `GET /api/status` includes a cached `providerUsage` snapshot and advertises `capabilities.providerUsage`. The renderer turns that snapshot into five percentage-used bars:

1. Claude current session, the five-hour window
2. Claude current week across all models
3. Claude current week for Fable
4. Codex five-hour window
5. Codex current week

The background monitor refreshes both providers every 30 seconds. Status requests only read the in-memory snapshot, so opening or polling the interface never starts a CLI process. Overlapping refresh requests share one promise. A successful sample records `checkedAt`; a later failure preserves the sample as `stale`. A provider with no successful sample settles as `unavailable`.

## Claude source

Claude Code exposes its five-hour and all-model weekly windows in status-line JSON, but it does not expose the Fable-specific weekly window there or through `claude auth status --json`. The authenticated `/usage` screen is the single installed-CLI surface that can contain all three requested values. Claude Code 2.1.236 can render Fable as a standalone section instead of the older `Current week (Fable)` row. Its zero state has no reset row.

`ClaudeUsageProbe` runs the already resolved Claude binary with `--safe-mode`, `--ax-screen-reader`, and `--no-chrome` inside a private macOS Expect pseudo-terminal. It answers the folder-trust prompt only for CC Relay's controlled data directory, opens `/usage`, captures the accessible text, and closes the session. One random Claude session ID is reused for every refresh during the CC Relay process lifetime, so periodic sampling does not create a new conversation each time. Claude can first paint a persisted snapshot and then replace it after the live request. The probe therefore allows the live repaint to settle, and the parser reads every row from only the final complete usage frame. It never combines a Fable row from one frame with five-hour and weekly rows from another.

Relay accepts both the older `Current week (Fable)` form and the standalone `Fable` section. A standalone `0% used` is a real numeric value even when no reset follows it, so the meter shows `0%` with a blank countdown. A missing Fable section remains unavailable. It must not borrow the all-model weekly percentage or reset because Claude now proves that the two values are independent.

An explicit per-model refresh failure is not treated as a fresh sample. When Claude says the model breakdown is rate limited or unavailable, Relay retains every value from its last successful Claude sample and marks the provider stale. This prevents a cached all-model value such as `2%` from replacing a newer successful `3%`, and it also retains a real Fable value such as `0%`. Without a prior real sample, the available cached values may be shown as last known while Fable remains unavailable. `fableWeeklyUnavailable` and a nonnumeric `fableWeekly` sentinel keep mixed backend and renderer versions fail closed.

The pseudo-terminal output is held only in a bounded in-memory buffer. It is not returned by the status endpoint or written to diagnostics. OAuth credentials remain inside Claude Code. The current bridge is macOS-only because it depends on `/usr/bin/expect`; other platforms report Claude usage as unavailable instead of attempting a weaker credential path.

## Codex source

`CodexAppServer.readRateLimits()` calls the authenticated `account/rateLimits/read` method on CC Relay's existing Codex app-server connection. The normalizer selects `rateLimitsByLimitId.codex`, then maps the exact 300-minute window to `fiveHour` and the 10,080-minute window to `weekly`. The two windows remain independent, so a response that omits the 300-minute bucket shows only **Cod 5h** as unavailable. Other limit IDs, including model-specific buckets such as Spark, cannot replace either general Codex value. Reset timestamps stay as provider epoch seconds until the renderer formats them for the local locale.

OpenAI's [Codex pricing documentation](https://learn.chatgpt.com/docs/pricing) identifies a shared five-hour window for local messages and cloud chats and notes that additional weekly limits can apply. Relay does not hard-code message allowances. It displays the percentages and reset times returned for the authenticated account.

This request keeps ChatGPT authentication inside the Codex app-server. CC Relay stores neither a token nor a usage history.

> [!important]
> `account/rateLimits/read` deliberately sends JSON-RPC `params: null`. The shared request diagnostic must therefore use optional access for `threadId`, `model`, and `effort`. Directly reading `params.threadId` throws before the WebSocket write, leaves Codex usage unavailable, and later produces an unrelated request timeout. The regression test exercises the real request serializer with null params instead of mocking `request()`.

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
      "fiveHour": { "usedPercent": 18, "resetsAt": 1786500000, "resetLabel": null },
      "weekly": { "usedPercent": 6, "resetsAt": 1786743600, "resetLabel": null }
    }
  }
}
```

Provider status is `checking`, `ready`, `stale`, or `unavailable`. Claude's own **Showing last-known usage** response is also mapped to `stale` and does not advance `checkedAt`. When a successful sample already exists, no window from a later stale frame replaces it. A missing window after its provider has responded renders as unavailable, not as a perpetual loading state. Old backends without the capability render all five bars as unavailable.

## Header behavior

> [!note]
> **September 5: all five windows are visible again.** Launchpad had moved Fable and Cod 5h
> into Display. Both now live directly in `#provider-usage`, alongside Cla 5h, Cla Week, and
> Cod Week. Each retains its percentage and 9px reset countdown in both themes. On compact
> screens the strip takes its own row, with the Display cog beside it and percentages beneath
> labels. Explicitly reset the inherited mobile `order` and header action direction, or the
> legacy cascade puts the cog on an unnecessary separate row.
> Codex plans are not inferred from a tier name: a reported 300-minute window works independently
> of weekly data, through either primary or secondary and either rate-limit response shape.
> Missing windows show `--`; Fable zero without a reset shows `0%` with no borrowed countdown.
> See [[provider-usage-visibility-review]] and [[launchpad-v2-design]].

`public/provider-usage.js` owns the pure presentation mapping. Values below 50 percent are green, values from 50 through 74 percent are yellow, values from 75 through 89 percent are orange, and values from 90 through 100 percent are red. The text percentage remains visible beside every bar, reset details live in its title, and stale values say **Last known value**.

The visible compact labels are **Cla 5h**, **Cla Week**, **Fable**, **Cod 5h**, and **Cod Week**. Their full provider and window names remain on the accessible progress bars and in reset tooltips. Fable gets a numeric progress value only from a direct Fable section. Reset countdowns use 9px monospace text so the remaining time stays readable within the fixed header instrument.

Each meter also shows a live reset countdown below its bar. The Claude and Codex five-hour windows use hours and minutes, such as `2h 20m`; the three weekly windows use days and hours, such as `3d 14h`. Codex supplies epoch timestamps directly. Claude supplies localized English reset copy, so the pure presentation helper parses the known time-only and `Mon DD at time` forms with their IANA timezone suffix. If a future Claude version returns an unknown label shape, the exact reset remains in the tooltip and the countdown stays blank rather than guessing. The normal two-second visible-page status render keeps the countdown current without adding a timer or another provider request.

> [!note]
> Keep the countdown units tied to the window type. Five-hour meters are operational clocks where minutes matter; weekly meters remain compact by rounding remaining time up to whole hours.

The five-meter strip replaces the former header **Pause queue** button and sits immediately after the **Top** or **Bottom** monitor-position control, before the theme control. The redundant **CC Relay online** pill is not rendered. Pause and resume endpoints, stored project pause state, and queue helper support remain in place; only the global header action is removed. See [[interface-layout]] and [[provider-installation-detection]].

## Session rollover synchronization

On August 14, the header showed an old Claude session sample of `98%` and `23h 58m` while Claude's live usage screen showed `1%` and `4h 59m`. The desktop status API returned the correct new values on its next sample, proving that the probe and parser were working. The defect had two parts:

1. The five-minute sampling interval kept the expired session snapshot visible too long.
2. The renderer treated every past time-only reset label as tomorrow. Just after a reset, an old label such as `2:20am` therefore became an impossible almost-24-hour countdown for a five-hour window.

`src/provider-usage.mjs` first reduced sampling to once per minute and now samples every 30 seconds while retaining overlap deduplication and cached status reads. `public/provider-usage.js` advances a time-only five-hour reset into the next day only when that candidate is within the window's five-hour horizon. Otherwise it keeps the expired timestamp, and the visible countdown clamps to `0h 0m` until the next provider sample replaces the old percentage and reset label.

> [!important]
> Do not restore unconditional next-day rollover for the five-hour meter. Overnight labels can legitimately point into the next day, but a candidate almost 24 hours away proves that the cached five-hour window has expired.

## Cached-frame and Fable correction

On August 17, Claude Code 2.1.233 exposed the remaining monitor defect in a live desktop run. Consecutive API snapshots moved the five-hour value from `22%` backward to `21%`, then forward to `23%`. The same resumed monitor session alternated between no Fable row and an older `34%` Fable row, while a fresh eight-second `/usage` capture showed `23%`, `48%`, and no distinct Fable allowance. The active Claude header still identified the model as Fable 5.

The cause was row-by-row history parsing. The pseudo-terminal byte stream held both persisted and refreshed paints, and an optional row that disappeared had no later match to replace it. The 500ms close delay could also end the dialog before a slower live repaint. Relay now waits for the repaint, selects the last complete frame first, and accepts current Fable label variants such as `Fable 5 only`. A CLI response that explicitly says it could not refresh remains stale rather than receiving a fresh timestamp.

> [!important]
> Never select the newest Claude usage row independently by label. Optional model-scoped rows can disappear between frames, so the frame boundary must be selected before any individual window is parsed.

## Delayed live repaint correction

Claude Code 2.1.234 can show a persisted `80%` all-model frame with no Fable row for about eighteen seconds while the Usage dialog says **Refreshing**. Its successful live repaint can then change all-model usage to `81%` and add a `71%` Fable row without repeating every label. Closing the dialog after the former 3.5-second settle window therefore published the persisted all-model value as shared Fable usage.

The probe now waits up to 22 seconds after observing **Refreshing**, inside a 40-second process ceiling that leaves room for clean dialog and CLI shutdown. A direct Fable row, the live Usage credits section, or an explicit refresh outcome ends that wait. Before closing the dialog, the probe changes the private pseudo-terminal dimensions twice so Ink emits one complete final frame instead of leaving an incremental repaint in the byte history. The parser still selects one final frame before reading any row.

> [!important]
> **Per-model breakdown unavailable** and a standalone `0% used` Fable section are different states. Neither one may use the all-model Claude week as a substitute.

## Standalone Fable zero and stale-frame correction

Claude Code 2.1.236 exposed two related defects on September 3. A live usage dialog showed all-model weekly usage at `3%` and a standalone Fable section at `0%` with the message that Fable had not been used. Relay could not parse the Fable section because its old row parser required `Resets`, so the renderer copied the all-model `3%` and its seven-day countdown into Fable. A later safe-mode probe returned a cached `2%` all-model frame plus **Per-model breakdown unavailable**, and the monitor replaced the newer `3%` with that older value.

The parser now recognizes an exact standalone Fable heading, accepts its percentage without a reset, and asks the Expect bridge to finish on that new heading after a live repaint. The renderer no longer synthesizes Fable from the all-model week. The monitor treats every provider-declared stale frame as status-only once a successful sample exists, preserving the complete successful value set and its `checkedAt` timestamp.

> [!important]
> A stale response may establish an initial last-known display when Relay has no successful sample. Once a successful sample exists, stale provider data can change only the status and Fable availability marker, never the stored percentages or reset labels.

## Verification

- `test/provider-usage.test.mjs` covers ANSI parsing, final-frame selection, optional-row removal, delayed complete redraws, legacy and standalone Fable label variants, standalone zero without a reset, explicit per-model unavailability, live-repaint settling, session reuse, platform gating, exact Codex 300-minute selection, weekly selection, cross-limit isolation, the 30-second default, refresh deduplication, and stale non-regression.
- `test/provider-usage-ui.test.mjs` covers the five-meter contract, online-pill and pause-button removal, exact control order, threshold boundaries, reset copy and countdown units for both five-hour meters, timezone-aware Claude labels, expired five-hour rollover, direct Fable zero presentation, explicit model-breakdown failures, absent windows, dark mode, and the mobile layout.
- `test/codex-app-server.test.mjs` protects the authenticated rate-limit method and proves its null parameters pass through the actual request serializer.

## Combined weekly bottom fill

The `#provider-usage` container itself doubles as a sixth, combined meter: a 2px `::after` strip
along its bottom edge fills left to right with the average of the Claude and Codex all-model
weekly `usedPercent` values (`combinedWeeklyUsagePresentation` in `public/provider-usage.js`).

- With both weekly windows reporting, the fill is their rounded average; with one reporting, it
  mirrors that single window; with neither, the strip, `data-combined-level`, and the container
  `title` are removed entirely.
- Thresholds and colors reuse the per-meter semantics (normal / warning 50 / elevated 75 /
  critical 90) via `--provider-usage-combined-accent`, themed for light and dark together.
- The container gained `position: relative` and `overflow: hidden` so the strip clips to the 9px
  rounded corners, and the strip's width transition is disabled inside the existing
  `prefers-reduced-motion` block (a rule was added inside that block, never a new block, per the
  last-reduce-block test trap).
- Covered by the combined-fill test in `test/provider-usage-ui.test.mjs`.

The August 19 Codex five-hour addition passed 76 focused usage and app-server tests, all 1,620 repository tests, `release:check` for v0.2.17, and rendered checks at 1680px and the 1344px responsive boundary. Both rendered sizes kept all five compact labels visible without clipping.

The adversarial completion verdict is recorded in [[provider-usage-fable-correction-review]].

#relay #providers #usage #claude #codex #header
