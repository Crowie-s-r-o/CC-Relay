---
name: Claude Terminal Visibility
description: Root cause of empty Claude terminals and parallel Claude limits, and the macOS terminal-driven execution fix.
type: diagnosis
---

# Claude Terminal Visibility

> [!important]
> Investigated July 23, 2026 (task around #249). Two reported problems: (1) Relay Claude turns never appear in the launched interactive terminal; (2) parallel Claude terminals do not work. Both root causes are confirmed against installed binaries.

> [!success]
> Problem 1 is resolved on macOS as of July 24, 2026. Relay now runs a queued direct Claude turn inside the interactive terminal by typing the prompt into the exact owned Terminal.app window, then mirrors the session transcript back into Task Activity. See [[#Resolution Problem 1 macOS terminal-driven execution]] below. The headless path remains the fallback and is unchanged on Windows and Linux.

## Problem 1: empty interactive terminal (architectural)

Codex parity works because Codex has a **client/server split**: the interactive terminal launches with `codex --remote ws://127.0.0.1:4769` and Relay is a second client of the same shared app-server. One process runs the turn, so both Relay's panel and the terminal display it. See [[project-workspaces]] and `src/codex-app-server.mjs`.

**Claude Code has no equivalent.** Verified on Claude CLI v2.1.218: `claude --help` exposes only `agents`, `auth`, `auto-mode`, `doctor`, `install`, `mcp`, `plugin`, `setup-token`, `update`. The only "serve" is `claude mcp serve` (Claude acting as an MCP tool server for other clients), which is **not** a way to inject a turn into a running interactive TUI. There is no `--remote`, no attach, no socket into a live session.

Consequently `src/claude-execution-runner.mjs:434` spawns a **separate headless process** `claude -p --output-format stream-json --resume <session-id>`. That headless child shares only the transcript **file** with the interactive TUI (same `--session-id`), never a live process. Relay reads its stdout pipe and renders the app panel; the interactive terminal never sees the turn, so it stays empty. Prior fixes that tweaked flags on this headless call could never fix visibility because the turn executes in the wrong process.

**To make the terminal show activity, the turn must execute in the interactive terminal itself.** No native attach exists, so the realistic path is driving the actual terminal (macOS: AppleScript/`osascript` into the known Terminal window; Windows: SendKeys equivalent) and reading the session `.jsonl` transcript to populate the app panel. Relay already has most of the macOS plumbing: it launches via `osascript ... do script` and captures the exact Terminal `window id` + `tty` (`src/project-launcher.mjs`, `src/terminal-runtime-resolver.mjs`), so it can target keystrokes at the right window.

## Problem 2: parallel Claude / binary+PATH mismatch

There are **two claude binaries** on this machine:

- `/opt/homebrew/bin/claude` = **v2.1.84**, PATH position 1. `claude agents --json` fails with `error: unknown option '--json'`.
- `/Users/patrikkelemen/.local/bin/claude` = **v2.1.218**, PATH position 24. `claude agents --json` returns live interactive sessions (pid, cwd, sessionId, name, status).

`src/claude-session-registry.mjs:74` runs bare `claude agents --json`. When PATH resolves `claude` to the homebrew 2.1.84 first, discovery **errors and returns `[]`** (swallowed by the catch), so Relay sees no/limited live Claude sessions and cannot manage multiple in parallel. The interactive terminal the user launched runs 2.1.218 (fish interactive PATH prefers `.local/bin`), but Relay's backend PATH may resolve to 2.1.84 depending on how Relay was started (Finder/dock vs terminal). This nondeterminism is a strong candidate for the flaky parallel behavior. The scheduler's `parallelClaudeExecution` capability also requires a Relay **restart** to load (see [[parallel-claude-review]] and [[task-history]] line about `parallelClaudeExecution`), so a stale backend is a second possible cause.

**Fix direction:** pin the exact claude binary (prefer the one supporting `agents --json`, matching the launched terminal's binary) instead of relying on bare PATH resolution, across `claude-session-registry.mjs`, `claude-execution-runner.mjs`, `claude-runner.mjs`, `claude-runtime-status.mjs`, and the launcher. Then confirm the running backend advertises `parallelClaudeExecution`.

### Fix: pinned binary resolution (July 23, 2026)

`src/claude-binary.mjs` now owns binary selection. `ClaudeBinaryResolver` enumerates every candidate in priority order (each `PATH` entry, then the well-known absolute locations `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `/usr/bin/claude`), probes each with `--version`, parses the leading semantic version, and picks the **highest** version. The comparison is numeric per component, not lexical, because `2.1.84` sorts above `2.1.218` as text while `218` is the newer patch. The exec function and platform, env, and homedir inputs are dependency-injected so tests use fakes.

`src/server.mjs` resolves the binary **once at startup** (a single top-level `await` before wiring) and passes the resolved absolute path into `ClaudeRunner`, `ClaudeExecutionRunner` (through its existing `command` option), `ClaudeRuntimeStatus`, and `ProjectLauncher`. The launched interactive terminal command and the UI connection helper both invoke the pinned path through `claudeRelayCommand`, so display and launch stay coherent. The bare `claude` fallback stays unquoted; a resolved absolute path is shell-quoted.

`ClaudeSessionRegistry` receives the resolver's `resolve` function rather than a static string. When `claude agents --json` fails with an unknown-option error (an outdated binary that predates `--json`), the registry re-resolves once with `{ refresh: true }` and retries against the newer binary. The retry is skipped when the re-resolved path is unchanged, so there is no loop. The resolver caches for the process lifetime; `refresh` is the only re-probe path.

The resolver never rejects: any probe or resolution error falls back to bare `claude` with a `claude.binary.fallback` diagnostic, so a failed resolve can never abort server startup. See [[diagnostics]] for the emitted events.

> [!note]
> Selection is best-available, not a hard floor. If only the outdated `2.1.84` binary exists, it is still chosen and `agents --json` still fails, which is no worse than before. The `claude.binary.resolved` diagnostic records `supportsAgentsJson` so the degraded case is visible.

## Resolution Problem 1 macOS terminal-driven execution

Built July 24, 2026. A queued **direct Claude Execute** turn now runs inside the interactive terminal on macOS when Relay owns an exactly resolvable single-tab Terminal.app window for that session. Plan council and the parallel Claude batch path are untouched.

### Modules

- `src/claude-transcript-tail.mjs`: pure helpers. Munges the session cwd to `~/.claude/projects/<munged>/<sessionId>.jsonl`, reads only appended bytes after a byte offset, splits complete JSONL lines, extracts assistant text, detects a turn-final assistant record, and wraps a prompt in bracketed-paste markers with ESC sanitized out.
- `src/claude-terminal-executor.mjs`: `ClaudeTerminalExecutor` orchestrates the readiness gate, prompt validation, injection-time identity re-verification, injection, submission confirmation, transcript tailing, completion detection, heartbeats, and cancellation. It emits the same event shapes as the headless path by feeding transcript records through the existing `consumeClaudeStreamMessage`.
- `src/claude-execution-runner.mjs`: `run()` branches at the top. On darwin with a resolved owned terminal it calls the executor; otherwise it runs the unchanged headless path (`runHeadless`). The `run(task, {onEvent, onStderr})` contract and the `{ finalResponse, sessionId, reportedSessionId, exitCode }` outcome are identical, so `src/queue.mjs` is unchanged.
- `src/server.mjs`: passes `platform` and a `resolveTerminal` callback into `ClaudeExecutionRunner`. The callback gates on `projectLauncher.terminalForThread(session.id)` (the same ownership tracking the Close feature uses) and re-verifies the exact `terminalWindowId` and `terminalTty` fresh through `TerminalRuntimeResolver` before each turn.

### Injection mechanism (chosen: bracketed paste through JXA do script)

Injection uses `osascript -l JavaScript` calling `Terminal.doScript(payload, {in: <tab 1 of window id>})`, where `payload` is the prompt wrapped in bracketed-paste markers `ESC[200~ ... ESC[201~`. The prompt is passed through JXA `argv`, so there is no AppleScript string escaping and leading dashes, double quotes, backslashes, and newlines survive intact. This needs only Automation (AppleEvents) permission, which Relay already holds to launch and close terminals.

Injection spike findings (throwaway terminals in scratch dirs, never the user's live sessions):

- **Single-line `do script`: works.** The prompt submitted and the session ran a real turn.
- **Plain multiline `do script`: broken.** An embedded newline left the text sitting unsubmitted in the input box (the dangerous case). This ruled out plain `do script`.
- **Bracketed-paste `do script`: works for multiline and special characters.** The TUI inserts the whole block literally and the carriage return that `do script` appends submits it as one turn. This is the chosen mechanism.
- **System Events `keystroke` (clipboard + Cmd+V, Candidate B): unavailable.** `osascript is not allowed to send keystrokes` (Accessibility denied). Candidate B is intentionally not used. Cancellation therefore also avoids System Events and sends a best-effort ESC through the same `do script` channel.
- **cwd munging uses the realpath.** A `/var/...` scratch dir (a symlink to `/private/var/...`) is stored under the private-form directory, so the resolver munges `realpathSync(cwd)` and falls back to a `<sessionId>.jsonl` glob across all project dirs.
- **Transcript is flushed incrementally within a turn.** Each assistant and tool_result record is appended as it happens (distinct per-record timestamps across tool rounds), so Task Activity updates live rather than dumping at turn end.

### Readiness, submission, and completion

1. **Readiness gate.** Before typing, the session must be present in `claude agents --json` and idle. Registration plus idle is the input-ready signal: an empirical spike confirmed a session sitting at the folder-trust prompt is **not** registered at all, so if `claude agents --json` lists it and it is idle, it is past the blocking prompts. The transcript file is deliberately **not** required, because a freshly launched terminal is discoverable before its first transcript exists (see [[claude-fresh-session-review]]); requiring it made the flagship "launch then queue the first task" flow time out. The tail simply reads from offset 0 once the file appears, so even the first turn runs visibly. The readiness error distinguishes "the session disappeared before Relay could type" (non-retryable) from "the session is present but stayed busy" (retryable).
2. **Validate the prompt** (reject NUL bytes and prompts larger than the argv byte limit) then **re-verify terminal identity** immediately before typing (see below).
3. **Inject** the bracketed-paste payload after recording the transcript byte offset (0 on a first turn).
4. **Confirm submission.** Within a tight window, require either the session to turn busy or the transcript to grow. If neither happens, the task fails **non-retryably** with a message that the terminal may hold unsubmitted text. Relay never falls back to the headless path here, because the text may already be queued and a second execution would double it.
5. **Tail and mirror.** New transcript records after the offset are fed through `consumeClaudeStreamMessage`, emitting identical `item/started`, `item/completed`, and `claude/message` events. Only lines written after injection belong to this turn.
6. **Complete** when the session is idle for at least two consecutive observations **and** a post-injection assistant record ended on any stop reason other than `tool_use` (covers `end_turn`, `max_tokens`, `stop_sequence`). The two-observation requirement plus a final drain avoids a race where a thinking-only record carries a terminal stop reason before the final text record flushes; without it Relay could record intermediate narration as the result. Fast turns can skip the busy poll, so completion is transcript-driven, not solely status-driven. `finalResponse` is the turn-final record's text, falling back to the last non-empty assistant text seen during the completed turn. A turn that returns to idle with no turn-final record (which also happens when the user presses ESC in the terminal) fails and is **never** auto-retried.

Heartbeat and cancellation notices use a dedicated `claude/progress` event (rendered as a quiet note, not a warning) so a healthy long turn does not accumulate warning-styled entries every 30 seconds. A generous ceiling and a transcript-shrinkage guard both fail non-retryably. Cancellation sends a best-effort ESC to the exact window, stops the watcher, marks the task cancelled, and surfaces that the terminal may still be finishing its turn.

### No double execution through queue auto-retry

`src/queue.mjs` auto-retries any failure whose `error.retryable !== false`. Because a terminal-driven turn cannot be un-run, **every** failure thrown at or after injection is `retryable: false`: the no-start guard, the idle-without-a-final-response case, an empty final response, the turn ceiling, transcript shrinkage, a mid-turn terminal close without a final record, and even the injection call itself (an `osascript` timeout can fire after Terminal.app already delivered and processed the Apple Event, so the prompt may already be running). Only genuinely pre-injection failures stay retryable: the readiness "stayed busy" timeout and the identity-recheck mismatch, where nothing was typed.

### Injection-time terminal identity re-verification

Relay targets a window by mapping the live session pid to a tty to a Terminal window. macOS **recycles tty names**, so a window and tty resolved when the task starts can belong to a different session by the time Relay types. Immediately before injecting, the executor re-reads the live session from `claude agents --json` and re-resolves the terminal for its current pid; if the window id, tty, or runtime pid no longer match the resolved target, it aborts with a retryable, pre-injection error and types nothing. This closes the window-recycling hazard proven by the incident below.

### Model and effort

A terminal-driven turn runs with the interactive session's own model and effort. Relay does not inject `/model` or `/effort`. The `claude/started` event carries `sessionMode: 'terminal'` and says the session's own settings apply.

### Fallback matrix

| Condition | Path / outcome |
| --- | --- |
| Platform is not darwin | Headless (`claude -p ... --resume`) |
| No owned single-tab Terminal.app window resolves for the session | Headless |
| Terminal identity resolution throws at task start | Headless |
| darwin and owned terminal resolves | Terminal-driven injection |
| Session stayed busy through the readiness window | Fail (retryable, pre-injection) |
| Session disappeared before typing | Fail (non-retryable, pre-injection) |
| Prompt has a NUL byte or exceeds the argv byte limit | Fail (non-retryable, pre-injection) |
| Window/tty/pid identity changed just before typing | Fail (retryable, pre-injection). Nothing typed |
| Injection call errors | Fail (non-retryable). The prompt may already be running |
| Injected but never starts | Fail (non-retryable). No fallback, to avoid double execution |
| Idle without a turn-final record, empty final, ceiling, shrinkage | Fail (non-retryable). The turn already ran |

Windows terminal-driven execution is not built; Windows and Linux keep the headless path. A Windows path would need a SendKeys-equivalent that survives multiline input and an equivalent readiness signal.

## Incident: spike cleanup killed a recycled-tty session (July 24, 2026)

During development, an injection-verification spike launched a throwaway Terminal window, and its cleanup killed **all processes on that window's tty by tty name** captured earlier, assuming they were the spike's leftovers. By kill time the spike's own session had already died at the trust prompt (no transcript was ever written), and macOS had **recycled that tty name** to a different, fully started Claude Code session (a full MCP stack was running on it). The cleanup killed that unrelated session.

Root cause: **tty names are recycled by macOS**, so a tty identifier captured earlier can point at a different process tree later. Acting on a stale tty name without re-verifying the live session identity is unsafe.

Corrective rules:

- Never kill, close, or send to a terminal based on a tty name captured earlier. Verify the live session identity (session id, pid, **and** cwd) at action time.
- This is why the executor re-verifies window, tty, and pid against a fresh `claude agents --json` read immediately before every injection (see [[#Injection-time terminal identity re-verification]]). The same recycling hazard that caused the incident is the reason for that code path.

See also [[terminal-close-review]] for the related rule that terminal Close must terminate processes on the exact verified tty before closing the window.

## Known limitations and backlog

- **Issue 3 (runtime-recovered terminals and user drafts).** A user-launched terminal that Relay recovers ownership of is injection-eligible. If the user has half-typed text in the TUI input box, the bracketed-paste injection merges into that draft before submitting. There is no API to read or clear the input box first. Backlog.
- **Issue 7 (foreign transcript correlation).** Records written to the session transcript by unrelated activity in the same window during the watch window could be misattributed to the turn. A correlation check keyed on the injected prompt record is a future hardening.
- **Issue 11 (Windows binary probing).** The pinned-binary work does not yet handle Windows `.cmd`/`.exe` shell semantics; a future pass is needed before a Windows terminal-driven path.
- **Issue 12 (queue begin-task copy).** The queue's task-start message still asserts the task's model and effort even though a terminal-driven turn uses the session's own settings. Cosmetic copy mismatch.
- **Issue 13 (resolver refresh-while-pending).** A minor nit in binary-resolver refresh coalescing.
- **Shutdown-then-manual-retry re-injects by user choice.** A terminal turn interrupted by Relay shutdown is marked interrupted and not auto-retried. If the user manually retries it later, Relay re-injects the prompt; that is an explicit user action, not an automatic double execution.

## Re-review outcome (July 24, 2026)

An adversarial re-review confirmed every original blocker fixed in code (readiness gate, non-retryable post-injection classification against queue auto-retry, finalize race, shrinkage, session-gone, prompt pre-flight, discovery grace, quiet heartbeats, injection-time identity recheck) at 347/347 tests. Verdict: **Ship pending live check**. The assembled real path (real injection, real transcript source, one live turn) has never run end-to-end; the required live check is one first turn on a freshly launched Relay-owned terminal, one long tool-using turn, and one mid-turn cancel.

New follow-ups found by the re-review, in priority order:

- **Issue 15 (moderate).** Prompts over the argv pre-flight limit are now non-retryably rejected on owned macOS terminals; they previously ran headless via stdin without limits. The rejection is deterministic and pre-injection, so falling back to headless for exactly this case is double-execution-safe and preserves capability. Plan-execution prompts embedding a large final plan are the realistic victim.
- **Issue 14 (low probability, high impact).** If the transcript stat transiently fails for an established session, `injectionOffset` becomes 0 and the reader replays history; stale `end_turn` records can complete the task with an old response. Guard: re-stat or fail retryably pre-injection when size is negative but a transcript is expected.
- **Issue 16 (minor).** Native-resolution flake at task start silently falls back to headless, while the same flake at verify time fails retryably; unify eventually.
- The trust-prompt safety property now rests on the verified fact that a trust-prompt session is not registered in `claude agents --json` (Claude CLI 2.1.216/2.1.218). Other registered-idle modal states (expired login, update notice, future CLI changes) would swallow an injection, which degrades to the non-retryable no-start guard; safe but version-sensitive. Re-verify on CLI upgrades.

See [[parallel-claude-review]], [[project-workspaces]], [[diagnostics]], [[claude-fresh-session-review]].

#claude #diagnosis #terminal #parallel
