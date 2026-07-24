---
name: Project Workspaces
description: How project cards scope Relay state and terminal launching.
type: architecture
---

# Project Workspaces

Pinned projects in `public/app.js` are selectable workspace cards. The active path is persisted in `localStorage` under `relay.activeProjectPath`.

One Launchpad project is always selected whenever pinned projects exist. Clicking or keyboard-activating the selected project keeps it selected. Startup and stale saved-selection recovery choose the selected terminal's project, another connected workspace, or the first pinned project.

> [!important]
> There is no unscoped or **All Projects** Queue or History state. A missing project path yields no task cards, never tasks from every project. Removing the active project immediately selects another pinned project, and Relay prevents removal of the final pinned project. The header running-task rail is deliberately global so concurrent work across projects remains visible without changing the selected workspace.

Project launch buttons follow the compact reference: 30px high, regular-weight monospace labels, thin 6px-radius borders, and neutral white surfaces for both providers. On the selected card, only the Claude icon and label use the orange provider accent, `#C96A1F`. The selected project uses a single-pixel blue outline with no elevated shadow. Keep these rules in the late cascade correction section of `public/style.css`, where they can override the older generic project-button surfaces.

> [!note]
> The Claude launch button uses a deterministic inline SVG burst beside its label. Its orange foreground is owned by `.project-launch-claude`, while `.project-launch-icon` draws with `currentColor`. Keep the button as an inline flex row so the 12px mark remains visible and aligned with the orange label. A font glyph was avoided because fallback fonts rendered the burst smaller and with inconsistent spoke shapes.

Unselected project cards intentionally reduce visual weight. Their initial tile becomes cool gray, project and path text become muted, activity accents lose saturation, and both provider launch buttons use the same neutral gray treatment. Hover may increase contrast slightly but must not restore blue or orange provider colors until the card is selected.

> [!important]
> Keep the unselected rules after the generic provider and hover rules in the final cascade. Earlier placement lets the orange Claude hover treatment leak back into inactive cards.

> [!important]
> Do not enlarge these controls to match the primary action buttons. They are secondary inline launch shortcuts inside a compact project card.

Each project card includes a live activity line derived from persisted tasks in that exact workspace. Status priority is running, queued, latest failure or interruption, then idle. Running summaries include the active task number and compact prompt plus any waiting count; idle summaries retain the last completed task number. Queue and task events already trigger the normal client refresh, so this line requires no separate polling channel.

The visible project path shows only its final two directory names separated by ` / `. For example, `/Users/patrikkelemen/WebstormProjects/relay` renders as `WebstormProjects / relay`. The complete path remains in the card title and continues to drive all workspace matching.

The active project scopes:

- Connected Codex and Claude sessions
- Task cards and project-level status counts
- Parallel Claude session choices
- The explicit **Launch Codex** and **Launch Claude** actions

In direct Execute mode, the session picker combines live Codex and Claude sessions for the active project. The selected session determines the execution provider, so its provider catalog drives the adjacent Model and Effort controls. Provider filtering remains in place for Codex-only workflows such as Plan council review and Turbo planning.

## Stable Relay identity

Codex Relay identity is global across workspaces and is persisted in SQLite by thread ID. Each new Codex thread receives the next positive `relay_number`, and its immutable `relay_name` is formatted as `Relay n`. Disconnecting a thread never recycles its number; reconnecting the same thread reuses the stored identity. The server exposes these values as `relayNumber` and `relayName` on Codex thread objects. Claude sessions keep their provider-specific identity and do not receive a Relay number.

The terminal picker and task cards render the persisted fields directly. They must never derive a Relay number from discovery order, `updatedAt`, array position, or the currently visible workspace. This keeps names, six-color classes, task ownership, and Turbo worker attribution stable when a new terminal is launched or existing terminals reconnect in a different order. See [[task-history]] and [[interface-layout]].

Each pinned project owns an independent task queue. Queue positions, priority insertion, retry append order, stale reorder validation, pause state, FIFO barriers, and dispatch eligibility are scoped by the task's exact `repo_path`. Reordering Alpha never rewrites Beta positions, pausing Alpha leaves Beta runnable, and a Plan council running in Alpha does not hold direct Codex work at the head of Beta's queue. Relay still coordinates shared provider and terminal resources centrally, so provider-wide exclusive tasks remain serialized even though unrelated direct Codex work can run beside them.

Direct execution capacity is session-scoped across any number of projects. Relay imposes no project-count or global direct-execution limit. Every distinct live Codex or Claude session may execute at the same time, including mixed-provider work in every project. Only tasks assigned to the same exact session ID remain sequential. The global running-task header is the cross-project monitoring surface while each Launchpad keeps its own Queue and History.

