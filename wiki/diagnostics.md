---
name: CC Relay Diagnostics
description: Persistent launch, proxy, discovery, enqueue, and Codex turn logging.
type: operations
---

# CC Relay Diagnostics

CC Relay writes structured JSONL diagnostics to `relay-diagnostics.jsonl` in the same data directory as `relay.sqlite`. Desktop builds therefore use Electron's per-user application data directory, while `npm start` writes under `.data/`.

The log records:

- Native terminal launch request and dispatch
- Shared proxy startup and client connection lifecycle
- Codex workspace reservation, claim, cancellation, expiry, and application to `thread/start`
- Thread create, resume, join, discovery, and disconnection
- Task enqueue validation and rejection
- App-server requests, responses, failures, and timeouts
- Waiting for an active thread to become idle
- Thread resume, turn start, completion, and failure
- Queue task status changes

Prompts and model responses are intentionally excluded. IDs, workspace paths, status, provider, model, effort, and errors are included because they are necessary to diagnose terminal handoff failures.

## Codex terminal opens but CC Relay does not connect

Native launch binding waits for the exact new Codex session for 15 seconds. A timeout is returned to the renderer as `connectionStatus: timed_out` instead of being treated as a successful connection. CC Relay then shows a targeted message explaining that it could not open a Codex CC Relay and that, if the terminal requires a Codex update, the user should update Codex and try again.

The native terminal remains open so its update or startup message is visible. The timeout remains recorded as `terminal.binding.timed_out`, and CC Relay releases the one-use workspace reservation after the bounded wait.

> [!important]
> CC Relay does not read or classify Terminal.app output. The update guidance is conditional because authentication, shell startup, or another Codex failure can also prevent the session from connecting.

The terminal settings dialog no longer includes an end-user **Copy diagnostics** control. Structured entries remain available to engineering and support through `GET /api/diagnostics?limit=500` and the JSONL file.

The file is capped operationally: after it exceeds 5 MB, CC Relay retains approximately the newest 2 MB. API reads inspect at most the newest 1 MB instead of loading the entire file.

> [!important]
> Diagnostics can contain local workspace paths and session identifiers. Review them before sharing outside the machine.

## Intermittent browser freezes

Chrome long-task warnings attributed to CC Relay clicks are currently caused by unbounded full task-list and event-stream reconstruction on the main thread. Warnings attributed to `content.js` and `@eyeo/webext-ad-filtering-solution` come from an injected browser extension and can amplify the same DOM-mutation bursts. CC Relay also blocks its Node request loop during cached synchronous Claude CLI status checks. See [[renderer-performance]] for measurements, code paths, and the required repair order.

## Plan council tasks that appear stuck

Plan council mode is persisted on the task when it is submitted. Changing the composer back to Execute afterward does not change an existing task. When a selected task shows the Plan council rail and its database record has `mode = plan` and `provider = council`, the Claude Fable author stage is expected even if the composer currently highlights Execute and Codex.

> [!important]
> On a current macOS backend, Plan council invokes Claude through its selected owned terminal and mirrors transcript events as they arrive. Windows, Linux, and an older backend use the isolated `--output-format json` runner and buffer the final response until the child exits. Both paths emit a stage heartbeat every 30 seconds and stop a stage after the one-hour safety limit. Confirm `capabilities.planCouncilTerminalExecution` to identify the terminal-driven path and `capabilities.planCouncilResume` before using checkpoint resume controls.

> [!note]
> CC Relay selector activity counts only `mode = execute` tasks as direct terminal work. A Plan council Claude draft no longer labels its future Codex review CC Relay as **Running**.

### Newly launched Claude terminal stays idle

On a current backend, a new Plan council submission does not require an already open or selected Claude terminal. It waits until the project's Claude and Codex limits have room, launches one disposable author terminal and one disposable reviewer terminal, binds both exact launches, runs the three stages, and closes those exact launches at the terminal outcome. If the Claude window appears but stays idle, inspect the task's queue events and `claude/started` event:

