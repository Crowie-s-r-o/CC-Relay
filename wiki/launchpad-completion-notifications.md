---
name: Launchpad Completion Notifications
description: How Launchpad projects surface completed tasks that have not been opened in Task Activity.
type: feature
---

# Launchpad Completion Notifications

Launchpad project cards show a numbered notification badge when a task in that project reaches
`complete` without being open in Task Activity. When the project has no running, waiting, or
attention state, its visible state becomes **Finished** until the completed task is opened.

The badge is project-scoped and remains visible alongside higher-priority **Running**, **Waiting**,
**Restart needed**, or **Attention** states. Opening a completed task acknowledges only that task,
so another unchecked completion in the same project keeps the badge visible.

Task queue cards for those same unread completions carry a compact **New** marker and a quiet
project-identity tint in both Queue and History. The existing **Complete** badge remains unchanged:
Complete is the task lifecycle state, while New says that its result has not been opened in Task
Activity.

> [!important]
> "Checked" means the completed task was opened in Task Activity. Merely selecting its Launchpad
> project does not clear the notification.

## Clearing the current project

When the selected Launchpad project has unread completions, the task queue heading exposes
**Clear new · N**. It marks every unread completion in the current project as viewed and leaves
notifications in every other project untouched. The control is hidden when the current project
has no unread tasks.

`ProjectCompletionNotifications.includes(path, taskId)` is the shared card-membership query.
`acknowledgeProject(path)` removes and persists exactly one normalized project bucket and returns
the number cleared. Opening a single task still uses `acknowledge(task)`.

## Persistence and first-use behavior

`public/project-completion-notifications.js` owns the transition tracker. It persists unread task
IDs and unfinished task observations in browser local storage under
`relay.projectCompletionNotifications.v1`.

- The first snapshot establishes a baseline and does not mark all historical completions unread.
- A queued or running task observed before a reload can still become unread if it is complete on
  the next page load.
- A task completing while it is already the selected Task Activity item is considered checked.
- Opening an unread completed task acknowledges it.
- Retrying a completed task or deleting it removes any stale completion notification.
- Storage parsing and writes fail open so notification state can never block queue refreshes.

`public/app.js` observes task snapshots after `/api/tasks` loads and acknowledges a task only after
its detail request succeeds. `public/style.css` renders the count on the project initial, adds the
**Finished** project activity state, and styles the queue marker from the task's project color.
Screen-reader copy includes the unchecked completion count, and unread task cards announce
**not viewed**.

Tests live in `test/project-completion-notifications.test.mjs` and the Launchpad markup and style
contracts remain in `test/project-layout.test.mjs`. The full repository suite passed 926 tests
after the task-level markers and project clear action were added.

See [[project-workspaces]], [[task-history]], and [[compact-interface-density]].

#launchpad #notifications #tasks #ui
