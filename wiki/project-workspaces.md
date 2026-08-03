---
name: Project Workspaces
description: How project cards scope CC Relay state and terminal launching.
type: architecture
---

# Project Workspaces

Pinned projects in `public/app.js` are selectable workspace cards. Their catalog, provider limits, and active path are persisted in the per-user `relay-config.sqlite` database shared by localhost and desktop CC Relay. `localStorage` under `relay.activeProjectPath` remains only as a compatibility seed for an older backend and for the first migration.

> [!important]
> The shared project config is deliberately separate from each server's task database. Standalone CC Relay keeps tasks under the repository `.data` directory, while desktop CC Relay keeps tasks under Electron's per-user data root. Sharing the task database would allow two live schedulers to recover or dispatch the same queue rows. See [[shared-project-configuration]].

Project identity color starts from a deterministic hash of the normalized project path in `public/project-colors.js`. The visible project list then resolves collisions against the remaining slots in the eight-color palette, so up to eight pinned projects never share an automatic color. The project name, solid initial tile, flat card tint, selected outline, and matching global running-task card reuse the resolved identity. A project can instead persist a preset or custom hex color through the initial-tile picker. See [[project-color-customization]].

Execute Plan council uses the task's persisted project path as artifact authority. Its final Markdown is written to `<project-root>/.data/tasks/<task-id>/plan.md`, while the draft, review, and recovery checkpoints remain in CC Relay's central data directory. A completed legacy council is migrated to the project path when read. CC Relay never changes the target repository's `.gitignore`.

> [!note]
> The colors should feel varied, but they are intentionally deterministic rather than generated with `Math.random()`. Reloading CC Relay or rendering the same pinned project in the header must not change its identity. Adding or reordering projects may change a collision-resolved assignment because uniqueness within the visible set takes priority.

One Launchpad project is always selected whenever pinned projects exist. Clicking or keyboard-activating the selected project keeps it selected. Startup and stale saved-selection recovery choose the saved project, a connected legacy workspace, or the first pinned project.

> [!important]
> There is no unscoped or **All Projects** Queue or History state. A missing project path yields no task cards, never tasks from every project. Removing the active project immediately selects another pinned project, and CC Relay prevents removal of the final pinned project. The header running-task rail is deliberately global so concurrent work across projects remains visible without changing the selected workspace.

Project cards are status and selection surfaces, not terminal launch surfaces. They do not contain Codex or Claude buttons. Terminal creation remains available through the Launchpad heading actions and the composer connection controls. Every unselected card carries a quiet 4 percent flat identity tint and mixed-color outline, with a 7 percent tint on hover. The selected project keeps the same one-pixel border geometry, strengthens the flat identity tint to 11 percent, and adds only a quiet one-pixel shadow. The solid initial tile carries project identity without a surrounding ring. There is no outer keyline or vertical lift, so selection does not create a thick frame or shift the card content.

> [!note]
> Global running-task cards split project and CC Relay ownership in markup. `.header-running-project` uses the resolved project accent, while the adjacent CC Relay name stays neutral. The same accent also controls the flat task surface, border, live dot, and task-number chip. See [[interface-layout]].

> [!important]
> Launchpad and running-task identity surfaces use solid colors and `color-mix()` tints only. Do not add linear gradients or a full-height left accent edge. Selection is communicated through the whole outline and a slightly stronger flat tint.

> [!important]
> Keep the eight project accents dark enough for normal-size colored names. `test/project-colors.test.mjs` requires at least 4.5:1 contrast on the strongest project tint and behind the white initial tile. Custom colors derive contrast-safe light and dark tokens. Project identity still excludes orange, which remains reserved for Claude.

> [!important]
> On wide desktop screens, the entire Launchpad is 44px high and the workspace height calculation subtracts the matching 102px combined header and Launchpad height. See [[compact-interface-density]].

> [!important]
> Desktop project cards are one 30px row and 176px wide. Only the folder name and current state are visible; the complete path remains in the card title. The project list scrolls horizontally when necessary. Do not place activity beneath the project name inside the fixed desktop dock. The heading, project list, and actions share the same wide-screen row.