- A queue event saying that disposable terminals are launching means the task has reserved its complete provider requirement.
- No `claude/started` after a binding failure means the newly launched Claude session did not register in time.
- `sessionMode: terminal` proves that the bound visible terminal path started.
- A cleanup failure keeps the exact launch counted against the project limit instead of pretending that capacity was released.
- A backend without `capabilities.disposableTerminalPools` is using the legacy selected-terminal behavior described in the historical notes below.

> [!important]
> Automatic work owns only terminals that it launches for that task. Do not diagnose it by selecting another open Claude session. Check the task's launch and binding events, the selected project's `terminalPool` status, and the exact owned launch.

> [!success]
> Resolved on macOS for direct Claude Execute (July 24, 2026). When CC Relay owns an exactly resolvable single-tab Terminal.app window for the session, `ClaudeExecutionRunner` runs the turn **inside** that terminal by typing a bracketed-paste prompt through `osascript` and mirrors the session `.jsonl` transcript into Task Activity. No second `claude` process is spawned. To tell which path a task took, read its `claude/started` event: `sessionMode: 'terminal'` means terminal-driven (the visible terminal shows the turn); `sessionMode: 'resume'` or `'fresh'` means the headless fallback. See [[claude-terminal-visibility]] for the mechanism, spike findings, and fallback matrix.

> [!note]
> Terminal-driven readiness and safety. A folder trust prompt is not registered in `claude agents --json`, so the launch coordinator first recognizes and approves that exact prompt only on its fresh owned tab, then restarts the binding deadline. See [[claude-folder-trust-startup]]. CC Relay types once the session is registered, idle, and past the viewport screen gate. The transcript file is not required, so a freshly launched terminal's first turn runs visibly (the tail reads from offset 0). Immediately before typing, CC Relay re-verifies that the resolved window, tty, and pid still match a fresh discovery read, because macOS recycles tty names; a mismatch aborts retryably with nothing typed. Every failure at or after injection is non-retryable (no-start, empty or missing final, the inactivity ceiling, transcript shrinkage, mid-turn close, and the injection call itself, whose osascript timeout can fire after Terminal.app already ran the prompt), so the queue never auto-reinjects a turn. The ceiling bounds 45 minutes of **continuous inactivity**, not total turn duration: new transcript records, a busy discovery status, or transcript growth all restart its window, so a long sub-agent run stays alive while an abandoned interactive prompt still releases its task. A task that reports no activity for that long is a stalled turn, not a slow one, so read its last transcript record and the terminal itself before retrying. Cancellation sends a best-effort ESC to the exact window; System Events keystrokes are Accessibility-gated and intentionally unused. See [[claude-terminal-visibility]] for the tty-recycling incident that motivated the identity recheck.

> [!note]
> A busy Claude session is a legacy selected-terminal pre-dispatch state. Current automatic work does not inject into that session. It waits for project capacity, launches a fresh task terminal, and leaves the existing session untouched. See [[claude-busy-dispatch]] for the compatibility behavior.

> [!note]
> Terminal-driven model and effort are launch settings, not decorative metadata. For a configured task, CC Relay first verifies the current Claude pid against the exact session, workspace, window, and tty, then restores the same UUID in that tab with the pinned Claude binary plus `--model` and `--effort`. Diagnostics and Task Activity receive progress before restart and after the replacement pid becomes idle. A relaunch ambiguity is non-retryable and no prompt is typed. Task 266 exposed both the old settings gap and a stale CC Relay backend: its server started before the guarded submit code was written, its raw events contained no recovery progress event, and its stored failure used the old message. See [[claude-terminal-settings-review]].

> [!note]
> A visible `[Pasted text #... +N lines]` placeholder with no later `claude/message` or transcript growth means Claude accepted the large paste but did not start the turn. Task 263 exposed this when the Return appended to the same `do script` Apple Event was ignored. Current CC Relay waits briefly, re-verifies the exact terminal, rechecks transcript growth, busy state, and cancellation, then sends at most one separate Return. Task Activity records a quiet `claude/progress` note when this guarded recovery runs. If it still cannot confirm a start, the task fails non-retryably and the terminal must be checked or cleared before a manual retry. See [[claude-terminal-submit-review]].

