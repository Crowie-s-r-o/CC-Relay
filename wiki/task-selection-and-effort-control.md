---
name: Task Selection and Effort Control
description: Restoration of project-colored task selection and a stable native effort slider after the Launchpad redesign.
type: review
tags: [relay, ui, accessibility, selection, effort, review]
---

# Task selection and effort control

## Executive Summary

**Ticket confidence: High**

Selected Queue and History cards again use their project's border and tinted surface. Reasoning
effort has a full-width colored track, fixed-size stops and thumb, a value above the rail, and one
visible focus ring. The user's "effort tracker" was interpreted as the composer reasoning-effort
slider, the control whose labels visibly resized its drag surface.

The native input also covers the visible stop row, so clicking a dot selects that exact effort
without adding custom pointer math or separate controls.

> [!important]
> `application.css` places `style.css` in the lower `legacy` layer. Restore current component
> presentation in `launchpad.css`; adding specificity to legacy rules cannot override it.

## Change Mapping

| File | Responsibility and effect |
| --- | --- |
| `public/launchpad.css` | Project-colored selected cards and effort, stable target geometry, visible stops, neutral unavailable state, single focus ring. |
| `public/index.html` | Moves the current effort value from the track row to the heading without changing control IDs or ARIA references. |
| `public/app.js` | `renderExecutionControls` skips unchanged native range bounds and step writes. |
| `scripts/verify-selection-effort.cjs` | Real pointer/keyboard, refresh, scale, selection, and focus checks against the shared Electron fixture. |
| `scripts/verify-launchpad.cjs` | Invokes those checks at desktop/compact sizes, supplies a one-effort catalog and change stream, and propagates assertion failures through the exit code. |
| Related wiki pages | Update the current design and refresh contracts. |

Queue scheduling, persistence, model defaults, provider routing, terminal ownership, authorization,
and API payload shapes are unchanged by this fix. Concurrent running-monitor and embedded-terminal
changes in the shared checkout are outside this review's implementation scope.

## Functional Execution Trace

Task activation sets `selectedTaskId`, then `renderTasks` applies `.selected` and the existing
collision-resolved project class/custom tokens. The current stylesheet now consumes that accent,
including on hover, without changing border width or card dimensions.

Native range input maps its integer index through the model's `data-values`, remembers the exact
effort through `updateSelectedExecution`, and updates presentation through `renderEffortSelection`.
It never invokes the full execution renderer from the input handler. Submission still snapshots
the exact mapped string before asynchronous routing. A provider/model change updates the scale;
background rendering leaves an unchanged scale alone and preserves the user's unsent choice.

Progress remains `index / (count - 1) * 100` for multiple efforts and zero for zero/one effort.
The six-stop case verifies 0 through 100 percent in both directions. Empty efforts show a disabled
neutral control with `Unavailable` as accessible text; one effort places its sole marker in the
center, matching the native range. Existing server validation continues to reject unsupported
model/effort pairs independently of presentation.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Real native dragging and stop clicks reach every six-stop value without changing the range rectangle; keyboard Home/End/Arrow and five/one/zero-effort catalogs pass. |
| Regression risk (UI / backend / contracts) | Green | Queue/History selection, provider choice retention, and the existing full Launchpad smoke pass. No execution contracts change. |
| Gap risk (edge cases, error handling, completeness) | Green | Both themes and 1720/1200/480/320px views pass. A backend change during drag keeps the same range node and produces no scale mutations after the deferred render. |
| Code quality (maintainability as safety) | Green | Current-layer CSS owns presentation; the native control and existing mapping remain. The smoke exits nonzero on failure and closes its owned resources. |
| Unit tests | Green | Existing effort default, exact submission mapping, stable control, and project color suites pass; all 2,001 repository tests pass with this fix isolated from concurrent changes. |
| Performance & scalability (if applicable) | Green | Three constant-time property comparisons replace redundant writes. CSS adds no timers or task-list traversal. |

## Top 3 Risks

1. Future Launchpad rules could neutralize the accent again. Computed selection-border and
   visible effort-stop checks run on the actual layered stylesheet.
2. Reintroducing the effort label beside the range would change native drag geometry. The
   Electron check compares the exact rectangle through every forward and reverse stop.
3. A catalog refresh could reset a choice or rewrite the native scale. The backend-change check
   verifies the preserved value/node and zero `min`/`max`/`step`/mapping/disabled mutations.

## Top Improvements

Keep the rendered verification when changing either component. Source-only CSS assertions did
not catch the original cascade regression or the value-label layout feedback.

## Recommendation

**Ship** for this UI scope.

## Confirmed Issues

- The pre-fix Electron run reproduced the track changing from 109.09375px at `high` to
  115.6875px at `low`. Moving the label above the rail removes that feedback.
- Neutral selected-card and range overrides in `launchpad.css` erased the existing project colors.
- Legacy hover scaling and active-marker width changes were incompatible with fixed targets.
- The extra verification found a one-stop marker at the left although the native thumb sits
  in the center, plus a generic purple focus rectangle inside the project-colored shell ring.
  Both are fixed.
- The fixture previously printed an assertion failure but exited zero through `app.quit()`.
  Cleanup now calls `app.exit(process.exitCode || 0)`; a failing run was confirmed to exit one.

## Suspected Issues & Edge Cases

No unresolved reproduced issue remains. Rendering was verified in macOS Electron/Chromium;
Firefox range rules are kept consistent but were not exercised in a Firefox runtime.

## Regression Risks

Only selected cards gain the tint; status text and provider colors remain independent. Supported
effort strings and their order remain catalog-owned. Inactive marker widths no longer differ from
the active width. The input's generic focus outline is removed only because the containing shell
provides the visible project-colored outline.

## Performance Risks

Production work remains O(1) for range bounds and O(n) for the existing small effort list. No new
polls, listeners, or storage are introduced. Extra automation and its observers exist only in the
isolated fixture and end with its window/server.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for unchanged effort semantics and the guarded control
contracts. Real UI checks supply the necessary geometry and cascade evidence that those unit
tests cannot provide. The fixture uses synthetic model catalogs and never executes provider work.

## Positive Improvements

Task selection is clear again, drag targets remain fixed, effort steps remain visible, and
keyboard focus has a single legible ring. Full tests, release metadata, whitespace checks, and
the rendered verification pass with these changes applied to release commit `77e8e5c` in an
isolated checkout. No renderer warnings, errors, or page overflow were observed.

> [!note]
> The shared checkout changed during verification. Its later 2,009-test run had two failures in
> existing task-history/queue source assertions (`project-layout.test.mjs` and
> `task-search-ui.test.mjs`) after concurrent history behavior edits. No changes were made to
> that work here. The isolated run uses only this task's renderer and verification changes,
> and passes all 2,001 tests plus the complete Electron fixture. The temporary checkout was
> removed after verification; screenshots and logs remain under `/tmp/relay-selection-effort-isolated-ui`
> and `/tmp/relay-selection-effort-isolated-tests.log`.

Reproduce with `node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-effort-check`.
The fixture closes its window, WebSockets, change streams, and HTTP server on completion.

See [[launchpad-v2-design]], [[stable-composer-selects]], [[hover-stability]],
[[active-project-composer-colors]], [[project-color-customization]], and [[interface-layout]].
