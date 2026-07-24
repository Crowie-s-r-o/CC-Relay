---
name: Terminal Close Ship Review
description: Adversarial ship review for exact per-terminal close control.
type: review
---

# Terminal Close Ship Review

### Executive Summary

**Ticket confidence: High**

The selected Relay can close its exact native terminal after confirmation. The implementation is fail-closed: a native target must be captured during launch or recovered through an exact live runtime identity chain before it can be closed. Queued, running, retry-scheduled, Plan council, and Turbo ownership prevents closure. A closing reservation also prevents new enqueue, retry, reassignment, planning, or dispatch from racing the operating-system call.

The review found and fixed three correctness defects before completion:

1. The first close implementation saw its own reservation as a second close and rejected the request.
2. A shared first-client Codex reservation could be claimed by a manually connecting client. App-launched Codex now receives a dedicated loopback proxy endpoint carrying its launch UUID.
3. Failed or timed-out discovery could leave reservation state available to a later launch. Reservation cleanup is now explicit on failure and timeout.

No database migration, environment variable, remote permission, or authentication change is in this ticket. Relay remains bound to localhost.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `ProjectLauncher.closeOwnedTerminal()` targets one parsed macOS window ID or Windows process ID. `TerminalCloseCoordinator.close()` revalidates the live provider, canonical path, current task ownership, and concurrent-close reservation. Focused tests cover success, rejection, and native failure. |
| Regression risk (UI / backend / contracts) | Amber | Manual Codex clients still use the shared endpoint, while app launches use a dedicated dynamic endpoint. The full 213-test suite passes and the browser flow was verified with an intercepted close request, but real Terminal.app and Windows `cmd.exe` closure are not automated in CI. |
| Gap risk (edge cases, error handling, completeness) | Amber | Launch ownership is process-local. The runtime-recovery follow-up below adds exact macOS recovery for existing one-tab Terminal sessions. Ambiguous, multi-tab, and unsupported-platform targets remain unclosable rather than risking a guessed association. |
| Code quality (maintainability as safety) | Green | Launch binding, close coordination, task ownership, and native process control are isolated in `terminal-launch-coordinator.mjs`, `terminal-close-coordinator.mjs`, `terminal-control.mjs`, and `project-launcher.mjs`. Diagnostics identify every ownership stage and failure. |
| Unit tests | Green | 213 tests pass. New coverage includes exact Claude UUID binding, dedicated Codex endpoint isolation from manual clients, concurrent launch serialization, concurrent close rejection, task and Turbo guards, retry protection, queue races, exact macOS and Windows targets, and failed-close release. Adequate UNIT tests: Yes, for all deterministic logic and contracts. |
| Performance & scalability (if applicable) | Green | Launch discovery is serialized and bounded to 15 seconds. Thread control evaluation is proportional to connected terminals times current tasks, which is small for this local desktop app. Native close calls have a 10-second timeout. |

### Change Map

| Files | Responsibility and behavior | Downstream impact |
|------|-----------------------------|-------------------|
| `public/index.html`, `public/app.js`, `public/style.css`, `public/terminal-close-state.js` | Persistent selected-terminal Close row, inline disabled reason, confirmation, pending state, API call, and next-session selection. | Composer state, terminal polling, accessibility labels, and launch handoff. |
| `src/server.mjs` | Advertises terminal control, enriches thread responses, exposes `DELETE /api/terminals/:threadId`, and wires launch and close coordinators. | Local HTTP API, SSE thread refresh, queue scheduling. |
| `src/project-launcher.mjs` | Captures exact native handles, injects Claude launch UUIDs, tracks session ownership, applies bounded exact native close, and retains bulk shutdown behavior. | macOS Terminal.app, Windows `cmd.exe`, app shutdown, project launch. |
| `src/websocket-proxy.mjs`, `src/codex-app-server.mjs` | Creates a dedicated loopback endpoint for each app-launched Codex terminal and records its launch UUID on the connected thread. | Codex remote connection, workspace rewrite, live thread discovery. |
| `src/terminal-launch-coordinator.mjs` | Serializes native launch through exact two-observation binding. | Both project launch routes and Close eligibility. |
| `src/terminal-close-coordinator.mjs`, `src/terminal-control.mjs` | Reserves close, revalidates live state, finds task blockers, and delegates exact native closure. | Thread API shape, error messages, queue availability. |
| `src/queue.mjs` | Rejects work against a closing direct, planner, or worker thread and exposes pending retries for close protection. | Enqueue, automatic and manual retry, assignment, look-ahead planning, dispatch. |
| `test/*.test.mjs` | Adds ownership, concurrency, failure, UI contract, proxy isolation, queue guard, and platform-target regression coverage. | Release confidence. |
| `README.md`, `wiki/*.md` | Documents user scope, exact ownership, diagnostics, and safety constraints. | Support and future implementation decisions. |