> [!note]
> Terminal-driven fallbacks and pre-injection guards (July 24, 2026). A prompt too large for the osascript argv or containing a NUL byte now runs headless on stdin even when CC Relay owns the terminal, rather than failing; a `claude/progress` note reads `CC Relay is running this task headless instead of typing it into the ... terminal because ...` and the task's `claude/started` then reports `sessionMode: 'resume'` or `'fresh'`. This restores the pre-terminal-path behavior (every Claude turn ran headless on stdin, which has no argv byte or NUL limit) with no double execution, because the check is pre-injection with nothing typed. Two other pre-injection guards fail retryably with nothing typed: a resumed session whose transcript size reads negative through a short bounded re-stat (avoids replaying a stale response), and a terminal re-resolution flake at the identity recheck (its message says the terminal could not be re-verified, distinct from a proven recycled-window mismatch). See [[claude-terminal-visibility]].

> [!note]
> Direct Claude process ownership is per conversation. Different Claude UUIDs may have active turns at the same time, while CC Relay rejects a second active turn for one saved UUID and cancels each turn through its existing task ID. Plan council remains one coordinated workflow and reserves one disposable Claude instance plus one disposable Codex instance.

> [!note]
> Claude Code Remote Control does synchronize an interactive terminal with claude.ai and mobile clients, but its documented transport is Anthropic's hosted service and it exposes no supported local submission API for CC Relay. Adding `--remote-control` to CC Relay's launch command therefore does not make the existing local runner drive the visible terminal. The shipped macOS solution instead restores the same verified session with task launch flags, types a bracketed-paste prompt into the exact owned Terminal.app window, and reads the session `.jsonl` transcript. This preserves the composer's model and effort selections, structured item events, live completion, and cancellation. The terminal-driven path remains macOS-only. See [[claude-terminal-visibility]].

> [!note]
> A `SessionStart` warning in the interactive terminal about prompt-type hooks is a local Claude hook configuration issue. For a current council, confirm the persisted launch, binding, and terminal-mode `claude/started` events for the task-owned Claude instance. For the non-macOS compatibility path, confirm the separate `claude --print` process.

## Plan council disabled after restart

Council capability and Claude authentication are separate checks. A current backend can advertise both `planCouncil` and `turboPlanCouncil` while Claude Code is installed but signed out. Claude Code 2.1.216 returns useful JSON with `loggedIn: false` and exit code 1 from `claude auth status --json`; treating that exit code as a missing CLI incorrectly collapses the state into a generic restart message.

CC Relay now preserves signed-out JSON from the failed command, reports the CLI as installed but unauthenticated, and refreshes Claude authentication on a five-second cache. Council submissions force an immediate recheck. Run `claude auth login`; after successful sign-in the visible composer enables automatically without another CC Relay restart.

> [!important]
> Restarting CC Relay does not authenticate Claude. Only suggest a restart when the backend lacks the council capability. When the backend is current and `reason` is `signed_out`, show the login command and automatic-detection behavior.

See [[turbo-plan-council]] and [[interface-layout]].

Task 150 on July 17, 2026 demonstrated the distinction: CC Relay persisted `claude/started` for Opus at max effort at `16:42:32` local time. The draft process remained active until a cancellation request at `16:43:43`, after which the draft stage was saved as cancelled with no output.

See [[task-history]] for the persisted task contract and [[interface-layout]] for Task Activity presentation.

## Unbounded Plan council retry usage

> [!warning]
> Unbounded Plan council retry was a historical defect. Plan council failures are now non-retryable queue outcomes. CC Relay records the exact failed stage, preserves completed stage outputs in `plan.json`, and waits for an explicit **Resume** after the provider or reviewer problem is corrected.

The July 17, 2026 task 130 incident proves the failure mode. The selected Codex review CC Relay was disconnected, but CC Relay launched the configured `fable` at `max` effort 520 times from `2026-07-16T23:55:00.205Z` through `2026-07-17T10:39:23.784Z`. Fifty Claude calls completed a fresh first draft and then failed at the disconnected Codex review. No Codex review or Claude revision completed. After provider usage was exhausted, another 468 launches exited with code 1 and were retried every five seconds.

