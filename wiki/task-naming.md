---
name: Task Naming
description: Optional task names at submission and atomic renaming while work is still queued.
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

## Queued rename

Queued cards expose **Rename**, and the existing task editor puts the name field first.
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

> [!note]
> Turbo work already under forward preparation remains protected by the existing preparation
> guard. The visible Rename button disables while that preparation is active.

## Queue helper

The bundled queue helper accepts `add --name "Short task name"` and `rename <task-id> --name "New
task name"`. Its add command now also supplies the required submission UUID. The plugin skill
documents that rename is queued-only.

## Files and verification

- `src/task-title.mjs`, `src/server.mjs`, `src/queue.mjs`
- `public/index.html`, `public/app.js`, `public/style.css`
- `public/project-composer-state.js`, `public/submission-intent.js`
- `plugin/relay-queue/scripts/relayctl.mjs`
- `test/task-title.test.mjs`, `test/relay-queue-plugin.test.mjs`, plus focused queue, composer,
  submission-intent, project-state, detail, and escaping coverage

See [[task-history]], [[interface-layout]], and [[duplicate-submission-review]].

#relay #queue #tasks #naming