Regression checks covered direct Codex, direct Claude, Plan council, Turbo planner and worker ownership, automatic retry, project launch, manual shared Codex connections, shutdown cleanup, responsive header layout, and selected-session changes. There is no calculation path in this feature.

### Functional Execution Trace

1. A project launch receives a random launch UUID. Claude receives it through `--session-id`. Codex receives a dedicated loopback endpoint whose proxy record contains the UUID and canonical workspace.
2. The native launcher captures only the exact Terminal.app window ID or Windows process ID it created.
3. `TerminalLaunchCoordinator` requires matching UUID, provider, and canonical path in two consecutive discovery results before binding the session to that native handle.
4. `/api/threads` returns Close ownership and blocker state. The browser always renders the selected-terminal Close row. Missing backend capability, missing ownership, and task blockers disable the action with an inline explanation; an enabled action always targets the selected session.
5. After user confirmation, `TerminalCloseCoordinator` reserves the thread before its first asynchronous operation. Queue mutation and dispatch paths then reject that thread.
6. The coordinator refreshes the live session, verifies its project path, and rechecks all task ownership. Invalid, missing, duplicate, delayed, or stale state returns an error without invoking native closure.
7. `ProjectLauncher` closes one exact window with `saving no` on macOS or one exact process tree with `taskkill /PID ... /T /F` on Windows. Success removes ownership. Failure preserves it for a safe retry.
8. The browser removes the closed session optimistically, selects the next eligible session, and background discovery repairs delayed disconnect state.

Concurrent callers are deterministic. A second close sees the reservation and fails. Enqueue, retry, and assignment cannot claim the reserved terminal. If queue dispatch wins the event-loop race first, it marks the task running synchronously and the close recheck rejects closure. If close wins first, scheduler eligibility rejects dispatch.

Partial failures are surfaced through the API and diagnostics. Native launch failure cancels its dedicated endpoint. Discovery errors retry until the bounded deadline. Close timeout or operating-system error leaves the ownership record intact. No failure path broadens the target to a process name, workspace, window title, or all Terminal windows.

### Top 3 Risks

1. **Native platform behavior is mocked in automated tests.** `ProjectLauncher.closeOwnedTerminalNow()` has exact command assertions, but CI does not open and close a real Terminal.app window or Windows process tree. A platform permission or command-semantic change would cause a loud close error and preserve ownership, but the action would fail for users.
2. **Exact binding is time-bounded.** `TerminalLaunchCoordinator.launchNow()` gives a new session 15 seconds and requires two observations. A slow CLI startup produces an open but unbound terminal with Close disabled. This sacrifices availability to avoid destructive guessed ownership.
3. **Ownership does not survive restart.** `ProjectLauncher.ownedTerminals` intentionally remains in memory. Persisting native IDs could target an unrelated later process, so terminals from an earlier Relay process or manual launches remain visible but unclosable.

### Top Improvements

1. Add release smoke tests on real macOS and Windows runners that launch a disposable terminal, bind a disposable session, close it, and prove a neighboring user terminal remains open.
2. Add a browser-level HTTP integration fixture with an injectable server port and fake native launcher, covering the real DELETE route and SSE refresh without touching the developer's live Relay instance.
3. Completed in the visibility follow-up below: the disabled reason now renders inline beneath the Relay cards and the Close action is never hidden.

## Visibility Follow-up Review

### Executive Summary

**Ticket confidence: High**

