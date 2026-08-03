---
name: macOS Terminal Grid Coordinates
description: Correct AppKit to Terminal.app coordinate conversion and JXA window rectangle normalization for multi-monitor grid placement.
type: bugfix
tags:
  - relay
  - terminal
  - macos
  - grid
  - displays
---

# macOS Terminal Grid Coordinates

CC Relay's terminal grid uses Terminal.app bounds, whose coordinate system starts at the top-left of the primary display. AppKit exposes screen frames from the bottom-left of the primary display.

> [!important]
> Convert an AppKit visible-frame Y coordinate with the top of `NSScreen.mainScreen.frame`, not the maximum upper edge across every connected screen. A display physically above the primary display must produce a negative Terminal.app Y coordinate.

The four-monitor layout that reproduced the bug had:

- primary frame: `(0, 0, 5120, 1440)`
- primary visible frame: `(0, 79, 5120, 1331)`
- upper displays extending the AppKit desktop to Y `2880`

The old global-maximum calculation produced Terminal Y `1470` for the primary visible frame. The correct primary-frame calculation produces Y `30`. macOS clamped the invalid grid rectangles to the primary display's bottom-left edge, which made distinct cells appear stacked.

## Terminal window rectangle shape

On the reproducing macOS version, JXA returns `Terminal.windows()[n].bounds()` as:

```json
{ "x": 20, "y": 30, "width": 1172, "height": 762 }
```

It is not an indexed `[left, top, right, bottom]` array. Reading indexes produced empty JSON objects, so occupied-cell inspection always selected grid cell zero. `normalizeMacTerminalWindowBounds()` now accepts the current JXA rectangle, the legacy indexed shape, and an already normalized edge object.

> [!note]
> These two defects amplified each other. Empty occupancy data repeatedly selected cell zero, and the wrong vertical conversion placed that cell below the primary display. Fixing only one defect would leave the grid unreliable.

## Verification

- The focused `project-launcher` suite passes all 40 tests.
- The complete repository suite passes all 767 tests.
- Live read-only inspection reports the selected primary display as `(0, 30, 5120, 1331)`.
- With existing Terminal windows inspected in their real JXA shape, the next free 3 by 3 cell resolved to slot 1 with bounds `(1706, 30, 3412, 473)`, rather than repeating slot zero at the bottom edge.

## Files

- `src/project-launcher.mjs`
- `test/project-launcher.test.mjs`

Restart the CC Relay backend before validating new launches. A packaged desktop build must be rebuilt and reopened to include the source change.

See [[interface-layout]], [[project-terminal-settings]], and [[desktop-updates]].

#relay #terminal #macos #grid #displays
