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

Token telemetry keeps a separate run boundary even though the task and conversation IDs remain the
same. Every `beginTask()` records `relay/task-attempt-started`, and later native usage snapshots carry
its exact `attemptStartedAt`. This prevents input, output, and output-rate values from leaking across
follow-ups, especially for manual terminal sessions whose lifecycle `started_at` intentionally
remains the first workspace start. See [[token-throughput-correction]].

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

The finished-turn `relay-follow-up-*` event is also the renderer fallback for a provider that does not echo user input. When Codex later reports a matching user-message item, [[terminal-conversation-filters]] suppresses that provisional receipt and keeps the one provider-delivered message, including its Relay notice. Persistence remains unchanged.

`GET /api/tasks/:id` exposes that list as `prompts` separately from `events`. The terminal console remains capped at its latest 500 raw events, while prompt history is complete. `public/task-prompt-history.js` normalizes older-backend responses, formats the ordered Prompts disclosure, and supplies its count and latest-prompt preview. The disclosure opens automatically after the first follow-up.

## UI identity

`submitTaskContinuation()` accepts only `steered` or `followUpStarted`. It has no `continuationQueued` branch and never assigns `state.selectedTaskId` from the response. Its post-write refresh is forced fresh so it cannot join an older in-flight snapshot. Task Activity therefore stays on the source task while its status changes from a historical outcome to running and its new prompt appears immediately.

### Pending submission feedback

A standard follow-up locks before its request begins and stays visibly locked until the exact request settles. `renderTaskContinuation()` sets `data-submitting` and `aria-busy` on the continuation form, disables the textarea, image controls, and submit button, changes the button to **Sending...**, and replaces the normal hint with an explicit confirmation-wait message. The disabled button retains enough contrast to remain readable and carries a progress ring whose rotation is enabled only when reduced motion is not requested. Every settled outcome clears the latch before it is rendered, so the same controls become available again without waiting for the next task refresh.

> [!note]
> The reliable Claude live-update outbox remains the intentional exception. It captures and clears each update immediately, reports the task-scoped pending count, and keeps the composer available so another ordered update can be written while earlier delivery settles. See [[claude-live-steer-outbox]].

For a running interactive Claude task advertising `claudeSteerOutbox`, submission does not take the global continuation lock. Each update and its attachments are captured immediately, the visible composer is released for the next message, and the active watcher serializes terminal delivery. A definite failure is restored only when doing so cannot overwrite newer task-scoped text. See [[claude-live-steer-outbox]].

For a running Codex task with an active `/goal`, one Relay run can span several automatic app-server turns. Relay keeps the task `running` after an intermediate `turn/completed`, adopts the successor `turn/started`, and keeps the continuation composer in live-update mode. A submission inside the brief turn boundary waits for that successor and calls `turn/steer` with its exact `expectedTurnId`. It never falls through to finished-task resume or the queue. See [[provider-plan-and-goal-visibility]] and [[manual-terminal-session-mode]].

## Files

- `src/queue.mjs`
- `src/server.mjs`
- `src/database.mjs`
- `src/codex-app-server.mjs`
- `public/app.js`
- `public/index.html`
- `public/task-continuation-state.js`
- `public/task-prompt-history.js`
- `test/queue.test.mjs`
- `test/database.test.mjs`
- `test/composer-workflows.test.mjs`
- `test/task-continuation-state.test.mjs`
- `test/task-prompt-history.test.mjs`
- `test/codex-app-server.test.mjs`

## Regression coverage

- Closed disposable resume keeps task count and source ID unchanged.
- A follow-up clears cached prior-turn token usage before its first new provider snapshot.
- Retained sessions calculate token rate from the current attempt without replacing session lifetime.
- The pool receives the saved conversation ID.
- The runner receives the follow-up prompt rather than the persisted original prompt.
- Full capacity rejects before task state, events, or attachments change.
- Prompt history remains complete after more than 500 console events.
- Paired steering events produce one prompt-history entry.
- Active Codex goals remain one running task across automatic turns, accept steering during the handoff, and ignore stale completion from the prior turn.
- Standard sends expose a native busy state, disable repeat submission, and keep an explicit **Sending...** indicator visible until the request settles.
- Renderer source contracts forbid `queue.enqueue()`, `continuationQueued`, and task-selection replacement in the continuation path.

See [[task-history]], [[disposable-terminal-pools]], [[retained-terminal-sessions]], [[continuation-input-review]], and [[project-workspaces]].

#relay #continuation #session #task-history #prompt-history
