---
name: Claude Terminal Visibility
description: Root cause of empty Claude terminals and parallel Claude limits, and the macOS terminal-driven execution fix.
type: diagnosis
---

# Claude Terminal Visibility

> [!important]
> Investigated July 23, 2026 (task around #249). Two reported problems: (1) CC Relay Claude turns never appear in the launched interactive terminal; (2) parallel Claude terminals do not work. Both root causes are confirmed against installed binaries.

> [!success]
> Problem 1 is resolved on macOS as of July 24, 2026. CC Relay runs a queued direct Claude turn inside the exact owned Terminal.app window and mirrors the session transcript back into Task Activity. As of July 27, current submissions no longer depend on terminals the user keeps open: the disposable pool launches a fresh Claude terminal per task, closes its exact native launch at outcome, and relaunches with `--resume` only for an explicit continuation or retry. See [[disposable-terminal-pools]] and [[#Resolution Problem 1 macOS terminal-driven execution]]. The headless path remains the fallback on Windows and Linux.

## Problem 1: empty interactive terminal (architectural)

Codex parity works because Codex has a **client/server split**: the interactive terminal launches with `codex --remote ws://127.0.0.1:4769` and CC Relay is a second client of the same shared app-server. One process runs the turn, so both CC Relay's panel and the terminal display it. See [[project-workspaces]] and `src/codex-app-server.mjs`.

**Claude Code has no equivalent.** Verified on Claude CLI v2.1.218: `claude --help` exposes only `agents`, `auth`, `auto-mode`, `doctor`, `install`, `mcp`, `plugin`, `setup-token`, `update`. The only "serve" is `claude mcp serve` (Claude acting as an MCP tool server for other clients), which is **not** a way to inject a turn into a running interactive TUI. There is no `--remote`, no attach, no socket into a live session.

Consequently `src/claude-execution-runner.mjs:434` spawns a **separate headless process** `claude -p --output-format stream-json --resume <session-id>`. That headless child shares only the transcript **file** with the interactive TUI (same `--session-id`), never a live process. CC Relay reads its stdout pipe and renders the app panel; the interactive terminal never sees the turn, so it stays empty. Prior fixes that tweaked flags on this headless call could never fix visibility because the turn executes in the wrong process.

**To make the terminal show activity, the turn must execute in the interactive terminal itself.** No native attach exists, so the realistic path is driving the actual terminal (macOS: AppleScript/`osascript` into the known Terminal window; Windows: SendKeys equivalent) and reading the session `.jsonl` transcript to populate the app panel. CC Relay already has most of the macOS plumbing: it launches via `osascript ... do script` and captures the exact Terminal `window id` + `tty` (`src/project-launcher.mjs`, `src/terminal-runtime-resolver.mjs`), so it can target keystrokes at the right window.

## Problem 2: parallel Claude / binary+PATH mismatch

There are **two claude binaries** on this machine:

- `/opt/homebrew/bin/claude` = **v2.1.84**, PATH position 1. `claude agents --json` fails with `error: unknown option '--json'`.
- `/Users/patrikkelemen/.local/bin/claude` = **v2.1.218**, PATH position 24. `claude agents --json` returns live interactive sessions (pid, cwd, sessionId, name, status).

`src/claude-session-registry.mjs:74` runs bare `claude agents --json`. When PATH resolves `claude` to the homebrew 2.1.84 first, discovery **errors and returns `[]`** (swallowed by the catch), so CC Relay sees no/limited live Claude sessions and cannot manage multiple in parallel. The interactive terminal the user launched runs 2.1.218 (fish interactive PATH prefers `.local/bin`), but CC Relay's backend PATH may resolve to 2.1.84 depending on how CC Relay was started (Finder/dock vs terminal). This nondeterminism is a strong candidate for the flaky parallel behavior. The scheduler's `parallelClaudeExecution` capability also requires a CC Relay **restart** to load (see [[parallel-claude-review]] and [[task-history]] line about `parallelClaudeExecution`), so a stale backend is a second possible cause.

**Fix direction:** pin the exact claude binary (prefer the one supporting `agents --json`, matching the launched terminal's binary) instead of relying on bare PATH resolution, across `claude-session-registry.mjs`, `claude-execution-runner.mjs`, `claude-runner.mjs`, `claude-runtime-status.mjs`, and the launcher. Then confirm the running backend advertises `parallelClaudeExecution`.

### Fix: pinned binary resolution (July 23, 2026)

`src/claude-binary.mjs` now owns binary selection. `ClaudeBinaryResolver` enumerates every candidate in priority order (each `PATH` entry, then the well-known absolute locations `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `/usr/bin/claude`), probes each with `--version`, parses the leading semantic version, and picks the **highest** version. The comparison is numeric per component, not lexical, because `2.1.84` sorts above `2.1.218` as text while `218` is the newer patch. The exec function and platform, env, and homedir inputs are dependency-injected so tests use fakes.

`src/server.mjs` resolves the binary **once at startup** (a single top-level `await` before wiring) and passes the resolved absolute path into `ClaudeRunner`, `ClaudeExecutionRunner` (through its existing `command` option), `ClaudeRuntimeStatus`, and `ProjectLauncher`. The launched interactive terminal command and the UI connection helper both invoke the pinned path through `claudeRelayCommand`, so display and launch stay coherent. The bare `claude` fallback stays unquoted; a resolved absolute path is shell-quoted.

`ClaudeSessionRegistry` receives the resolver's `resolve` function rather than a static string. When `claude agents --json` fails with an unknown-option error (an outdated binary that predates `--json`), the registry re-resolves once with `{ refresh: true }` and retries against the newer binary. The retry is skipped when the re-resolved path is unchanged, so there is no loop. The resolver caches for the process lifetime; `refresh` is the only re-probe path.

The resolver never rejects: any probe or resolution error falls back to bare `claude` with a `claude.binary.fallback` diagnostic, so a failed resolve can never abort server startup. See [[diagnostics]] for the emitted events.

> [!note]
> Selection is best-available, not a hard floor. If only the outdated `2.1.84` binary exists, it is still chosen and `agents --json` still fails, which is no worse than before. The `claude.binary.resolved` diagnostic records `supportsAgentsJson` so the degraded case is visible.

## Resolution Problem 1 macOS terminal-driven execution

Built July 24, 2026. A queued direct Claude Execute turn runs inside the interactive terminal on macOS when CC Relay owns an exactly resolvable single-tab Terminal.app window for that session. Extended July 27, 2026: automatic Execute work launches that owned terminal only for the task, and Execute Plan council allocates its Claude author terminal from the same disposable pool. Council stages use read-only plan permissions with no headless fallback. Legacy persistent sessions and the parallel Claude batch path remain compatible.

### Modules

- `src/claude-hook-bridge.mjs`: creates token-scoped loopback HTTP hook settings for live text, tool activity, and turn completion. It acknowledges before asynchronous event dispatch so `MessageDisplay` never waits on Relay rendering or discovery.
- `src/claude-transcript-tail.mjs`: pure helpers. Munges the session cwd to `~/.claude/projects/<munged>/<sessionId>.jsonl`, reads only appended bytes after a byte offset, watches for native file changes, splits complete JSONL lines, extracts assistant text, detects a turn-final assistant record, and wraps a prompt in bracketed-paste markers with ESC sanitized out.
- `src/claude-terminal-executor.mjs`: `ClaudeTerminalExecutor` orchestrates the readiness gate, prompt validation, selected-settings relaunch, injection-time identity re-verification, injection, submission confirmation, live hook consumption, transcript fallback, completion detection, heartbeats, and cancellation. Both live hooks and transcript records reuse the event shapes produced by `consumeClaudeStreamMessage`.
- `src/claude-execution-runner.mjs`: `run()` branches at the top. On darwin with a resolved owned terminal it calls the executor; otherwise it runs the unchanged headless path (`runHeadless`). The `run(task, {onEvent, onStderr})` contract and the `{ finalResponse, sessionId, reportedSessionId, exitCode }` outcome are identical, so `src/queue.mjs` is unchanged.
- `src/server.mjs`: passes `platform` and a `resolveTerminal` callback into `ClaudeExecutionRunner`. The callback gates on `projectLauncher.terminalForThread(session.id)` (the same ownership tracking the Close feature uses) and re-verifies the exact `terminalWindowId` and `terminalTty` fresh through `TerminalRuntimeResolver` before each turn.

### Injection mechanism (chosen: bracketed paste through JXA do script)

Injection uses `osascript -l JavaScript` calling `Terminal.doScript(payload, {in: <tab 1 of window id>})`, where `payload` is the prompt wrapped in bracketed-paste markers `ESC[200~ ... ESC[201~`. The prompt is passed through JXA `argv`, so there is no AppleScript string escaping and leading dashes, double quotes, backslashes, and newlines survive intact. This needs only Automation (AppleEvents) permission, which CC Relay already holds to launch and close terminals.

Injection spike findings (throwaway terminals in scratch dirs, never the user's live sessions):

- **Single-line `do script`: works.** The prompt submitted and the session ran a real turn.
- **Plain multiline `do script`: broken.** An embedded newline left the text sitting unsubmitted in the input box (the dangerous case). This ruled out plain `do script`.
- **Bracketed-paste `do script`: preserves multiline and special characters.** The TUI inserts the whole block literally. Ordinary prompts also accept the Return that `do script` appends, but task 263 proved that Claude can collapse a large paste into `[Pasted text ...]` while ignoring that same Apple Event's Return. CC Relay therefore verifies that the turn actually starts and, when it does not, sends one guarded separate Return.
- **A nonempty whitespace `do script` to the exact existing tab emits a distinct Return.** An empty action can report success without moving Claude's current large-paste widget. The trailing space is harmless prompt whitespace and CC Relay uses it only as the guarded large-paste submit action, never as an unconditional second submission.
- **System Events `keystroke` (clipboard + Cmd+V, Candidate B): unavailable.** `osascript is not allowed to send keystrokes` (Accessibility denied). Candidate B is intentionally not used. Cancellation therefore also avoids System Events and sends a best-effort ESC through the same `do script` channel.
- **cwd munging uses the realpath.** A `/var/...` scratch dir (a symlink to `/private/var/...`) is stored under the private-form directory, so the resolver munges `realpathSync(cwd)` and falls back to a `<sessionId>.jsonl` glob across all project dirs.
- **Transcript persistence is asynchronous and can lag badly.** A measured task had a 1.48 second median delay, an 11.4 second p90, and a 55.4 second maximum between Claude's event timestamp and Relay storage. The official Claude hook reference confirms the transcript may lag the in-memory conversation. Live hooks are therefore the primary activity channel and the transcript is the durable fallback. See [[claude-terminal-live-output]].

### Readiness, submission, and completion

1. **Readiness gate.** Before typing, the session must be present in `claude agents --json` and idle. An empirical spike confirmed a session sitting at the folder trust prompt is **not** registered at all. The launch binding coordinator now handles that exact prompt on the fresh owned native launch before discovery, then gives registration a fresh timeout; see [[claude-folder-trust-startup]]. Once listed, session idle plus the viewport screen gate is the input-ready signal. The transcript file is deliberately **not** required, because a freshly launched terminal is discoverable before its first transcript exists (see [[claude-fresh-session-review]]); requiring it made the flagship "launch then queue the first task" flow time out. The tail simply reads from offset 0 once the file appears, so even the first turn runs visibly. The readiness error distinguishes "the session disappeared before CC Relay could type" (non-retryable) from "the session is present but stayed busy" (retryable).
2. **Validate the prompt** then **apply model and effort** when the task carries configured settings. CC Relay re-verifies the live session id, pid, workspace, window, and tty before stopping only that Claude pid. It restores the same UUID in the same tab with the pinned binary and either `--session-id` for a fresh conversation or `--resume` for an existing transcript, plus the selected `--model`, `--effort`, and loopback live-hook settings. New CC Relay-owned terminals receive the same hook settings on their initial launch. CC Relay waits for a different pid to register as the same idle interactive session in the same workspace and window before continuing. A failed or ambiguous relaunch is non-retryable and no prompt is typed.
3. **Re-verify terminal identity** immediately before typing (see below). A prompt that cannot travel as an osascript argv value (larger than the byte limit, or containing a NUL) has already been routed to the headless path by the runner before the executor runs (Issue 15); the executor keeps the same check as a non-retryable backstop for direct callers.
4. **Record the transcript byte offset** where this turn's records begin, then **inject** the bracketed-paste payload. The offset is the transcript size read immediately before typing. A fresh session with no transcript starts at 0; a resumed session whose stat transiently returns negative is re-statted with a short bounded retry rather than restarting at 0, because offset 0 would replay history and a stale `end_turn` could complete the turn with an earlier response (Issue 14). Fresh-vs-resumed is decided once at task start, because the same transient stat failure that yields a negative size also fails a concurrent existence check.
5. **Confirm the exact prompt and recover a held large paste.** Injection first emits a quiet `deliveryState: injected` progress event. Only a `UserPromptSubmit` hook whose full prompt matches the delivered task, or a top-level non-summary transcript user record containing that complete prompt, confirms submission and emits `claude/started`. Busy state and arbitrary transcript growth remain liveness only. Unrelated or partial JSONL growth receives one quiet parsing interval, then cannot permanently suppress recovery. `PreCompact` and `PostCompact` explicitly hold and release the compaction state; `/compact`, its summary, and restored attachments never count as the continuation. After 1.5 seconds, an idle unconfirmed turn re-verifies the exact window, tty, pid, transcript, and cancellation state before sending at most one whitespace-plus-Return action. If the exact prompt still never appears, the task fails **non-retryably** rather than executing it elsewhere. A separate five-minute processing ceiling prevents busy or compaction state from occupying the queue forever without an exact transcript anchor or a matching processing hook.
6. **Mirror live, then reconcile.** After submission, current-turn `MessageDisplay`, tool, and `Stop` hooks emit Task Activity immediately. Where Claude supplies `prompt_id`, hooks from a different turn are ignored. The exact transcript prompt becomes the durable correlation anchor and can correct a delayed stale hook id; records before that anchor are not rendered as this task's output. The native watcher then drains persisted records as soon as they arrive. Exact tool ids and completed message text suppress delayed transcript duplicates.
7. **Complete or report a verified question.** Completion requires at least two idle observations and either the current main `Stop` hook supplied a final response with no background work or a correlated assistant record ended on a stop reason other than `tool_use`. `Stop.last_assistant_message` is authoritative on the live path because Claude documents that the final transcript record may not exist yet. A terminal is shown as **Input needed** only when a current `AskUserQuestion` tool use remains unresolved after the idle grace. Generic idle with no final and no question produces quiet progress and continues watching; generic busy cannot claim that a question was answered. See [[claude-terminal-input]].

Heartbeat and cancellation notices use a dedicated `claude/progress` event (rendered as a quiet note, not a warning) so a healthy long turn does not accumulate warning-styled entries every 30 seconds. An inactivity ceiling and a transcript-shrinkage guard both fail non-retryably. The ceiling measures **continuous inactivity**, not total turn duration: every live hook, drained transcript record, busy discovery status, and observed transcript growth restarts its 45-minute window, so a turn that keeps working never fails on elapsed time alone. Task 320 exposed the former wall-clock version, which failed a visibly busy sub-agent run at 45m11s while its own 30-second heartbeats proved the session was still working. An idle pause accrues inactivity normally, so an abandoned interactive prompt still releases its task and session within the same bound. Cancellation sends a best-effort ESC to the exact window, stops the watcher, marks the task cancelled, and surfaces that the terminal may still be finishing its turn.

### No double execution through queue auto-retry

`src/queue.mjs` auto-retries any failure whose `error.retryable !== false`. Because a terminal-driven turn cannot be un-run, **every** failure thrown at or after injection is `retryable: false`: the no-start guard, an ambiguous or failed separate submit action, the idle-without-a-final-response case, an empty final response, the inactivity ceiling, transcript shrinkage, a mid-turn terminal close without a final record, and even the injection call itself (an `osascript` timeout can fire after Terminal.app already delivered and processed the Apple Event, so the prompt may already be running). Only genuinely pre-injection failures stay retryable, where nothing was typed: the readiness "stayed busy" timeout, the identity-recheck mismatch, the identity-recheck re-resolution flake (Issue 16), and a resumed session whose transcript size stays unreadable through the bounded re-stat (Issue 14). Each timed pre-injection loop re-checks cancellation immediately before its retryable throw, so a cancel that lands during the final readiness poll or the final re-stat wait (after that iteration's loop-top check has already passed) is reported as cancelled and never auto-requeued (Issue 18). The post-paste submit guard also rechecks cancellation immediately before its one extra action.

### Injection-time terminal identity re-verification

CC Relay targets a window by mapping the live session pid to a tty to a Terminal window. macOS **recycles tty names**, so a window and tty resolved when the task starts can belong to a different session by the time CC Relay types. Immediately before injecting, the executor re-reads the live session from `claude agents --json` and re-resolves the terminal for its current pid; if the window id, tty, or runtime pid no longer match the resolved target, it aborts with a retryable, pre-injection error and types nothing. This closes the window-recycling hazard proven by the incident below.

The recheck separates two retryable, pre-injection outcomes (Issue 16). If the re-resolution **flakes** (the resolver threw or returned nothing), CC Relay reports that it could not re-verify the terminal, because a flake has not proven anything was reused. If it returns a **different** window, tty, or pid, CC Relay reports the recycled-window mismatch. A flake at task start instead falls back to headless in the runner; failing retryably here (the executor owns no headless path) is coherent because the re-run re-resolves from scratch and itself falls back to headless if resolution flakes again.

The same identity check runs again before the guarded separate submit. At that point the prompt has already been pasted, so any identity ambiguity is non-retryable and CC Relay does not send the extra action. This prevents a recycled window from receiving Return while also preventing the queue from re-pasting an ambiguous turn.

### Model and effort

A configured terminal-driven turn uses the task's selected model and effort. CC Relay does not inject `/model` or `/effort`, because slash commands are TUI state changes and are not a reliable per-task contract. Instead, it restarts the verified idle Claude process in the same tab and UUID with the pinned binary plus Claude's supported `--model` and `--effort` launch flags. `best` maps to `fable`, matching the headless path. Account-default model selections omit `--model`.

The `claude/started` event carries `sessionMode: 'terminal'` plus the settings actually placed on the launch command. The relaunch produces two quiet progress events: one before stopping the old verified pid, and one after the replacement process is idle and verified.

The process restart intentionally clears any unsent manual composer draft. CC Relay cannot inspect the TUI draft, and preserving it would risk merging unknown text with the queued task.

### Fallback matrix

| Condition | Path / outcome |
| --- | --- |
| Platform is not darwin | Headless (`claude -p ... --resume`) |
| No owned single-tab Terminal.app window resolves for the session | Headless |
| Terminal identity resolution throws at task start | Headless |
| darwin and owned terminal resolves | Terminal-driven injection |
| Prompt has a NUL byte or exceeds the argv byte limit | Headless fallback (runner routes to `runHeadless`; pre-injection, nothing typed; a `claude/progress` note explains it) |
| Session stayed busy through the readiness window | Fail (retryable, pre-injection) |
| Session disappeared before typing | Fail (non-retryable, pre-injection) |
| Transcript stat returns negative for a resumed session | Bounded re-stat; recover if it heals, else Fail (retryable, pre-injection). A fresh session with no transcript still starts at offset 0 |
| Terminal re-resolution flakes at the pre-injection identity recheck | Fail (retryable, pre-injection). Message says the terminal could not be re-verified |
| Window/tty/pid identity changed just before typing | Fail (retryable, pre-injection). Nothing typed |
| Configured model or effort | Re-verify exact identity, stop only that Claude pid, and restore the same UUID in the same tab with launch flags |
| Old Claude pid does not exit | Fail (non-retryable). No relaunch and no prompt |
| Relaunch Apple Event is ambiguous or replacement session does not verify | Fail (non-retryable). Never send the launch command twice and never type the prompt |
| Injection call errors | Fail (non-retryable). The prompt may already be running |
| Injected but no exact prompt evidence after 1.5 seconds | While idle and outside compaction, re-verify the exact terminal, session, and transcript, then send at most one guarded separate Return. Busy and unrelated transcript growth delay the check only while they are current |
| Guarded Return errors or the exact prompt still never appears | Fail (non-retryable). No fallback, to avoid double execution |
| Exact prompt hook arrives but processing cannot be verified within five minutes | Fail (non-retryable). The terminal state is uncertain, so CC Relay does not type or run the task again |
| Idle without a turn-final record after the turn started | Emit `claude/input-required` only for a pending current `AskUserQuestion`; otherwise emit quiet progress and keep checking. See [[claude-terminal-input]] |
| Empty final, inactivity ceiling, or transcript shrinkage | Fail (non-retryable). The turn already ran. A turn that stays busy never reaches the ceiling |

Windows terminal-driven execution is not built; Windows and Linux keep the headless path. A Windows path would need a SendKeys-equivalent that survives multiline input and an equivalent readiness signal.

## Settings and submission live validation (July 25, 2026)

Task 266 selected Opus at max effort but ran through a CC Relay server started before the guarded submit fix was written. Its persisted raw events used `session default` settings and contained no submit-recovery progress event. The terminal held `hi` without a transcript turn, proving the old backend neither applied the task settings nor started the message.

The current executor was then run directly against that exact idle session:

1. It verified session UUID `54d2fa59-22ec-4d5d-9ead-d3360bdb69b2`, pid `37109`, Terminal window `53148`, and `/dev/ttys015`.
2. It stopped only pid `37109`, launched Claude Code 2.1.220 in the same tab with `--session-id <same UUID> --model opus --effort max`, submitted `hi`, mirrored Claude's visible response, and completed.
3. It repeated the path with an existing transcript. The replacement command line used `--resume <same UUID> --model opus --effort max`, and Claude returned exactly `OK`.
4. It repeated a resumed turn with a 281-line prompt. The prompt submitted and Claude again returned exactly `OK`.

The active post-run process remained on the same tty and exposed the selected launch flags through `ps`. See [[claude-terminal-settings-review]] for the adversarial review and the remaining external-process risks.

## Incident: spike cleanup killed a recycled-tty session (July 24, 2026)

During development, an injection-verification spike launched a throwaway Terminal window, and its cleanup killed **all processes on that window's tty by tty name** captured earlier, assuming they were the spike's leftovers. By kill time the spike's own session had already died at the trust prompt (no transcript was ever written), and macOS had **recycled that tty name** to a different, fully started Claude Code session (a full MCP stack was running on it). The cleanup killed that unrelated session.

Root cause: **tty names are recycled by macOS**, so a tty identifier captured earlier can point at a different process tree later. Acting on a stale tty name without re-verifying the live session identity is unsafe.

Corrective rules:

- Never kill, close, or send to a terminal based on a tty name captured earlier. Verify the live session identity (session id, pid, **and** cwd) at action time.
- This is why the executor re-verifies window, tty, and pid against a fresh `claude agents --json` read immediately before every injection (see [[#Injection-time terminal identity re-verification]]). The same recycling hazard that caused the incident is the reason for that code path.

See also [[terminal-close-review]] for the related rule that terminal Close must terminate processes on the exact verified tty before closing the window.

## Known limitations and backlog

- **Interactive input is terminal-owned.** CC Relay verifies a current `AskUserQuestion` before showing **Input needed** and keeps watching, but the user answers the selector in Terminal.app. CC Relay does not guess or inject answers. See [[claude-terminal-input]].
- **Issue 3 (runtime-recovered terminals and user drafts).** A user-launched terminal that CC Relay recovers ownership of is injection-eligible. If the user has half-typed text in the TUI input box, the bracketed-paste injection merges into that draft before submitting. There is no API to read or clear the input box first. Backlog.
- **Issue 7 (foreign transcript correlation) - resolved.** Only the exact complete delivered prompt anchors transcript output to the turn. Compact summaries, tool results, attachments, partial text, and unrelated user records are ignored before that anchor. Current-turn hook events are filtered by `prompt_id` when available. See [[claude-continuation-compaction-recovery-review]].
- **Issue 11 (Windows binary probing).** The pinned-binary work does not yet handle Windows `.cmd`/`.exe` shell semantics; a future pass is needed before a Windows terminal-driven path.
- **Issue 12 (queue begin-task copy) - resolved.** Terminal execution now applies the task's model and effort through verified Claude launch flags, so the queue start copy and actual execution agree.
- **Issue 13 (resolver refresh-while-pending).** A minor nit in binary-resolver refresh coalescing.
- **Shutdown-then-manual-retry re-injects by user choice.** A terminal turn interrupted by CC Relay shutdown is marked interrupted and not auto-retried. If the user manually retries it later, CC Relay re-injects the prompt; that is an explicit user action, not an automatic double execution.

## Task 263 held-paste follow-up (July 24, 2026)

Task 263 supplied the missing real failure case. The terminal visibly contained `[Pasted text #1 +280 lines]`, while its session transcript did not grow and its persisted task events contained only `claude/started`; `claude agents --json` never reported the session busy. The startup hook warning shown above the composer was unrelated because the session had already registered as idle and accepted the paste. The root cause was narrower: the original implementation assumed the Return appended to the bracketed-paste Apple Event always submitted the collapsed paste.

Issue 19 is resolved in `ClaudeTerminalExecutor.watchTurn`. After a short no-start grace period, CC Relay re-verifies the exact terminal identity, checks complete and partial transcript growth, checks live busy state, checks cancellation, and sends at most one separate Return. A late original start suppresses the action. Every ambiguous outcome after the paste remains non-retryable. The focused terminal suite passes 46 of 46 tests and the full repository passes 413 of 413. See [[claude-terminal-submit-review]].

## Re-review outcome (July 24, 2026)

An adversarial re-review confirmed every original blocker fixed in code (readiness gate, non-retryable post-injection classification against queue auto-retry, finalize race, shrinkage, session-gone, prompt pre-flight, discovery grace, quiet heartbeats, injection-time identity recheck) at 347/347 tests. Verdict: **Ship pending live check**. The assembled real path (real injection, real transcript source, one live turn) has never run end-to-end; the required live check is one first turn on a freshly launched CC Relay-owned terminal, one long tool-using turn, and one mid-turn cancel.

Follow-ups found by the re-review, all three resolved July 24, 2026:

- **Issue 15 (moderate) - resolved.** An oversize or NUL-bearing prompt on an owned macOS terminal now falls back to the headless `runHeadless` path instead of failing. `ClaudeExecutionRunner.headlessFallbackReason` runs the deterministic pre-injection check before any typing; when it fires, the runner emits a `claude/progress` note explaining the headless run and never calls the terminal executor, so there is exactly one execution and no injection. Both cases route identically because the headless path passes the prompt on stdin, never argv, so neither the byte limit nor the NUL constraint applies to it, and every Claude turn ran that way before the terminal path existed. The executor keeps its own non-retryable pre-injection reject as a backstop for direct callers. Plan-execution prompts embedding a large final plan are the realistic case.
- **Issue 14 (low probability, high impact) - resolved.** `runTurn` records whether a transcript already exists once at task start (`resumed`), decoupled in time from the offset read, because the same transient stat failure that makes `size()` return -1 also makes a concurrent existence probe return false. `resolveInjectionOffset` trusts a non-negative size, treats a negative size on a fresh session as offset 0 (Issue 1 preserved), and on a resumed session re-stats with a short bounded retry, recovering the real size if the blip heals or failing retryably pre-injection (nothing typed) if it does not, rather than replaying history where a stale `end_turn` could complete the task with an old response.
- **Issue 16 (minor) - resolved.** The pre-injection identity recheck now separates a re-resolution flake (the resolver threw or returned nothing) from a proven mismatch (it returned a different window, tty, or pid). Both stay retryable pre-injection, but the flake message now says CC Relay could not re-verify the terminal instead of claiming another session reused the window. Coherence: a resolver flake at task start falls back to headless in the runner, and a flake at verify time (inside the executor, which has no headless path) fails retryably so the re-run re-resolves cleanly and itself falls back to headless if resolution flakes again.
- The trust-prompt safety property now rests on the verified fact that a trust-prompt session is not registered in `claude agents --json` (Claude CLI 2.1.216/2.1.218). Other registered-idle modal states (expired login, update notice, future CLI changes) would swallow an injection, which degrades to the non-retryable no-start guard; safe but version-sensitive. Re-verify on CLI upgrades.

See [[parallel-claude-review]], [[project-workspaces]], [[diagnostics]], [[claude-fresh-session-review]].

## Sub-agent visibility in the task console (July 27, 2026)

A Claude turn that runs a team session spawns sub-agents through Claude Code's own `Agent` tool. CC Relay recorded those launches as generic connected-tool calls, so a task that had been live for an hour looked exactly like one waiting on a single slow command. The console now names the agents and tracks how many are still working.

### What the transcript actually contains

Ground truth comes from a real team session transcript and the events it produced for task 320:

1. A launch is an assistant `tool_use` block named `Agent`. Its input carries `description` (the operator-facing name, for example `dev-1: editor layout rework`), `subagent_type`, and the full briefing prompt.
2. A background launch returns in milliseconds. The paired `tool_result` record reports `toolUseResult.isAsync: true` with `status: async_launched` and an `agentId`, and its text says the agent is working in the background. The tool call completing therefore says nothing about the agent finishing.
3. The real completion arrives much later, as a separate record of type `queue-operation` whose content is a `<task-notification>` document holding `<task-id>` (the agent id), `<tool-use-id>` (the tool call that launched or last resumed the agent), `<status>`, a `<summary>` reading `Agent "<name>" finished`, and the agent's own report. CC Relay dropped these records entirely before this work.

Two properties of the real file shape the design. The same notification is written twice, once with operation `enqueue` and once with `remove`, carrying identical content. And a notification can be appended before the launch it resolves: in the captured session the notification for `toolu_012M2...` sits four lines above that tool call. A resumed agent notifies again through the `SendMessage` tool use that woke it, so one agent id can appear under several tool use ids.

### Event shapes

`consumeClaudeStreamMessage` in `src/claude-execution-runner.mjs` keeps the existing `item/started` and `item/completed` envelope with `item.type: 'mcpToolCall'`, `server: 'Claude Code'`, `tool: 'Agent'`, so stored events from older tasks and every existing consumer keep rendering unchanged. A sub-agent launch adds flat metadata: `subAgent: true`, `toolUseId`, `agentName` from `description`, `agentType` from `subagent_type`, and at completion `backgrounded` plus `agentId`. The backgrounded flag is read from the record's `toolUseResult` when the interactive transcript supplies it and from the result text otherwise, so the headless stream-json path stays covered.

A parsed notification emits one new event:

```json
{
  "type": "claude/agent-finished",
  "provider": "claude",
  "toolUseId": "toolu_012M2JjykSAMBUw7JewJMYeX",
  "agentId": "a21d93d8cd05ec4fb",
  "status": "completed",
  "summary": "Agent \"dev-2: standby core developer\" finished",
  "agentName": "dev-2: standby core developer"
}
```

The agent's full report is deliberately not carried: every event row lands in SQLite and travels over server-sent events on each refresh. Queue operations that are not task notifications (agent messages, plain dequeues, empty content) emit nothing. The turn context remembers the notifications it has already reported, so the enqueue and remove copies of one notification produce a single finish.

### Console behavior

`public/event-stream.js` collects sub-agent item ids before grouping, then folds a `claude/agent-finished` event into the launch signal it resolves. Collecting first is what makes the out-of-order case work: a notification read before its launch creates the entry, and the later `item/started` and `item/completed` merge into the same signal. A notification whose tool use is not a known sub-agent launch (a resumed agent reporting through `SendMessage`) keeps its own line rather than silently attaching itself to an unrelated tool call.

`subAgentEntryState` reports `running` while the launch call is open, `backgrounded` once Claude has launched the agent asynchronously, and `finished` when its notification arrives or a synchronous run returns. `activeSubAgentCount` counts live launches instead of decrementing a shared tally, so the number cannot go negative when a notification arrives early, repeats, or belongs to a launch this stream never saw. A turn that is no longer running owns no live sub-agents, so `renderEventStream` passes `turnEnded` and the count clears with the turn.

The signal itself sits between protocol noise and errors: the agent name at full contrast, its type and elapsed run time on a muted meta line, the briefing behind a collapsed disclosure, and one small live dot whose pulse is opt-in through `prefers-reduced-motion: no-preference`. Sub-agent runs stay in the Highlights and Commands filters, the copy log carries name, outcome, and brief, and no new `aria-live` region was added: state changes ride the existing terminal announcements. Every value derived from model output is escaped through `public/escape-html.js`.

Covered by `test/claude-execution-runner.test.mjs` (real launch, backgrounded result, notification parsing, enqueue and remove deduplication, resumed agents, non-notification queue operations), `test/event-stream.test.mjs` (folding, out-of-order notifications, orphan notifications, never-negative count, turn-end clearing, legacy events unchanged), and `test/sub-agent-console.test.mjs` (signal markup, escaping, count chip, reduced motion).

#claude #diagnosis #terminal #parallel
