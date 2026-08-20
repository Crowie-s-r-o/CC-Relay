---
name: Task Starring
description: Persistent starred task organization and its separation from scheduler priority.
type: architecture
tags:
  - relay
  - tasks
  - queue
  - ui
  - persistence
---

# Task Starring

Every ordinary task card exposes a capability-gated star beside its title. The state is persisted
as `tasks.starred`, normalized to a boolean in API records, and defaults to false for both new and
upgraded databases. `PATCH /api/tasks/:id/star` accepts an exact boolean and
`capabilities.taskStarring` keeps refreshed renderer assets from calling an older backend.

Starred tasks form one stable group above unstarred tasks in Queue, History, task search, and the
global active-task monitor. Existing order remains intact inside both groups:

- Queue keeps its running, Ready for review, open-session, queued-position, and recency order.
- History keeps descending creation order inside each group.
- Search keeps server relevance order inside each group.
- The active-task monitor keeps its existing rail order inside each group.

The Queue, History, and search surfaces use one visible **Starred** divider. The amber star and
divider are the only new warm signal. They do not repaint project selection, completion review,
task status, or retained-session cues, and both light and dark themes define explicit surfaces.

> [!important]
> A star is presentation organization, not execution priority. It never changes `position`, the
> next queued task, FIFO barriers, provider capacity, or workflow ownership. **Run now** remains the
> explicit priority-dispatch action.

## Reorder boundary

Queued arrow and drag operations work within the task's current star group. The renderer captures
the complete execution-order snapshot plus only the matching starred or unstarred IDs as its
visible subset. `mergeVisibleQueueOrder()` writes that subset back into its original global slots,
so reordering starred tasks cannot move unstarred tasks or silently treat display grouping as a new
scheduler order.

## Inline title rename

The adjacent pencil opens a single-line editor in the card. Enter or the check action saves;
Escape or the cancel action restores the title. The renderer keeps the focused field through its
two-second snapshot refresh and stores the draft value when focus moves to another control.

`PATCH /api/tasks/:id/title` delegates to `TaskQueue.rename()`. Renaming is available for queued,
running, open, and terminal-outcome tasks. It preserves the task ID, prompt, status, position,
provider ownership, saved conversation, results, and attachments, then rewrites only the canonical
`task.md` heading and records the old and new names. A blank value regenerates the compact prompt
title through the shared task-title validator.

> [!note]
> Planner breakdown titles remain owned by their linked proposal. They cannot be renamed
> independently. A Turbo task already under forward preparation also keeps the existing rename
> guard until preparation finishes.

The older queued task editor still owns prompt and execution-setting changes. The queue helper's
`rename` command remains queued-only because it continues to use that compatibility route.

## Files and verification

- `src/database.mjs`, `src/artifacts.mjs`, `src/queue.mjs`, `src/server.mjs`
- `public/task-history.js`, `public/app.js`, `public/style.css`
- `test/task-organization.test.mjs`, plus task history, search, queue, database, and layout coverage

See [[task-naming]], [[task-history]], [[task-search]], [[compact-interface-density]], and
[[hover-stability]].

#relay #tasks #queue #ui #persistence