Task 184 on July 20 and 21, 2026 exposed the authentication variant. Its old queue launched Claude 78 times while `claude auth status --json` reported `loggedIn: false`. A direct reproduction returned `Failed to authenticate: OAuth session expired and could not be refreshed`, but the former runner reduced that output to a generic exit-code error.

> [!important]
> Do not restore automatic retry for Plan council. Manual resume validates a connected same-workspace Codex reviewer and current Claude authentication, keeps every completed checkpoint, and restarts only the first missing stage. The renderer requires `capabilities.planCouncilResume` so new static assets cannot invoke this behavior on an older backend.

See [[plan-council]] and [[plan-council-review]].

## Unbounded direct-task retry usage

Task 216 exposed the direct Codex variant: its selected terminal disconnected, the runner detected that permanent identity failure, but the error lacked `retryable = false`. CC Relay retried the same assignment 1,279 times. Disconnected and missing Codex thread errors are now non-retryable, and every other direct or Turbo automatic retry chain has a queue-level limit of three retries. See [[automatic-retry-safety]].

## Duplicate server starts and orphaned queue rows

CC Relay must own `127.0.0.1:4768` before it recovers interrupted tasks or starts queue dispatch. A previous startup order called `queue.start()` before `server.listen()`. A second `npm start` could therefore mark the real server's active task interrupted, dispatch the next task from the shared SQLite database, then crash with `EADDRINUSE`. The dispatched row remained persisted as `running` even though the failed process no longer had an active runner.

Startup now attaches the listen error handler first and moves queue recovery, the `relay.started` diagnostic, and background Codex app-server startup into the successful listen callback. A duplicate start reports the occupied port and exits without changing task status or adding queue events.

> [!important]
> When diagnosing a `running` row with no ID in `/api/status.activeTaskIds`, compare `task.codex.run.requested` with `task.codex.turn.started`. A row created by the old port-collision bug can have the former without the latter. Recover only that verified orphan as interrupted; do not cancel or rewrite a task that still appears in the live active-task map.

### Packaged desktop startup and dynamic ports

Resolved July 28, 2026. The no-window incident was a real port collision, not an off-screen window. The packaged Electron process tried fixed HTTP port `4768` while the development CC Relay already owned it. `src/server.mjs` emitted `relay.listen.failed` with `EADDRINUSE`, and `src/electron-main.mjs` waited only for a future `listening` event. Because the failed server could never emit that event, Electron never constructed `BrowserWindow`. The stale primary process then held the single-instance lock, so later opens could not repair it.

Electron now starts the embedded server with `--relay-port 0` and `--relay-codex-port 0`. Port `0` asks the operating system to choose an available loopback port atomically. The exported `serverReady` promise resolves with the actual HTTP endpoint or rejects on a bind error. Electron awaits that promise and loads its returned URL. The Codex proxy likewise reports its actual endpoint through `/api/status`, so terminal launch commands do not retain port `0`.

> [!important]
> Standalone `npm start` still defaults to fixed HTTP port `4768` and Codex proxy port `4769`. Only the embedded desktop process requests operating-system-assigned ports. This preserves the documented browser and CLI endpoints while allowing the desktop app to coexist with a running development CC Relay.

The Electron main process writes its lifecycle into the same structured log as the backend. On the current macOS package that file is:

`/Users/patrikkelemen/Library/Application Support/dual-agent-orchestrator/relay-diagnostics.jsonl`

Useful desktop events include:

- `desktop.start.requested`
- `desktop.server.start.requested`
- `relay.listen.requested`
- `relay.started`
- `desktop.server.ready`
- `desktop.window.created`
- `desktop.window.load.requested`
- `desktop.window.load.completed`
- `desktop.window.load.failed`
- `desktop.renderer.gone`
- `desktop.start.failed`
- `desktop.shutdown.requested`
- `desktop.shutdown.completed`
- `desktop.shutdown.failed`

An unexpected startup failure also displays a native error box containing the log path. `desktop.window.unresponsive`, `desktop.window.responsive`, and `desktop.child_process.gone` cover failures after a successful first render.

