---
name: Launchpad v2 Design Review
description: Adversarial review of the structural Launchpad v2 port and rendered verification.
type: review
tags: [relay, ui, review, accessibility]
---

# Launchpad v2 design review

## Executive Summary

**Ticket confidence: High**

The September 5 structural revision ports the reference workspace, council matrix, Turbo rows,
and terminal settings. Real Electron checks establish reference geometry and control behavior.
All 2,000 repository tests passed, as did `npm run release:check` and `git diff --check`.
See [[launchpad-v2-design]] for the presentation contract and reproduction command.

This review covers the design changes. Concurrent interactive-terminal backend and packaging work
was preserved. Its visible surface was checked using synthetic WebSocket output; this review does
not claim to validate real provider sessions, native permissions, or that separate transport.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | `scripts/verify-launchpad.cjs` checks real controls, capacity PATCH count, attachments, council ordering, Turbo conditional rows, settings, views, and cached reload. |
| Regression risk (UI / backend / contracts) | Green | Existing handlers and IDs remain; saved placement and widths, draft focus, panel and terminal keyboard resizing pass rendered checks. |
| Gap risk (edge cases, error handling, completeness) | Green | Both themes, empty projects, native titlebar, 320 through 1720px layouts, both terminal surfaces, and compact dialogs were checked without renderer errors. |
| Code quality (maintainability as safety) | Green | `application.css` isolates the legacy cascade; table ownership and zero-width separator constraints are documented. |
| Unit tests | Green | Workflow and preference contracts, existing contrast checks, and executable same-day/overnight/pending timestamp cases pass with the full 2,000-test suite. |
| Performance & scalability | Green | The design adds no runtime dependency or polling. Fixed-size stepper observers and existing bounded task rendering retain linear work. |

## Top 3 Risks

1. `public/application.css` must layer `style.css` before unlayered `launchpad.css`. Hidden rows
   still rely on binding `[hidden]` rules. Both council orders and Turbo council states passed
   actual geometry checks, including removal of inherited grid areas and pseudo-elements.
2. `loadSnapshot()` can retain an active project without the normal selection render. Its explicit
   `renderAutomaticTerminalPool()` refresh now prevents the legacy picker from surviving a
   cached reload. The smoke test reproduces that exact path.
3. `applyPanelWidths()` uses the full workspace width for overlapping separators; legacy migration
   still removes the original 64px. `applyTerminalHeight()` and CSS must honor saved height as
   actual geometry. Keyboard checks assert the resulting dimensions and width persistence.

## Top Improvements

Use the repository-owned Electron fixture when changing these components. Source-shape checks
cannot establish table alignment, focus retention, overflow, or which cascade rule owns the pixels.
Keep fixture capabilities aligned with application behavior as features change.

## Recommendation

**Ship** for the design scope. No unresolved high-likelihood design regression was found.

## Change Mapping

| Files | Responsibility and downstream effect |
|---|---|
| `public/application.css`, `public/launchpad.css` | Cascade ownership, reference geometry, themes, responsive flow, tables, dialogs, and separator targets. |
| `public/index.html` | Shared provider rows, real steppers, unified prompt toolbar, queue header, activity views, dock usage, settings, and monitor defaults. Existing IDs bind the same handlers. |
| `public/app.js` | Escaped compact card metadata/dates, live status and pool summaries, input stepper dispatch, secondary views, layout calculations, and cached capability refresh. |
| `public/embedded-terminal.css`, `public/embedded-terminal.js` | Presentation adjustments to concurrent terminal work: font, line height, padding, palette, and visible activity metrics. |
| `src/ui-preferences.mjs` | Fresh monitor default becomes two rows; persisted values still win. |
| `test/composer-workflows.test.mjs`, `test/dark-mode.test.mjs`, `test/desktop-icon.test.mjs`, `test/header-position.test.mjs`, `test/plan-visibility.test.mjs`, `test/project-layout.test.mjs` | Updated markup, cascade entry, visibility, and layout contracts. |
| `test/quick-skill-editor.test.mjs`, `test/task-activity-overview.test.mjs`, `test/task-search-ui.test.mjs`, `test/task-time.test.mjs`, `test/ui-preferences.test.mjs` | Settings/metadata contracts, token overview, executable date cases, and fresh defaults. |
| `scripts/verify-launchpad.cjs` | Isolated HTTP/WebSocket fixtures and Electron interaction, screenshot, geometry, persistence, and cleanup checks. |
| `wiki/launchpad-v2-design.md`, `wiki/launchpad-v2-design-review.md`, `wiki/interface-layout.md`, `wiki/compact-interface-density.md`, `wiki/header-position.md`, `wiki/dark-mode.md`, `wiki/durable-ui-layout-preferences.md`, `wiki/hot.md` | Current structural contract, review, defaults, cascade, and verification guidance. |

