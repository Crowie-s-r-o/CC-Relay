---
name: Task Naming
description: Optional task names, all-status inline rename, and queued request editing.
type: architecture
tags:
  - relay
  - queue
  - tasks
  - naming
---

# Task Naming

Tasks may receive an optional operator-written name in the composer. The existing `tasks.title`
column is the canonical name, so this feature requires no schema migration and historical tasks
remain compatible. A blank name falls back to the compact title derived from the request.

## Contract

- `POST /api/tasks` accepts optional `title`. Names collapse whitespace, are limited to 120
  characters, and fall back to the existing 80-character prompt title when blank or omitted.
- The task name is part of the [[duplicate-submission-review|submission intent]]. Reusing one
  submission UUID with a different name fails closed instead of returning a task with the wrong
  name.
- Task cards show the canonical name above the request. The global running-task rail and Task
  Activity header use the same name.
- Composer drafts store `taskName` per Launchpad project alongside the prompt and images. A
  successful submission clears both name and prompt.
- `/api/status` advertises `capabilities.queuedTaskNaming`. Refreshed static assets do not send a
  name to an older backend that would silently ignore it.

## Quick title rename

Every ordinary task card exposes a pencil beside its title when
`capabilities.taskTitleRenaming` is available. It opens a single-line editor in place; Enter or
the check action saves and Escape or the cancel action restores the current name. The focused
input survives the normal two-second task snapshot refresh, and its draft is retained if focus
moves to another card control.

`PATCH /api/tasks/:id/title` applies the shared whitespace normalization, 120-character limit,
and blank-name fallback for queued, running, open, complete, failed, interrupted, and cancelled
tasks. `TaskQueue.rename()` preserves the prompt, task identity, scheduler position, conversation,
status, outcomes, and attachments. `ArtifactStore.updateTaskTitle()` changes only the canonical
`task.md` heading, using a replacement callback so `$` sequences in an operator-written title are
stored literally.

Planner breakdown names remain linked to their proposals and cannot be renamed independently.
Turbo work already under forward preparation remains protected until preparation finishes.

See [[task-starring]] for the adjacent persistent star and display ordering contract.

## Queued rename

The existing queued task editor still puts the name field first and owns request, provider, model,
and effort changes.
`PATCH /api/tasks/:id` accepts a title-only body, preserves the current prompt, and delegates to the same
`TaskQueue.edit()` and `RelayDatabase.updateQueuedTask()` status guard as request editing. The task
ID, queue position, provider, model, effort, terminal assignment, workflow settings, and images do
not change.

Clearing the editor name regenerates it from the current request. Older clients that send a prompt
without `title` retain their historical behavior and regenerate the title from the edited prompt.
A title-only patch preserves the prompt and rewrites the canonical `task.md` heading. The queue
event records an explicit old-name to new-name rename.

> [!important]
> Never implement rename as delete plus enqueue. A rename must preserve task identity, queue
> ordering, artifacts, submission history, and workflow ownership. See [[task-history]].

## Queue helper

The bundled queue helper accepts `add --name "Short task name"` and `rename <task-id> --name "New
task name"`. Its add command now also supplies the required submission UUID. The plugin skill
documents that rename is queued-only.

## Files and verification

- `src/task-title.mjs`, `src/server.mjs`, `src/queue.mjs`
- `public/index.html`, `public/app.js`, `public/style.css`
- `public/project-composer-state.js`, `public/submission-intent.js`
- `plugin/relay-queue/scripts/relayctl.mjs`
- `test/task-title.test.mjs`, `test/task-organization.test.mjs`,
  `test/relay-queue-plugin.test.mjs`, plus focused queue, composer, submission-intent,
  project-state, detail, and escaping coverage

See [[task-history]], [[interface-layout]], and [[duplicate-submission-review]].

#relay #queue #tasks #naming
