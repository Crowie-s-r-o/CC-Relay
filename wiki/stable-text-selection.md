---
name: Stable Text Selection
description: Browser text selections remain copyable while Relay polls and refreshes live UI regions.
type: architecture
---

# Stable Text Selection

Relay refreshes tasks every two seconds, terminal discovery every four seconds, task durations every second, and planner state while a run is active. Several renderers replace whole DOM regions with `innerHTML`. A browser text range points to the concrete nodes it spans, so replacing an unchanged-looking node collapses the range and prevents the operator from copying it.

## Refresh contract

`public/text-selection-guard.js` recognizes both kinds of user selection:

- A non-collapsed document selection from `window.getSelection()`.
- A nonempty `selectionStart` to `selectionEnd` range in the focused form control.

Background render paths await `textSelectionGuard.waitForClear()` after network reads and before applying UI state. Task duration updates skip their tick while a range is active. Updates resume automatically after the browser emits `selectionchange` with no active range. Provider and task execution continue normally because only renderer updates wait.

The protected interval begins at `pointerdown`, not only after `window.getSelection()` becomes nonempty. This closes the race where a network response completed during the first part of a drag and replaced Task Detail before the browser established the final range. A plain click releases its waiting render after `pointerup`; a completed text selection holds it until the range is cleared.

The guarded paths are task snapshots, project refreshes, selected task details, terminal discovery, saved plans, active planner polling, and one-second durations.

> [!important]
> Any new periodic renderer that replaces visible text must use the same guard before mutating the DOM. A signature that avoids unchanged writes is still useful, but it does not protect a range when the content genuinely changes.

## Desktop copy contract

Task Activity scrollback explicitly declares `user-select: text`, while signal line numbers remain
excluded with `user-select: none`. This keeps terminal content selectable even if a parent surface
temporarily owns a resize gesture. Its explicit Tokyo Night selection colors make the dragged range
visibly distinct from inline-code backgrounds.

Electron `BrowserWindow` does not provide Chromium's page context menu automatically. The desktop
main process therefore handles `context-menu` and opens a native **Copy** role whenever the page
reports selected read-only text. Editable controls receive only the native Undo, Redo, Cut, Copy,
Paste, and Select All actions that Electron reports as available. An ordinary unselected app
surface opens no desktop menu. The application Edit menu continues to own Command or Control plus
C, so keyboard copy and right-click copy reach the same browser selection.

> [!note]
> This desktop handler also fulfills the selected-task-card behavior in [[task-references]]: a
> right-click inside selected card text keeps Copy available instead of opening the task-reference
> scope menu.

## Drag click behavior

Mouseup after dragging across text can emit a click. Relay cancels that click at the document capture boundary when either selection endpoint belongs to its target. This applies to Task Detail disclosures, queue and history cards, links, project controls, planner surfaces, and future clickable regions without requiring a local handler in each component. It prevents a completed drag from toggling, navigating, activating, and rebuilding selected content.

Ordinary pointer clicks still work because they do not leave a range inside their target. Keyboard-generated clicks have `detail === 0` and are explicitly left alone. The task card also retains its local selection check as a defense close to the most frequently rebuilt list.

## Verification

- `test/text-selection-guard.test.mjs` covers document ranges, form-control ranges, pointerdown-before-range timing, deferred resumption, selection-target intersection, mouse versus keyboard click behavior, every recurring renderer integration, and the task-card activation gate.
- Live Chrome checks selected text inside a real task card, Task Detail result, Result disclosure summary, and terminal output. The ranges survived more than one two-second poll. Dragging across the Result summary left the disclosure open instead of toggling it.
- The task-card range copied with Command or Control plus C and read back as the exact text from the clipboard.
- An isolated real-browser Task Activity fixture computed `user-select: text`, kept a 273-character
  response selection through the two-second poll, and copied the exact selected text with
  Command+C. The native desktop menu template is covered independently so it cannot regress to an
  empty right-click on selected text.
- The live page reported no browser console errors.
- The original August 10 complete suite passed 1,125 tests.
- The August 26 desktop-copy pass has 27 focused checks, all 1,744 repository tests pass, and
  `npm run release:check` reports consistent v0.2.26 metadata. A second isolated browser tab
  repeated the 273-character selection, polling, and exact clipboard check with zero warnings or
  errors.

See [[interface-layout]], [[task-history]], and [[renderer-performance]].

#relay #ui #selection #clipboard #refresh
