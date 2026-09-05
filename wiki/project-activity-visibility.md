---
name: Project Activity Visibility
description: Visible project execution states and the verification of their Launchpad presentation.
type: review
tags: [relay, projects, ui, accessibility, review]
---

# Project activity visibility

## Executive Summary

**Ticket confidence: High**

Every Launchpad project now shows its existing activity label. Running uses a filled violet
badge, while Idle uses neutral text with a hollow dot. Waiting, Restart needed, Session open,
Sessions open, Attention, and Finished remain explicit. Project selection and identity colors
remain independent of execution state. See [[launchpad-v2-design]].

> [!important]
> Do not hide `.project-activity strong` again. The v2 one-pixel clipped label left sighted
> operators with only a small dot, making running and inactive projects difficult to distinguish.

## Change Mapping and Functional Execution Trace

`public/launchpad.css` owns this change. `renderProjects()` already calls `projectActivity()`
for each exact project path, escapes the status text, and emits `data-activity` plus an accessible
label. Task snapshot refreshes update the same presentation. The stylesheet now displays those
words and applies semantic badge colors without changing the activity calculation or API.

Priority remains running, valid open manual sessions, queued work, latest failure/interruption,
unread completions, then idle. A selected project does not imply running work. Unread completion
counts remain visible alongside Running; see [[launchpad-completion-notifications]]. Empty
projects retain their existing empty state. Queue, terminal ownership, storage, and authentication
paths are unchanged.

Cards stay 30px high and grow to at most 300px or the rail's available width. Names can truncate;
the identity tile, status, and close control do not shrink. State text uses the existing body
font at 10.5px with no animation. Both themes use their existing tokens.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Electron exercised all eight labels and a live Running to Idle transition. |
| Regression risk (UI / backend / contracts) | Green | Project state logic and handlers are unchanged; 44 focused project/session checks passed. |
| Gap risk | Green | Long names, 9+ unread completions, selected and unselected cards, both themes, and 320 through 1720px widths were checked. |
| Code quality | Green | Changes stay in the existing unlayered dock block, overriding the legacy cascade explicitly. |
| Unit tests | Green | Existing state, notification, session, layout, and reorder coverage passed; all 2,010 repository tests passed on the final run. |
| Performance & scalability | Green | CSS only; no added polling, allocation, task scan, or dependency. |

## Top 3 Risks

1. Hidden or clipped status text: computed styles and actual label bounds were checked in Electron.
2. Long names crowding the status: shrink is limited to the project name, and cards are capped
   to their scroll rail, including at 320px.
3. Selection or completion being mistaken for execution: only `data-activity="running"` receives
   the violet fill. Notification badges remain independent.

## Top Improvements

Persistent words make state readable without hovering or interpreting project identity colors.
The same prominent Running badge appears on selected and unselected projects.

## Recommendation

**Ship** for this presentation change.

## Confirmed Issues

The extra pass found and fixed two issues before completion: a 300px long-name card exceeded
the compact rail, and Finished text measured 4.45:1 against the light control surface. The width
now uses `min(300px, 100%)`; Finished uses the panel surface. All measured label contrasts now
exceed 4.5:1, with theme minima of 4.65:1 in light and 4.97:1 in dark.

## Suspected Issues & Edge Cases

No unresolved issue was found in this scope. Existing stale snapshot behavior is unchanged;
this presentation does not infer running activity from a selected project or an open terminal.

## Regression Risks

Project chips consume more horizontal space because their state is now visible. The existing
horizontal rail still handles overflow without compressing badges or changing dock height.
Keyboard focus, color controls, and close controls keep their existing elements and handlers.

## Performance Risks

No new JavaScript work. Existing per-project task filtering has the same complexity as before.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for the unchanged state logic and interaction contracts.
No new source-shape test was added for this CSS correction. The repository Electron verifier
passed without renderer errors; a temporary extension of its isolated synthetic fixture checked
all project labels, geometry, notifications, and live refreshes in both themes at 1720, 1200, 480,
and 320px. Screenshots were inspected. Live provider launches are outside this visual scope.

The initial full run encountered a concurrently changing terminal test. After that separate
work updated its contract, the final full run passed all 2,010 tests. Release metadata and
`git diff --check` passed. Verification windows, HTTP servers, and sockets closed on exit.

## Positive Improvements

Running and idle projects are readable at a glance. Intermediate and attention states retain
their precise words, and long project names cannot displace those words or the close control.

See [[project-workspaces]], [[manual-terminal-session-mode]], and [[hover-stability]].