> [!note]
> Regression coverage generates twelve project paths and starts twenty-four direct tasks simultaneously: one Codex and one Claude task per project. Separate Claude runner coverage confirms twelve independent CLI processes receive the correct project working directories. Twelve is a practical test size, not a product maximum.

> [!important]
> Do not introduce a fixed project or direct-session concurrency constant. Capacity is the number of distinct connected session IDs. Machine resources and provider account throttling may limit real throughput, but Relay must not add an artificial project-count ceiling.

> [!important]
> A backend without `capabilities.parallelClaudeExecution` still has the former global Claude lock. When a direct Claude task waits behind a different active Claude session, project activity and queue summary must say **Restart Relay for parallel Claude projects** instead of presenting the delay as ordinary FIFO waiting.

> [!important]
> Compute the normal exclusive barrier from the active and queued tasks in each project. A Plan council or non-executing Turbo parent blocks later work in its own project. Direct Codex and direct Claude execution reserve only their own session IDs, so eligible direct work on another session can start. An exclusive task must not cause `runnableTasks()` to return an empty global result when another project has eligible work on a free provider resource. Task 150 and task 151 on July 17, 2026 exposed the old global barrier when an Agreau Plan council unnecessarily held a Relay project task until the council was cancelled.

> [!important]
> Renderer files can refresh while the Node backend remains alive. `/api/status` advertises `capabilities.projectQueueIsolation` when project-scoped dispatch is active. If the capability is missing and another project is visibly holding waiting work, project cards and the queue summary must request a normal Relay restart. Task 184 proved that refreshing the page alone does not replace an old in-memory scheduler. See [[project-queue-isolation-review]].

Each project also owns an in-memory composer session. Switching Launchpads saves and restores the prompt draft, reference images, Execute or Turbo mode, Plan council settings, provider, model settings, and selected terminal. A project without saved state starts with a blank prompt, no images, Execute with Codex, and its own eligible terminal selection. Queue scope is intentionally excluded from the snapshot and resets to the broad project view. Composer state cannot be created without a project path.

> [!important]
> Never build a reorder snapshot from every queued task. The client sends only the active project's queued IDs plus its project path, and the database validates and renumbers only that path. Cross-project task IDs must fail stale-order validation.

> [!note]
> Composer sessions are intentionally kept in memory. Prompt drafts and image data do not leak while switching Launchpads, but they are not promised to survive a Relay page or application restart.

> [!note]
> Selecting a project immediately makes its normalized exact path the outer boundary for Queue and History. A project switch resets task scope to **All Relays**, clears the selected detail task, restores that project's composer and execution terminal, and then refreshes terminals, task cards, counts, and statistics. See [[task-history]].

## Terminal handoff

After a launch, the client polls session discovery for up to 15 seconds. It matches provider and normalized working-directory path and accepts only a session ID that was not present before the launch. The new session must appear in two consecutive discovery results before Relay selects it. Existing sessions in the same workspace are never used as a fallback for a newly launched terminal.

The **Connect another Codex terminal** disclosure preserves its user-controlled open state across terminal discovery refreshes. `renderThreads()` may open it automatically when there are no visible terminals, but it must not force it closed when terminals exist. Silent polling runs regularly, so assigning `connectionHelp.open = false` in the populated-terminal render path makes the panel appear to close by itself while the user is working in it.

Thread discovery requests carry a monotonically increasing client-side sequence. A slower response is ignored when a newer discovery request has already started, preventing stale background refreshes from replacing the launch handoff state.

> [!important]
> The previous implementation looked for a new session first but immediately fell back to the first existing workspace session. When a project already had a connected terminal, **Launch terminal** therefore reported ready before the new terminal connected and could send the next task to the wrong thread.

> [!important]
> Do not reset the connection disclosure in the normal populated-terminal render path. Terminal polling is background state synchronization and must not override an active UI disclosure.

If no project card is active but a live session is already selected, **Launch terminal** silently pins and reuses that session's working directory. The native folder picker is only used when Relay has neither an active project nor a selected session with a working directory.

> [!note]
> Path comparison normalizes slash direction and trailing separators so macOS and Windows project paths can use the same client-side matching logic.

## Terminal interaction model

The event rail inside **Terminal output** remains a read-only viewer, not a terminal emulator. It renders provider events recorded by Relay and offers filtering, follow mode, and log copying. Direct tasks add a separate **Continue session** dock above that rail. For a running Codex task, sending uses the app-server steering protocol to update the exact active turn. After a turn finishes, the dock immediately starts the next provider turn against the exact original session and reuses the source task activity. Neither path creates queue work or injects raw keystrokes. See [[task-history]] and [[interface-layout]].