> [!important]
> The unpin control owns the final `close` grid area of `.project-chip`. It must be a direct card child after the activity group, never a child of `.project-chip-head`. Nesting it in the name sub-grid places the close button in the middle of the card.

Each project card includes a compact live state derived from persisted tasks in that exact workspace. Its visible label is **Running**, **Waiting**, **Restart needed**, **Attention**, **Finished**, or **Idle**. Status priority is running, queued, latest failure or interruption, unchecked completion, then idle. A numbered badge remains visible when a completed task has not been opened in Task Activity, including while a higher-priority live state is shown. Task-specific detail, unchecked completion count, and restart guidance remain in the card's accessible label even though they no longer consume visible rail space. Queue and task events already trigger the normal client refresh, so this state requires no separate polling channel. See [[launchpad-completion-notifications]].

The project path is not repeated inside the compact card. The complete path remains in the card title and continues to drive all workspace matching.

The active project scopes:

- Task cards and project-level status counts
- Codex and Claude provider, model, and effort choices
- Per-provider automatic instance limits and active usage
- Every disposable terminal launch and its working directory
- Legacy connected-session controls when an older backend is active

In current direct Execute mode, provider tabs choose Codex or Claude and the selected project's automatic pool supplies the terminal later. No live session is selected when a fresh task is submitted. The provider catalog still drives the adjacent Model and Effort controls. A backend without `capabilities.disposableTerminalPools` retains the former live-session picker as a compatibility path.

## Stable CC Relay identity

Codex CC Relay identity is global across workspaces and is persisted in SQLite by thread ID. Each new Codex thread receives the next positive `relay_number`, and its immutable `relay_name` is formatted as `CC Relay n`. Disconnecting a thread never recycles its number; reconnecting the same thread reuses the stored identity. The server exposes these values as `relayNumber` and `relayName` on Codex thread objects. Claude sessions keep their provider-specific identity and do not receive a CC Relay number.

The terminal picker and task cards render the persisted fields directly. They must never derive a CC Relay number from discovery order, `updatedAt`, array position, or the currently visible workspace. This keeps names, six-color classes, task ownership, and Turbo worker attribution stable when a new terminal is launched or existing terminals reconnect in a different order. See [[task-history]] and [[interface-layout]].

Each pinned project owns an independent task queue. Queue positions, priority insertion, retry append order, stale reorder validation, pause state, FIFO barriers, and dispatch eligibility are scoped by the task's exact `repo_path`. Reordering Alpha never rewrites Beta positions, pausing Alpha leaves Beta runnable, and a Plan council running in Alpha does not hold direct Codex work at the head of Beta's queue. CC Relay still coordinates shared provider and terminal resources centrally, so provider-wide exclusive tasks remain serialized even though unrelated direct Codex work can run beside them.

Direct execution capacity is controlled by `max_codex_instances` and `max_claude_instances` on each pinned project. Both default to 1 and can be set from 1 through 8 in the left composer panel. A project's active and reserved disposable work consumes only that project's provider limits. Separate projects can therefore use their own limits concurrently, subject to the machine and provider account.

> [!note]
> The configured number is an upper bound, not a promise that every provider process will start instantly. Queue order, exclusive workflow barriers, provider authentication, native launch binding, and machine resources still apply.

> [!important]
> Capacity is counted from both active task reservations and exact native launches. A terminal whose cleanup failed remains counted until CC Relay can prove that exact launch is gone. Never release capacity merely because session discovery stopped listing it.

Direct Execute and Planner breakdown need one slot from their selected provider. Plan council needs one Claude and one Codex slot. Turbo needs one Codex planner plus its worker count, and adds one Claude slot when its council runs through a terminal. CC Relay validates an atomic workflow requirement before it starts, so it never launches half a Plan council or a partial Turbo fleet and then waits while holding those terminals.

> [!important]
> A backend without `capabilities.parallelClaudeExecution` still has the former global Claude lock. When a direct Claude task waits behind a different active Claude session, project activity and queue summary must say **Restart CC Relay for parallel Claude projects** instead of presenting the delay as ordinary FIFO waiting.

