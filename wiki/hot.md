---
name: Current Relay Notes
description: High-signal context for the next development session.
type: hot
---

# Current Relay Notes

> [!important]
> Relay now detects Codex and Claude CLI installation independently and disables only providers confirmed missing. Signed-out CLIs remain installed and selectable, while pending or transiently failed probes stay neutral and retry automatically. A selected missing provider falls back to the installed alternative, and later Codex installation or sign-in starts the shared app-server automatically. See [[provider-installation-detection]], [[disposable-terminal-pools]], and [[task-add-reliability]].

> [!important]
> Disposable Codex continuation now binds through the exact new launch reservation even when an older client still reports the same saved conversation. Native recovery cannot steal a terminal while its launch is binding or resurrect an intentionally closed conversation from a draining proxy connection. A rejected or timed-out resume is closed exactly once and never retried automatically, so **Continue session** cannot fan out into repeated terminals. Restart Relay before manually retrying an affected continuation. See [[codex-disposable-resume-review]], [[disposable-terminal-pools]], and [[automatic-retry-safety]].

> [!important]
> macOS terminal cleanup now enumerates the freshly verified exact TTY with `ps -t <tty> -o pid=` and SIGKILLs exactly those identifiers with `kill -9`. On Darwin 25 the `-t` filter of `pgrep` and `pkill` matches nothing, so the previous `pkill` call killed no processes, the `pgrep` drain counted its empty results as success, and task 320 recorded a completed close whose live session was re-bound three seconds later. The same `ps` snapshot now drives the drain gate: two consecutive empty observations before the exact window closes, and a TTY that does not drain within two seconds stays open and retains ownership. Never reintroduce `pgrep -t` or `pkill -t` here. See [[terminal-close-review]].

> [!important]
> Current queue submissions use per-project disposable terminal pools. The left composer panel sets maximum Codex and Claude instances from 1 through 8. A fresh task has no preselected session: Relay launches its required terminals only when capacity is available, binds each exact native launch, runs the task, and closes that launch at every terminal outcome. Finished direct tasks retain their saved conversation ID, so **Continue session** creates a linked queue task that relaunches Claude with `--resume` or Codex with `codex resume`. Only one queued or running task may own a saved conversation. Existing persistent task rows retain legacy routing for compatibility. See [[disposable-terminal-pools]], [[project-workspaces]], and [[task-history]].

> [!important]
> A waiting automatic Execute task can now switch between Claude and Codex from **Edit**. The editor validates the destination model and effort. A provider change keeps the task, position, prompt, and images but clears provider-specific conversation identity and starts fresh. Legacy persistent tasks and workflow-owned Plan council, Turbo, and breakdown tasks cannot switch. Advertised as `capabilities.queuedTaskProviderSwitch`. See [[queued-provider-switching]].

> [!important]
> Execute Plan council now saves its final Markdown under the source workspace at `<project-root>/.data/tasks/<id>/plan.md`, derived from the task's persisted `repo_path`. Internal `plan.json` checkpoints stay in Relay's data directory. Opening an older completed council migrates its final-only artifact and removes the former Relay-local copy. Relay does not edit the target project's `.gitignore`. See [[plan-council]] and [[project-workspaces]].

> [!important]
> Writable Codex Execute turns now reset both `thread/resume` and `turn/start` to explicit full access. Codex app-server persists a turn sandbox policy into subsequent turns, so the former omission allowed a read-only Plan council or Turbo stage to poison every later Execute task on that session even though Relay logged `readOnly: false`. Tasks 283 and 291 reproduced this on the Documi Relay. Planning remains explicitly read-only. Restart Relay to load the fix. See [[codex-sandbox-isolation]].

> [!important]
> Unsent work targeting a busy Claude terminal now stays **queued** instead of becoming falsely **running**. A synchronous dispatch guard reserves the session while preserving edit, cancel, reorder, and same-workspace Claude reassignment. The task starts only when the selected session is idle or idle routing moves it to another free Claude Relay. Task 284 proved why: `documi-ai-73` had a live background review agent and an existing terminal draft, so typing was unsafe, but the old scheduler still showed Live. Restart Relay to load the scheduler and `capabilities.queuedClaudeAssignment`. See [[claude-busy-dispatch]] and [[parallel-project-queues]].