> [!success]
> A live collision test kept the development CC Relay on ports `4768` and `4769`, then started another server with both desktop flags set to `0`. Its HTTP UI bound to `50210`, its Codex proxy bound to `50213`, `/api/status` reported Codex connected, and no existing listener was interrupted.

See [[desktop-updates]] for the packaged Electron lifecycle.

## Renderer HTML escaping and CSP backlog

`escapeHtml` was a DOM trick (`textContent` then `innerHTML`) that escaped `&`, `<`, and `>` but left `"` and `'` intact. Many render call sites interpolate escaped, agent-controlled text (task prompts, latest responses, session labels) into double-quoted attributes such as `title="..."` and `aria-label="..."`, so a quote in model output could break out of the attribute and add an inline event handler: prompt-injection to XSS on a UI that currently ships without a Content-Security-Policy (Finding 19, pre-existing).

The helper is now a pure function in `public/escape-html.js` that also escapes `"` (`&quot;`) and `'` (`&#39;`), imported by `public/app.js` with an unchanged signature and call sites. Use it for every attribute interpolation, including new Planner markup. `test/escape-html.test.mjs` asserts a payload like `x" onmouseover="evil` comes back with the quote escaped.

> [!warning]
> A Content-Security-Policy for the local UI remains a tracked backlog item. Until it lands, escaping is the only defense against agent-controlled markup, so never interpolate untrusted text into HTML without `escapeHtml`, and prefer `textContent` for plain-text sinks.

## Visible prompt submits as empty

> [!important]
> Never nest another `<form>` inside `#task-form`. The Terminal Settings dialog briefly used an inner `method="dialog"` form. HTML form parsing closed the outer task form at the dialog boundary, leaving the visible prompt, image input, and submit button outside it. `new FormData(taskForm)` therefore omitted the visible prompt and the server returned **Task prompt is required**; image selection and button submission were also broken.

Terminal Settings now uses a non-form panel and an explicit close handler. `test/composer-workflows.test.mjs` protects task form ownership, and the Electron renderer check verifies that `prompt.form`, `imageInput.form`, and `submitButton.form` all resolve to `#task-form`, while the prompt appears in `FormData`.

## Continue session must stay in its task

The old finished-task behavior deliberately created a linked Execute task, and an even older compatibility path called the ordinary task endpoint. Both paths made a follow-up appear as new queue work even though the dock promised the same terminal session. Current continuation mutates the selected source task back to running and executes the next turn under that same task ID.

The renderer now separates drafting from safe submission. The textarea stays editable unless a request is active, but a finished task enables Send only when `/api/status` advertises `taskDirectFollowUp: true`. **Restart required**, **Terminal busy**, **Session offline**, and full provider capacity all disable or reject only Send. A live retained or legacy persistent session starts immediately. A closed disposable session relaunches its saved conversation through the provider pool, but it still uses the selected source task and never enters the queue. There is no ordinary-task fallback and no queued presentation state. After restarting CC Relay, hard refresh the renderer if needed and confirm that `/api/status` advertises both `taskDirectFollowUp: true` and `taskSteering: true`.

If a direct follow-up fails, its task error begins with `Same-session follow-up`. Generic Retry is intentionally unavailable because retrying the stored source task would queue its original prompt. Reconnect or free the exact session, then use **Continue session** again.

The upper **Prompts** disclosure is the visual identity check. It must list the original request and every accepted follow-up in order, open automatically once the task has more than one prompt, and remain attached to the same selected task while its status changes. If Send selects another task card or the prompt count does not increase after acceptance, the renderer or backend predates the same-task continuation contract.

## Fresh rollout subscription warnings

On the first task for a new Codex thread, the rollout metadata file may be briefly empty after `turn/start`. This is an expected persistence race, not a failed command. CC Relay retries the live-output subscription with bounded backoff and keeps transient empty-rollout details in diagnostics instead of Task Activity. See [[project-workspaces]].

## Fresh Claude session has no conversation

A newly opened Claude terminal may appear in session discovery before it has a persisted transcript. CC Relay first probes normal resume. On the exact **No conversation found with session ID** response naming the selected UUID, it suppresses that expected warning, refreshes discovery, verifies the same interactive UUID and workspace, and records `claude/session-initializing`. The first task then runs with `--session-id` using that exact UUID, and the successful result must report the same UUID before CC Relay accepts completion. Normal resume works afterward.