Execution routing, schemas, authorization, ownership, and API shapes are outside this design's
changes. Other modified backend, package, and terminal files in the shared checkout belong to the
concurrent terminal task and are not attributed to this port.

## Functional Execution Trace

- A capacity button resolves its number input, respects disabled/min/max, calls `stepUp()` or
  `stepDown()`, then emits one change. The existing project save path retains serialization,
  validation, rollback, and feedback. The fixture proves one PATCH per click, the upper bound,
  and no provider selection or task submission as a side effect.
- Snapshot loading populates status and projects before refreshing automatic pool controls.
  Cached and newly selected projects now reach the same state. Missing automatic capability
  continues through existing legacy controls.
- Council and Turbo reuse the existing provider/model handlers. Columns follow the actual first
  author; reviewer controls stay hidden when council is off. Both orders and transitions passed.
- Compact dates retain semantic `datetime` values. Only same-day ending dates are abbreviated;
  overnight dates remain explicit and pending values have an accessible label. Identity and
  owner content still use the existing escaping helpers.
- Layout changes clamp against available space, retain the original legacy migration, and persist
  through existing APIs. Saved terminal height changes the actual event pane. Narrow viewports
  have bounded stacked flow and reachable scrolling.
- Attachments stage and remove fixture files through existing handlers. Drafts, focus, and settings
  survive rerenders. Settings retain immediate save with an accurate Done footer.

No new retry, authorization, database-write, or concurrent execution path is introduced. Existing
error feedback and execution contracts remain covered by the repository suite. The isolated
visual fixture does not inject every possible network failure into those unchanged paths.

## Confirmed Issues

Fixed during implementation and the extra verification pass:

- `launchpad.css`: old council pseudo-elements inserted a table row; inherited grid areas and
  Turbo display rules broke alignment or conditional visibility. Explicit ownership fixes both.
- `launchpad.css`: the monitor inherited `display: contents` and expanded the document; compact
  layouts compressed content. A real flex wrapper and bounded flow eliminate horizontal overflow.
- `app.js`, `loadSnapshot()`: cached projects left a legacy picker despite automatic capability.
  Explicit post-snapshot rendering fixes the reload case.
- `app.js`, `applyTerminalHeight()`, and CSS: the compact header could prevent a saved terminal
  size from affecting rendered height. Conditional flex sizing, measured header bounds, and an
  overlapping focusable handle restore actual resizing.
- `app.js`, `selectMode()`: stale council feedback remained after mode changes. Clearing obsolete
  form feedback keeps it consistent with the selected workflow.

No unresolved confirmed issue remains in this design scope.

## Suspected Issues & Edge Cases

The static reference has different task text, provider availability, token counts, and preferences.
Fresh geometry is asserted; saved operator layouts deliberately remain authoritative. Settings
retain immediate save and Done because Save/Cancel would misrepresent existing behavior.
Large queues and attachment collections scroll within existing rendering and attachment limits.
The fixture covers empty and populated states, not exhaustive production history sizes or every
operating-system font rendering variation.

## Regression Risks

Fresh monitor rows change from one to two in markup and server normalization. Saved rows, widths,
and placement override that default. IDs and handlers remain stable despite DOM moves. Extra
activity views and subscription windows remain accessible through disclosures.
Overlapping resizers retain pointer and keyboard targets. Checks establish actual resizing and
saved width restoration. Native titlebar and Top placement were checked separately from Bottom.

## Performance Risks

Stepper synchronization visits a fixed number of controls. Observers watch only disabled/min/max
and do not mutate those attributes, avoiding observer loops. Date/token formatting is constant
work per task, so rendering remains O(n) in the existing visible task count. One token presentation
is reused per activity overview. Local fonts and the cascade entry add no remote dependency.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for changed defaults, control contracts, theme loading,
contrast checks, and actual timestamp behavior. Source-shape tests alone are weak visual evidence;
Electron supplies geometry and interaction evidence. Live provider execution and native PTY work
were not initiated. Synthetic output verifies presentation without claiming validation of the
concurrent transport feature. Screens were reviewed visually, not asserted as byte-identical to
a reference with different content.

## Positive Improvements

The workspace, council, Turbo, settings, and monitor now use the reference's structural arrangement.
Layout expectations are executable, cascade boundaries explicit, and compact controls reachable.
The extra pass found and fixed a cached startup bug and verified actual terminal resizing.

Final validation: 2,000 tests passed with zero failures; release metadata passed for the shared
checkout's v0.2.37; whitespace checks passed. The final Electron run reported no renderer errors
and no document overflow. Its windows, fixture server, and sockets closed on exit.

See [[launchpad-v2-design]], [[durable-ui-layout-preferences]], and [[hover-stability]].
