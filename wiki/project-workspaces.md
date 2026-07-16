---
name: Project Workspaces
description: How project cards scope Relay state and terminal launching.
type: architecture
---

# Project Workspaces

Pinned projects in `public/app.js` are selectable workspace cards. The active path is persisted in `localStorage` under `relay.activeProjectPath`.

The active project scopes:

- Connected Codex and Claude sessions
- Task cards and project-level status counts
- Parallel Claude session choices
- The generic **Launch terminal** action

Task execution remains one global sequential queue. Project filtering is a presentation concern. When a user reorders visible queued tasks, Relay replaces only those tasks' slots in the complete queued ID list so tasks from other projects retain their relative positions and the server's complete-set reorder validation still succeeds.

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

The **Terminal output** area in task activity is a read-only event viewer, not a terminal emulator or command input. It renders provider events recorded by Relay and offers filtering, follow mode, and log copying only.

The macOS **Launch terminal** action opens a real Terminal.app window and starts the provider CLI there. For Codex, that process connects to Relay's shared app-server with `--remote`. The same Codex thread can still be used interactively in Terminal.app when idle, but the user should not submit another prompt while a Relay task is running in that thread because Relay and the interactive client share the thread's active-turn state.

Fresh Codex remote threads are visible through `thread/read` before their first rollout is persisted. Calling `thread/resume` during that window fails with `no rollout found for thread id`. Relay treats only that exact failure as a fresh-thread case and proceeds with `turn/start`; established threads still use `thread/resume` so their existing context and subscription behavior are preserved.

> [!note]
> A connected, idle thread is not necessarily resumable. The first turn creates its rollout. Do not reject a newly launched terminal solely because `thread/resume` cannot find one yet.

> [!important]
> UI wording can be misleading: **Terminal output** means task activity output, while **Launch terminal** means opening an external native terminal.

## Files

- `public/app.js`
- `public/style.css`
- `README.md`

#relay #projects #queue #terminal