> [!important]
> Adding a task is now local-validation-only and never blocks on a provider CLI. `ClaudeRuntimeStatus.current()` and the Codex probe are cache reads refreshed in the background with bounded async probes; they were `execFileSync` with no timeout, which blocked the whole event loop on every Claude, Plan council, and Turbo submission. Claude session discovery keeps its **last known good** list on a transient failure instead of caching an empty one, which is what used to make live sessions vanish and reject the add. The add path reads warm caches and falls back to last-known-good, then to the workspace from that session's previous task; it rejects only a session Relay has never seen. Claude auth blocks an add only on a completed signed-out probe, never on a pending or errored one. Restart Relay to load it. See [[task-add-reliability]].

> [!important]
> Idle-Relay routing now happens at **dispatch**, not in the browser before posting. The client posts immediately with `preferIdleTerminal`; the server keeps the selected session when it is free and otherwise moves the task to a free idle session of the same provider in the same workspace, never crossing a workspace. Persisted as `prefer_idle_terminal`, advertised as `capabilities.dispatchIdleRouting`. Guard rail: `schedule()` runs `runNext()` and `planAhead()` in one tick and `planAhead()` depends on state `runner.run()` writes synchronously, so routing is gated behind a synchronous `shouldRouteIdle()` check. An unconditional `await` before `runner.run()` silently disables Turbo forward planning. See [[parallel-project-queues]].

> [!note]
> `ClaudeRunner` keys plan stages per owner. It previously held one global slot and its `cancel()` ignored its argument, so a Plan council stage timeout stopped whichever Claude stage was newest. Plan council itself stays deliberately globally exclusive (single-task fields plus `sharedExclusiveAvailable`); that never blocks cross-project direct Codex or Claude work and can be widened later as its own change. See [[parallel-project-queues]].

> [!important]
> A completed Execute Plan council promotes implementation as visible step **04** directly after the council stages. Task Activity also provides a primary **Execute plan** shortcut that scrolls and focuses this handoff. The user chooses Codex or Claude, and Relay creates a linked disposable Execute task in the source project without changing or automatically running the reviewed plan. See [[plan-council]] and [[interface-layout]].

> [!important]
> A terminal-driven Claude Execute task now stays running when the interactive session becomes idle without a final transcript record. That state can mean `AskUserQuestion` is waiting in Terminal.app and Claude may not flush the question record until after the answer. Relay emits **Input needed**, keeps the exact task and session reserved, resumes mirroring after the terminal answer, and still stops on cancellation, terminal closure, or the 45-minute inactivity ceiling. That ceiling now measures continuous inactivity instead of total turn time, so a session that keeps working never fails on duration alone (task 320) while an unanswered prompt still releases its task after a full idle window. Task 270 exposed the former four-poll false failure. See [[claude-terminal-input]] and [[claude-terminal-visibility]].

> [!important]
> Direct Claude Execute runs the turn **inside** the interactive terminal on macOS when Relay owns an exactly resolvable single-tab Terminal.app window for the session. Before typing a configured task, Relay verifies the live session id, pid, workspace, window, and tty, stops only that Claude pid, and restores the same UUID in the same tab with the pinned Claude binary plus the selected `--model` and `--effort`. It waits for the replacement pid to register idle, re-verifies the terminal, types a bracketed-paste prompt through `osascript`, and mirrors the session `.jsonl` transcript into Task Activity. If no busy or transcript evidence appears after 1.5 seconds, Relay re-verifies again and sends at most one separate Return. Every ambiguous relaunch or post-injection failure is non-retryable, so Relay never repeats a launch or prompt automatically. Three real Terminal.app turns on July 25 proved fresh, resumed, and 281-line visible submission with Opus at max effort. Non-darwin and unowned direct sessions keep the headless path. A current macOS Plan council now requires this terminal path instead of falling back. See [[claude-terminal-visibility]], [[claude-terminal-settings-review]], [[claude-terminal-submit-review]], and [[diagnostics]].

> [!warning]
> Terminal cleanup hazard, learned the hard way (July 24, 2026): macOS recycles tty names, so a tty captured earlier can point at a different session later. Never kill, close, or send to a terminal by a stale tty name; verify live session identity (session id, pid, and cwd) at action time. A spike cleanup that violated this killed an unrelated Claude session. See [[claude-terminal-visibility]].

> [!note]
> Relay uses a custom source-available, view-only license. Public users may inspect the source but receive no permission to run, copy, modify, redistribute, incorporate, or derive another project from it. Do not call this open source. See [[licensing]].