The macOS **Launch terminal** action opens a real Terminal.app window and starts the provider CLI there. For Codex, that process connects to Relay's shared app-server with `--remote`. The same Codex thread can still be used interactively in Terminal.app when idle, but the user should not submit another prompt while a Relay task is running in that thread because Relay and the interactive client share the thread's active-turn state.

Relay owns the native terminals it launches for the lifetime of the desktop app. On macOS, `ProjectLauncher` captures the exact Terminal window ID returned for each launched tab. On Windows, it captures the `cmd.exe` process ID returned by `Start-Process -PassThru`. During graceful shutdown, Relay first stops queued work, then closes only those process-launched Terminal windows or Windows process trees, and only afterward closes the Codex app-server and database. Runtime-recovered or user-opened terminal windows are never included in automatic shutdown cleanup.

The terminal picker always exposes a **Close selected terminal** row directly beneath its Relay cards. The action remains visible when disabled and explains whether Relay needs a restart, native identity is ambiguous, or a task currently protects it. Each successful native launch receives an in-memory launch ID. `TerminalLaunchCoordinator` serializes launch and discovery until it observes the exact new session twice. Claude starts its interactive CLI with the launch UUID as `--session-id`; Codex receives a dedicated one-use loopback WebSocket endpoint that carries the launch UUID into the proxy client record. The backend also verifies provider and canonical project path before binding that thread to the captured native handle. The browser only selects the backend-confirmed thread. Closing targets one bound handle and automatically selects the next eligible session in the composer.

On macOS, `TerminalRuntimeResolver` can recover exact control for an already-running session. Claude discovery supplies the interactive process PID. A Codex thread supplies one exact proxy client socket, which `lsof` maps to one Codex PID. Relay maps that PID to one TTY through `ps`, then requires exactly one Terminal.app window containing exactly one tab with that TTY. Any missing, duplicate, multi-client, multi-tab, or shared-window result is rejected. The coordinator repeats session identity verification at the API boundary, and the launcher rechecks the process TTY and window TTY immediately before closing.

> [!important]
> Native handles are never persisted. A process-launched terminal is bound in memory. A macOS runtime-recovered terminal is re-derived from its live PID, socket, TTY, and single-tab window, is revalidated before every explicit close, and is excluded from graceful-shutdown cleanup. A session moved to another terminal invalidates the old mapping instead of closing the former window.

> [!warning]
> A queued, running, or scheduled-to-retry task protects every terminal it owns. This includes direct and Plan council `thread_id` assignments plus Turbo planner and worker assignments. Cancel or reassign the task before closing its terminal. While a close is reserved, new enqueue, retry, assignment, planner, and dispatch operations cannot claim that terminal. The API repeats this validation against the live session and current tasks even when the browser previously rendered the action as available.

> [!important]
> Never replace exact identity with a broad Terminal quit, `close every window`, process-name-only kill, workspace-path match, or window-title match. Those approaches can close unrelated user terminals. Runtime recovery requires the complete live identity chain, and a multi-tab window is rejected. New native launches are rejected once shutdown begins, and the serialized launch queue is allowed to settle before its launch-owned handles are closed.

The public Codex terminal endpoint is `ws://127.0.0.1:4769`, distinct from the Relay browser at `http://127.0.0.1:4768`. Before opening a Codex terminal, `ProjectLauncher` awaits complete shared app-server and proxy startup. It does not reserve workspace handoff state or dispatch the native terminal until the proxy is confirmed listening. The private Codex app-server uses an operating-system-assigned port and is never embedded in a terminal command. See [[diagnostics]].

> [!important]
> Keep the readiness check inside the serialized native launch path. A UI status poll is not an ownership guarantee and cannot prevent a terminal from racing app-server startup.

Codex launch commands pass the selected project through the CLI's explicit `--cd` option, but Codex CLI 0.144.5 does not carry that value into `thread/start` when connected to a remote shared app-server. The native launcher therefore creates a dedicated operating-system-assigned loopback proxy port for the canonical project path and launch UUID immediately before dispatch, then places that private endpoint in only the new terminal's command. When that client sends `thread/start`, the proxy overwrites `params.cwd` with the reserved path and associates the resulting thread with that UUID. The listener stops accepting after its client connects. Unclaimed endpoints expire after 30 seconds and are released after binding timeout or native dispatch failure, so a manual client on the shared `4769` endpoint cannot steal launch ownership.

