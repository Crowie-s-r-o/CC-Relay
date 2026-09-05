---
name: Provider concurrency limit review
description: Twenty-instance provider limits and the nineteen-execution Turbo boundary.
type: review
tags:
  - relay
  - queue
  - concurrency
  - review
---

# Provider concurrency limit review

## Executive Summary

**Ticket confidence: High** for the limit change. On September 5, the configurable ceiling
increased from eight to twenty for each provider in each project. The request's terminal wording
maps to the existing provider pool controls; each conversation remains sequential. Defaults and
saved limits remain unchanged. See [[disposable-terminal-pools]] and [[turbo-execution]].

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Composer number fields, save validation, and project PATCH validation accept 20. Pool reservations block task 21. |
| Regression risk (UI / backend / contracts) | Green | No schema or default changes. Legacy Turbo keeps eight workers. |
| Gap risk (edge cases, error handling, completeness) | Green | Fractional, missing, zero, negative, and over-limit input is rejected; all three providers have boundary coverage. |
| Code quality (maintainability as safety) | Green | Renderer and server each name the project ceiling and derive the automatic Turbo limit. Contract tests pin their agreement. |
| Unit tests | Green | Focused suites cover persistence, provider and project isolation, and Turbo's planning slot. |
| Performance & scalability | Amber | Logical capacity is verified with synthetic reservations; twenty live provider processes have not been load-tested. |

## Top 3 Risks

1. `src/server.mjs` had a separate eight-worker Turbo validator. It now derives the disposable
   limit as 20 minus one, retaining eight for persistent terminal work.
2. `public/app.js` and `public/index.html` each enforce input bounds. Both now accept 20;
   `scripts/verify-launchpad.cjs` also checks the updated plus-button boundary.
3. `DisposableTerminalPool.canRun()` admits more processes only after an operator raises a saved
   limit. Machine and provider resource use increases accordingly; scheduling remains bounded.

## Top Improvements

The extra verification pass found and updated the UI fixture's stale eight-slot assertion.
Any future ceiling change must update provider fields, both validators, and the UI fixture together.

## Recommendation

**Ship with Mitigations**: apply the limit change, retaining existing configured values. Review
unrelated shared-worktree suite failures separately before release.

## Confirmed Issues

No unresolved issue found in the changed limit paths. An initial new test expected `null` for no
capacity error; the existing pool contract returns an empty string. The assertion was corrected.

## Suspected Issues & Edge Cases

Twenty executions in automatic Turbo require 21 Codex slots and remain invalid. Nineteen executions
plus one planner fit exactly. Lowering a project limit still rejects changes that would strand a
queued workflow. Network/save errors retain the existing visible error and rerender behavior.

## Regression Risks

`saveProjectInstanceLimits()` validates before PATCH. The route validates all providers before the
store mutation, checks queued workflow requirements, then schedules against the saved limits.
The shared project store and database mirror preserve 20 on reopening. Pool accounting continues
to isolate projects and providers and reserve one owner per saved conversation. No launch or cleanup
ownership code changed for this request.

## Performance Risks

Pool capacity checks still scan existing allocations and reservations. Increasing the ceiling adds
no new loop or query, but up to twenty active processes per provider and project may use more CPU
and memory. Synthetic tests are not a live-provider throughput benchmark.

## Test Gaps

**Are there adequate UNIT tests? Yes.** Focused tests exercise the changed bounds and scheduler
behavior. Backend validator tests execute extracted pure validation blocks to avoid launching a
real server or provider. Real provider load at the new ceiling remains unmeasured.

## Positive Improvements

The larger capacity is available through the existing controls and API. Automatic Turbo now agrees
with the expanded provider pool while reserving its planning lane. No environment variables,
versions, or live project settings changed.

## Verification evidence

The 101 focused composer, Turbo, pool, and project-store tests pass. An isolated Electron fixture
verified all three providers save 20, disable increment at 20, decrement to 19, and fit at widths
1720 and 760 in both themes. Screenshots are in `/tmp/relay-parallel-ui-focused/` for this run.
`release:check`, JavaScript syntax checks, and `git diff --check` pass.

The final full run passed 2,041 of 2,043 tests. Both remaining failures are pre-existing shared-tree
inspector assertions in `test/task-detail-modal.test.mjs`, covering modal placement and terminal
height. The broad Launchpad visual script stopped before the capacity checks on its unrelated
terminal-inset geometry assertion; the isolated capacity fixture passed. Earlier shared-tree
history failures disappeared in the final run. All verification processes started for this task
exited, including both Electron fixtures.
