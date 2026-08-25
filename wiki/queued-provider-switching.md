---
name: Queued Provider Switching
description: Contract for changing a waiting automatic Execute task among Claude, Codex, and OpenCode.
type: decision
tags:
  - relay
  - queue
  - providers
---

# Queued Provider Switching

Waiting direct Execute tasks assigned to the [[disposable-terminal-pools|automatic terminal pool]] can change among Claude, Codex, and OpenCode from the existing **Edit queued task** dialog. The editor also exposes the destination provider's model and effort settings. Prompt-only edits continue to preserve the task's existing execution settings.

> [!important]
> Provider switching is available only while the task is `queued`, has `mode: execute`, and uses `terminal_lifecycle: disposable`. Legacy persistent tasks remain pinned to their provider-specific live terminal. Plan council, Turbo, and Planner breakdown tasks retain their workflow-owned provider configuration.

## Conversation boundary

Changing the provider starts a fresh conversation. The queue atomically clears `thread_id`, `thread_name`, `thread_source`, `session_id`, and `continued_from_task_id` when `provider` changes. This prevents any provider's conversation ID from reaching another provider and releases any saved-conversation reservation held by the waiting task.

The switch preserves:

- Task ID and queue position
- Project path
- Prompt and title
- Reference images
- Terminal launch layout

Changing only model or effort for the same provider preserves the saved conversation identity.

## API and compatibility

`PATCH /api/tasks/:id` still accepts `{ prompt }` for older prompt-only editing. A current client may also send `{ prompt, provider, model, effort }`. The server validates model and effort against the selected provider catalog and checks Claude or OpenCode readiness before accepting that destination.

`capabilities.queuedTaskProviderSwitch` gates the new execution controls. A current renderer connected to an older backend keeps prompt editing but hides provider, model, and effort controls.

> [!note]
> The final queued-state check remains inside `TaskQueue.edit()` after any asynchronous Codex model lookup. If the scheduler starts the task while the request is being validated, the edit is rejected instead of changing a running task.

## Implementation

- `src/database.mjs`: queued-only atomic updates now cover execution and conversation fields.
- `src/queue.mjs`: enforces eligibility, clears cross-provider conversation state, refreshes artifacts, records the switch, and reschedules.
- `src/server.mjs`: validates provider-specific settings and advertises the capability.
- `public/index.html`, `public/app.js`, `public/style.css`: add capability-gated provider, model, and effort controls to the task editor.
- `test/database.test.mjs`, `test/queue.test.mjs`, `test/composer-workflows.test.mjs`: cover queued-only persistence, both switch directions, conversation clearing, legacy rejection, artifacts, and renderer contracts.

## Verification

> [!note]
> Reverified on 2026-07-28 against the current worktree. The focused database, queue, and composer workflow suite passed 104 tests, and the complete `npm test` suite passed all 771 tests. Both Claude to Codex and Codex to Claude switching remain covered.

See also [[task-history]], [[project-workspaces]], and [[interface-layout]].

#relay #queue #claude #codex #opencode
