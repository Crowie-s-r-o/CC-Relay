---
name: Parallel Claude Review
description: Shipping review for per-session Claude execution and idle Relay routing.
---

# Parallel Claude Review

## Executive Summary

Confidence: **High**. Direct Claude execution now uses per-task and per-session ownership instead of one global lock. The queue reserves each Claude `thread_id`, runs different session IDs concurrently, keeps one session sequential, and routes the idle Relay preference within the selected provider. The backend capability gate prevents a refreshed UI from claiming support before Relay is restarted.

The cross-project contract is explicit: any number of Claude terminals opened in different pinned projects use different UUIDs and may run together. Relay contains no project-count concurrency setting or fixed Claude session cap. A July 21, 2026 regression test generates twelve distinct project working directories, while the queue integration test overlaps Codex and Claude across all twelve. Twelve is test coverage, not a maximum. An older backend missing `parallelClaudeExecution` produces a targeted restart warning when it blocks this case.

No blocking defect was found in the reviewed execution, cancellation, follow-up, shutdown, or routing paths.

## Quality Panel

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Scheduler tests prove overlap across two Claude sessions and sequential execution on one session. |
| Cancellation safety | Green | Runner tests cancel one task ID without terminating the other Claude child process. |
| Routing isolation | Green | Routing tests keep Claude selection inside Claude sessions, the current workspace, and unassigned idle targets. |
| Backward compatibility | Green | Claude idle routing requires `capabilities.parallelClaudeExecution`; Codex routing remains available on older backends. |
| Reliability | Green | Queue reservations remain authoritative even if discovery briefly reports a session as idle. |
| Maintainability | Green | Codex and Claude direct tasks share the same session reservation path, while provider-specific runners remain separate. |

## Top 3 Risks

1. Two agents working in the same repository can edit the same files concurrently. Relay guarantees session isolation, not source-level merge isolation. Users should assign independent tasks when running sessions together.
2. Claude Code or account-level limits can still throttle simultaneous CLI work. Such failures remain task-specific and do not require Relay to restore a global lock.
3. Manual typing in an interactive Claude terminal can race with Relay after the last discovery refresh. The selected session is checked before dispatch, and Claude's session-in-use error remains the final guard.

## Top Improvements

1. Add an optional user-facing concurrency setting if account throttling becomes common.
2. Show the final routed Claude session more prominently in the enqueue confirmation when idle routing changes the destination.
3. Add a packaged-app smoke test that launches two real Claude terminals and confirms simultaneous Task Activity streams without spending a full task run.

## Verified Invariants

- Different Claude session IDs may run at the same time.
- Different Claude session IDs in different project paths may run at the same time.
- Codex and Claude direct tasks may overlap across any number of projects and distinct sessions.
- One Claude session ID owns at most one active Relay task.
- A queued or running direct task makes its session unavailable to idle routing.
- Cancelling one Claude task does not cancel another session.
- A same-session follow-up remains immediate and unqueued, and a follow-up on a different Claude session can run beside active Claude work.
- Relay shutdown addresses every active task by ID.

#review #claude #queue #routing
