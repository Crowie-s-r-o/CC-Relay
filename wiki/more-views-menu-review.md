---
name: More views menu visibility
description: Fix and rendered regression checks for the clipped activity view dropdown.
type: review
tags: [relay, ui, accessibility, review]
---

# More views menu visibility

## Executive Summary

**Ticket confidence: High.** The legacy `.event-filters` horizontal scroll container
clipped the absolute dropdown below the tab rail. `public/launchpad.css` now owns
`overflow: visible`; its existing wrapping handles the rail's width. At 480px and below,
the dropdown anchors to the rail's right edge so every option fits within the panel.

> [!important]
> A higher menu z-index cannot escape ancestor overflow clipping. The original fixture's
> DOM `.click()` bypassed hit testing and passed while the menu was unusable. Preserve the
> native input and `elementFromPoint` regression checks in `scripts/verify-more-views.cjs`.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Native clicks select all five filters from Terminal and Conversation. |
| Regression risk | Green | Only view-rail CSS changes; selection, counts, disclosure closing, and summary handlers are unchanged. |
| Gap risk | Green | Both themes, 320/380/480/1200/1720px, option-corner hit tests, keyboard selection, and page overflow checks. |
| Code quality | Green | Explicit ownership of inherited overflow and compact menu positioning. |
| Unit tests | Green | Existing suite covers view contracts; the rendered fixture covers the CSS defect directly. |
| Performance | Green | Static CSS; no new listeners, polling, dependencies, or environment variables. |

## Top 3 Risks

1. Restoring `overflow-x: auto` clips the dropdown in both axes despite its z-index.
2. Anchoring to the summary at compact widths can place the menu outside the panel.
3. Programmatic clicks cannot establish pointer reachability through clipping or overlays.

## Top Improvements

The fixture asserts every option's corners are unobstructed, then sends native mouse events.
Native Return, Tab, Return events also exercise disclosure opening and first-option selection.

## Recommendation

**Ship.** This is a renderer layout fix, with no backend or persisted-state change.

## Confirmed Issues

Reproduced clipping before the fix at 1720px. The subsequent compact pass found and fixed
right-edge clipping at 380px. No unresolved issue remains in this scope.

## Suspected Issues & Edge Cases

The expanded terminal uses its own view controls and hides this toolbar. The fix does not
alter that path. Native terminal transport is synthetic in the isolated visual fixture.

## Regression Risks

`updateEventControls()` still labels the summary from the selected secondary view. The
existing filter click handler closes the disclosure, saves the view, and renders the stream.
No task-owned data, provider action, or request contract changes. Existing shared-checkout
changes in the same stylesheet and fixture were preserved.

## Performance Risks

No runtime work is added to the application. The verification helper runs only on demand.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for unchanged view contracts. Source assertions alone
are insufficient for clipping, so the new regression uses actual macOS Electron rendering.
Live providers and Windows rendering are outside this narrow layout check.

## Positive Improvements

All secondary views remain visible and selectable above task content. Compact alignment
preserves full option labels, and the test fails against the original clipping rule.

## Verification

```sh
node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-more-views-after --more-views
node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-more-views-extra --more-views --interactive
```

The second command is the extra pass with synthetic interactive terminal output. Each run
destroys its window, terminates WebSocket clients, and closes the fixture server in `finally`.
Screenshots are stored in the specified output directories. The repository suite passes
2,051 tests in the final shared-workspace run; release metadata and whitespace checks pass.

See [[launchpad-v2-design]], [[terminal-review-full-height]], and [[terminal-window]].
