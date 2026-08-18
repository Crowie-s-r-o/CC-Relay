---
name: Fable Usage Repaint Correction Review
description: Adversarial ship review of delayed Claude Usage repaint handling and honest Fable fallback semantics.
type: review
tags:
  - relay
  - providers
  - usage
  - claude
  - fable
  - review
---

# Fable Usage Repaint Correction Review

## Executive Summary

**Ticket confidence: High**

The change is safe to ship. Claude Code 2.1.234 was reproduced painting a persisted `80%` all-model frame without Fable, then later painting `81%` all-model and `71%` Fable. The corrected probe waits for that live outcome, forces Ink to emit a complete final frame, and prevents an explicit per-model refresh failure from becoming false shared Fable usage.

The execution path was traced from `ClaudeUsageProbe.read()` through `parseClaudeUsageScreen()`, `ProviderUsageMonitor.refreshProvider()`, `GET /api/status`, `providerUsageMeterPresentation()`, and `renderProviderUsage()`. A live probe against the installed Claude 2.1.234 binary returned `81%` Claude week and `71%` Fable. The focused suite passes 24 tests, all 1,582 repository tests pass, `release:check` is green for v0.2.14, and `git diff --check` is clean.

### Change Mapping

| File | Responsibility and changed behavior | Downstream consumers |
| --- | --- | --- |
| `src/provider-usage.mjs` | Waits for the live Usage repaint, forces a complete private-terminal redraw, detects explicit refresh failures, preserves a prior real Fable value, and emits a mixed-version-safe unavailable sentinel otherwise. | `src/server.mjs`, `/api/status`, SSE status notifications, renderer usage state. |
| `public/provider-usage.js` | Suppresses shared Fable fallback when the backend explicitly marks the model breakdown unavailable. | `public/app.js` progress bars, titles, accessibility text, and reset presentation. |
| `test/provider-usage.test.mjs` | Protects delayed redraw, rate-limit, prior-direct-value, unavailable-sentinel, script timing, and session reuse contracts. | Backend and parser regression confidence. |
| `test/provider-usage-ui.test.mjs` | Protects unavailable versus successful shared fallback presentation. | Header visual and accessibility contract. |
| `wiki/provider-usage-monitor.md` | Records the Claude 2.1.234 failure mode and final monitor contract. | Future provider-monitor changes. |
| `wiki/interface-layout.md` | Distinguishes successful missing allowance from failed model breakdown in the header behavior. | Future renderer and design changes. |

Blast radius is limited to cached provider usage collection and the four header meters. There are no database, migration, credential, permission, environment-variable, task execution, or queue changes.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | The live Claude 2.1.234 probe returned `81%` weekly and `71%` Fable. Parser tests cover the reproduced cached `80%` frame followed by a complete redraw. |
| Regression risk (UI / backend / contracts) | Green | Successful missing-Fable responses retain the documented shared fallback. Explicit failures carry `fableWeeklyUnavailable` plus a nonnumeric window sentinel, so both current and older renderers fail closed. |
| Gap risk (edge cases, error handling, completeness) | Green | Rate limiting, last-known output, a still-refreshing timeout, prior direct values, no prior direct value, absent rows, overlap deduplication, cancellation, and unsupported platforms have bounded outcomes. |
| Code quality (maintainability as safety) | Green | Probe lifecycle, parser semantics, monitor state, and renderer fallback remain separated. The new boolean names the otherwise ambiguous missing-row state. |
| Unit tests | Green | 24 focused tests cover normal, partial repaint, explicit failure, shared fallback, mixed-version sentinel, stale preservation, UI output, and process-script construction. |
| Performance & scalability (if applicable) | Green | One bounded 40-second child can exist, refreshes deduplicate, status requests remain memory-only, and terminal output remains capped at 256 KiB. |

## Top 3 Risks

1. `src/provider-usage.mjs` still depends on Claude's human-facing labels such as **Refreshing**, **Usage credits**, and **Current week (Fable)**. A future CLI text change can extend a probe to its timeout, but cannot turn an explicit failure into a shared Fable value.
2. The 22-second live wait may be shorter than a future unusually slow successful response. The resulting outcome is stale or unavailable, not an incorrect percentage, and the 30-second monitor schedule retries later.
3. The forced redraw uses `stty` on Expect's private pseudo-terminal. It was verified live on the supported macOS path, while non-macOS remains explicitly unavailable rather than using this code.

## Top Improvements

- If Claude later exposes model-scoped limits through a stable machine-readable command, replace the TUI probe while preserving the current cached API contract.
- Add a deterministic macOS integration fixture for the Expect timing and `stty` redraw if CI gains a controllable pseudo-terminal environment.
- Track future Claude label changes in the focused parser fixtures before accepting a new CLI version as validated.

## Recommendation

**Ship**

## Confirmed Issues

None remain after the mixed-version review added the nonnumeric unavailable sentinel. No execution path found can publish the cached all-model percentage as Fable after Claude explicitly reports that its per-model breakdown failed.

## Suspected Issues & Edge Cases

- A successful response with neither a Fable row nor a Usage credits section waits the full 22 seconds before the redraw. This is bounded and produces the correct final frame.
- If the private terminal cannot be resized, both `stty` operations are guarded. The parser then keeps its existing safe stale or unavailable behavior, although a label-less incremental all-model update may remain old until the next sample.
- A provider response that changes every known label could become unavailable. It cannot bypass credentials, leak terminal output, or mutate task state.

## Regression Risks

- Before: any missing direct Fable row became the all-model percentage, even when Claude said the model breakdown was rate limited. After: only a clean completed response may use that shared fallback.
- Before: a 3.5-second settle period could close on the persisted frame. After: a visible refresh receives up to 22 seconds plus a complete redraw.
- Before: an older renderer would ignore a new top-level failure flag. After: the backend also sends a truthy but nonnumeric Fable window, which older presentation code renders as unavailable rather than falling back.

## Performance Risks

The parser remains linear in a buffer capped at 256 KiB. The extra wait is asynchronous inside one detached child and does not block the HTTP event loop. `ProviderUsageMonitor.refresh()` still shares one pending promise, so a slow Claude sample cannot create overlapping probes. Worst-case cadence can skip one 30-second interval, but status reads continue to return cached state immediately.

## Test Gaps

No deterministic test executes the real Tcl script against a synthetic Ink terminal. Script construction is asserted, captured terminal frames cover parser behavior, and one live Claude 2.1.234 probe validates the complete path. Given the macOS-only integration boundary and the complete repository pass, the remaining gap is acceptable.

**Are there adequate UNIT tests? Yes.** They cover the reproduced normal flow, delayed repaint, explicit rate-limit failure, prior real Fable preservation, no-real-value failure, successful shared fallback, UI state, timeout-script construction, overlap deduplication, and unsupported platforms.

## Positive Improvements

- Fable now reflects the real model-specific allowance when Claude provides it.
- A provider failure is represented honestly instead of appearing as valid usage data.
- The API remains backward-safe for an older renderer.
- The probe still reuses one Claude session, keeps credentials inside the CLI, bounds output, and terminates its owned process group on timeout or cancellation.

See [[provider-usage-monitor]], [[interface-layout]], and [[hot]].

#relay #providers #usage #claude #fable #review
