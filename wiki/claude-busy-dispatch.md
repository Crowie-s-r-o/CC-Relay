---
name: Claude Busy Dispatch
description: Why unsent Claude work stays queued while an interactive session is busy, and how it becomes dispatchable.
type: architecture
tags:
  - relay
  - claude
  - queue
  - dispatch
---

# Claude Busy Dispatch

> [!note]
> This page records the legacy persistent-session dispatch contract. Current tasks use [[disposable-terminal-pools]]: they wait on the selected project's Claude instance limit, then launch a fresh Claude terminal. They never target an unrelated existing busy session, overwrite its draft, or offer manual reassignment. The busy-session guard below remains required for existing persistent tasks and as a final race guard after an automatic terminal binds.

Task 284 exposed a misleading state transition on July 27, 2026. The selected `documi-ai-73`
Claude session reported `busy`, so Relay correctly typed nothing, but the queue had already
changed the task from `queued` to `running`. Task Activity therefore showed **Live** and
**Claude session busy** even though no provider runner had started and the task could no longer
be reassigned.

Live inspection proved the status was not a stale discovery result. The terminal still had a
background review agent running and its input line contained an unsent draft. Treating that
session as idle or typing over its composer would risk both concurrent repository work and loss
of the user's draft.

## Dispatch contract

Direct Claude work and a macOS Plan council with an assigned Claude author terminal claim an
in-memory dispatch guard synchronously, but remain persisted as `queued` until one of these
conditions is true:

1. The selected Claude session reports idle.
2. **Use an idle Relay when available** finds an unassigned idle Claude session in the same
   workspace and moves the task there.
3. The queued task is explicitly assigned to another live Claude Relay in the same workspace.

Conditions 2 and 3 apply to direct Execute tasks. Plan council is pinned to its explicit author
terminal, so it waits for condition 1 or is cancelled and resumed with another author assignment.

While waiting:

- `started_at` stays empty.
- The task is absent from `activeTaskIds`.
- No prompt, Return key, or provider child process is sent.
- One `claude/waiting` event explains that the task is still queued and nothing was sent.
- The task stays editable, reorderable, and cancellable. Direct Execute tasks also remain
  reassignable.
- Repeated discovery polls do not append repeated waiting events.

When a destination becomes ready, Relay records that the Claude session is ready, calls
`beginTask()`, and only then gives the task to `ClaudeExecutionRunner`.

> [!important]
> The dispatch guard reserves the selected session synchronously before the first discovery
> await. Do not replace it with an unclaimed asynchronous preflight. Two tasks resolving at the
> same time could otherwise choose the same Claude session.

> [!important]
> Keep `ClaudeExecutionRunner.waitForIdle()` as the final race guard. A terminal can become busy
> after queue preflight but before prompt injection. Queue preflight fixes the normal busy case;
> the runner still protects the last moment before execution.

## Reassignment compatibility

`capabilities.queuedClaudeAssignment` gates Claude assignment in the renderer. A current backend
accepts queued Execute tasks for either provider at `POST /api/tasks/:id/assign`, resolves the
matching provider session, and enforces the same normalized workspace path. An older backend
continues to show only Codex assignment targets.

Task cards list only same-provider, same-workspace targets. Dragging a queued Claude card onto
another Claude terminal and the explicit **Assign** control use the same guarded route.

## Existing running tasks

The change is backend behavior and requires a Relay restart. A task that an older backend already
promoted to `running`, such as task 284, is not silently rewritten to queued by refreshed static
assets. It must finish, be cancelled, or be recovered normally during restart, then be retried
under the current scheduler.

## Files and coverage

- `src/queue.mjs`
- `src/server.mjs`
- `public/app.js`
- `test/dispatch-idle-routing.test.mjs`
- `test/composer-workflows.test.mjs`

Regression coverage proves queued status, empty `started_at`, one waiting event, Plan council
author waiting, idle rerouting, manual direct-Claude reassignment, cancellation before send,
session reservation, and no cross-workspace routing.

See [[parallel-project-queues]], [[parallel-claude-review]], [[task-history]],
[[task-add-reliability]], and [[diagnostics]].

#relay #claude #queue #dispatch
