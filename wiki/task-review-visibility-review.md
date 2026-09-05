---
name: Task Review Visibility Review
description: Execution trace and adversarial verification for prominent review cards and the review-only view.
type: review
tags: [relay, review, ui, testing]
---

# Task review visibility review

## Executive Summary

**Ticket confidence: High**

The review-only view uses the existing durable completion membership and exact project scope.
Every unread card is visibly marked in the final stylesheet. Synthetic Electron verification
passes in both themes at desktop and compact widths, including acknowledgement, search races,
project changes, keyboard focus, and a second bulk-review cycle.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `renderTasks()` selects `tasksReadyForReview(projectTasks(), ...)`; count and badges share `ProjectCompletionNotifications`. Electron proves old, starred, and unstarred review membership. |
| Regression risk (UI / backend / contracts) | Green | Queue mutations require the exact Queue view. Search remains project-wide, switches clear stale searches, and existing exact-outcome review endpoints are unchanged. |
| Gap risk (edge cases, error handling, completeness) | Green | Mixed statuses, nested projects, zero results, reload, delayed search, keyboard removal, and repeated bulk review are exercised. |
| Code quality (maintainability as safety) | Green | One small filter helper, existing preferences and notification predicate, and theme tokens in the owning stylesheet avoid a second review state. |
| Unit tests | Green | Adequate UNIT tests: Yes. Filtering is tested with the real notification store; existing persistence tests cover reopen, migrations, retries, and exact completion races. |
| Performance & scalability (if applicable) | Green | One linear filter followed by existing ordering of the review subset; no new API calls, polling timers, or storage growth. |

## Top 3 Risks

1. **Cascade suppression:** `launchpad.css` hides general card pseudo-elements and overrides legacy
   backgrounds. Dedicated unread overrides now restore both; Electron checks computed rail display
   and a distinct background, with screenshots in both themes.
2. **Search race:** selecting Review during a pending search could replace its cards with stale
   matches. The view handler calls `clearTaskSearch({ render: false })`, advancing its request
   sequence. The delayed-response fixture proves the review subset survives.
3. **Acknowledgement removal:** the opened card disappears from a review-only list. `selectTask()`
   keeps its detail visible, updates summary and count, and restores keyboard focus only if the
   request still owns selection and the user has not moved focus elsewhere.

## Top Improvements

Resolved the discovered bulk-action latch by restoring `disabled = false` in `finally`. Confirmed
that an additional completion arriving through the change stream can immediately be marked
reviewed. The zero-result view retains a focusable filter and explanatory text.

## Recommendation

**Ship**

Final verification on September 5: `npm test` passed all 2,044 tests; `npm run release:check`,
`git diff --check`, and JavaScript syntax checks passed. The final Electron pass completed with
no renderer warnings or errors, and all of its processes exited. Synthetic visual evidence is
in `/tmp/relay-task-review-qa-final/`, with the verification script available to regenerate it.

## Confirmed Issues

Fixed: review tint and rail suppressed by the Launchpad cascade; Queue omitted per-card word
badges; no dedicated review view; the bulk review action stayed disabled after success; review
summary text did not immediately update after opening one task.

## Suspected Issues & Edge Cases

No unresolved issue found in this feature. A failed acknowledgement retains existing endpoint
and notification behavior. Review requests still carry the exact `finishedAt` outcome, so late
writes cannot clear a new completion. No backend ownership or scheduler logic changed here.

## Regression Risks

View buttons previously disabled during search. They now clear the search and enter the chosen
view. No view appears pressed while search supersedes it. This intentional behavior is documented
in [[task-search]]. Selecting a project changes review scope without marking its tasks reviewed.

The shared workspace had concurrent terminal, layout, and capacity edits. They were preserved;
this review assesses only the review visibility and filter changes. Full repository checks are
recorded against the working tree available at verification time.

## Performance Risks

For `n` project tasks and `r` unread completions, filtering costs O(n), followed by O(r log r)
ordering and O(r) rendering. Existing signature checks avoid replacing unchanged cards. No
additional task transcripts or search payloads are loaded for the review view.

## Test Gaps

The Electron harness uses synthetic HTTP responses rather than launching provider work. Real
SQLite semantics remain covered by `completion-review-persistence.test.mjs`. Windows and Linux
desktop rendering were not exercised; this repository is currently validated on macOS.

## Positive Improvements

The badge provides a word cue in every task view, the filter provides a counted review inbox, and
the exact project boundary and durable completion model remain intact. The verification harness
closes its own window, SSE connections, and loopback server in `finally`.

See [[task-review-visibility]], [[launchpad-completion-notifications]], and [[task-history]].
