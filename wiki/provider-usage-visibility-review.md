---
name: Provider Usage Visibility Review
description: Restore visible Fable and Codex five-hour meters and verify accounts without weekly usage.
type: review
tags: [relay, usage, ui, review]
---

# Provider usage visibility review

## Executive Summary

**Ticket confidence: High**

Launchpad moved Fable and Cod 5h into the closed Display popover. `public/index.html` now places
all five existing meters directly inside `#provider-usage`. `public/launchpad.css` owns the
five-column strip and compact row, retaining percentage text and reset countdowns. Obsolete
popover meter styles were removed. No backend, credential, scheduling, or plan-tier behavior changed.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Actual renderer displays all five windows with Display closed. |
| Regression risk (UI / backend / contracts) | Green | Existing meter keys, ARIA labels, status handling, and countdown calculations are retained. |
| Gap risk | Green | Both themes, eight widths from 320 to 1720px, Top placement, and SSE refresh verified. |
| Code quality | Green | Layout stays in the owning unlayered stylesheet; no duplicated meters or new render paths. |
| Unit tests | Green | Five-hour-only responses pass through normalization, monitor state, presentation, and stale retention. |
| Performance & scalability | Green | Same five meters and existing refresh path; no additional timers or provider requests. |

## Top 3 Risks

1. `index.html`: finding five keys anywhere in the document previously passed while two were
   hidden in Display. The existing assertion now requires each within the visible usage section.
2. `launchpad.css`: legacy mobile direction and order rules put the cog above the strip.
   Visual review found this and the final rules reset both. Runtime verification requires a shared row.
3. `normalizeCodexUsage`: assuming a weekly window exists would hide five-hour-only plans.
   Tests verify both primary and secondary positions and both keyed and legacy response shapes.

## Top Improvements

`scripts/verify-provider-usage.cjs`, invoked through `verify-launchpad.cjs --provider-usage`, uses
synthetic rate limits normalized by the real backend helper. It checks rendered text bounds,
visibility, percentage values, countdowns, ARIA values, and the closed Display state.
The broader Launchpad smoke exposed two stale assertions for the terminal inset and removed
height separator. These now check the existing flush terminal geometry and absent divider,
matching [[terminal-review-full-height]] without changing terminal behavior.
The smoke now creates its replacement native window before destroying the first window,
preventing Electron's default last-window shutdown from aborting the remaining checks.

## Recommendation

**Ship**

## Confirmed Issues

Both hidden meters and the extra mobile cog row are fixed. Fable at a provider-reported zero
remains independent of Claude weekly usage and has no invented countdown.

## Suspected Issues & Edge Cases

No unresolved issue found in scope. This verifies provider-response behavior using fixtures,
not a live login for every paid tier. Unsupported or absent windows retain `--`.

## Regression Risks

Execution trace: `CodexAppServer.readRateLimits()` supplies authenticated data to
`normalizeCodexUsage()`, which selects the 300-minute and weekly windows independently.
`ProviderUsageMonitor` accepts either window as ready and preserves the prior sample on failure.
`GET /api/status` supplies that snapshot to `providerUsagePresentation()` and
`renderProviderUsage()`, which locates the same five DOM keys and writes plain text and ARIA values.
Moving those nodes changes visibility without changing data ownership or polling.

The extra rendered pass switches from five-hour-only to weekly-only Codex data through the
normal SSE status refresh. Cod 5h becomes unavailable while Cod Week gains its own value.
It also changes Fable from zero to a real weekly value and verifies Top monitor placement.

## Performance Risks

None added. Rendering remains bounded to five meters. The isolated fixture closes its window,
HTTP server, event streams, and WebSocket clients, and never launches provider work.

## Test Gaps

**Are there adequate UNIT tests? Yes.** The focused suite has 83 passing checks, including
normalization, missing weekly data, countdown units, missing Fable, independent zero, and stale
retention. All 2,059 repository tests pass; release metadata and whitespace checks pass.
Unit assertions cannot prove cascade behavior, so the Electron fixture verifies actual rendering
at 1720, 1344, 1200, 800, 760, 480, 380, and 320px in both themes.
The complete Launchpad smoke also passes, including native desktop chrome, both monitor
placements, zoom limits, interactive terminal display, saved preferences, and empty projects.
Rendered evidence is in `/tmp/relay-usage-visible-check/` and `/tmp/relay-usage-layout-regression/`.

## Positive Improvements

All five subscription windows are visible without opening settings. Users whose Codex account
reports only five-hour usage see that percentage and reset countdown immediately.

> [!note]
> This supersedes the three-window placement described in [[provider-usage-countdown-review]].
> See [[provider-usage-monitor]] and [[launchpad-v2-design]] for the current contract.
