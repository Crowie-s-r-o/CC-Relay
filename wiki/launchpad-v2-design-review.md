---
name: Launchpad v2 Design Review
description: Adversarial validation of the Launchpad reference port and its saved-layout boundaries.
type: review
tags: [relay, ui, review, accessibility]
---

# Launchpad v2 design review

## Executive Summary

**Ticket confidence: High**

The reference port changes presentation, form grouping, and fresh layout defaults. Queue routing,
provider work, task ownership, database schemas, and permissions remain outside this change.
Concurrent terminal and startup work in this checkout was preserved. See [[launchpad-v2-design]].

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | Electron exercised the existing provider, council, settings, and display handlers after the markup move. |
| Regression risk (UI / backend / contracts) | Green | Saved widths and Top placement restore after reload; provider capacity remains a sibling control; no API shape changes. |
| Gap risk | Green | 320 to 1720px captures, both themes, empty projects, and compact Activity reachability passed. |
| Code quality | Green | Final presentation lives in one separate stylesheet; legacy coordinate conversion and selector ownership are documented. |
| Unit tests | Green | Existing workflow/layout tests updated; actual new light/dark tokens checked numerically against every base surface. |
| Performance & scalability | Green | Four small local font assets; no added polling, dependencies, providers, or per-task JavaScript. |

## Top 3 Risks

1. `public/launchpad.css` must outrank project-aware styles from `public/style.css`. The final
   ownership selectors and rendered state review verify the resulting colors and selection.
2. `applyPanelWidths()` in `public/app.js` must use the same separator budget as CSS. The
   16px current budget and 48px legacy adjustment preserve the old saved-Activity conversion.
3. Compact Electron layouts have a fixed outer viewport. Block workspace flow and explicit row
   direction on the monitor keep all content reachable with zero document-width overflow.

## Top Improvements

Keep using rendered evidence when changing the legacy cascade. Regex checks alone can pass while
an earlier or more specific selector still owns the actual pixels.

## Recommendation

**Ship**

## Confirmed Issues

Fixed during verification: compact grid rows compressed all three panels; the monitor inherited
column flex direction and overflowed horizontally; old named model-control grid areas hid labels;
legacy project colors overrode neutral workflow selection; light muted text missed AA on raised
controls; and legacy terminal-empty chrome retained a light background in dark mode. Council column placement was then checked and explicitly bound to the author order.
No unresolved issue was found in this design change.

## Suspected Issues & Edge Cases

Long task lists and large image collections necessarily scroll. Existing rendering bounds and
attachment limits remain. The fixture preview validates layout and handlers, not live provider
execution or native terminal ownership, which were not changed by this task.

## Regression Risks

Fresh defaults change from 580/500px to 420/440px and Top to Bottom. Existing cached or durable
choices win. The moved Model/Effort and image elements retain IDs, form ownership, validation,
and event listeners. Council hides direct controls until unchecked; its own model selectors remain.

## Performance Risks

CSS selection cost remains proportional to visible DOM size. Added `:has()` checks involve only
the three provider cards and one composer, not repeated scans over task history. Fonts load locally
and cache normally. No runtime package was added.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for the changed defaults, ordering, font/theme loading
contract, and numerical contrast. Browser layout requires rendered checks; the isolated Electron
pass additionally verified responsive geometry, focus, persistence, and empty-state behavior.
The existing server and task suites cover the unchanged execution contracts.

## Positive Improvements

More projects fit in the rail, Activity receives more desktop width, and related provider settings
share one group. Keyboard access, worded task state, saved preferences, and local asset loading
remain explicit rather than depending on the visual mockup.

See [[launchpad-v2-design]], [[durable-ui-layout-preferences]], and [[hover-stability]].