> [!important]
> Shell `cd` and Codex `--cd` alone do not establish the remote thread workspace. The proxy reservation and `thread/start.cwd` rewrite are the authoritative handoff. Keep `--cd` for terminal consistency and future Codex compatibility, but do not remove the proxy rewrite unless a verified Codex release forwards the selected directory.

> [!note]
> Encoding the workspace in the WebSocket URL was tested and rejected. Codex CLI 0.144.5 accepts only bare `ws://host:port` or `wss://host:port` network endpoints, so paths and query strings cannot carry launch metadata.

Fresh Codex remote threads are visible through `thread/read` before their first rollout is persisted. Calling `thread/resume` during that window fails with `no rollout found for thread id`. Relay treats only that exact failure as a fresh-thread case and proceeds with `turn/start`; established threads still use `thread/resume` so their existing context and subscription behavior are preserved.

After `turn/start` succeeds for a fresh thread, Relay immediately calls `thread/resume` again. The first successful turn has now created the rollout, so this second resume subscribes Relay's app-server connection to live notifications. Without the post-start resume, the native terminal displays progress but Task Activity receives no item events and remains nearly empty until polling observes the final result. The successful subscription is released with `thread/unsubscribe` when the task finishes.

The rollout file can exist but remain empty for a short interval after `turn/start`. Relay treats both `no rollout found for thread id` and `rollout ... is empty` as fresh-thread persistence races. The post-start subscription retries with bounded backoff and records deferred attempts only in diagnostics. It does not render a Terminal warning for this transient state. Completion polling applies the same classification so an empty rollout cannot flood Task Activity while Codex is still persisting the first turn.

> [!important]
> A transient subscription failure must never decide task completion or queue ownership. Relay continues with polling even if all bounded subscription attempts are exhausted.

> [!note]
> A connected, idle thread is not necessarily resumable. The first turn creates its rollout. Do not reject a newly launched terminal solely because `thread/resume` cannot find one yet.

> [!important]
> Do not rely only on completion polling for a fresh terminal's first task. Polling recovers the final result but cannot populate the live execution ledger.

> [!important]
> UI wording can be misleading: **Terminal output** means task activity output, while **Launch terminal** means opening an external native terminal.

## Fresh Claude terminal execution

`claude agents --json` can report a newly launched interactive Claude terminal before that terminal has saved its first conversation transcript. The session is live and selectable, but `claude -p --resume <session-id>` exits with **No conversation found with session ID** until a first turn exists.

Direct Claude execution first attempts the normal `--resume` path. If and only if Claude returns the exact missing-conversation error naming the selected session ID, Relay refreshes live discovery and requires the same UUID to still identify an idle interactive Claude process in the exact task workspace. Relay then runs the first turn with `--session-id <same-session-id>`, preserving the prompt, model, effort, attachments, event stream, cancellation ownership, and transcript identity. Relay also requires Claude's successful result to report that same UUID. Later turns use `--resume` normally.

This is same-session initialization, not fresh-context routing. Claude Code 2.1.216 was verified with an interactive process left open: the first print-mode turn using its exact UUID completed, and a subsequent `--resume` using that UUID retained the transcript. The native terminal does not redraw output produced by the headless task process, so Task Activity remains the live execution surface.

If the interactive terminal creates its transcript after Relay's failed resume probe but before first-turn initialization, Claude rejects `--session-id` with **Session ID ... is already in use**. Relay handles only that same-UUID race, revalidates the interactive terminal again, waits for it to become idle, and returns to normal `--resume` without failing or duplicating the task.

Task 164 on July 20, 2026 exposed an unsafe earlier fallback that became an unbounded hidden process after the resume failure. The current path keeps the child inside `ClaudeExecutionRunner`, emits `claude/session-initializing`, streams its activity, and remains cancellable. The expected probe error is not rendered as a Terminal warning. Any closed terminal, background-only duplicate, workspace mismatch, or cancellation stops before the initialization process starts.

`claude agents --json` may temporarily list both the interactive terminal and a print or background child with the same session ID. Discovery deduplicates by session ID, prefers `kind = interactive`, and otherwise keeps the newest record. Duplicate DOM entries with the same ID make both cards appear selected and must never reach the browser.

When Execute Plan council is enabled, discovered interactive Claude sessions remain visible in the Relay picker with an **Execute only** marker. They are disabled because council authoring and revision use the signed-in non-interactive Claude CLI, while the selected terminal is the Codex review Relay. This preserves launch feedback without allowing an interactive Claude session to replace the reviewer or disable the council. See [[interface-layout]].

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