> [!note]
> The Planner is a per-project saved plan library reached from the composer heading. Its AI breakdown enqueues an ordinary `mode: 'breakdown'` queue task on a chosen live session, parses the structured output tolerantly, and stores review-before-queue proposals on the plan. `breakdownUpdateForTask` is a reconciler (self-heals `failed -> running -> complete`, never clobbers user edits). Backend advertises `capabilities.planner`; an older running backend shows **Restart Relay to use the Planner**. See [[planner]].

> [!important]
> Planner v2 turns the Planner into an orchestrator. The breakdown contract now returns `{id, title, prompt, dependsOn}` and stores **resolved internal proposal ids** in `dependsOn`, never the model's labels; unknown refs, self-refs, and cycle-closing edges are pruned deterministically with a note on the breakdown row. A **plan run** (`POST /api/plans/:id/run`, `/run/stop`) is a reconciler hooked to the queue `changed` listener, not a second scheduler: a step whose dependencies are complete becomes an ordinary `mode: 'execute'` task through `queue.enqueue`, carrying `preferIdleTerminal` so independent steps fan out across idle same-workspace sessions. Each step's submission id is a deterministic hash of plan+run+proposal, which is what makes re-entry (enqueue emits `changed` synchronously) impossible to double-enqueue. `blocked` and a `failed` run are derived every pass, never latched, so the ordinary task retry is the un-block mechanism; `stopped` is the one latched status. Boot order is `queue.start()` then `planRuns.reconcileAll()`. Advertised as `capabilities.plannerV2`. See [[planner]].

> [!warning]
> Guard-before-await is a real bug shape in `src/server.mjs`, not a theoretical one. A route that validates, then awaits the request body, a live session, or the model list, and only then writes, can be cleared twice by two overlapping submissions (second tab, double dispatch). Planner v2 found it on `POST /api/plans/:id/run` (would have minted two task sets for one plan) and on both breakdown routes. The fix is to re-check synchronously immediately before the write, ideally inside the module that owns the invariant so it defends itself: `planRuns.startConflict()` runs again inside `start()`, and `requireNoBreakdownInProgress` runs again right before `createPlanBreakdown`. A guard carrying `statusCode` on the error reaches the client with the right code through the generic handler. See [[planner]].

> [!warning]
> Deleting a queued Planner breakdown task used to be a **silent permanent plan lockout**: the breakdown row stayed `pending` forever, so every planner route refused work until the plan was deleted. Deletion is still allowed and now marks the row `failed`, and the parallel Codex batch route rejects any non-`execute` mode instead of deleting a breakdown, council, or Turbo task out from under its owner. See [[planner]].

> [!warning]
> `mode: 'breakdown'` is **no longer globally exclusive**. `TaskQueue.isSingleSessionTask` replaced `isDirectExecutionTask` at all five scheduling and reservation sites, so a breakdown serializes only on its own session. The load-bearing half is `reservedThreadIds()`: a running breakdown now reserves its own session, and without that, dropping exclusivity would let a second task start on the session it is using. `planAhead()` had to learn the same reservation, because Turbo look-ahead starts a real turn on its planner session and previously only avoided Turbo's own threads. Plan council and Turbo barriers are untouched and pinned by `test/breakdown-scheduling.test.mjs`. See [[planner]] and [[parallel-project-queues]].

> [!note]
> `escapeHtml` (now `public/escape-html.js`) is a pure helper that also escapes `"` and `'`, closing an attribute-injection XSS path (Finding 19). Use it for every attribute interpolation. A Content-Security-Policy for the local UI remains a tracked backlog item. See [[diagnostics]].

> [!note]
> The launchpad now treats pinned projects as selectable workspace cards. See [[project-workspaces]].

> [!note]
> One Launchpad is always selected whenever pinned projects exist. Activating it again keeps it selected, stale selection recovery chooses an available project, and the final pinned project cannot be removed. There is no **All Projects** state. See [[project-workspaces]].

> [!note]
> Launchpad cards are project selectors and live status surfaces, not provider launch surfaces. They contain no Codex or Claude buttons. Each card leads with **Running**, **Waiting**, **Restart needed**, **Attention**, or **Idle**, followed by task detail. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> The Launchpad desktop band is 104px high with one 42px horizontal card row. Each 330px card keeps its name and activity on that row, and the rail scrolls horizontally rather than clipping a second row. Color hashing resolves collisions across visible projects, so up to six pinned projects use distinct palette colors; the matching global running-task card shares the resolved project identity. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Project-card unpin is a dedicated final grid column at the far-right edge. Keep it outside the name sub-grid; nesting it inside `.project-chip-head` visibly places the close control in the middle. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Task records persist in SQLite. The selected Launchpad project always bounds the visible queue and history; switching projects immediately swaps task cards, counts, and statistics. See [[task-history]].

