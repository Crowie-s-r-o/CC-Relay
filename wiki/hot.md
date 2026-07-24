---
name: Current Relay Notes
description: High-signal context for the next development session.
type: hot
---

# Current Relay Notes

> [!important]
> Direct Claude Execute now runs the turn **inside** the interactive terminal on macOS when Relay owns an exactly resolvable single-tab Terminal.app window for the session. It types a bracketed-paste prompt through `osascript` (Automation permission only; System Events keystrokes are Accessibility-gated and unused) and mirrors the session `.jsonl` transcript into Task Activity. Readiness is registration plus idle in `claude agents --json` (a trust-prompt session is not registered), so even a freshly launched terminal's first turn runs visibly. Immediately before typing, Relay re-verifies the window, tty, and pid against a fresh discovery read because macOS recycles tty names; a mismatch aborts with nothing typed. A terminal-driven turn uses the session's own model and effort; its `claude/started` event carries `sessionMode: 'terminal'`. Non-darwin, unowned terminals, and Plan council keep the headless path. Every failure at or after injection is non-retryable so the queue never double-executes a turn. See [[claude-terminal-visibility]] and [[diagnostics]].

> [!warning]
> Terminal cleanup hazard, learned the hard way (July 24, 2026): macOS recycles tty names, so a tty captured earlier can point at a different session later. Never kill, close, or send to a terminal by a stale tty name; verify live session identity (session id, pid, and cwd) at action time. A spike cleanup that violated this killed an unrelated Claude session. See [[claude-terminal-visibility]].

> [!note]
> Relay uses a custom source-available, view-only license. Public users may inspect the source but receive no permission to run, copy, modify, redistribute, incorporate, or derive another project from it. Do not call this open source. See [[licensing]].

> [!note]
> The launchpad now treats pinned projects as selectable workspace cards. See [[project-workspaces]].

> [!note]
> One Launchpad is always selected whenever pinned projects exist. Activating it again keeps it selected, stale selection recovery chooses an available project, and the final pinned project cannot be removed. There is no **All Projects** state. See [[project-workspaces]].

> [!note]
> Project launch chips match the compact reference: selected cards retain blue and provider accents, while unselected cards mute their tile, text, activity, and launch controls to neutral gray. Controls use regular monospace labels, thin borders, and no selected-card shadow. Electron is locked to 100 percent zoom. See [[project-workspaces]] and [[interface-layout]].

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
> The queue defaults to **All Relays**. Startup, project changes, and provider changes restore that broad view; selecting an execution terminal does not narrow it. **This Relay** is explicit and temporary. See [[task-history]].

> [!note]
> Task queues follow the selected Launchpad project and may narrow to the selected terminal session. Workspace columns are user-resizable, and launch/send diagnostics are persisted locally. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> The header center is a global horizontally scrollable feed containing only currently running tasks across every project. Each card shows project, Relay, duration, prompt, and the latest actual Codex or Claude response; selecting it opens that task in its project. Queue and History remain project-scoped. See [[interface-layout]] and [[project-workspaces]].

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
> Direct execution Model and Effort controls render below the Relay picker so their settings clearly belong to the selected Relay. See [[interface-layout]].

> [!note]
> **Run in parallel** bundles selected waiting tasks into one numbered Codex command sent to the currently selected Codex terminal. Codex receives explicit sub-agent instructions. See [[task-history]].

> [!note]
> Forward-planning turbo uses a read-only Codex planner and a dependency-aware Relay scheduler across multiple live worker terminals. Defaults are Sol high for planning, Luna high for execution, and three workers. See [[turbo-execution]].

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
> Execute Plan council is a checkpointed Claude author, Codex reviewer, Claude revision state machine. Failures never retry automatically. Manual resume preserves completed stages, each active stage emits heartbeats, and the final deliverable is one canonical `.data/tasks/<id>/plan.md`. See [[plan-council]] and [[diagnostics]].

> [!note]
> A completed Execute Plan council can be queued on any selected Codex or Claude Relay in the same workspace. The linked Execute task receives the original request, final reviewed plan, canonical file path, and copied reference images. Planning completion never starts implementation automatically. See [[plan-council]] and [[task-history]].

