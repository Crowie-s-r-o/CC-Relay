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

The operational Queue moves those same unread completions directly below running work and groups
them under a rose **Ready for review** divider. Each card keeps a rose left rail and tint, while the
shared divider avoids repeating a long label on every compact card. History and task search retain
their own chronology or relevance order, so an unread result in either view carries an individual
**Ready for review** marker. The existing **Complete** badge remains unchanged: Complete is the task
lifecycle state, while Ready for review says that its result has not been opened in Task Activity.

> [!important]
> "Checked" means the completed task was opened in Task Activity. Merely selecting its Launchpad
> project does not clear the notification.

## Clearing the current project

When the selected Launchpad project has unread completions, the task queue heading exposes
**Mark reviewed · N**. It marks every unread completion in the current project as reviewed and leaves
notifications in every other project untouched. The control is hidden when the current project
has no unread tasks.

`ProjectCompletionNotifications.includes(path, taskId)` is the shared card-membership query.
`acknowledgeProject(path)` removes and persists exactly one normalized project bucket and returns
the number cleared. Opening a single task still uses `acknowledge(task)`. The Queue passes the same
membership predicate to `sortOperationalTasks()`, so acknowledgement moves the card back to Today
or Past on the next render without changing the persisted task or its former queue position.

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
**Finished** project activity state, and gives review cards, the divider, and the bulk control a
coordinated rose treatment in light and dark themes.
Screen-reader copy includes the unchecked completion count, and unread task cards announce
**ready for review**.

`observe()` also returns every task that genuinely transitioned from unfinished to `complete`.
This transition list drives [[task-completion-alerts]] independently of unread state, so a task
already open in Task Activity can still sound while remaining acknowledged.

Transition tests live in `test/project-completion-notifications.test.mjs`, ordering coverage lives
in `test/task-history.test.mjs`, and the Launchpad and divider contracts live in
`test/project-layout.test.mjs` and `test/queue-ledger-ui.test.mjs`. The complete repository suite
passed 1,471 tests after the review block and terminology update.

See [[project-workspaces]], [[task-history]], [[task-completion-alerts]], and
[[compact-interface-density]].

#launchpad #notifications #tasks #ui