> [!important]
> Compute the normal exclusive barrier from the active and queued tasks in each project. A legacy persistent Plan council or non-executing Turbo parent blocks later work in its own project. A disposable Plan council keeps the global council slot but shares its project with disposable single-session work when `DisposableTerminalPool.canRun()` proves the combined Codex and Claude requirements fit. Direct Codex and direct Claude execution reserve their provider capacity and bound session IDs. An exclusive task must not cause `runnableTasks()` to return an empty global result when another project has eligible work on a free provider resource. Task 150 and task 151 on July 17, 2026 exposed the old global barrier when an Agreau Plan council unnecessarily held a CC Relay project task until the council was cancelled. Task 364 on July 28 exposed the remaining same-project disposable barrier.

> [!important]
> Renderer files can refresh while the Node backend remains alive. `/api/status` advertises `capabilities.projectQueueIsolation` when project-scoped dispatch is active. If the capability is missing and another project is visibly holding waiting work, project cards and the queue summary must request a normal CC Relay restart. Task 184 proved that refreshing the page alone does not replace an old in-memory scheduler. See [[project-queue-isolation-review]].

Each project also owns an in-memory workspace session. Switching Launchpads saves and restores the prompt draft, reference images, selected Task Activity task, Execute or Turbo mode, Plan council settings, provider, model settings, and an older-backend terminal-settings fallback. Current terminal retention, idle routing, grid, monitor, and background launch are persisted on the exact project row described in [[project-terminal-settings]]. A project without saved state starts with a blank prompt, no images, no selected task, Execute with Codex, terminal retention disabled, and clean terminal layout defaults. A legacy selected terminal remains in the compatibility snapshot but current disposable submissions ignore it. There is no queue-scope state because every CC Relay in the project is always visible. Workspace state cannot be created without a project path.

> [!important]
> Never build a reorder snapshot from every queued task. The client sends only the active project's queued IDs plus its project path, and the database validates and renumbers only that path. Cross-project task IDs must fail stale-order validation.

> [!note]
> Composer sessions are intentionally kept in memory. Prompt drafts and image data do not leak while switching Launchpads, but they are not promised to survive a CC Relay page or application restart.

> [!note]
> Selecting a project immediately makes its normalized exact path the outer boundary for Queue and History. A project switch restores that project's last selected detail task, composer, and execution terminal, then refreshes terminals, task cards, counts, and statistics across every CC Relay in that project. A remembered task is restored only when its stored `repo_path` exactly matches the incoming project; a deleted, stale, or mismatched task produces an empty detail panel. See [[task-history]].

> [!important]
> Task Activity selection is remembered only for the current in-memory browser session. `public/app.js` stores `selectedTaskId` in `ProjectComposerStore`, validates it against the incoming project before rendering, and reopens it through `selectTask()`. Do not restore an ID without the exact project-path check, because task IDs alone do not define the visible workspace boundary.

## Automatic terminal lifecycle

With `capabilities.disposableTerminalPools`, a task is persisted before any provider terminal exists. When the task is runnable and the project has capacity, CC Relay launches a fresh native terminal in the exact project path and binds it through provider-specific proof: the Codex proxy launch reservation or the expected Claude session ID. It requires two stable discovery observations before the task owns the session.

Every native launch has a fresh `launchId`, including a terminal that resumes an older conversation ID. Task completion, failure, cancellation, or interruption releases the task. When the task snapshots project retention as enabled, its final exact launch remains connected without consuming pool capacity. When retention is disabled, CC Relay closes that exact launch. Manually opened windows are never part of automatic cleanup. See [[disposable-terminal-pools]] and [[retained-terminal-sessions]].

### Legacy manual terminal handoff

After a launch, the client polls session discovery for up to 15 seconds. It matches provider and normalized working-directory path and accepts only a session ID that was not present before the launch. The new session must appear in two consecutive discovery results before CC Relay selects it. Existing sessions in the same workspace are never used as a fallback for a newly launched terminal.

