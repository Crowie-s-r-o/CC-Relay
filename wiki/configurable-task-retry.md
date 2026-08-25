---
name: Configurable Task Retry
description: Manual direct-task retry can select Codex, Claude, or OpenCode, model, and effort without replacing the task.
type: decision
tags:
  - relay
  - retry
  - codex
  - claude
  - opencode
  - task-activity
---

# Configurable Task Retry

Failed, cancelled, and interrupted automatic Execute tasks expose execution settings before they return to the queue. The shared task editor enters a dedicated retry mode with **Executor**, **Model**, and **Effort**, while the task name and request remain fixed.

> [!important]
> This applies only to direct `mode: execute` tasks using the disposable terminal pool. Plan council, Turbo, breakdown, legacy persistent, session-follow-up, and automatic retry paths keep their existing workflow-owned routing.

## Conversation boundary

Keeping the same provider preserves `thread_id` so the retry resumes the saved conversation when it exists. A model or effort change applies to the resumed turn. Switching among Codex, Claude, and OpenCode clears `thread_id`, `thread_name`, `thread_source`, `session_id`, and `continued_from_task_id`, then launches a fresh conversation for the selected provider.

The task ID, title, prompt, reference images, project, queue history, and terminal layout stay unchanged. The canonical `task.md` artifact is rewritten with the selected provider, model, and effort before the task is scheduled.

## API and state guard

`POST /api/tasks/:id/retry` accepts optional `{ provider, model, effort }`. The server validates provider readiness and the provider-specific model catalog before calling `TaskQueue.retry()`. `RelayDatabase.updateRetryableTask()` performs the execution change and transition to `queued` in one status-guarded write that accepts only `failed`, `cancelled`, or `interrupted` rows.

Changing providers also bypasses conflicts and close reservations belonging only to the abandoned provider conversation. Reusing a retained terminal is allowed only when the provider stays the same.

`capabilities.retryTaskExecutionSettings` protects a current renderer from sending settings to an older backend. Missing capability retains the original immediate retry behavior.

## Verification

Focused database, queue, copy, composer, and API-contract tests pass. The complete repository suite passes 1,115 tests.

See [[task-history]], [[queued-provider-switching]], [[disposable-retry-conversation-initialization]], [[automatic-retry-safety]], and [[interface-layout]].

#relay #retry #task-activity #codex #claude #opencode
