---
name: Running Task Full Width Rows Review
description: Adversarial ship review of the wide-header two-row and three-row running-task layout.
type: review
tags:
  - relay
  - ui
  - header
  - layout
  - review
---

# Running Task Full Width Rows Review

## Executive Summary

**Ticket confidence: High**

The wide desktop header now keeps row one between the brand and header actions while rows two and
three span the complete padded header width. The saved preference contract is unchanged. Rendering,
duration refresh, focus restoration, and click delegation now cover both rails. One-row, two-row,
and three-row assignment is executable in `test/running-task-layout.test.mjs`, the CSS and markup
contract is protected in `test/project-layout.test.mjs`, and the complete suite passes 1,537 tests.

The in-app browser was unavailable in the non-interactive run, so computed-layout screenshot
verification remains the only meaningful gap.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `runningTaskRailGroups()` partitions supported row counts deterministically. `renderHeaderRunningTasks()` writes both rails and includes the row count in its render signature. Wide CSS places `.header-running-primary` in column 2 and `.header-running-extra-tasks` across columns `1 / -1`. |
| Regression risk (UI / backend / contracts) | Green | One-row rendering keeps every task in `#header-running-tasks`; preferences, API payloads, card markup, project navigation, and backend behavior are unchanged. Compact layouts keep the complete monitor full width. |
| Gap risk (edge cases, error handling, completeness) | Amber | The final CSS cascade could not be observed in a live browser or Electron screenshot during this run. Static contracts cover the intended geometry but do not prove painted pixels. |
| Code quality (maintainability as safety) | Green | Distribution is isolated in `public/running-task-layout.js`; card markup has one renderer; both rails share the same card, scroll, dark-theme, focus, and click paths. |
| Unit tests | Green | Tests cover 1, 2, 3, and unsupported row counts. Existing header, color, hover, preference, and workflow contracts pass, as does the complete repository suite. |
| Performance & scalability | Green | Rendering remains O(n) in the running-task count. The change adds one small array partition and one additional `innerHTML` write only when the render signature changes. |

## Top 3 Risks

1. `public/style.css` uses two independent horizontal scroll regions in a multi-row header. A very
   large running set can require scrolling the primary and extra rails separately.
2. `public/app.js` renders primary-row buttons before extra-row buttons in DOM order. Keyboard
   access is preserved, but focus traversal follows the visible rail groups rather than numeric
   task order.
3. No live computed-layout check covered the exact ultrawide, 50 percent zoom geometry from the
   reported screenshot.

## Top Improvements

1. Capture light and dark Electron screenshots at one, two, and three rows after the next normal
   app rebuild, including the reported ultrawide zoom level.
2. Add a DOM integration fixture that clicks and restores focus to a task rendered in
   `#header-running-extra-tasks`.
3. If operators regularly overflow both rails, add explicit horizontal navigation instead of
   silently coupling their scroll positions.

## Recommendation

**Ship**

## Confirmed Issues

No remaining correctness blocker was found. The reported width loss is addressed at the exact
wide-header grid boundary.

## Suspected Issues & Edge Cases

- Separate scroll positions may feel less convenient only when both the center rail and full-width
  rail overflow. They do not hide or drop tasks.
- The extra live region is empty in one-row mode and cleared when no task is running, so stale task
  buttons cannot remain reachable.
- Changing rows while a running card is focused can move it between rails. Focus restoration now
  queries the common monitor wrapper and follows the task to its new rail.

## Regression Risks

- Before: all configured rows were constrained between the brand and action cluster on wide
  screens. After: only row one uses that center column; later rows use the complete header grid.
- One-row geometry, card widths, 44px card height, 7px row gap, saved preferences, and measured
  workspace height remain unchanged.
- At 1344px and below, the complete monitor already owned a full-width wrapped row. The new wrapper
  retains that behavior and only stacks the configured extra rail below the primary rail.
- Card click handling moved from `#header-running-tasks` to `.header-running-monitor`, so cards in
  either rail follow the existing project selection and Task Activity path.

## Performance Risks

The grouping helper and rendering path are O(n) time and O(n) temporary memory for `n` running
tasks. The header already rendered O(n) card markup, and the practical running count is bounded by
configured provider capacity. No polling cadence, network payload, or backend query changed.

## Test Gaps

- No browser screenshot proves the final painted width at desktop or compact breakpoints.
- No DOM-capable test executes focus restoration or click delegation inside the extra rail.
- Independent horizontal overflow behavior is protected structurally, not through pointer or
  keyboard interaction automation.

## Positive Improvements

- Rows two and three reclaim the space below both fixed header regions.
- The preferences schema and first-paint cache need no migration.
- Settings remain outside live task markup, so polling cannot close the popover.
- Empty-state cleanup, duration updates, task focus, and click navigation now share the complete
  monitor boundary.

Related: [[interface-layout]], [[compact-interface-density]], [[durable-ui-layout-preferences]]

#relay #ui #header #layout #review
