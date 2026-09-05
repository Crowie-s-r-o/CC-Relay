---
name: Compact Task Monitor Review
description: Review of bounded task monitor cards and restored latest-message previews.
type: review
tags: [relay, ui, layout, review]
---

# Compact task monitor review

## Executive Summary

**Ticket confidence: High**

The bottom task cards were stretching across available width and hiding the last message.
`public/launchpad.css` now bounds both rails to the saved card width and displays metadata,
project/title, and the latest agent response in a 48px card. The existing Electron smoke's height
expectation in `scripts/verify-launchpad.cjs` follows the new geometry. See [[launchpad-v2-design]].

This review covers those changes and their wiki notes. Concurrent project status, selection,
effort slider, and embedded-terminal edits were preserved.

> [!note]
> Verification: 84 focused checks passed after the presentation change, followed by 39 monitor,
> feed, preference, color, and escaping checks. The complete Electron smoke passed, and a separate
> pass measured 26 cards across seven sparse/crowded, width, row, theme, and viewport cases with
> visible latest messages, no card overflow, and no renderer errors. Release metadata and whitespace
> checks pass. A later full-suite run overlapped other work in the shared checkout. Its remaining
> reproducible failure is `test/database.test.mjs:525`, where concurrent response-history changes
> sort the fallback result ahead of recorded messages. This monitor change edits no database code.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | Isolated Electron measurements confirm 230px, 286px, and 360px cards, visible response text, and clipping to a 296px rail at a 320px viewport. |
| Regression risk (UI / backend / contracts) | Green | Only presentation and the existing smoke height expectation changed. Row grouping, shared preferences, message selection, escaping, task navigation, and refresh signatures retain their original paths. |
| Gap risk (edge cases, error handling, completeness) | Green | Both themes, sparse and crowded rails, one through three rows, long project names, live usage, manual sessions, and compact screens were rendered. |
| Code quality (maintainability as safety) | Green | Changes stay in the unlayered Launchpad stylesheet; legacy styles and hidden-state rules retain their established ownership. |
| Unit tests | Green | Existing feed, layout, workflow, escaping, throughput, and hover suites pass 84 focused checks. Geometry is validated in Electron, not inferred from source regexes. |
| Performance & scalability | Green | No new polling, JavaScript, dependencies, event listeners, or data work. Existing card rendering remains linear in monitored tasks. |

## Top 3 Risks

1. `application.css` must continue importing `launchpad.css` above the legacy layer. The final
   computed layout, not legacy source-only layout assertions, proves bounded widths.
2. `renderHeaderRunningTasks()` uses two independent rails. Crowded layouts require horizontal
   scrolling; shrinking the cards must not hide or remove their task buttons.
3. Session labels and token speed compete inside the metadata row. They can ellipsize while
   project, title, duration, and response retain separate space and existing full-context labels.

## Top Improvements

Keep future monitor checks in the existing isolated Electron fixture, using synthetic messages and
real rendered geometry. Preserve the three text lines when making further density adjustments.

## Recommendation

**Ship with Mitigations**

The monitor change is verified. The shared database response-ordering check must be reconciled
with the concurrent history work before the combined checkout is released.

## Confirmed Issues

Fixed: `minmax(..., 1fr)` stretched sparse cards. The single-line flex layout also hid
`.header-running-response` and let metadata compete with task identity. Bounded columns and three
explicit text lines address both requests.

## Suspected Issues & Edge Cases

No unresolved blocker. Missing updates still show the existing waiting message; open sessions
use their existing error/result or ready-for-command fallback. Long strings remain escaped and
ellipsized. Stale or delayed updates retain the existing task-scoped feed and content signature.

## Regression Risks

The card height increases from 24px to 48px to show the last message. The body grid and measured
header height reserve the added space in both monitor positions. Compact workspace scrolling,
saved layout restoration, and the original terminal remain usable in the Electron smoke.

## Performance Risks

None introduced. `AgentUpdateCache` and `taskMonitorResponseHash()` are unchanged. Both rails still
render bounded previews in O(n) work for n monitored tasks.

## Test Gaps

Unit tests are adequate for the unchanged feed and preference logic. They cannot prove painted
CSS geometry. The existing smoke and an additional temporary synthetic capture pass supply that
evidence; no real provider session or installed application was restarted.

## Positive Improvements

The selected width now means the visible width. Latest messages remain visible without opening
Task Activity, and title/message lines cannot be displaced by session metadata. Full text remains
available through existing hover titles and task navigation.

Related: [[compact-interface-density]], [[interface-layout]], [[durable-ui-layout-preferences]].