The missing Close report was confirmed against the live Relay process. Its `/api/status` response did not advertise `terminalControl`, and `renderTerminalCloseControl()` responded by setting the button to `hidden`. This made the restart limitation indistinguishable from an absent feature. The fix moves a persistent Close row beneath the Relay cards and presents the exact disabled reason without weakening any native ownership or task-safety check. The follow-up review also found that selecting another Relay during an in-flight close could make the row appear enabled even though the client rejected a second click. The client now retains the exact closing label and disables the entire row until the request settles.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `terminalClosePresentation()` covers unsupported backend, no selection, owned-ready, owned-blocked, unowned, missing control state, and closing. `renderTerminalCloseControl()` applies that result while `closingThreadLabel` keeps every selection in the same disabled pending state until the fail-closed request settles. |
| Regression risk (UI / backend / contracts) | Green | Backend contracts and destructive execution are unchanged. The existing action moved from the launch toolbar to a dedicated row below the same terminal list. Responsive CSS stacks the row at the narrow breakpoint. |
| Gap risk (edge cases, error handling, completeness) | Amber | The current live backend still requires a safe restart after active tasks finish. The runtime-recovery follow-up below removes the macOS relaunch requirement for surviving one-tab Terminal sessions by deriving exact identity after restart. |
| Code quality (maintainability as safety) | Green | Presentation decisions live in one pure module instead of being duplicated across DOM branches. The destructive API path remains separately guarded by live backend validation. |
| Unit tests | Green | `test/terminal-close-state.test.mjs` exercises every meaningful availability class, while existing terminal-control and coordinator tests continue to cover ownership and close safety. Adequate UNIT tests: Yes. |
| Performance & scalability | Green | One constant-time presentation calculation runs during existing terminal renders and status polling. No API request, event listener, or hot-path loop was added. |

### Top 3 Risks

1. The user must refresh the current page to receive the new HTML and module code.
2. A normal Relay restart is still required before the backend advertises terminal control.
3. Existing macOS one-tab Terminal sessions can be recovered after restart; ambiguous or unsupported sessions still require manual closure or a new Relay launch.

### Top Improvements

1. Add an application-level restart workflow that waits for active tasks and then relaunches Relay without manual coordination.
2. Add a rendered browser fixture for the unsupported, blocked, and ready rows when an injectable test server becomes available.
3. Keep the inline reason concise if future blocker types add more remediation detail.

### Recommendation

**Ship.** The original visibility defect is fixed without broadening destructive authority.

### Confirmed Issues

- Fixed: capability absence hid the only Close control in `public/app.js`.
- Fixed: changing selection during a close could display an enabled action that the client silently ignored.

### Suspected Issues & Edge Cases

- A stale browser tab can retain the old hidden markup until refreshed. The server already serves the updated source files.

### Regression Risks

- The persistent row adds a small amount of vertical space to the composer. It remains within the existing scrollable panel and collapses to one column on narrow screens.

### Performance Risks

- None material. Presentation is O(1) per terminal panel render.

### Test Gaps

- The running app was not available through an Electron CDP endpoint, so visual validation used the served DOM and deterministic presentation tests rather than live Electron automation.

### Positive Improvements

- Unsupported and unowned states are now discoverable without hover, and manually enabling the disabled browser button still cannot bypass `closeSelectedTerminal()` or backend validation.

See [[project-workspaces]], [[interface-layout]], and [[diagnostics]].

## Runtime Recovery Follow-up Review

### Executive Summary

**Ticket confidence: High**

The relaunch-only limitation was the confirmed reason the user still could not close an idle Relay. The running backend did not advertise `terminalControl`, and the previous design could control only native handles captured during the same process lifetime. The correction keeps the old backend fail-closed, labels its button **Restart required**, and adds exact macOS runtime recovery for existing one-tab Terminal sessions after restart.

Claude recovery starts from the interactive session PID. Codex recovery starts from the one live proxy client associated with the exact thread, then maps its client socket to one Codex PID. Both providers must resolve through one PID, one TTY, one Terminal.app window, and one tab. The API re-runs the identity chain before close, and the launcher rechecks both process TTY and window TTY immediately before executing the native close. Runtime-recovered windows are excluded from automatic Relay shutdown cleanup.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `TerminalRuntimeResolver.resolve()` requires exact PID, socket, TTY, window, and single-tab identity. `ProjectLauncher.verifyTerminalForThread()` invalidates moved sessions. `TerminalCloseCoordinator.close()` performs that verification before task checks and native close. |
| Regression risk (UI / backend / contracts) | Green | The DELETE endpoint and task guards are unchanged. Process-launched ownership remains the preferred path. Runtime recovery adds availability without entering launch-owned shutdown sets. The final full suite passes 229 tests. |
| Gap risk (edge cases, error handling, completeness) | Amber | Runtime recovery is currently macOS-specific. Windows retains exact process-launched ownership. Multi-tab Terminal windows remain intentionally unavailable. |
| Code quality (maintainability as safety) | Green | Runtime inspection is isolated in `src/terminal-runtime-resolver.mjs`; proxy socket identity, launch ownership, close coordination, and UI presentation remain separate contracts. |
| Unit tests | Green | Parser, ambiguity, duplicate proxy client, same-window collision, moved-session invalidation, runtime shutdown exclusion, TTY close revalidation, and coordinator rejection paths are covered. Adequate UNIT tests: Yes. |
| Performance & scalability | Green | Recovery batches one `lsof`, one `ps`, and one Terminal inventory pass, then stores successful mappings. Failed sessions are throttled for 15 seconds. Work is linear in connected sessions plus local TCP records. |

