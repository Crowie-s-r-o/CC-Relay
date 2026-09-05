---
name: Stable Composer Selects
description: Composer and Plan council dropdowns keep their open popup because refresh ticks no longer rewrite unchanged options.
type: architecture
tags:
  - relay
  - ui
  - refresh
  - models
  - claude
---

# Stable Composer Selects

> [!important]
> A `<select>` whose options are replaced while its native popup is open loses that popup, or loses the highlighted row. Relay repaints the composer every two seconds, so any renderer that writes option markup unconditionally makes its dropdown unusable.

## The defect

`renderExecutionControls` and `renderPlanControls` are both re-run by the two-second snapshot refresh (`loadSnapshot`) and, through `renderThreads`, by the four-second thread poll. Both wrote their option markup, values, and disabled flags on every call. Choosing a Claude model therefore failed most of the time: the tick landed between the press and the release, and the selection appeared to jump back.

Measured on the live page with a `MutationObserver`, with no user input at all:

| Element | Rewrites in 31 idle seconds |
| --- | --- |
| `#model-select` | 15 |
| `#plan-author-model` | 23 |
| Effort slider markers | 15 |

The counts are exactly the tick rates: 15 snapshot ticks, plus 8 thread polls for the Plan council panel, which `renderThreads` also repaints.

## Contract

`public/stable-select.js` writes a control only when it would actually change.

- `setSelectOptions(select, options)` compares the intended `{ value, label, disabled }` list against the live `select.options` and writes `innerHTML` only on a difference.
- `setControlValue` and `setControlDisabled` assign only on a difference.

The comparison reads the **live DOM**, not a cached copy of the last markup. Two consequences follow, and both are the reason this shape was chosen:

- A writer that bypasses the helpers cannot leave a cache lying about what is on screen. There is no staleness trap.
- Labels containing a quote or an ampersand still compare equal after the browser has parsed them. `escapeHtml` emits `&#39;` for an apostrophe, so a guard that compared its own markup string against `innerHTML` read back would never match and would rewrite the list on every tick while appearing to be fixed.

Guarded controls: `#model-select`, `#plan-author-model`, `#plan-reviewer-model`, `#plan-author-terminal`, and both Plan council effort selects through `planCouncilEffortOptions`.

The effort slider markers are rebuilt only when the effort values themselves change. `renderEffortSelection` already owned the active marker, so the markers carry no inline active class and a refresh tick no longer replaces the slider under the pointer.

The range's `min`, `max`, and `step` now also assign only on a difference. The September 5
Launchpad fix keeps effort text above the full-width rail and fixes the size of every stop and
thumb on hover. DOM stability alone does not prevent a variable-width sibling label from moving
the native target. The Electron fixture exercises a backend change during a drag, checks the
same range node and no scale-attribute mutations after rendering resumes, and retains the chosen
effort. See [[task-selection-and-effort-control]].

> [!note]
> This is the same defect [[turbo-execution]] fixed for the Forward-planning Turbo panel with the render-skip token in `public/turbo-controls-signature.js`. That fold must name every datum its panel draws from, and a forgotten one leaves a stale panel with no event able to repair it. A per-control diff carries no such risk because it always recomputes the intended options, so new poll-driven selects should prefer it. Both remain valid; do not mix them in one render path.

## Verification

- Idle for 46.8 seconds on the live page after the change: **zero** rewrites of any guarded select, and no browser console errors.
- Switching provider to Claude repainted `#model-select` exactly once, with `default`, `opus`, `fable`, `sonnet`, and `haiku` in catalog order. See [[claude-current-model-routing]].
- Selecting Fable and idling through ten further snapshot ticks left the value on `fable` and rebuilt **no** option markup; only the effort markers moved, because Fable's effort set differs from Opus's.
- `test/stable-select.test.mjs` covers the unchanged-list skip, escaped labels, every field that must force a rewrite, empty catalogs, the value and disabled guards, and a source assertion that no renderer writes these selects directly again.
- `npm test` passes 1,427 tests. `npm run release:check` and `git diff --check` pass.

> [!warning]
> A green suite is not evidence here. The tests are source assertions and pure-module units with no DOM; if a signature input or a rendered label churns every tick, the skip never fires and the bug survives. The discriminating check is the idle `MutationObserver` count on the live page.

## Files

- `public/stable-select.js`
- `public/app.js`
- `test/stable-select.test.mjs`
- `test/composer-workflows.test.mjs`

See [[stable-text-selection]], [[turbo-execution]], [[interface-layout]], and [[hover-stability]].

#relay #ui #refresh #models #claude
