---
name: Terminal Review and Full Height
description: Automatic conversation review after terminal closure and a borderless terminal pane that fills available height.
type: review
tags: [relay, terminal, renderer, review]
---

# Terminal Review and Full Height

A finished task previously stayed on Original terminal after its disposable PTY closed, leaving the operator on an empty terminal notice. The active Launchpad also retained an invisible draggable height separator and honored old fixed heights. The native terminal had a rounded inset card that consumed space.

`public/app.js` now selects Conversation when the selected task is complete, failed, cancelled, or interrupted and its task-scoped terminal read confirms unavailability without remaining targets. An unsupported backend also uses Conversation for finished tasks. The change updates both inline and expanded selections without persisting an automatic global preference. A PTY disconnection immediately rereads the task-owned terminal route.

> [!important]
> Running and open tasks, retained live PTYs, workflow terminal choosers, and temporarily unreadable legacy screens retain their original terminal behavior. A request failure does not prove closure. Existing request sequence and task identity guards prevent a late response from changing another task. The one live conversation node remains shared between inline and expanded views.

`public/index.html` removes the height separator. `applyTerminalHeight()` clears the legacy height override; the shared preference schema stays backward compatible. `public/launchpad.css` gives the terminal and conversation all remaining height with no outer padding, card border, radius, top gap, or decorative window dots. The expanded interactive view has exactly one flexible grid row. `public/embedded-terminal.css` removes artificial minimum heights while retaining padding on xterm itself for correct PTY fitting.

## Executive Summary

**Ticket confidence: High for the changed UI paths.** Direct renderer tests and isolated Electron exercise terminal closure, retained sessions, docking, geometry, and saved response rendering. No provider task is launched by verification.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Finished-task transitions are tested inline and expanded for all four finished statuses. Electron observes a real host exit through the production socket bridge. |
| Regression risk (UI / backend / contracts) | Green | Backend ownership and preference schema unchanged. Retained live and stale legacy screens keep their behavior. |
| Gap risk | Green | Existing late-task response checks plus closure-before-completion, explicit AI filters, and dialog restoration tests. |
| Code quality | Green | One guarded transition uses the existing view and rendering functions. Removed pointer and keyboard resize handlers. |
| Unit tests | Green | 108 focused checks pass, including eleven new behavioral cases and updated obsolete resize contracts. |
| Performance and scalability | Green | Constant-time transition, one extra render only on closure, existing polling stops in Conversation. |

## Top 3 Risks

1. A completed retained terminal must remain interactive. The live response path never sets the closure flag; Electron checks this before ending the synthetic PTY.
2. An old legacy screen read failure must not imply terminal closure. Responses with `legacy-screen` transport keep the last proven screen.
3. Terminal closure can precede the task status update. The availability flag survives until a finished status arrives; a renderer test covers that ordering.

## Top Improvements

The extra pass added immediate discovery after socket disconnection and measured the terminal bottom against its pane bottom. Old tests asserting the removed separator now assert the current flexible Launchpad layout.

## Recommendation

**Ship**, subject to the repository-wide gate results recorded below. The UI behavior is implemented and locally verified; no desktop release or deployment is performed.

## Confirmed Issues

No unresolved issue found in these UI changes.

## Suspected Issues and Edge Cases

External Terminal.app read failures cannot always distinguish closure from temporary unreadability. The last proven legacy screen remains available until the owned-terminal metadata reports that the target is gone.

## Regression Risks

Automatic fallback intentionally supersedes the earlier rule that an unavailable terminal always requires explicit activity selection. It applies only to finished tasks. Explicit Conversation, My messages, and AI messages choices remain stable during refresh.

## Performance Risks

The new checks are constant-time and reuse existing bounded event rendering and task-scoped requests. No background process or additional polling loop is introduced.

## Test Gaps

Native Windows UI was not exercised. Geometry and lifecycle tests run on macOS Electron with synthetic data and the production host and socket bridge.

## Positive Improvements

Review immediately presents saved messages, old height preferences cannot shrink the terminal, no invisible drag target remains, and both inline and expanded surfaces reclaim card space.

## Verification

- 108 focused renderer, terminal, inspector, and geometry contract checks pass.
- `scripts/verify-terminal-rendering.cjs` checks full-height borderless geometry, text preservation, dark/light desktop and compact views, docking, scroll position, reconnecting, zoom, resize bursts, retained completion, actual PTY exit, and inline Conversation restoration.
- Full `npm test`: 2,044 tests pass, zero failures. The initial run caught two obsolete separator assertions, now updated; three unrelated concurrent history/capacity failures cleared in the latest shared workspace.
- `npm run release:check` passes for v0.2.38; `git diff --check` is clean.
- Screenshots and measurements: `/tmp/relay-terminal-completion-pass/`.
- The verification script destroys its Electron window, detaches sockets, shuts down the synthetic host, and closes its loopback HTTP server in `finally`.

See [[embedded-original-terminal]], [[terminal-window]], [[interface-layout]], and [[durable-ui-layout-preferences]].
