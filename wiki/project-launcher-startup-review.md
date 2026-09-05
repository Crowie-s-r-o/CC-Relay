---
name: Project Launcher Startup Review
description: September 5 desktop startup failure caused by eager dependency access and a false-positive startup test.
type: review
---

# Project Launcher Startup Review

## Executive Summary

**Ticket confidence: High**

Version 0.2.36 failed before HTTP binding because `src/server.mjs` constructed
`TaskOriginalTerminal` with `launcher: projectLauncher` before the launcher's `const`
initializer. Installed desktop diagnostics identified this exact ReferenceError.
The service now initializes immediately after `ProjectLauncher`.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Launcher exists before eager constructor argument evaluation. |
| Regression risk (UI / backend / contracts) | Green | Same dependencies and constructor arguments; only construction order changes. |
| Gap risk (edge cases, error handling, completeness) | Amber | Local macOS validation; Windows runtime was not exercised. |
| Code quality (maintainability as safety) | Green | Consumer follows its dependency without optional fallbacks or mutable placeholders. |
| Unit tests | Green | Full 1,971-test suite passes; startup test now requires EADDRINUSE. |
| Performance & scalability | N-A | One startup-only construction moves; no new repeated work. |

## Execution Trace

Electron dynamically imports the server. The server resolves providers, constructs
`ProjectLauncher`, then constructs `TaskOriginalTerminal`, and later binds HTTP.
`TaskOriginalTerminal` only stores dependencies in its constructor. Its ownership checks
and task endpoint behavior remain unchanged. Earlier Claude callbacks capture the launcher
without reading it during construction, so they do not cause the eager access failure.
The launcher constructor stores callbacks and allocates runtime helpers without dispatching work.

## Top 3 Risks

1. `src/server.mjs` top-level constructor arguments must follow dependency initialization.
2. `test/server-startup.test.mjs` previously accepted every exit code 1 and hid this crash.
3. Installed `app.asar` freezes source, so a source fix requires a rebuilt installed app.

## Top Improvements

The startup regression now captures stderr and requires EADDRINUSE, while retaining the
assertions that a failed duplicate start cannot interrupt existing task state. It waits for
child `close` so stderr is drained before assertions.

## Recommendation

**Ship.** Construction-order review and the real server subprocess test cover the failure.

## Confirmed Issues

Fixed eager access to an uninitialized const and a false-positive startup test.

## Suspected Issues & Edge Cases

No additional issue found in the moved constructor. Empty, missing, or stale task and terminal
inputs still enter the existing service checks after startup, with the same dependencies.

## Regression Risks

Before: both desktop and standalone server fail before binding. After: initialization reaches
binding; occupied standalone ports still fail without queue recovery or dispatch.

## Performance Risks

None introduced; constant startup work and allocations are unchanged.

## Test Gaps

Adequate UNIT tests: Yes, combined with the startup subprocess regression and the original-terminal
service coverage. Native Windows packaged launch remains unverified.

## Installed macOS Verification

The signed arm64 DMG and ZIP build completed. Strict deep code-signature verification passed
for the build and installed `/Applications/CC Relay.app`; their `app.asar` SHA-256 hashes match.
The installed app was relaunched and emitted `desktop.server.ready` and
`desktop.window.load.completed` at 15:03 UTC on September 5. Its status endpoint returned HTTP 200.
Release metadata and `git diff --check` also pass.

## Positive Improvements

The regression checks the actual startup failure reason instead of treating an unrelated crash
as successful ownership protection. No configuration, database schema, or environment variable changes.

> [!important]
> A nonzero child exit does not prove a negative-path integration test reached its intended boundary.
> Assert the expected failure reason. See [[diagnostics]], [[original-terminal-review]],
> [[desktop-packaging-review]], and [[hot]].

#relay #desktop #startup #review