> [!note]
> Launchpads own independent queue positions, reorder validation, priority and retry ordering, pause state, selected execution terminal, and in-memory composer drafts including prompt text and reference images. Queue and History are always bounded by the selected Launchpad. See [[project-workspaces]] and [[task-history]].

> [!important]
> Project queue isolation is backend behavior and cannot hot-reload with renderer assets. The current backend advertises `capabilities.projectQueueIsolation`; when it is absent, a waiting project blocked by work elsewhere says **Restart Relay for separate project queues**. Task 184 on July 20, 2026 exposed a July 17 backend still running the former global barrier. See [[project-queue-isolation-review]].

> [!note]
> Packaged macOS and installed Windows NSIS builds check for GitHub releases after startup, prompt before download and restart, and shut down Relay gracefully before installation. Development and Windows portable builds remain manual-update paths. See [[desktop-updates]].

> [!note]
> The task panel has a read-only date ledger with day, Monday-based week, and month navigation plus total, completed, success-rate, runtime, and activity statistics. It follows the selected project and **All Relays** or explicit **This Relay** scope. See [[task-history]].

> Successful composer submission always returns to **Queue**, resets scope to **All Relays**, selects the new task, and opens its Task Activity details. See [[task-history]].

> [!important]
> Composer submission is idempotent. The browser locks before asynchronous idle routing, retains one UUID for an unchanged intent through ambiguous failures, and the backend requires and uniquely persists that UUID. Repeated delivery returns the original task instead of creating another row. Restart Relay to load the database migration and server guard. See [[task-history]] and [[duplicate-submission-review]].

> [!note]
> Repeated Enter while the composer already shows **Adding task** is a quiet no-op. The disabled button during submission is progress, not evidence that the selected Relay disconnected. The screenshot attached to task 274 captured a second Enter replacing progress with a false missing-terminal error. The earlier pictured prompt never reached the API, while the report task itself was accepted immediately on the same Relay. See [[task-history]].

> [!note]
> The queue defaults to **All Relays**. Startup, project changes, and provider changes restore that broad view; selecting an execution terminal does not narrow it. **This Relay** is explicit and temporary. See [[task-history]].

> [!note]
> Task queues follow the selected Launchpad project. Current disposable work uses the complete project view because no live terminal is selected before launch. Legacy session-scoped history remains available for older task rows. Workspace columns are user-resizable, and launch/send diagnostics are persisted locally. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> The header center is a global horizontally scrollable feed containing only currently running tasks across every project. Each card shows project, Relay, duration, prompt, and the latest actual Codex or Claude response; selecting it opens that task in its project. Queue and History remain project-scoped. See [[interface-layout]] and [[project-workspaces]].

> [!note]
> Design round 2 (July 24, 2026) restructured markup, not just CSS, for the three called-out areas. The header running feed dropped its persistent bordered pill so the empty state is a compact **No tasks running** chip, never a giant void, and running cards are a three-tier meta/prompt/response grid. The Launchpad became a full-width wrapping grid of roomy two-row project cards (name, path, activity, Codex/Claude launch) instead of a cramped scroll strip, with the desktop band raised to 192px and the header, dock, workspace, and task-list heights moved as one set. The mode-tab workflow label wraps in full and the Task queue heading stays on one line. Launchpad CSS was consolidated into the base block and its stale 2026 and horizontal-flex responsive overrides deleted rather than layered. See [[interface-layout]].

> [!note]
> Terminal output now uses the refined execution-ledger hierarchy documented in [[interface-layout]].

> [!note]
> The right-side Task Activity terminal defaults to **All**, including messages, commands, tools, and streamed reasoning summaries. See [[interface-layout]].

> Task Activity now shows Codex reasoning output usage as **thinking tokens**, uses a compressed task header, and has a persisted draggable horizontal split for terminal height. See [[interface-layout]].

> [!note]
> Direct Codex and Claude Task Activity views include a compact **Continue session** dock. A running Codex task updates its exact active turn through `turn/steer`; a finished task starts the next turn immediately in the exact same session and task activity. Neither path creates queue work. Busy or offline sessions reject submission, running Claude turns remain unavailable, and older backends without `taskDirectFollowUp` show **Restart required** instead of falling back to a normal task. See [[task-history]], [[interface-layout]], and [[project-workspaces]].

> [!note]
> Continue session accepts PNG, JPEG, and WebP images through **Add images** or clipboard paste. Finished Codex and Claude turns receive only the new images, running Codex sends them through exact-turn steering, and older backends without `taskFollowUpAttachments` keep the image control disabled. See [[task-history]] and [[interface-layout]].

