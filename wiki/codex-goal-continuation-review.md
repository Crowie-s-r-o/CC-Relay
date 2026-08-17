---
name: Codex Goal Continuation Review
description: Adversarial ship review of automatic Codex goal turn handoff and live steering in terminal session mode.
type: review
tags:
  - relay
  - codex
  - goal
  - terminal
  - continuation
  - review
---

# Codex Goal Continuation Review

## Executive Summary

**Ticket confidence: High**

The change is safe to ship. Relay now treats `turn/completed` as a provider-turn boundary while a persisted Codex goal remains active, keeps the queue task running, retains its app-server subscription, adopts the exact automatic successor, and keeps live steering available. The review found four concrete race defects during implementation and each is now fixed with focused regression coverage. No unresolved confirmed issue remains.

## Change Mapping

| File | Responsibility and change | Downstream contract |
|---|---|---|
| `src/codex-app-server.mjs` | Owns app-server requests, notifications, active-turn state, completion, cancellation, and steering. It now carries one Relay run across automatic goal turns, reconciles missed events through `thread/read`, loads persisted goal state, and freezes steer acknowledgements to the accepted turn id. | `RelayRunner.run()` stays pending, so `TaskQueue.executeTask()` keeps the task `running`; the server's running-task steer route remains available; final subscription release and queue outcome happen once. |
| `public/app.js` | Presents app-server lifecycle events. It now says **Turn started** and **Turn finished** instead of claiming that the session finished. | Task Activity wording matches the thread-versus-turn protocol boundary. |
| `test/codex-app-server.test.mjs` | Pins successor adoption, reconciliation, goal hydration, stale-read protection, exact steering, cancellation, recovered final response, and settlement behavior. | Protects the backend, queue promise, API steering, and UI availability contract. |
| `test/terminal-markdown.test.mjs` | Pins the Task Activity boundary labels. | Prevents the original false-session wording from returning. |
| Wiki pages | Record the durable lifecycle and review evidence. | Keeps operator and future implementation guidance aligned with executable behavior. |

The blast radius includes Codex direct Execute tasks, manual terminal sessions, running-task steering, queue status transitions, task events, final result selection, cancellation, app-server subscription lifetime, and Task Activity protocol labels. No database schema, environment variable, authentication rule, permission boundary, or API response shape changed.

## Quality Panel (RAG)

| Area | Rating | Evidence |
|---|---|---|
| Functional correctness | Green | `finishActiveTurn`, `waitForGoalContinuation`, `adoptGoalContinuation`, and `reconcileGoalContinuation` preserve one active record until explicit thread settlement. The Task 781 trace proves the original 67 millisecond failure boundary. |
| Regression risk (UI / backend / contracts) | Green | Non-goal turns keep their ordinary finalization path. The queue and server need no contract change because the existing runner promise now resolves at the correct boundary. Task Activity changed only its inaccurate label. |
| Gap risk (edge cases, error handling, completeness) | Green | Missed start notifications, failed reads, unknown status, stale completions, cancellation in the handoff, recovered final output, persisted goals, stale goal reads, and fast steer acknowledgements are covered. |
| Code quality (maintainability as safety) | Green | Goal-continuation state is explicit on the active record, exact turn ids guard every completion and poll, diagnostics name waiting, started, ambiguous, settled, and unavailable-read states, and timer cleanup follows every terminal path. |
| Unit tests | Green | The dedicated app-server suite passes 52 tests. The complete repository suite passes 1,572 tests with no failure, cancellation, or skip. |
| Performance & scalability (if applicable) | Green | Normal runs add one bounded `thread/goal/get` request. Reconciliation reads are limited to the short active-goal boundary and are sequential, not overlapping. No database query or renderer hot loop changed. |

## Top 3 Risks

