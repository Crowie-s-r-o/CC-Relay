---
name: Desktop Chrome and Monitor Defaults
description: Removal of the empty macOS title strip, consistent Bottom defaults, and focused native verification.
type: review
tags: [relay, ui, electron, layout, review]
---

# Desktop chrome and monitor defaults

The September 5 change removes the empty `.desktop-titlebar` element and its active Launchpad
grid track. The project dock starts at the top edge with the default Bottom task monitor. An
explicit Top choice instead places the monitor at the top edge. The first content bar is the
native drag surface, with interactive project and monitor controls marked `no-drag`.

`hiddenInset` and the existing `desktopTitlebar=hidden-inset-v1` main-process marker are unchanged.
The renderer still requires both the marker and the macOS Electron user agent. Browser, Windows,
and Linux layouts receive no custom inset. The native buttons remain owned by Electron.

Native button geometry does not scale with web contents. `renderDesktopZoomControls()` publishes
the bounded scale through `--desktop-chrome-scale`; CSS divides an 84px left inset and a 40px
minimum physical height by that scale. This prevents controls colliding at the supported 50%
minimum zoom. The usual 51px dock remains the minimum at normal and larger zoom levels.

> [!important]
> `public/application.css` places `style.css` in the legacy cascade layer. The active three-row
> grid and zero titlebar height belong in `launchpad.css`. Removing the HTML element alone leaves
> the old named grid track visible. Do not restore a separate empty row to reserve native controls.

`public/index.html` already chose Bottom on fresh first paint. The backend normalizer and both
renderer position functions still chose Top for omitted or invalid values. They now all accept
an exact `top` value and otherwise use `bottom`. No migration rewrites an explicitly saved choice.
The static toggle also advertises moving to Top before renderer initialization.

See [[header-position]], [[durable-ui-layout-preferences]], [[launchpad-v2-design]], and
[[packaged-renderer-startup]].

## Executive Summary

**Ticket confidence: High** for the scoped chrome and placement behavior.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Native fixture proves a content bar at y=0, no titlebar track, and a viewport-aligned final row. |
| Regression risk (UI / backend / contracts) | Green | Saved Top restoration survives an empty browser cache; absent database records and absent fields produce Bottom. |
| Gap risk (edge cases, error handling, completeness) | Green | Executed bootstrap, renderer, and backend agree on missing, null, invalid, Top, and Bottom values. Native geometry covers 50%, 100%, and 200% zoom. |
| Code quality (maintainability as safety) | Green | Existing preference record and titlebar marker are retained; active CSS owns the replacement grid. |
| Unit tests | Green | Focused header, preferences, desktop icon/titlebar/zoom, and layout checks pass. |
| Performance & scalability | Green | Constant work during the existing status/zoom render, with no new observer, polling loop, or network request. |

## Top 3 Risks

1. `launchpad.css`: removing just the DOM node would leave the macOS named grid track. The active
   layout now explicitly has only projects, workspace, and monitor.
2. `public/app.js` and `src/ui-preferences.mjs`: missing saved position previously reset first-paint
   Bottom to Top. Runtime regression coverage now executes all three normalization boundaries.
3. `renderDesktopZoomControls()`: fixed CSS padding would shrink below native button width at 50%
   zoom. Native geometry verifies physical clearance in both placements at both zoom limits.

## Top Improvements

The required scoped mitigations are implemented. Keep the focused native check available when
other simultaneous terminal changes make the broad Launchpad fixture unsuitable for this scope.

## Recommendation

**Ship**: the scoped native UI check, all 2,044 repository tests, release metadata, and whitespace
checks pass. The extra native pass also covers 320px in both placements and a stale Top cache
reconciled against a saved record with no position field.

## Confirmed Issues

The unused native row and inconsistent default placement are fixed. The first visual test also
exposed a fixture timing issue: reloading immediately after toggling Bottom discarded a pending
debounced preference save. The harness waits for the existing save interval before reloading.

## Suspected Issues & Edge Cases

No remaining scoped issue was found. Electron `capturePage()` captures renderer content, not
native traffic-light artwork. The fixture creates an actual `hiddenInset` BrowserWindow and
checks the reserved physical geometry and drag exclusions; it does not click the native close
button or rebuild the packaged application.

## Regression Risks

Explicit saved Top is intentionally preserved. Legacy `style.css` titlebar selectors remain in
their lower layer; the active entry stylesheet supersedes them. No server routes, task state,
terminal ownership, environment variables, or release versions change for this task.

## Performance Risks

No material risk. Position normalization and setting one zoom CSS variable are O(1).

## Test Gaps

Unit tests are adequate for placement normalization and native-marker retention. Browser layout
requires Electron execution rather than source assertions, supplied by the focused fixture.
The package and non-macOS native window managers were not exercised.

## Positive Improvements

The workspace reclaims the former 32px strip. Fresh tasks stay at the bottom through preference
restoration, while saved choices and window controls retain their behavior.

## Verification

Run the focused native check on macOS:

```sh
node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-chrome-check --desktop-chrome
```

It serves synthetic HTTP/WebSocket fixtures, creates an isolated Electron session, and closes
its window, sockets, and server in `finally`. It never launches provider work. The helper is
`scripts/verify-desktop-chrome.cjs`; captures cover both placements, both themes, compact widths,
saved Top, missing preferences, and zoom limits.

The initial scoped suite passed 51 checks. `release:check` and `git diff --check` passed. The first
full suite ran amid concurrent database and terminal edits and reported four failures outside
this change: assistant-response database fallback and three obsolete terminal sizing assertions.
The broad visual fixture likewise stopped at an absolute terminal-inset assertion superseded by
the concurrent edge-to-edge terminal change. The focused chrome entry avoids those unrelated
terminal assertions while using the same renderer and fixture infrastructure.

Final verification: all 2,044 repository tests pass, all 51 focused checks pass, and release
metadata and whitespace checks pass. The extra native run passes in dark and light themes at
1720px, 480px, and 320px, including 50% and 200% zoom, missing and fresh preferences, and saved Top.
The test Electron windows, HTTP server, and WebSocket connections all exited; a final process
inspection found no task-owned test process remaining.

Local captures: [default Bottom](/tmp/relay-1265-extra/native-default-bottom.png),
[compact Top](/tmp/relay-1265-extra/native-compact-top-light.png), and
[320px Bottom](/tmp/relay-1265-extra/native-smallest-bottom-light.png).