The **Connect another Codex terminal** disclosure preserves its user-controlled open state across terminal discovery refreshes. `renderThreads()` may open it automatically when there are no visible terminals, but it must not force it closed when terminals exist. Silent polling runs regularly, so assigning `connectionHelp.open = false` in the populated-terminal render path makes the panel appear to close by itself while the user is working in it.

Thread discovery requests carry a monotonically increasing client-side sequence. A slower response is ignored when a newer discovery request has already started, preventing stale background refreshes from replacing the launch handoff state.

> [!important]
> The previous implementation looked for a new session first but immediately fell back to the first existing workspace session. When a project already had a connected terminal, **Launch terminal** therefore reported ready before the new terminal connected and could send the next task to the wrong thread.

> [!important]
> Do not reset the connection disclosure in the normal populated-terminal render path. Terminal polling is background state synchronization and must not override an active UI disclosure.

If no project card is active but a live session is already selected, **Launch terminal** silently pins and reuses that session's working directory. The native folder picker is only used when CC Relay has neither an active project nor a selected session with a working directory.

> [!note]
> Path comparison normalizes slash direction and trailing separators so macOS and Windows project paths can use the same client-side matching logic.

## Terminal interaction model

The event rail inside **Terminal output** remains a read-only viewer, not a terminal emulator. It renders provider events recorded by CC Relay and offers filtering, follow mode, and log copying. Direct tasks add a separate **Continue session** dock above that rail. For a running Codex task, sending uses the app-server steering protocol to update the exact active turn. For a running interactive Claude task, sending uses exact owned-terminal steering. After a disposable turn finishes, the dock keeps the original task selected, reserves a free provider slot, launches a terminal, and resumes the saved conversation under the same task ID. A live retained or legacy persistent session starts immediately in its original terminal. No continuation path creates queue work. See [[claude-live-steering-review]], [[task-history]], [[same-task-session-continuation]], and [[interface-layout]].

Codex sandbox policy is turn-persistent. CC Relay must send an explicit `dangerFullAccess` policy on every normal Execute and finished-task follow-up, because an omitted policy inherits a prior read-only Plan council or Turbo planning policy. Read-only stages still receive an explicit `readOnly` policy. See [[codex-sandbox-isolation]].

The manual macOS **Launch terminal** action opens a real Terminal.app window and starts the provider CLI there. For Codex, that process connects to CC Relay's shared app-server with `--remote`. Manual sessions are independent from current queued work, which launches and owns its own disposable terminal.

CC Relay owns the native terminals it launches for the lifetime of the desktop app. On macOS, `ProjectLauncher` captures the exact Terminal window ID returned for each launched tab. On Windows, it captures the `cmd.exe` process ID returned by `Start-Process -PassThru`. During graceful shutdown, CC Relay first stops queued work, then closes only those process-launched Terminal windows or Windows process trees, and only afterward closes the Codex app-server and database. Runtime-recovered or user-opened terminal windows are never included in automatic shutdown cleanup.

On a current backend, the composer hides the terminal picker and **Close selected terminal** row and shows project provider limits instead. The picker and explicit close action remain available only in the legacy compatibility UI. Each successful native launch still receives an in-memory launch ID. `TerminalLaunchCoordinator` serializes launch and discovery until it observes the exact new session twice. Claude starts its interactive CLI with a controlled session UUID; Codex receives a dedicated one-use loopback WebSocket endpoint that carries the launch UUID into the proxy client record. The backend verifies provider and canonical project path before binding the session to the captured native handle. Automatic cleanup targets that one launch ID.

On macOS, `TerminalRuntimeResolver` can recover exact control for an already-running session. Claude discovery supplies the interactive process PID. A Codex thread supplies one exact proxy client socket, which `lsof` maps to one Codex PID. CC Relay maps that PID to one TTY through `ps`, then requires exactly one Terminal.app window containing exactly one tab with that TTY. Any missing, duplicate, multi-client, multi-tab, or shared-window result is rejected. The coordinator repeats session identity verification at the API boundary, and the launcher rechecks the process TTY and window TTY immediately before closing.