An expected **Session ID ... is already in use** during this path means the interactive terminal persisted a transcript in the small gap between probe and initialization. CC Relay suppresses that same-UUID race warning, revalidates the terminal again, and resumes normally. A different UUID or any other provider error remains visible and fails closed.

If Task Activity shows the raw missing-conversation warning followed by a manual-initialization failure, the running CC Relay backend predates this fix and needs a normal restart. If initialization instead reports that the terminal closed, became background-only, or belongs to another workspace, reopen or select the exact interactive terminal and retry manually. See [[project-workspaces]] and [[claude-fresh-session-review]].

> [!note]
> The known missing-conversation probe line is hidden only when CC Relay handles it through same-session initialization. All other Claude stderr remains the primary failure message so authentication, CLI startup, and provider failures stay actionable.

## Orphaned internal Codex app-server ports

Standalone CC Relay's public endpoints remain fixed: the browser and HTTP API use `127.0.0.1:4768`, while interactive Codex terminals use the WebSocket proxy at `ws://127.0.0.1:4769`. Packaged Electron requests available ports for both public listeners and advertises the actual choices. The Codex app-server behind the proxy is private implementation detail and also binds an operating-system-assigned loopback port by starting with `ws://127.0.0.1:0`.

The launcher parses the exact `listening on:` endpoint advertised by its newly spawned Codex child, points the WebSocket proxy at that endpoint, initializes it, and only then reports the app-server ready. This ownership handshake prevents an orphaned app-server from an earlier CC Relay process from hijacking a new startup. The previous fixed internal port `4770` could remain occupied after CC Relay exited; a new process would briefly connect to the orphan, then tear down public port `4769` when its own child failed to bind.

Native Codex launch also awaits `codexAppServer.start()` before reserving the workspace or dispatching Terminal.app or `cmd.exe`. A launch therefore fails through the HTTP request without opening a terminal when the public proxy is unavailable. Known app-server startup metadata is kept out of task stderr, while genuine child-process errors remain visible.

Useful diagnostic sequence:

- `appserver.start.requested` contains the configured private endpoint ending in port `0`.
- `appserver.endpoint.ready` records the actual private endpoint advertised by the owned child.
- `proxy.listening` confirms the actual terminal endpoint is accepting connections. It is `4769` for standalone CC Relay and operating-system-assigned for Electron.
- `appserver.ready` is emitted only after initialization and proxy binding succeed.
- `terminal.launch.waiting_for_codex` must precede `terminal.launch.codex_ready` and `terminal.launch.dispatched`.

> [!important]
> Do not restore a fixed private app-server port or let a native Codex launch bypass readiness. Use the endpoint reported by `proxy.listening` and `/api/status` for `codex --remote`; the HTTP endpoint cannot accept the Codex WebSocket protocol.

## Native terminal shutdown ownership

`terminal.launch.dispatched` records the exact `terminalWindowId` on macOS or `terminalProcessId` on Windows when the native launcher can capture it. Graceful application quit emits `terminal.shutdown.requested`, waits for pending serialized launches, and then closes only those owned handles. Completion emits `terminal.shutdown.completed` with `windowCount` and `processCount`.

macOS close failures emit `terminal.shutdown.failed`. Individual Windows process-tree failures emit `terminal.shutdown.process_failed` with the process ID, allowing the remaining owned terminals to continue closing. Cleanup errors are diagnostic rather than permission to target all Terminal windows or all `cmd.exe` processes.

## Single terminal close ownership

`terminal.launch.dispatched` now includes an in-memory `launchId` beside the captured native handle. Backend discovery then requires two observations of the exact launch UUID: Claude uses the interactive CLI session ID, while Codex uses metadata from its dedicated one-use proxy endpoint. `proxy.launch.reservation.created`, `proxy.launch.reservation.claimed`, `proxy.launch.reservation.cancelled`, and `proxy.launch.reservation.expired` trace that endpoint without relying on shared-client arrival order. `terminal.session.bound` records the exact launch ID, thread ID, provider, and canonical project path. `terminal.binding.discovery_failed` and `terminal.binding.timed_out` explain why ownership was not bound. A user close emits `terminal.close.requested`, followed by `terminal.close.completed` or `terminal.close.failed`.