### Top 3 Risks

1. `RelayWebSocketProxy.runtimeClientForThread()` reads the current `ws` socket ports. A future `ws` internal API change can make Codex recovery unavailable, but cannot broaden the target because missing ports return no mapping.
2. Terminal.app automation permission or changed `lsof` and `ps` output can disable recovery. Errors are diagnostic and fail closed.
3. The already-running backend still needs one normal restart after Task 183 completes. Static renderer code cannot add a destructive API route to a Node process that has not loaded it.

### Top Improvements

1. Add exact runtime recovery for Relay-launched `cmd.exe` trees on Windows.
2. Add a release smoke test that closes a disposable real Terminal.app window while proving a neighboring window remains open.
3. Add a graceful **Restart Relay** application action after the queue becomes idle.

### Recommendation

**Ship**

---

### Confirmed Issues

- Fixed: idle sessions from before the current backend process could never become closable without relaunch.
- Fixed: a conversation resumed in another terminal could leave a stale native mapping. Runtime mappings are now re-derived before close and removed when PID, TTY, or window identity changes.
- Fixed: the unsupported button still read **Close selected**, which looked broken. It now reads **Restart required**.

### Suspected Issues & Edge Cases

- A Codex conversation joined by more than one proxy client is intentionally unclosable because there is no single native process target.
- A session inside a multi-tab Terminal window is intentionally unclosable because closing the window could terminate unrelated tabs.
- A surviving Codex remote client may disconnect during backend restart. If it does, its Relay card disappears and no stale close target is offered.

### Regression Risks

- Existing manually opened single-tab Terminal sessions become explicitly closable on macOS. They are not treated as launch-owned and are not closed when Relay exits normally.
- Native inspection runs during thread discovery only for sessions without control, with a 15-second retry throttle. Successful mappings do not repeat inspection during ordinary polling, except for the required pre-close verification.
- Process-launched Windows and macOS closure retain their existing direct native-handle path.

### Performance Risks

Low. Initial recovery is O(s + c), where `s` is the number of connected sessions and `c` is the local established TCP record count. Successful recovery is cached in memory. Failed recovery retries at most once per session every 15 seconds.

### Test Gaps

The implementation did not execute a real destructive close against the user's Terminal.app. Live read-only validation resolved all three active Claude sessions to three distinct PIDs, TTYs, and window IDs, reverified one exact session successfully, and compiled the guarded AppleScript without entering its close branch. Electron CDP was unavailable, so renderer verification used the live served page.

**Are there adequate UNIT tests? Yes.** The deterministic identity, ambiguity, lifecycle, queue safety, and native command contracts are covered. The remaining gap is a real operating-system smoke test.

### Positive Improvements

- Existing macOS Codex and Claude sessions no longer require a relaunch when their exact one-tab window can be proven.
- Runtime recovery never relies on project path, title, process name, or discovery order alone.
- Moved sessions invalidate stale mappings before native close.
- Recovered user windows require explicit confirmation and remain outside automatic shutdown cleanup.
- The unsupported state now explains the one required backend restart directly on the button.

#relay #review #terminal #safety

## Running-process prompt correction

On July 21, 2026, native macOS Close was found to stop at Terminal.app's own running-process confirmation. `close window ... saving no` suppresses document-saving prompts, but it does not approve termination of live shells, MCP servers, or their children.

Relay now inspects the exact captured Terminal window immediately before closure, requires exactly one tab, reads that tab's TTY, and sends `SIGKILL` to every process attached to that exact TTY. It then closes the exact window ID. The same sequence is used for explicit selected-terminal closure and for launch-owned terminal cleanup during Relay shutdown.

> [!important]
> Never return to closing a live Terminal.app window before its exact TTY processes are gone. Terminal.app can show a modal confirmation and leave the close request incomplete.

> [!note]
> A failed TTY kill leaves the native window open and preserves explicit ownership for retry. Exit code 1 from `pkill` means the exact TTY already has no matching processes, so Relay may safely continue with the window close.

Focused coverage in `test/project-launcher.test.mjs` proves exact TTY targeting, no neighboring-window reference, kill-failure preservation, already-empty TTY handling, and shutdown cleanup. The complete suite passes 242 tests.

See [[project-workspaces]], [[diagnostics]], and [[interface-layout]].

#relay #terminal #macos #process-cleanup