> [!note]
> The follow-up image action is now an intentionally faint icon beside Send. Its grid accounts for the generated terminal caret, so the textarea retains the available width and Send stays on the same row. Empty image metadata is hidden. See [[interface-layout]].

> [!note]
> Live terminal polling preserves the nested scroll position of expanded command output. Output follows appended lines only when its own scroller was already at the bottom. See [[interface-layout]].

> [!note]
> Expanded command output uses an explicit opaque `#0c0e17` surface so the app-wide light `pre` styling can never produce a white block inside Task Activity. See [[interface-layout]].

> [!warning]
> The current renderer can freeze during live activity because each SSE or polling refresh rebuilds an unbounded task list, rebuilds the selected task event stream, and performs layout measurements around those replacements. `loadSnapshot()` also rebuilds the task list twice when a task is selected. An Eyeo ad-filtering extension can amplify the DOM-mutation cost, while synchronous Claude CLI status checks add a separate five-second backend pause. See [[renderer-performance]].

> [!note]
> Direct execution keeps the compact effort slider. Model and effort are retained independently for every Codex and Claude Relay terminal, and slider indices are mapped to exact supported effort strings at submission. Explicit choices seed newly discovered terminals for that provider. See [[interface-layout]].

> [!note]
> Direct submission snapshots effort before idle-Relay discovery, then remembers the server-accepted model and effort on the actual destination terminal. This keeps the composer at the task's accepted effort after enqueue, including when idle routing changes Relays. See [[interface-layout]].

> [!note]
> Per-terminal effort state distinguishes provisional defaults, persisted task values, and unsent user choices. Task history replaces only provisional defaults; polling never replaces a user choice. This fixes the startup race where task 171 showed `xhigh` while its Relay slider showed `low`. See [[interface-layout]].

> [!note]
> Current direct execution Model and Effort controls render below the automatic pool controls and belong to the selected provider in the active project. A legacy backend renders them below its Relay picker. See [[interface-layout]].

> [!note]
> **Run in parallel** is a legacy persistent-task action that bundles selected waiting tasks into one numbered Codex command sent to the selected Codex terminal. Disposable work uses project limits or Turbo instead. See [[task-history]].

> [!note]
> Forward-planning Turbo uses a read-only Codex planner and a dependency-aware Relay scheduler across a disposable Codex fleet. The project maximum must fit one planner plus the configured worker count before the workflow starts. See [[turbo-execution]] and [[disposable-terminal-pools]].

> [!note]
> Turbo queue cards now show **Forward plan**, **Planning ahead**, **Plan ready**, or **Workers running** alongside the canonical queue status. A free planner can prepare the next queued Turbo parent while another parent executes; planning does not change queue position or start the parent early. See [[turbo-execution]].

> [!note]
> Turbo cards now include a compact planner and execution-Relay fleet manifest, while the detail graph uses checked, loading, blocked, and failed dispatch tickets. See [[turbo-execution]] and [[interface-layout]].

> [!note]
> Turbo dispatch tickets use uniform outlines without colored left borders. The running spinner keeps a continuous phase across live graph rerenders so polling cannot make it appear frozen. See [[interface-layout]].

> [!note]
> Turbo dispatch tickets use the final `.turbo-graph-*` layout exclusively. Broad legacy article and direct-child span selectors break the compact state, copy, and Relay ownership grid and must not be restored. See [[interface-layout]].

> [!note]
> An active Turbo graph with no packages now displays **Planning dependency graph** with an indeterminate accessible animation and skeleton tickets instead of `0 / 0 complete`. The task marker remains **Planning graph** until worker execution actually begins. See [[turbo-execution]] and [[interface-layout]].

> [!note]
> Turbo Plan council now matches the standalone council card design and lets the user choose **Codex first** or **Claude first**. The first provider authors the graph and the second validates it before workers start. See [[turbo-plan-council]], [[turbo-execution]], and [[interface-layout]].

> [!important]
> Council capability does not imply Claude authentication. Relay distinguishes an installed but signed-out Claude CLI from an old backend, preserves `loggedIn: false` JSON even when `claude auth status --json` exits with code 1, and rechecks authentication while running. Use `claude auth login`; Council enables automatically after sign-in without another restart. See [[diagnostics]].

