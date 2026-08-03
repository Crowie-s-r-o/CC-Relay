---
name: Fresh Claude Session Ship Review
description: Adversarial ship review for automatic first-turn initialization of a selected Claude terminal.
type: review
---

# Fresh Claude Session Ship Review

### Executive Summary

**Ticket confidence: High**

The reported failure was reproduced against Claude Code 2.1.216. A newly launched interactive terminal was discoverable through `claude agents --json`, but `claude -p --resume <uuid>` failed because no transcript existed. A controlled live test proved that `claude -p --session-id <the same uuid>` can execute the first turn while that interactive process remains open, and that a subsequent `--resume <the same uuid>` retains the new transcript.

CC Relay now classifies only the exact missing-conversation response as this fresh-session case. Before starting the first turn it refreshes discovery and verifies the same session ID, interactive process kind, idle status, task workspace, and cancellation state. The first-turn child remains owned by the normal execution runner, streams to Task Activity, uses the requested model, effort, prompt, and attachments, and can be cancelled. It does not create a new UUID or route the task to a fresh context.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `ClaudeExecutionRunner.run()` probes `--resume`, revalidates the live terminal, then uses `--session-id` with the exact original UUID. A live Claude 2.1.216 collision test completed the first turn and a later resume. |
| Regression risk (UI / backend / contracts) | Green | Established sessions retain the old resume path. Plan council uses `ClaudeRunner` and is outside this branch. `public/app.js` renders the new initialization event as Claude activity. All 272 repository tests pass. |
| Gap risk (edge cases, error handling, completeness) | Green | Tests cover transcript creation during initialization, mismatched error and result UUIDs, terminal disappearance, workspace drift, a background-only duplicate, cancellation between attempts, same prompt delivery, stderr suppression, and the ordinary established-session path. Other stderr remains visible. |
| Code quality (maintainability as safety) | Green | Missing-conversation classification, process execution, session validation, and UI presentation remain separate. The fallback reuses the existing process runner rather than duplicating stream and cancellation logic. |
| Unit tests | Green | Twelve focused runner tests plus the renderer contract pass inside the 272-test suite. Adequate UNIT tests: Yes, because the normal path, fresh path, transcript race, UUID gates, terminal identity gates, cancellation boundary, follow-up busy behavior, and timeline presentation are deterministic. |
| Performance & scalability (if applicable) | Green | Established sessions add no work. A fresh session adds one failed resume probe and one forced registry refresh before the real first turn, all O(1) within the existing global Claude lane. |

### Change Mapping

- `src/claude-execution-runner.mjs` owns direct Claude execution. It now validates a fresh interactive session and runs the first turn with the same UUID after an exact resume failure.
- `public/app.js` owns Task Activity presentation. It recognizes `claude/session-initializing` as a Claude session event instead of generic provider activity.
- `test/claude-execution-runner.test.mjs` protects normal resume, exact same-ID initialization, prompt reuse, identity races, cancellation, and busy follow-up behavior.
- `test/composer-workflows.test.mjs` protects the timeline presentation contract for the new event.
- `wiki/project-workspaces.md`, `wiki/diagnostics.md`, `wiki/hot.md`, and `wiki/index.md` replace the old manual-priming rule, document the safety boundary, and link this review.
- `wiki/claude-fresh-session-review.md` records this adversarial validation and the remaining operational restart requirement.

The blast radius is direct Claude Execute tasks and finished-task Claude follow-ups that target a newly opened terminal. Codex execution, Plan council, Turbo, persistence schemas, authentication, permissions, and terminal close ownership are unchanged. Regression checks must cover established Claude resume, session disappearance, global Claude serialization, Task Activity events, cancellation, and queue retry classification.

### Functional Execution Trace

1. The server validates Claude authentication and resolves the selected live Claude session before enqueue.
2. The queue starts one direct Claude task in the global Claude lane and passes its persisted session ID, workspace, model, effort, prompt, and attachments to `ClaudeExecutionRunner`.
3. The runner waits for the selected session to be idle and starts the normal `--resume <session-id>` process.
4. Normal output follows the existing stream parser and completion path. No fallback work occurs.
5. If stderr contains the exact missing-conversation signature for the selected session ID, that expected line is retained for classification but not rendered as a failure warning. The same signature for any other ID fails closed.
6. The runner refreshes `claude agents --json`. A missing terminal, busy immediate follow-up, non-interactive duplicate, workspace mismatch, or cancellation stops here without starting another process.
7. CC Relay records `claude/session-initializing` and starts `claude -p --session-id <the same session-id>` with the same common arguments and task prompt.
8. If Claude reports that the same UUID is already in use, the interactive terminal created the transcript during the race window. CC Relay revalidates it, waits for idle, and resumes once instead of failing or creating duplicate work.
9. Stream events, tools, final response, errors, and cancellation use the ordinary `runProcess()` path. CC Relay accepts successful first-turn completion only when Claude reports the selected UUID, then persists it under the original task and session.
10. Any later CC Relay task uses `--resume` because the first turn created the transcript.

Null or empty task data is rejected by the existing API and continuation validators. Duplicated queue work remains serialized by the global Claude lane. Delayed session changes are caught by the forced registry refresh. Unauthorized provider execution remains blocked by the existing Claude authentication check. Unexpected provider errors remain visible and follow the existing retry policy rather than being mistaken for a fresh session.

### Regression and Edge-Case Findings

- The previous manual safeguard prevented every valid first task on a newly launched Claude terminal. That was the confirmed user-facing defect.
- The earlier Task 164 fallback was unsafe because it became an unbounded hidden process. The new child is assigned to `active.child`, emits normal activity, and is terminated by the existing cancellation path.
- A transcript can appear after the failed resume probe if the interactive terminal receives input at the same time. The exact same-UUID in-use error now returns to normal resume after another identity check.
- The native interactive Claude screen does not redraw a turn produced by the headless task process. This is also true for established direct resume execution. Task Activity is the authoritative live output, while the on-disk transcript and session UUID preserve continuity.
- A future Claude CLI that changes the missing-conversation wording will fail loudly with raw stderr instead of taking the fallback. This is fail-closed and does not risk creating a wrong session.
- No numerical calculations, migrations, cache growth, authorization changes, or N+1 paths are in scope.

### Top 3 Risks

1. The currently running CC Relay backend must restart before it can load the new runner. Retrying on the old process will reproduce the same manual-priming error.
2. Claude's native terminal does not visually replay headless task output. Users must follow Task Activity for CC Relay-driven work even though the transcript uses the same UUID.
3. The classifier depends on Claude's current missing-conversation phrase. A future wording change safely disables the fallback but would require a compatibility update.

### Top Improvements

1. After restarting CC Relay, manually retry the failed task on the still-live selected Claude terminal and confirm the `Claude session` initialization event followed by normal streamed activity.
2. If Claude later exposes a supported resumability field in `claude agents --json`, replace the failed resume probe with that explicit signal while keeping the identity gates.
3. Add a provider-neutral CLI fixture in CI if CC Relay needs end-to-end child-process coverage beyond the current deterministic spawn tests.

### Recommendation

Ship after a normal CC Relay restart. The implementation is safe for the reported case, preserves the selected session identity, and fails closed for every tested race. No commit was created.

See [[project-workspaces]], [[diagnostics]], and [[task-history]].

#relay #claude #session #review #ship
