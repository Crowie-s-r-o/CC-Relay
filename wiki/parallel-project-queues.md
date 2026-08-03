---
name: Parallel Project Queues
description: How the interface presents several projects running at the same time, and why the queue view stays bounded to one Launchpad.
type: architecture
---

# Parallel Project Queues

CC Relay is no longer a single sequential queue. Each project owns its own queue, and work in
different projects and different sessions runs at the same time, so several tasks can hold
status `running` simultaneously. See [[project-queue-isolation-review]] for the scheduler
side and [[parallel-claude-review]] for concurrent Claude sessions.

This page records how the browser presents that, and one deliberate decision about what it
does **not** present.

## There is no all-projects queue view

> [!important]
> The Queue and History lists stay bounded to the selected Launchpad project. Grouping the
> queue by workspace so several projects render at once was considered and rejected.

The reasons, in order of weight:

1. Cross-project visibility already exists and is better placed. The header running feed
   shows every running task across every project, with its project, CC Relay, live duration,
   prompt, and latest agent response, and selecting one opens that task in its project. A
   grouped queue would duplicate that in a worse position. See [[interface-layout]].
2. The Launchpad selection is load-bearing well beyond the task list. It bounds pause
   state, queue positions, reorder validation, retry ordering, the selected execution
   terminal, and the in-memory composer draft including prompt text and reference images.
   See [[project-workspaces]] and [[task-history]]. Unbinding only the task list would
   leave those five behaviors bound to a project the list no longer implies.
3. `tasksForScope` returns an empty list without a project path by design
   (`public/task-history.js`), and `test/task-history.test.mjs` asserts it. The invariant
   is encoded, not incidental.

So grouping by workspace **inside** the selected project is a no-op and is not implemented.
Switching projects remains the way to look at another queue.

## What multiple running tasks changed in the browser

**Header and queue counts.** `renderStatus` used to take the first task it found with
status `running` and describe it as the running task. It now counts them:

- two or more running in the selected project reads `N tasks running · M waiting`,
- exactly one keeps the precise `Task 276 is running · M waiting`,
- none keeps `M waiting · queue ready`.

The same count feeds `projectQueueRestartRequired`, so the **Restart CC Relay** hint for an
older backend is still correct when a project has several runs in flight.

**Activity panel selection.** The rule is unchanged in spirit and sharper in practice:
adding a task never moves the activity panel off the task the user is inspecting, and an
inferred selection is only used when the current one is gone. With concurrent runs, "the
running task" is ambiguous, so the fallback is `mostRecentlyStartedRunningTask`, ordered by
`started_at` and then by id. That is the run the user most likely just caused, and it does
not swing between concurrent runs on every refresh.

**CC Relay destination is read from task data.** With dispatch-time idle routing the server
can move a task to a different free CC Relay in the same provider and workspace after it was
enqueued, updating `thread_id`, `thread_name`, and `thread_source`. `taskRelayLabel`
resolves from the task record, so the queue card and Task Activity show the real
destination on the next refresh with no client bookkeeping. Per-terminal model and effort
memory follows through `hydrateThreadExecutionSettings`, which seeds from the task record
and still never overwrites an explicit user choice, per the rules in [[interface-layout]].

**Parallel batch guard.** Every task in one **Run in parallel** batch must belong to the
selected Codex terminal's workspace. Project scoping implies this today, but the guard is
now explicit in `renderParallelBatchBar` and shows **Same workspace only** instead of
silently sending a mixed batch. The invariant no longer depends on which tasks happen to
be visible.

## Scheduler side

One persistent global waiting order lives in SQLite. Per-project queues are a grouped view plus
a dispatch rule, not separate persisted queues, so `POST /api/queue/reorder` keeps its existing
shape. The dispatch rule is: **at most one active CC Relay task per target session id.** Different
session ids run concurrently, including two sessions in the same workspace and sessions across
any number of projects, with no project-count limit. FIFO and exclusive barriers are scoped per
project.

`runnableTasks()` claims sessions into a reserved set **synchronously, inside one pass**. That is
what stops two dispatches from starting on the same session, and it is the property to protect
when changing anything here.

For a direct Claude task, that synchronous claim may be a queued dispatch guard instead of an
active task. If live discovery says the selected Claude session is busy, the guard reserves its
session ID while the persisted task stays queued. This keeps unsent work editable, cancellable,
and reassignable without allowing another dispatch to claim the same conversation. See
[[claude-busy-dispatch]].

> [!warning]
> `schedule()` runs `runNext()` and `planAhead()` in the same tick, and `planAhead()` reads state
> that `runner.run()` writes synchronously during dispatch. An unconditional `await` before
> `runner.run()` silently disables Turbo forward planning, because the plan write then lands
> after `planAhead()` has already looked. Dispatch-time idle routing is gated behind a synchronous
> `shouldRouteIdle()` check for exactly this reason, so every task that is not routing keeps a
> completely await-free dispatch path. Three queue tests catch a regression here.

### Dispatch-time idle routing, server side

The browser no longer waits for a free terminal before posting. It posts immediately with the
selected `threadId` plus optional boolean `preferIdleTerminal`, and the server does the
equivalent at start time.

