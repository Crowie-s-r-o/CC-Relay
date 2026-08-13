---
name: Same Task Session Continuation
description: Same-row conversation resume and durable prompt-history contract for direct task follow-ups.
type: architecture
tags:
  - relay
  - continuation
  - session
  - task-history
  - prompt-history
---

# Same Task Session Continuation

Direct task continuation preserves one task as one conversation. `POST /api/tasks/:id/follow-up` always returns the source task ID. It never calls `TaskQueue.enqueue()`, creates `continued_from_task_id` lineage, changes queue position, or tells the renderer to select another task.

## Finished task flow

1. The route revalidates the direct provider, source status, provider readiness, saved conversation ID, model, effort, and workspace.
2. A live idle retained or legacy session uses `TaskQueue.startFollowUp()` immediately.
3. A closed disposable session builds the same runtime follow-up and calls `TaskQueue.startFollowUp(..., { resumeDisposable: true })`.
4. The queue synchronously checks active task ownership, saved conversation reservations, and `DisposableTerminalPool.canRun()` before storing attachments or changing state.
5. When capacity is free, the source row becomes `running`. `DisposableTerminalPool.prepare()` launches a new native terminal with the source `thread_id` as its resume ID.
6. The prepared database task is merged with the runtime follow-up prompt and only the new attachments before the provider runner starts. This merge is required because pool preparation returns the persisted task, whose canonical `prompt` remains the original request.
7. Outcome, events, terminal cleanup or retention, and cancellation stay under the source task ID.

> [!important]
> A full provider pool rejects immediately with the finished task unchanged. Continuation is not delayed queue work, and configured instance limits are never bypassed.

> [!important]
> A resume launch still receives a fresh native launch ID. Only the provider conversation ID and CC Relay task ID are reused. Exact binding, cleanup, retention, and non-retryable resumed-session failure rules from [[codex-disposable-resume-review]] remain intact.

## Prompt history

The task row keeps its original `prompt` unchanged. Every accepted finished-turn follow-up records a CC Relay-marked `userMessage` event. Running Codex and interactive Claude steering carry a `relay-steer-*` client marker.

`RelayDatabase.listTaskPrompts()` scans all stored payload events for those markers, deduplicates paired provider item events, and returns:

- the canonical original request;
- every finished-turn follow-up;
- every running-turn steering prompt.

`GET /api/tasks/:id` exposes that list as `prompts` separately from `events`. The terminal console remains capped at its latest 500 raw events, while prompt history is complete. `public/task-prompt-history.js` normalizes older-backend responses, formats the ordered Prompts disclosure, and supplies its count and latest-prompt preview. The disclosure opens automatically after the first follow-up.

## UI identity

`submitTaskContinuation()` accepts only `steered` or `followUpStarted`. It has no `continuationQueued` branch and never assigns `state.selectedTaskId` from the response. Its post-write refresh is forced fresh so it cannot join an older in-flight snapshot. Task Activity therefore stays on the source task while its status changes from a historical outcome to running and its new prompt appears immediately.

For a running interactive Claude task advertising `claudeSteerOutbox`, submission does not take the global continuation lock. Each update and its attachments are captured immediately, the visible composer is released for the next message, and the active watcher serializes terminal delivery. A definite failure is restored only when doing so cannot overwrite newer task-scoped text. See [[claude-live-steer-outbox]].

## Files

- `src/queue.mjs`
- `src/server.mjs`
- `src/database.mjs`
- `public/app.js`
- `public/index.html`
- `public/task-continuation-state.js`
- `public/task-prompt-history.js`
- `test/queue.test.mjs`
- `test/database.test.mjs`
- `test/composer-workflows.test.mjs`
- `test/task-continuation-state.test.mjs`
- `test/task-prompt-history.test.mjs`

## Regression coverage

- Closed disposable resume keeps task count and source ID unchanged.
- The pool receives the saved conversation ID.
- The runner receives the follow-up prompt rather than the persisted original prompt.
- Full capacity rejects before task state, events, or attachments change.
- Prompt history remains complete after more than 500 console events.
- Paired steering events produce one prompt-history entry.
- Renderer source contracts forbid `queue.enqueue()`, `continuationQueued`, and task-selection replacement in the continuation path.

See [[task-history]], [[disposable-terminal-pools]], [[retained-terminal-sessions]], [[continuation-input-review]], and [[project-workspaces]].

#relay #continuation #session #task-history #prompt-history