> [!note]
> The completed-plan panel now keeps the local Git-ignored `plan.md` path visible and includes its own opened-Relay selector for same-workspace Codex and Claude sessions. An older backend shows **Restart to open** and a disabled execution explanation instead of hiding the feature. Task 194 was canonicalized to final-only `plan.md` with no duplicate `result.md`. See [[plan-council]] and [[plan-council-review]].

> [!note]
> Both optional Plan council entry cards use the same shared component, primary label, compact neutral review shell, and interaction states in Execute and Forward-planning Turbo. Turbo adds only its help disclosure and workflow-specific supporting sentence. See [[interface-layout]].

> [!note]
> Execute and Turbo Plan council now share the complete refined surface: neutral rounded shell, single checked-state focus treatment, provider-accented route nodes, rounded settings, and a central arrow handoff. Disabled routes are hidden consistently. Execute retains only its revision and readiness details; Turbo retains only order selection and help. See [[interface-layout]].

> [!note]
> Ctrl+Enter is labeled **Run now**, prioritizes a new submission on the currently selected Relay, and bypasses the optional idle-Relay router. It does not interrupt active work. Shortcut hints are visually separated. See [[task-history]].

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
> Connected Codex terminals are numbered as Relay workers. Queued Codex tasks can be assigned by button or dropped onto another Relay in the same workspace, and direct submissions can opt into idle-terminal routing. See [[task-history]] and [[interface-layout]].

> [!note]
> Idle-terminal routing gives a newly launched Relay up to three seconds to connect when the selected Relay is busy, avoiding a launch-to-enqueue race that otherwise pins the task to the busy Relay. See [[task-history]].

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
> Execute tasks always target their assigned terminal session. Established Claude transcripts use `--resume`; a newly launched Claude terminal is initialized once with its exact assigned session UUID after live identity and workspace revalidation. Idle routing may choose another free session from the same provider and workspace. Background fresh-context routing remains removed. See [[task-history]] and [[project-workspaces]].

> [!note]
> A freshly launched Claude terminal can be discovered before its first transcript exists. Direct execution now handles that exact resume failure by starting the first task with the same session UUID after verifying the live interactive process and workspace. Expected probe stderr is suppressed; stale, background-only, cross-workspace, and cancelled sessions never start the fallback. Discovery still deduplicates repeated IDs and prefers the interactive terminal. See [[project-workspaces]], [[diagnostics]], and [[claude-fresh-session-review]].

> [!note]
> Execute Plan council keeps connected interactive Claude sessions visible as disabled **Execute only** Relay entries. Only Codex Relays are selectable reviewers, and the signed-in Claude CLI authors and revises automatically. This prevents a successful Claude launch from appearing missing while preserving council routing. See [[project-workspaces]] and [[interface-layout]].

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
> Direct Execute no longer shows Codex and Claude provider switchers. It shows both providers' live sessions in one Relay picker; selecting a session chooses its provider and updates Model and Effort. Separate **Launch Codex** and **Launch Claude** buttons replace the generic launch action. See [[interface-layout]] and [[project-workspaces]].

> [!note]
> Native Codex launches reserve the selected workspace for the next proxy client, and the proxy applies it to `thread/start.cwd`. Shell `cd` and Codex `--cd` are insufficient with Codex CLI 0.144.5, while workspace metadata in the WebSocket URL is rejected by that CLI. See [[project-workspaces]].

> [!note]
> Closing Relay now waits for queued work to stop, then closes only native terminal windows or process trees launched by that Relay process before the backend and Electron app exit. Normal quit and update installation share this exact-ID cleanup path. See [[project-workspaces]], [[desktop-updates]], and [[diagnostics]].

> [!note]
> The selected Relay has a guarded **Close** action for terminals with exact native identity. Normal launches bind Claude by its injected interactive session UUID and Codex through a dedicated one-use loopback proxy endpoint. On macOS, Relay can also recover an existing one-tab Terminal window through the exact Claude PID or Codex proxy socket, process PID, and TTY. Queued, running, and retry-scheduled direct, Plan council, and Turbo assignments still block closure. See [[project-workspaces]], [[interface-layout]], and [[diagnostics]].

> [!note]
> **Close selected terminal** is always visible directly beneath the Relay cards. An older backend labels the action **Restart required**. After restart, existing macOS one-tab Terminal sessions are checked automatically, while ambiguous, multi-tab, moved, and task-protected sessions remain disabled. See [[terminal-close-review]] and [[interface-layout]].

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