> [!important]
> Native handles are never persisted. A process-launched terminal is bound in memory. A macOS runtime-recovered terminal is re-derived from its live PID, socket, TTY, and single-tab window, is revalidated before every explicit close, and is excluded from graceful-shutdown cleanup. A session moved to another terminal invalidates the old mapping instead of closing the former window.

> [!warning]
> A queued, running, or scheduled-to-retry legacy task protects every terminal it owns. Disposable tasks reserve provider capacity and their exact native launches instead. CC Relay closes each disposable launch automatically at the task outcome, and a cleanup failure keeps its capacity reserved.

> [!important]
> Never replace exact identity with a broad Terminal quit, `close every window`, process-name-only kill, workspace-path match, or window-title match. Those approaches can close unrelated user terminals. Runtime recovery requires the complete live identity chain, and a multi-tab window is rejected. New native launches are rejected once shutdown begins, and the serialized launch queue is allowed to settle before its launch-owned handles are closed.

The public Codex terminal endpoint is `ws://127.0.0.1:4769`, distinct from the CC Relay browser at `http://127.0.0.1:4768`. Before opening a Codex terminal, `ProjectLauncher` awaits complete shared app-server and proxy startup. It does not reserve workspace handoff state or dispatch the native terminal until the proxy is confirmed listening. The private Codex app-server uses an operating-system-assigned port and is never embedded in a terminal command. See [[diagnostics]].

> [!important]
> Keep the readiness check inside the serialized native launch path. A UI status poll is not an ownership guarantee and cannot prevent a terminal from racing app-server startup.

Codex launch commands pass the selected project through the CLI's explicit `--cd` option, but Codex CLI 0.144.5 does not carry that value into `thread/start` when connected to a remote shared app-server. The native launcher therefore creates a dedicated operating-system-assigned loopback proxy port for the canonical project path and launch UUID immediately before dispatch, then places that private endpoint in only the new terminal's command. When that client sends `thread/start`, the proxy overwrites `params.cwd` with the reserved path and associates the resulting thread with that UUID. The listener stops accepting after its client connects. Unclaimed endpoints expire after 30 seconds and are released after binding timeout or native dispatch failure, so a manual client on the shared `4769` endpoint cannot steal launch ownership.

> [!important]
> Shell `cd` and Codex `--cd` alone do not establish the remote thread workspace. The proxy reservation and `thread/start.cwd` rewrite are the authoritative handoff. Keep `--cd` for terminal consistency and future Codex compatibility, but do not remove the proxy rewrite unless a verified Codex release forwards the selected directory.

> [!note]
> Encoding the workspace in the WebSocket URL was tested and rejected. Codex CLI 0.144.5 accepts only bare `ws://host:port` or `wss://host:port` network endpoints, so paths and query strings cannot carry launch metadata.

Fresh Codex remote threads are visible through `thread/read` before their first rollout is persisted. Calling `thread/resume` during that window fails with `no rollout found for thread id`. CC Relay treats only that exact failure as a fresh-thread case and proceeds with `turn/start`; established threads still use `thread/resume` so their existing context and subscription behavior are preserved.

After `turn/start` succeeds for a fresh thread, CC Relay immediately calls `thread/resume` again. The first successful turn has now created the rollout, so this second resume subscribes CC Relay's app-server connection to live notifications. Without the post-start resume, the native terminal displays progress but Task Activity receives no item events and remains nearly empty until polling observes the final result. The successful subscription is released with `thread/unsubscribe` when the task finishes.

The rollout file can exist but remain empty for a short interval after `turn/start`. CC Relay treats both `no rollout found for thread id` and `rollout ... is empty` as fresh-thread persistence races. The post-start subscription retries with bounded backoff and records deferred attempts only in diagnostics. It does not render a Terminal warning for this transient state. Completion polling applies the same classification so an empty rollout cannot flood Task Activity while Codex is still persisting the first turn.

> [!important]
> A transient subscription failure must never decide task completion or queue ownership. CC Relay continues with polling even if all bounded subscription attempts are exhausted.

