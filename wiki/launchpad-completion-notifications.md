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

Completion review state is owned by the task database. The additive `tasks.completion_reviewed`
column defaults to reviewed for queued work and for rows created by an older schema. Every real
transition from a non-complete status to `complete` sets it to unread in the same SQLite update.
The task API exposes that state as `ready_for_review`, so a new renderer origin reconstructs the
same Launchpad badges and Queue review block from durable task rows.

> [!important]
> Do not move completion review ownership back to browser storage. Packaged Electron loads the
> embedded server from a dynamically assigned loopback port, and the port is part of the browser
> origin. An app restart or version installation can therefore select an origin with an empty
> `localStorage` even though the task database is unchanged.

The first durable-schema startup performs a one-time compatibility import. Before the first task
snapshot, the renderer sends any unread task IDs still reachable under
`relay.projectCompletionNotifications.v1` to the backend. SQLite restores matching completed rows
and records a database migration marker, then the local record advances to version 2 and stops
carrying unread IDs. A stale browser origin cannot repeat the import and resurrect work that was
reviewed later. If an older dynamic origin is no longer reachable, its checked-versus-unchecked
distinction cannot be inferred from the legacy task row, so existing completed rows remain the
acknowledged migration baseline.

- An unread task survives an app restart, a package upgrade, and a loopback port change.
- Existing completed rows become a reviewed baseline when the column is added, preventing a full
  historical backlog from appearing as new.
- A task completing while it is already the selected Task Activity item is acknowledged through
  the same backend review action.
- Opening an unread completed task acknowledges only the exact `finished_at` outcome that was
  opened. A delayed response cannot clear a newer completion of the same task.
- **Mark reviewed** submits the exact visible task and completion pairs. Work that completes while
  the request is in flight remains unread.
- Repeating a write to the same completed outcome does not reopen review. A retry or continuation
  clears the old state, and its next transition to complete opens a new review.
- Deleting a task removes its review state with the task row.

`public/project-completion-notifications.js` now projects durable task flags for the renderer and
keeps only the unfinished-status baseline used to detect sound transitions in origin-local
storage. Storage parsing and writes remain best effort and cannot block queue refreshes.
`public/app.js` acknowledges a task only after its detail request succeeds. `public/style.css`
renders the count on the project initial, adds the
**Finished** project activity state, and gives review cards, the divider, and the bulk control a
coordinated rose treatment in light and dark themes.
Screen-reader copy includes the unchecked completion count, and unread task cards announce
**ready for review**.

`observe()` also returns every task that genuinely transitioned from unfinished to `complete`.
This transition list drives [[task-completion-alerts]] independently of unread state, so a task
already open in Task Activity can still sound while remaining acknowledged.

Transition and compatibility-import tests live in
`test/project-completion-notifications.test.mjs`. SQLite reopen, additive-schema, exact-outcome
race, API, and renderer startup coverage lives in `test/completion-review-persistence.test.mjs`.
Ordering coverage lives in `test/task-history.test.mjs`, and the Launchpad and divider contracts
live in `test/project-layout.test.mjs` and `test/queue-ledger-ui.test.mjs`.

See [[project-workspaces]], [[task-history]], [[task-completion-alerts]], and
[[compact-interface-density]].

#launchpad #notifications #tasks #ui