> [!important]
> Execute Plan council is a checkpointed Claude author, Codex reviewer, Claude revision state machine. Failures never retry automatically. Manual resume preserves completed stages, each active stage emits heartbeats, and the final deliverable is one canonical `<project-root>/.data/tasks/<id>/plan.md`. See [[plan-council]] and [[diagnostics]].

> [!note]
> A completed Execute Plan council can be queued on any selected Codex or Claude Relay in the same workspace. The linked Execute task receives the original request, final reviewed plan, canonical file path, and copied reference images. Planning completion never starts implementation automatically. See [[plan-council]] and [[task-history]].

> [!note]
> The completed-plan panel keeps the project-local `plan.md` path visible and offers Codex or Claude execution through the project's disposable pool. An older backend uses the opened-Relay selector. Task 194 was canonicalized to final-only `plan.md` with no duplicate `result.md`. See [[plan-council]] and [[plan-council-review]].

> [!note]
> Both optional Plan council entry cards use the same shared component, primary label, compact neutral review shell, and interaction states in Execute and Forward-planning Turbo. Turbo adds only its help disclosure and workflow-specific supporting sentence. See [[interface-layout]].

> [!note]
> Execute and Turbo Plan council now share the complete refined surface: neutral rounded shell, single checked-state focus treatment, provider-accented route nodes, rounded settings, and a central arrow handoff. Disabled routes are hidden consistently. Execute retains only its revision and readiness details; Turbo retains only order selection and help. See [[interface-layout]].

> [!note]
> Ctrl+Enter is labeled **Run now** and prioritizes a new submission inside the active project without bypassing provider limits or interrupting active work. The selected-Relay and idle-routing behavior remains only for legacy persistent submissions. See [[task-history]].

> [!note]
> Newly launched Codex terminals can accept their first Relay task even before Codex has persisted a rollout. Relay falls through from the expected `thread/resume` missing-rollout error to `turn/start`. See [[project-workspaces]].

> [!note]
> After that first `turn/start`, Relay resumes the fresh thread again to subscribe to live output. This keeps the first task's Task Activity stream populated instead of relying only on final-result polling. See [[project-workspaces]].

> [!note]
> Fresh-thread subscription now retries both missing and temporarily empty rollouts without showing a Terminal warning. Polling remains the completion fallback. See [[project-workspaces]] and [[diagnostics]].

> [!note]
> Queue recovery and dispatch start only after Relay successfully binds port 4768. A duplicate server start now exits on `EADDRINUSE` without interrupting active work or orphaning the next task as running. See [[diagnostics]].

> [!note]
> The **Connect another Codex terminal** disclosure now stays open across silent terminal polling. The populated-terminal render path must preserve the user's disclosure state. See [[project-workspaces]].

> [!note]
> Queue and terminal state refresh automatically. The interface intentionally has no manual Refresh buttons, and connection copy should describe automatic discovery. See [[interface-layout]].

> [!note]
> Connected Codex terminals are still numbered for legacy history and manually launched interactive sessions. Current disposable tasks cannot be assigned or dropped onto one of them. See [[task-history]] and [[interface-layout]].

> [!note]
> Legacy idle-terminal routing gives a newly launched Relay up to three seconds to connect when the selected Relay is busy. Current disposable routing instead reserves project capacity and binds the exact task-owned launch. See [[task-history]].

> [!note]
> Relay numbers and names are persisted per Codex thread and remain unchanged when terminals reconnect, disconnect, or are reordered. See [[task-history]].

> [!note]
> While a Turbo parent executes, queued direct Codex work can use unreserved Relays across queued exclusive entries. Turbo workers, busy planners, and active direct terminals remain reserved; no second exclusive task starts, and FIFO barriers return when Turbo ends. See [[turbo-execution]] and [[task-history]].

> [!note]
> Direct Codex tasks run concurrently across distinct Relay terminals while remaining sequential per terminal. FIFO and exclusive barriers are project-scoped, so a Plan council in one Launchpad does not hold eligible direct Codex work in another. Provider-wide exclusive tasks remain globally serialized, and cancellation is tracked per task. See [[project-workspaces]] and [[task-history]].

> [!note]
> Direct Claude tasks now execute concurrently on distinct Claude session IDs and remain sequential within each session. The idle Relay preference routes Claude submissions to an unassigned idle Claude session in the same workspace when the backend advertises `parallelClaudeExecution`. Direct Codex and Claude work can run beside each other, while Plan council and Turbo retain their exclusive barriers. Restart Relay to load the new scheduler capability. See [[task-history]], [[project-workspaces]], and [[parallel-claude-review]].

