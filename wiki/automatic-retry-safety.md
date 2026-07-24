---
name: Automatic Retry Safety
description: Bounded transient retries and terminal-session failure classification for direct and Turbo tasks.
type: incident
---

# Automatic Retry Safety

Automatic retry is reserved for transient execution failures and is bounded to three retries per automatic chain. Direct Execute and Forward-planning Turbo preparation share this guard. When the limit is reached, the task remains failed and Task Activity tells the user to fix the cause before retrying manually. A manual retry starts a new bounded chain.

Terminal identity failures are not transient. `CodexAppServerError` carries an explicit `retryable` property, and both a missing task thread ID and a selected Codex terminal that is no longer connected set it to `false`. The queue records one failed outcome and waits for manual reassignment or reconnection instead of repeating the same impossible dispatch.

> [!important]
> Keep the queue-level retry cap even when individual runner classifications are correct. It is the final protection against a new permanent provider error being accidentally treated as transient.

## Task 216 incident

On July 21, 2026, Task 216 remained assigned to disconnected Codex thread `019f84ea-2e48-7673-95f3-340a60faa5b2`. `CodexAppServer.run()` detected the missing terminal immediately, but `CodexAppServerError` had no retry classification. `TaskQueue.executeTask()` therefore treated the error as retryable and repeated it every five seconds.

The database recorded 1,279 automatic retries from `2026-07-21T13:44:56.500Z` through `2026-07-21T15:34:31.070Z`. The live loop was stopped by pausing only the affected project, allowing the scheduled retry to return to queued state, cancelling Task 216, and immediately resuming that project. No other task was cancelled.

Regression coverage proves:

- A disconnected selected Codex terminal returns `retryable = false`.
- A persistent generic failure stops after the configured automatic retry limit.
- Existing one-time transient recovery still succeeds.
- Non-retryable session failures and Plan council failures still wait for manual action.

See [[diagnostics]], [[task-history]], [[project-workspaces]], and [[plan-council]].

#relay #retry #incident #scheduler #safety