For existing macOS one-tab Terminal sessions, `terminal.recovery.completed` records the exact thread, provider, runtime PID, TTY, and Terminal window ID recovered from the live identity chain. `terminal.recovery.socket_inspection_failed`, `terminal.recovery.native_inspection_failed`, and `terminal.recovery.inventory_invalid` report operating-system discovery failures. `terminal.recovery.rejected` means the result conflicted with another binding. `terminal.recovery.identity_changed` means the same conversation moved or no longer maps to the recorded process and window; CC Relay drops that mapping instead of closing the stale target.

> [!important]
> The Close row must never disappear. An unavailable action stays visible and prints its reason inline. If the row itself is missing, the browser is serving stale UI assets; refresh it. If a current macOS session remains unverifiable, inspect recovery diagnostics and confirm it occupies one tab in one Terminal window. CC Relay must never recover an association from only a process name, project path, or Terminal.app window title.

The API refuses close requests while `src/terminal-control.mjs` finds a queued, running, or scheduled-to-retry task assigned to the direct thread, Turbo planner, or Turbo executor. `src/terminal-close-coordinator.mjs` reserves the thread, revalidates its live provider and project, repeats the task check, and then delegates the exact native close with a ten-second operating-system timeout. Queue enqueue, retry, assignment, planner, and dispatch paths reject a reserved thread until the close finishes or fails. This protects queue ownership independently of possibly stale browser state. See [[project-workspaces]].

## Claude binary resolution

CC Relay pins one exact `claude` binary at startup instead of trusting bare `PATH` resolution, which varied with how CC Relay was launched (Finder or dock versus a terminal) and could select an outdated binary whose `agents --json` fails. `src/claude-binary.mjs` enumerates candidates, probes each with `--version`, and selects the highest version.

- `claude.binary.resolved` records the chosen `command` absolute path, its `version`, a `supportsAgentsJson` flag, and the `rejected` candidates with their version or probe-failure reason. Use it to confirm which binary discovery and execution actually use.
- `claude.binary.fallback` means no candidate responded to `--version`, so CC Relay fell back to bare `claude`. Its `candidates` list (or `error`) explains why. Discovery may then behave exactly as it did before the fix, so treat this as the degraded path.

The resolver caches the result for the process lifetime. `ClaudeSessionRegistry` re-resolves once with a refresh when `claude agents --json` fails with an unknown-option error, then retries against the newer binary. A stale backend that predates this change shows neither event; restart CC Relay to load the resolver.

> [!important]
> The resolver never throws. A rejected resolve would abort the top-level `await` in `src/server.mjs` and prevent `server.listen`, so every probe and resolution error is caught and downgraded to the bare-`claude` fallback with a diagnostic.

See [[claude-terminal-visibility]] for the root cause and the two-binary machine that motivated the fix.

## Files

- `src/diagnostics.mjs`
- `src/server.mjs`
- `src/server-options.mjs`
- `src/electron-main.mjs`
- `src/claude-binary.mjs`
- `src/claude-session-registry.mjs`
- `src/claude-runtime-status.mjs`
- `src/claude-runner.mjs`
- `src/claude-execution-runner.mjs`
- `src/claude-terminal-executor.mjs`
- `src/claude-transcript-tail.mjs`
- `src/project-launcher.mjs`
- `src/terminal-launch-coordinator.mjs`
- `src/terminal-close-coordinator.mjs`
- `src/terminal-control.mjs`
- `src/terminal-runtime-resolver.mjs`
- `src/websocket-proxy.mjs`
- `src/codex-app-server.mjs`
- `test/diagnostics.test.mjs`
- `test/desktop-startup.test.mjs`
- `test/server-options.test.mjs`
- `test/server-startup.test.mjs`
- `test/terminal-runtime-resolver.test.mjs`
- `test/claude-terminal-executor.test.mjs`

#relay #diagnostics #terminal #codex #logging