> [!note]
> Relay pins one exact `claude` binary at startup (`src/claude-binary.mjs`) instead of trusting bare `PATH` order, which selected an outdated binary and silently returned no live Claude sessions when Relay was launched from Finder or the dock. The resolver probes every candidate with `--version` and picks the highest version; discovery, execution, runtime status, and the launched terminal command all use the pinned absolute path. Watch `claude.binary.resolved` and `claude.binary.fallback`. Restart Relay to load the resolver. See [[claude-terminal-visibility]] and [[diagnostics]].

> [!note]
> Cross-project direct execution has no Relay project-count limit. Generated coverage runs one Codex and one Claude task simultaneously across twelve projects, with twelve serving only as a practical test size. An older backend that queues Claude behind another project's session shows a targeted restart warning. See [[project-workspaces]] and [[parallel-claude-review]].

> [!note]
> Fresh disposable Execute tasks intentionally have no assigned session and always start a new conversation in a new terminal. Retries and explicit continuations relaunch and resume the saved conversation. Legacy persistent Execute tasks retain assigned-session and idle-routing behavior. See [[task-history]], [[project-workspaces]], and [[disposable-terminal-pools]].

> [!note]
> A freshly launched Claude terminal can be discovered before its first transcript exists. Direct execution now handles that exact resume failure by starting the first task with the same session UUID after verifying the live interactive process and workspace. Expected probe stderr is suppressed; stale, background-only, cross-workspace, and cancelled sessions never start the fallback. Discovery still deduplicates repeated IDs and prefers the interactive terminal. See [[project-workspaces]], [[diagnostics]], and [[claude-fresh-session-review]].

> [!note]
> Current Execute Plan council requires one Claude slot and one Codex slot in the selected project. Relay launches and binds both exact terminals automatically, runs the three-stage read-only route, and closes them at the terminal outcome. Older backends retain explicit terminal assignment or the isolated CLI route. See [[plan-council]], [[diagnostics]], [[interface-layout]], and [[disposable-terminal-pools]].

> [!note]
> Composer routing follows the visibly selected workflow and provider. The only workflow tabs are Execute and Forward-planning Turbo. Plan council is an explicit per-prompt option inside both, and inconsistent visual and internal selection is rejected. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> Execute Plan council is explicitly off by default. Its two-provider route appears only after the user enables the per-prompt switch, and the server rejects internal plan submissions without that opt-in. The old standalone workflow tab has been removed. See [[task-history]] and [[interface-layout]].

> [!note]
> Execute Plan council selects Codex for its review Relay but does not lock the provider tabs. Choosing Claude turns the council option off and switches to direct Claude execution. See [[task-history]] and [[interface-layout]].

> [!note]
> Terminal Settings must not introduce a nested form inside `#task-form`. Its panel uses an explicit dialog close action so the prompt, image picker, and submit button remain owned by the task form. See [[diagnostics]].

> [!note]
> Project cards and numbered Relay cards now expose live task activity, including running prompts, waiting counts, Turbo roles, attention-needed outcomes, and idle readiness. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Numbered Relay selector cards have stable per-number accent colors. Task cards remain neutral and show ownership through their Relay name only; activity badges sit beneath the provider icon at the lower left without adding card height. See [[interface-layout]].

> [!note]
> The selected Relay selector always uses a blue border, subtle blue background, and blue radio mark while retaining its per-number title color. See [[interface-layout]].

> [!note]
> Task cards use the reference footer: one divider, execution and workspace metadata on the left, and status dot, duration, and compact timestamp on the right. See [[interface-layout]].

> [!note]
> A task can contain up to 99 reference images while retaining the 5 MB per-image and 20 MB combined limits. See [[interface-layout]].

> [!note]
> Codex and Claude terminal launches share one window grid. Bounds are reapplied after CLI startup so Claude cannot resize itself out of the selected cell. See [[interface-layout]].

> [!note]
> Terminal launch is now a compact button with adjacent settings. The modal owns command, diagnostics, grid controls, and a persisted option that launches the new terminal minimized behind other windows. See [[interface-layout]].

> [!note]
> Current Direct Execute shows Codex and Claude provider tabs plus the selected project's maximum and active instance counts. It does not require a live-session picker. Fresh work opens a new provider terminal only when a queue slot is available, then closes that exact owned terminal when the task ends. Legacy backends retain the live-session picker and manual launch buttons. See [[disposable-terminal-pools]], [[interface-layout]], and [[project-workspaces]].