- Honoured for `mode: "execute"` only, and ignored when `runNow` is true, because Ctrl+Enter
  deliberately pins the task to the visibly selected CC Relay.
- The originally selected session always wins when it is free.
- Otherwise the task moves to a free, unassigned, idle session of the same provider in the same
  workspace. Routing never crosses a workspace, so `repo_path` is stable and project grouping,
  project pause, and reorder scoping are unaffected.
- Selection runs in one synchronous block after the live list arrives, so two tasks routing at
  the same moment cannot claim the same session. A reroute reschedules so the freed session can
  take other waiting work.
- A discovery failure during routing is not an error; the task stays on its selected session.
- Persisted as `prefer_idle_terminal`. Advertised as `capabilities.dispatchIdleRouting`.

Direct Claude dispatch also checks readiness when the idle preference is off. A busy selected
session leaves the task queued rather than presenting it as running. With the preference on, each
readiness check may instead choose a free same-workspace Claude session. The final runner
`waitForIdle()` remains in place to close the race between queue readiness and prompt injection.

> [!important]
> That stay-put rule only works because `idleSessionCandidates` **checks staleness explicitly**.
> Both registries deliberately swallow discovery failures and serve last-known-good, which is
> what makes task-add reliable, but it also means discovery never throws. Routing decides where
> to send work based on which sessions are idle, and a cached `status` from before an outage is
> not evidence of anything. So after the forced refresh, a stale registry yields **no candidates**
> and the task keeps the session the user chose. Without that check the rule would be dead code
> and routing would silently act on pre-outage state.

The same reasoning applies to `waitForIdle` in `src/claude-execution-runner.mjs`: a session
cached as busy would otherwise be served forever during an outage, hanging the task on "Waiting
for the selected Claude session to become idle" with nothing ever typed. Sustained staleness now
fails the task non-retryably with a message that says explicitly that nothing was sent. A brief
blip resets the deadline and does not fail anything.

> [!warning]
> Capacity sharing is safe only because `reservedThreadIds()` includes both a running Plan
> council's Claude author and Codex reviewer conversation IDs. `runnableTasks()` also passes all
> active tasks plus every task already selected in the same synchronous pass to
> `DisposableTerminalPool.canRun()`. Removing either reservation path can place direct work on a
> council conversation or overbook a provider while the council is still launching its fleet.

Note that `idleSessionCandidates` calls `listSessions({ refresh: true })`. A ready task normally
needs one probe. A busy Claude task repeats the existing bounded readiness poll while it remains
queued, and concurrent callers still join one registry discovery already in flight. The live
`status` field is required because it detects manual terminal work and background agents.

### Runner state

Concurrency is safe because runners are keyed per task or per session:
`ClaudeExecutionRunner` keys by task **and** session, `CodexAppServer` correlates JSON-RPC
replies by request id and keys turns by thread id, `TurboRunner` keys children by parent task id,
`RelayRunner` keys runners by task id. `ClaudeRunner` now keys plan stages by owner; it
previously used one global slot and its `cancel()` ignored its argument, so a stage timeout in
one project's Plan council stopped whichever Claude stage was newest. Owners are threaded through
`PlanCouncilRunner` and `TurboPlanCouncilReviewer`.

### Single-session work

`isSingleSessionTask` is the predicate the scheduler uses for "occupies exactly one session for
one turn, so one CC Relay task per session id is barrier enough": direct Codex, direct Claude, and
Planner breakdowns. It replaced `isDirectExecutionTask` at every scheduling and reservation site
in `runnableTasks()` and `reservedThreadIds()`. Anything else (Plan council, Turbo) is exclusive.

> [!warning]
> If you widen that predicate again, `reservedThreadIds()` is the site that must move with it.
> Admitting a mode into the non-exclusive path without reserving its running session lets a
> second task start on a session that is already busy. That is exactly what made the breakdown
> reclassification a five-site change rather than a one-line one.

`planAhead()` consults `reservedThreadIds()` too. Forward planning starts a real turn on the
planner session, so it needs the same reservation every dispatch honours. It previously avoided
only Turbo's own worker and planner threads, which was survivable while every non-direct mode
froze its whole project; once single-session breakdowns began running beside Turbo, a breakdown
holding a session in another project became invisible to look-ahead and forward planning could
open a second turn on it.

### The one deliberate serialization point

> [!important]
> Plan council remains globally exclusive. `PlanCouncilRunner` keeps `activeRunner`,
> `activeTaskId`, and `activeStageId` as single-task fields and refuses a second concurrent
> council, and the scheduler enforces the matching barrier through `sharedExclusiveAvailable` in
> `runnableTasks()`. Widening it requires changing the runner **and** the scheduler barrier
> together, so it was left intact deliberately rather than half-changed.

Global council serialization is separate from project capacity. A current disposable council may
share its own project with disposable direct or breakdown work when the combined Codex and Claude
requirements fit. A second council or Turbo parent still waits globally. Legacy persistent
councils keep their former same-project drain barrier.

## Related

- [[task-add-reliability]] for why adding a task is now instant and never transiently rejected.
- [[task-history]] for queue ordering, reorder snapshots, and submission behavior.
- [[project-workspaces]] for the Launchpad and terminal ownership.
- [[interface-layout]] for the composer and header surfaces.

#relay #queue #projects #parallel
