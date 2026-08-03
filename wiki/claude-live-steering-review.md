---
name: Claude Live Steering Ship Review
description: Exact-terminal delivery and adversarial review for messages sent while Claude is working.
type: review
---

# Claude Live Steering Ship Review

### Executive Summary

**Ticket confidence: High**

A running direct Claude task can now accept a message from the existing **Continue session** dock. The message stays in the same task and conversation, is delivered only to the exact active interactive terminal turn, and never falls back to queue creation or a headless second execution.

The terminal path fails closed before typing unless CC Relay proves the task, session, workspace, window, tty, process, busy state, visible composer, and empty native draft. After typing, only the exact `UserPromptSubmit` hook or exact transcript prompt record confirms delivery. An ambiguous Apple Event is never retried automatically.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | The renderer selects `/api/tasks/:id/steer`, the server delegates through the exact active task record, and the terminal executor queues the message in the owned Claude composer. Exact hook or transcript evidence produces one `relay-steer-*` user event in the existing task. |
| Regression risk (UI / backend / contracts) | Green | `claudeTaskSteering` gates the renderer, older backends remain disabled, no queue fallback exists, running Codex behavior is unchanged, and a transient session-list miss no longer hides a server-verifiable active turn. |
| Gap risk (edge cases, error handling, completeness) | Amber | The singleton server has no isolated HTTP route test, and the live owned terminal was not mutated while another user Claude task was active. A restarted idle-session smoke test is still required. |
| Code quality (maintainability as safety) | Green | Delivery is centralized in `ClaudeExecutionRunner.steer()` and `ClaudeTerminalExecutor.deliverActiveSteer()`. Concurrent updates are serialized, terminal checks are explicit, and delivery uncertainty is a first-class error property. |
| Unit tests | Green | The 218 focused continuation, runner, terminal, and renderer contract tests pass. New cases cover transcript confirmation, one guarded submit, native draft protection, stale prompt hooks and transcript boundaries, uncertain turn closure, post-delivery history failure, headless rejection, and a transient discovery miss. |
| Performance & scalability (if applicable) | Green | Live updates share the existing watcher and transcript reader. Requests are serialized per active turn and confirmation is bounded to 25 seconds, with no new polling service or queue record. |

### Top 3 Risks

1. Terminal Apple Events can time out after Terminal.app accepted them. The API must preserve `deliveryUncertain`, keep possibly referenced images, and tell the user to inspect Task Activity before any resend.
2. `src/server.mjs` is still a process singleton, so route behavior is source-contract tested rather than exercised through an isolated HTTP server.
3. Claude Code can change its composer frame, prompt hook payload, or transcript representation. The visible-screen classifier and exact transcript fallback reduce this risk, but a smoke test is needed after Claude upgrades.

### Top Improvements

- Export an isolated server factory and test successful, definite-failure, and uncertain `/steer` attachment transactions through HTTP.
- After a safe CC Relay restart, run an idle disposable Claude smoke test for text, an image, a deliberately held paste, and a completion-boundary update.
- Add diagnostics aggregation for `task.claude.steer.completed`, evidence type, guarded submit use, definite rejection, and uncertain delivery.

### Recommendation

**Ship after CC Relay restarts safely**

## Execution trace

1. `continuationPresentation()` enables **Update turn** only when `capabilities.claudeTaskSteering` is true.
2. `continuationSubmission()` selects `POST /api/tasks/:id/steer`. It never selects a task-creation route.
3. The server validates a running direct Claude task and stages only the new image attachments.
4. `ClaudeExecutionRunner.steer()` resolves only `activeByTask.get(taskId)` and rejects preparing or headless work.
5. `deliverActiveSteer()` re-proves the exact interactive session and terminal identity, requires Claude to be busy, reads the current viewport, and requires an empty composer.
6. CC Relay bracket-pastes the decorated message. If exact evidence does not arrive within six seconds, it sends one separate Return only when the same terminal is still busy and visibly holds that exact paste.
7. The active watcher accepts only an exact prompt hook or transcript record, advances the current prompt identifier, clears any earlier final boundary, and emits one Claude `userMessage` event.
8. The server commits staged images after confirmed delivery. A definite rejection discards them. An uncertain post-injection result retains them because Claude may already have received their paths and records a `claude/steer-uncertain` warning in Task Activity.

## Safety invariants

> [!important]
> A live Claude update is never converted into queued work, never starts another process, and is never retried after ambiguous terminal delivery.

- A native composer draft is never cleared, overwritten, or submitted by live steering.
- A late `Stop` hook from the earlier prompt cannot complete the newer prompt.
- Pending updates prevent normal idle finalization and are serialized in request order.
- A turn that closes before injection reports that nothing was queued.
- A turn that closes after injection reports uncertain delivery.
- A local history or attachment-documentation failure after exact acceptance cannot convert confirmed delivery into a failed response that invites a duplicate resend.
- A running task remains steerable during a transient renderer session-list miss because the server performs the authoritative identity checks.
- Headless Claude work rejects live steering clearly.

## Verification

- `test/claude-terminal-executor.test.mjs`
- `test/claude-execution-runner.test.mjs`
- `test/task-continuation-state.test.mjs`
- `test/composer-workflows.test.mjs`
- Syntax checks for all changed JavaScript modules
- `git diff --check`

All 890 repository tests outside `test/dark-mode.test.mjs` pass. At review time, the full repository run had one unrelated failure in that file while task 397 was actively changing the dark theme. The live steering subset is fully green and does not touch that test or its stylesheet contract.

## Updated decision

The earlier [[continuation-input-review]] conclusion that running Claude lacked a safe steering protocol is obsolete for a direct task already owned by the interactive terminal executor. Claude Code 2.1.220 accepts queued composer messages while working, and CC Relay now wraps that capability in stricter identity, screen, evidence, and no-retry guards. Headless Claude turns still have no live steering path.

See [[same-task-session-continuation]], [[claude-terminal-input]], [[claude-terminal-live-output]], [[claude-terminal-submit-review]], and [[task-history]].

#relay #review #claude #continuation #steering #terminal #no-queue
