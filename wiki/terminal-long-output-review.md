---
name: Long Terminal Output Review
description: Correct embedded terminal dimensions so long lines and the final rows remain visible.
type: review
tags: [relay, terminal, renderer, review]
---

# Long Terminal Output Review

## Executive Summary

**Ticket confidence: High.** Long output was clipped because `public/embedded-terminal.css` placed padding on the border-box container measured by the fit addon. The addon subtracts padding only from its child xterm element. Moving the same desktop and compact insets onto that element corrects the dimensions sent to the actual PTY. The CLI retains control of wrapping, cursor movement, and editing.

Validation completed with 2,001 of 2,001 tests passing in a temporary checkout of release `77e8e5c` plus this rendering change, a passing release metadata check, and clean whitespace checks. The final Electron fixture also passes against the shared working tree. Concurrent session and history edits affected two earlier shared-tree suite runs; the latest had 2,009 passes and one unrelated `listTaskResponses()` ordering failure in `test/database.test.mjs`. Those edits were preserved, and the temporary verification worktree was removed after its tests finished.

> [!note]
> The request described long terminal text as rendering strangely without a specific example. The investigation targeted the current default interactive terminal, reproduced clipping with synthetic long output, and kept the fix in that surface. [[terminal-markdown]] and the legacy native screen are separate renderers.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | The before capture fails the right-edge assertion. Corrected geometry fits both axes and the PTY receives the same rows and columns as the browser. |
| Regression risk (UI / backend / contracts) | Green | One CSS rule and its compact override move existing spacing. No change to input, transport, ownership, event rendering, stored settings, or dependencies. |
| Gap risk (edge cases, error handling, completeness) | Amber | Real Electron geometry is verified on macOS. Windows and Linux hardware were not exercised. |
| Code quality (maintainability as safety) | Green | The CSS explains the fit addon's sizing contract, with a repeatable Electron regression script. |
| Unit tests | Green | Existing terminal, socket, and window tests cover the unchanged behavior. Actual browser geometry assertions cover the CSS defect instead of a source-pattern test that only repeats the implementation. |
| Performance & scalability | Green | No additional production JavaScript, DOM nodes, event handlers, or per-output work. Existing bounded scrollback remains in effect. |

## Top 3 Risks

1. **Padding moves back to the wrong element.** `EmbeddedTerminalView.fit()` calls `FitAddon.proposeDimensions()`, which measures the parent's computed width and height, then subtracts padding on the terminal element. `public/embedded-terminal.css` now matches that calculation. The long-output fixture fails with the old rule.
2. **A resize hides lost text.** `scripts/verify-terminal-rendering.cjs` compares the complete logical text with its synthetic source after expanding, shrinking, zooming, docking, and reconnecting, in addition to screenshots and bounds checks.
3. **Verification affects an operator's session.** The fixture uses its own in-memory synthetic PTY, loopback server on an ephemeral port, and isolated Electron partition. Its `finally` block disposes the window, sockets, terminal host, and server, including on assertion failure.

## Top Improvements

Run the same geometry fixture on Windows and Linux hardware when those platforms receive native verification. Preserve the distinction between terminal soft wraps and actual line breaks in future text-related tests.

## Recommendation

**Ship.** The demonstrated clipping is corrected and the terminal's execution and ownership contracts are unchanged.

## Confirmed Issues

- Before the fix, the 814px container fitted 111 columns while its 18px left inset pushed the final column outside the right edge. It also counted the vertical inset as available terminal height.
- After moving padding, the same container fits 106 columns and 24 rows instead of 111 columns and 25 rows, preserving visible right and bottom insets. The exact counts vary with the viewport and font metrics.
- The extra visual pass found that xterm's legacy viewport still painted its default black background beneath the new insets. A scoped transparent background lets both themes show through correctly without overriding the active terminal cell surface. Computed-background checks and final light screenshots verify that correction.

The affected source is `public/embedded-terminal.css`; the new verifier is `scripts/verify-terminal-rendering.cjs`. Documentation is linked from [[embedded-original-terminal]] and [[hot]].

## Suspected Issues & Edge Cases

No unresolved issue was found in the changed layout. The synthetic terminal covers normal scrollback and live output without executing a provider turn. This change does not claim to alter a provider's own word-breaking behavior or its handling of very wide tables.

## Regression Risks

The before and after views use the same visual insets, but their reported PTY dimensions now exclude those insets correctly. The native CLI may redraw at the corrected width as expected. Keyboard input and resize notifications still follow the existing view, WebSocket, and `EmbeddedTerminalHost.resize()` path. Dialog reparenting continues to use the same terminal instance.

## Performance Risks

The production change is CSS-only and adds no runtime work. Verification uses approximately 27,000 characters of synthetic output, well below the existing 2,000-row scrollback bound at the tested widths. Screenshots, complete text, and geometry are saved under a temporary artifact directory, not committed to the repository.

## Test Gaps

**Are there adequate UNIT tests? Yes**, for the unchanged terminal lifecycle and transport. The relevant existing focused suites passed after the CSS change. The layout defect needs actual Electron measurements, so the new executable browser fixture supplies that coverage without adding a redundant CSS source assertion. Hardware verification remains macOS-only.

The extra pass also corrected a verification assumption: after widening, xterm can retain a wrapped empty row below the cursor. The fixture must trim unused cells on the final cursor row rather than treating that invisible padding as lost or added output. Earlier wrapped rows still retain spaces needed to reconstruct the exact source.

## Positive Improvements

Long lines fit inside the terminal, the final rows retain their inset, and scrollback stays stable while new output arrives. The reusable fixture proves complete text preservation across all tested sizes, with no renderer warnings or errors, and exits cleanly on success or failure.

Verification artifacts: `/tmp/relay-terminal-long-before/` captures the reproduced failure, `/tmp/relay-terminal-long-final/` contains the successful final extra pass including the light-theme correction, and `/tmp/relay-terminal-launchpad-regression/` contains the broader existing Launchpad checks. The full isolated test log is `/tmp/relay-terminal-rendering-isolated-tests.log`. All verification windows, sockets, terminal hosts, and servers exited. See [[embedded-terminal-review]] for the original real-provider PTY validation.