> [!note]
> A connected, idle thread is not necessarily resumable. The first turn creates its rollout. Do not reject a newly launched terminal solely because `thread/resume` cannot find one yet.

> [!important]
> Do not rely only on completion polling for a fresh terminal's first task. Polling recovers the final result but cannot populate the live execution ledger.

> [!important]
> UI wording can be misleading: **Terminal output** means task activity output, while **Launch terminal** means opening an external native terminal.

## Legacy fresh Claude terminal execution

This section documents the persistent selected-session compatibility path. Current disposable work creates a fresh Claude conversation in its own native terminal, or relaunches `claude --resume <conversation-id>` for an explicit continuation.

`claude agents --json` can report a newly launched interactive Claude terminal before that terminal has saved its first conversation transcript. The session is live and selectable, but `claude -p --resume <session-id>` exits with **No conversation found with session ID** until a first turn exists.

Direct Claude execution first attempts the normal `--resume` path. If and only if Claude returns the exact missing-conversation error naming the selected session ID, CC Relay refreshes live discovery and requires the same UUID to still identify an idle interactive Claude process in the exact task workspace. CC Relay then runs the first turn with `--session-id <same-session-id>`, preserving the prompt, model, effort, attachments, event stream, cancellation ownership, and transcript identity. CC Relay also requires Claude's successful result to report that same UUID. Later turns use `--resume` normally.

This is same-session initialization, not fresh-context routing. Claude Code 2.1.216 was verified with an interactive process left open: the first print-mode turn using its exact UUID completed, and a subsequent `--resume` using that UUID retained the transcript. The native terminal does not redraw output produced by the headless task process, so Task Activity remains the live execution surface.

If the interactive terminal creates its transcript after CC Relay's failed resume probe but before first-turn initialization, Claude rejects `--session-id` with **Session ID ... is already in use**. CC Relay handles only that same-UUID race, revalidates the interactive terminal again, waits for it to become idle, and returns to normal `--resume` without failing or duplicating the task.

Task 164 on July 20, 2026 exposed an unsafe earlier fallback that became an unbounded hidden process after the resume failure. The current path keeps the child inside `ClaudeExecutionRunner`, emits `claude/session-initializing`, streams its activity, and remains cancellable. The expected probe error is not rendered as a Terminal warning. Any closed terminal, background-only duplicate, workspace mismatch, or cancellation stops before the initialization process starts.

`claude agents --json` may temporarily list both the interactive terminal and a print or background child with the same session ID. Discovery deduplicates by session ID, prefers `kind = interactive`, and otherwise keeps the newest record. Duplicate DOM entries with the same ID make both cards appear selected and must never reach the browser.

In this legacy path, Execute Plan council on macOS has its own Claude author-terminal selector and uses the ordinary CC Relay picker for the Codex reviewer. Current automatic Plan council has no selectors: it reserves and launches one Claude author plus one Codex reviewer from the project's pool. See [[interface-layout]] and [[disposable-terminal-pools]].

> [!important]
> A selected Claude session disappearing before dispatch or before first-turn initialization is a non-retryable session error. Do not treat absence, a background duplicate, or a different workspace as the selected interactive terminal. Session identity failures wait for an explicit manual retry instead of entering the generic automatic retry loop.

> [!important]
> Preserve Claude stderr as the primary failure message when the stream result contains only a generic error. Otherwise a precise session failure is reduced to **Claude could not complete the task**, which makes terminal routing defects hard to diagnose.

Regression coverage lives in `test/claude-execution-runner.test.mjs`.

See [[claude-fresh-session-review]].

## Files

- `public/app.js`
- `public/style.css`
- `public/terminal-close-state.js`
- `src/project-launcher.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/terminal-close-coordinator.mjs`
- `src/terminal-control.mjs`
- `src/terminal-runtime-resolver.mjs`
- `src/codex-app-server.mjs`
- `src/claude-execution-runner.mjs`
- `src/websocket-proxy.mjs`
- `test/terminal-runtime-resolver.test.mjs`
- `README.md`

#relay #projects #queue #terminal