1. **Ambiguous provider state could falsely finish a live goal.** `reconcileGoalContinuation()` now finalizes successfully only for explicit `idle` or `notLoaded`; `active`, unknown state, and read failure retry. `systemError` fails the run.
2. **A stale turn could close or misreport its successor.** Polling is generation-bound to a frozen turn id, `finishActiveTurn()` requires exact identity, and `steer()` compares the response with its frozen accepted id rather than mutable active state.
3. **Persisted or racing goal state could be missed.** `loadCurrentGoal()` hydrates the current goal before `turn/start`, while `goalRevision` prevents its response from overwriting a newer notification or clear.

## Top Improvements

- Add a future protocol integration fixture that runs a real disposable Codex goal through at least two automatic turns. The deterministic unit coverage is adequate now, but a provider-level fixture would detect upstream protocol drift.
- Consider consuming `thread/status/changed` as an additional wake-up signal if app-server exposes a stable ordering guarantee. The current bounded polling is correct and simpler, but the notification could shorten rare recovery latency.
- Rebuild and launch the desktop bundle after active user work ends, then repeat the exact Task 781 operator flow and capture the running composer through the successor boundary.

## Recommendation

**Ship**

## Confirmed Issues

No unresolved confirmed issues remain.

The adversarial pass confirmed and fixed these implementation defects before this review was closed:

- cancellation inside the no-turn handoff could have resolved the completed prior turn as success;
- a fast handoff could make an accepted steer response look mismatched by comparing it with mutable state;
- reconciliation of a missed completed successor could return stale response text from the prior turn;
- a delayed persisted-goal read could overwrite a newer goal notification.

## Suspected Issues & Edge Cases

- An older app-server that lacks `thread/goal/get` falls back to live goal notifications and records a diagnostic. Current Codex documents and implements the read method, so this is a mixed-version compatibility caveat rather than a current defect.
- The installed desktop bundle was already running older packaged code and was not restarted during active terminal work. Source and protocol behavior are verified, but that old process cannot demonstrate the fix until rebuild and relaunch.

## Regression Risks

- Ordinary completed turns now perform one goal-state read before starting. Failure is swallowed into diagnostics and does not block execution.
- A thread whose goal remains active but launches no successor waits for the one-second grace and then settles from explicit thread status. The visible cost is a short completion delay, not a state error.
- Intermediate `turn/completed` events remain in Task Activity as provider evidence, but they no longer resolve the queue task. Consumers that correctly distinguish task status from event type continue unchanged.
- **Session finished** changed to **Turn finished** for app-server protocol events. Any assertion or operator procedure relying on the inaccurate wording must use the new factual label.

## Performance Risks

`successorTurns()` is linear in the turns returned by one thread read. Reconciliation performs one request at a time after a one-second grace, then at 250 millisecond intervals only while app-server reports an active thread without exposing its turn. Expected automatic handoffs are tens of milliseconds, so the notification path avoids reads entirely. Worst-case repeated reads require a provider state that remains internally active but publishes neither a turn nor settlement; disconnect cleanup still rejects the run and clears the timer.

## Test Gaps

**Are there adequate UNIT tests? Yes.** They cover normal handoff, exact steering, out-of-order and duplicate completion, missed notifications, read failure, unknown status, explicit idle settlement, system cancellation behavior, stale recovered output, persisted goals, goal-read races, and UI wording.

The remaining gap is live desktop and real-provider integration after packaging. It is not a unit-test gap and does not weaken the deterministic lifecycle proof.

## Positive Improvements

- Relay task lifetime now matches Codex thread and goal lifetime instead of one model turn.
- The continuation composer stays useful during the exact state in which the terminal is still doing work.
- A message submitted inside the handoff targets the actual successor via exact `expectedTurnId` and is never queued elsewhere.
- Failed or ambiguous state reads fail safe by keeping work live.
- Final response, cancellation, diagnostics, timer cleanup, and subscription release now follow the whole automatic chain.
- Operator wording distinguishes a finished turn from a finished session.

See [[provider-plan-and-goal-visibility]], [[manual-terminal-session-mode]], and [[same-task-session-continuation]].

#relay #codex #goal #terminal #continuation #review
