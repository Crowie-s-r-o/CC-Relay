---
name: Provider Usage Countdown Review
description: Restoring reset countdown visibility in the Launchpad usage meters.
type: review
tags: [relay, ui, usage, review]
---

# Provider usage countdown review

## Executive Summary

**Ticket confidence: High**

The screenshot's missing remaining time came from `display: none` in
`public/launchpad.css`. The countdown DOM and calculations were already present.
The fix displays that row and widens mobile columns to fit the complete text.
See [[provider-usage-monitor]] and [[launchpad-v2-design]].

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Actual renderer shows all three primary countdowns. |
| Regression risk (UI / backend / contracts) | Green | Two CSS declarations changed; provider collection and rendering are unchanged. |
| Gap risk | Green | Both themes, six widths from 320 to 1720px, Top placement, Display details, and a subsequent refresh checked. |
| Code quality | Green | Presentation stays in the owning Launchpad stylesheet. |
| Unit tests | Green | All 29 existing provider usage tests and all 2,054 repository tests pass. |
| Performance & scalability | Green | No new timers, requests, or calculations. |

## Top 3 Risks

1. Cascade regression: `application.css` gives Launchpad precedence over legacy rules.
   Legacy stylesheet assertions alone cannot prove visibility.
2. Truncation: the old 36px mobile columns cannot fit the countdown. Rendered text
   bounds now fit inside every tested 54px compact column.
3. Missing reset data: `providerUsagePresentation()` deliberately returns a blank
   countdown for unknown resets. Direct Fable zero still has no borrowed countdown.

## Top Improvements

The runtime verification loaded real repository assets with synthetic status data
through an isolated Electron fixture. It checked computed visibility, full text
bounds, accessible labels, viewport containment, and page overflow, then captured
both themes for visual inspection.

## Recommendation

**Ship**

## Confirmed Issues

The hidden countdown and insufficient mobile width are fixed.

## Suspected Issues & Edge Cases

No unresolved issue found within this change. Provider-unavailable and expired-reset
semantics remain covered by the existing presentation tests.

## Regression Risks

Trace: cached `/api/status` usage passes through `providerUsagePresentation()`, then
`renderProviderUsage()` writes plain text and ARIA labels. Only the final CSS display
and compact column width change. Display's additional windows retain their countdowns.

## Performance Risks

None added. The existing bounded five-meter rendering and refresh cadence remain.

## Test Gaps

**Are there adequate UNIT tests? Yes.** Existing tests cover countdown units, timezone
parsing, expired windows, missing data, and Fable zero. They do not render the cascade;
the isolated Electron pass supplies that evidence. Release metadata and whitespace
checks also pass. No provider work was launched, and the fixture closed its window,
sockets, and HTTP server on completion.

## Positive Improvements

Remaining reset time is visible at a glance again, with complete text at compact widths.

> [!note]
> The requested extra pass checked Top placement, Display's independent Fable zero and
> Codex five-hour countdown, and a subsequent normal status refresh. All passed.