> [!note]
> Native Codex launches reserve the selected workspace for the next proxy client, and the proxy applies it to `thread/start.cwd`. Shell `cd` and Codex `--cd` are insufficient with Codex CLI 0.144.5, while workspace metadata in the WebSocket URL is rejected by that CLI. See [[project-workspaces]].

> [!note]
> Closing Relay now waits for queued work to stop, then closes only native terminal windows or process trees launched by that Relay process before the backend and Electron app exit. Normal quit and update installation share this exact-ID cleanup path. See [[project-workspaces]], [[desktop-updates]], and [[diagnostics]].

> [!note]
> Current queued work closes its exact task-owned native launch automatically at the terminal outcome. The guarded selected-Relay **Close** action remains a legacy compatibility control for manually launched terminals with exact native identity. See [[disposable-terminal-pools]], [[project-workspaces]], [[interface-layout]], and [[diagnostics]].

> [!note]
> On a current backend, the composer replaces the selected-terminal controls with per-project Codex and Claude maximum instance controls. **Close selected terminal** appears only in the legacy compatibility UI. See [[disposable-terminal-pools]], [[terminal-close-review]], and [[interface-layout]].

> [!important]
> macOS terminal Close must terminate every process on the exact verified one-tab TTY before closing its exact Terminal.app window. Closing the window first triggers Terminal.app's running-process confirmation and does not complete automatically. Explicit Close and Relay shutdown share this sequence. See [[terminal-close-review]].

> [!note]
> Codex terminals still connect to the fixed public proxy on `4769`, while the browser uses HTTP port `4768`. Relay now gives its private Codex app-server an operating-system-assigned port, connects only to the endpoint advertised by its newly spawned child, and waits for the public proxy before opening a native terminal. This prevents orphaned internal port owners from causing terminal connection failures. See [[diagnostics]] and [[project-workspaces]].

> [!note]
> If a newly launched Codex terminal does not connect within the bounded launch wait, Relay now reports that it could not open a Codex Relay and conditionally points to a required Codex update visible in the terminal. See [[diagnostics]].

> [!note]
> Task badges and footer dots have distinct final-cascade colors for running, queued, complete, failed or interrupted, and cancelled states. See [[interface-layout]].

> [!note]
> Orange is reserved for Claude identity. Generic running state is purple across task cards, Relay badges, project activity, header activity, task events, and planning stages. Relay 4 now uses sky blue instead of orange, and the stylesheet no longer exposes legacy amber tokens. See [[interface-layout]].

> [!note]
> The Queue view orders running work first, queued work by manual queue position, and terminal outcomes newest first. Historical queue positions must not sort completed tasks. See [[task-history]].

> [!note]
> Queued task cards now match execution order from top to bottom: the oldest or manually promoted task is at the top, and a normal new task is appended at the bottom. **Run now** remains the explicit Ctrl+Enter priority exception. See [[task-history]].

> [!note]
> Waiting tasks can now edit their request from Task Activity. Saving preserves task identity, queue position, routing, execution settings, and images; a task that already started or entered active Turbo preparation rejects the edit. See [[task-history]].

> [!note]
> Queue reordering starts from the card grip and uses one immutable global-plus-visible snapshot. Only visible tasks replace their original global slots; a stale `expectedTaskIds` request is rejected atomically and refreshed. Assignment drops onto Relay cards remain separate. See [[task-history]].

> [!note]
> Task Activity now provides **Copy** for Prompt, Result, Claude draft, Codex review, and Final revised plan. Plan outputs copy their stored raw Markdown, pending outputs stay disabled, and task selection clears stale copy payloads. See [[interface-layout]] and [[plan-council]].

> [!note]
> Direct Codex and Claude response text in Task Activity now uses a stronger 650 weight. Commands, reasoning, and protocol messages remain regular weight. See [[interface-layout]].

> [!warning]
> A disconnected Codex terminal is a non-retryable failure. All remaining direct and Turbo automatic retry chains stop after three retries, then wait for manual action. Task 216 proved why both the runner classification and queue-level cap are required. See [[automatic-retry-safety]] and [[diagnostics]].

> [!note]
> A visual polish pass finished the green to blue accent migration in the app chrome. Residual green hover, selected-tint, and empty-state values are neutralized to the cool blue and neutral system, the `--blue` and `--muted` token gaps are closed (restoring the parallel batch bar stripe and checkbox accents), app-chrome controls share one quiet transition, and the primary action gets a single soft lift. Residual green hovers were edited in place, not appended, to preserve the selected-on-hover accent. The dark terminal ledger is unchanged. See [[interface-layout]].

#relay #hot
