---
name: Windows Compatibility
description: August 2026 Windows compatibility audit and fixes for terminal launch, CLI spawning, paths, and packaging, with the outstanding Windows smoke-test gate.
type: review
---

# Windows Compatibility

> [!note]
> **September 5: original-terminal opening now has a Windows implementation.** New launches use
> a dedicated native `conhost.exe` window around `cmd.exe`, retaining the CLI itself. The launcher
> records the host PID and process creation time. Opening validates both, the window's owning PID,
> and foreground success. Old launches without a creation-time identity use the activity fallback.
> Claude execution and OpenCode remain headless on Windows and use that same fallback. This path
> has deterministic win32 coverage but still needs the real-machine smoke gate below. See
> [[original-terminal-default]] and [[original-terminal-review]].

> [!important]
> As of August 12, 2026 the code base is Windows-correct by static analysis and simulated win32 tests, but the project has still only ever executed on macOS. Windows support is code-complete pending the smoke checklist below on a real Windows machine. Items 1 through 5 of that checklist are the release gate.

## What was broken before this pass

1. **The UI never rendered on Windows.** The static-asset and task-attachment containment guards in `src/server.mjs` used `startsWith(root + '/')`; win32 `resolve()` returns backslash paths, so every asset and image 404ed, and execute-plan attachment re-reads threw. Fixed with `isPathInside(root, candidate, pathModule)` exported from `src/artifacts.mjs`, proven against `path.win32` and `path.posix` in `test/windows-paths.test.mjs`.
2. **Every direct provider CLI spawn failed.** npm installs `claude` and `codex` as `.cmd` shims; `spawn('claude')` is ENOENT and `.cmd` without a shell is EINVAL since Node's April 2024 hardening. Root cause was `ClaudeBinaryResolver.probe()` itself failing on every `.cmd`, so the resolver returned an unspawnable bare `claude` fallback. Fixed in `src/claude-binary.mjs` with `providerCommandInvocation` (POSIX identity; win32 wraps `.cmd`/`.bat` in `cmd.exe /d /s /c` with cross-spawn caret escaping and `windowsVerbatimArguments`), `resolveExecutableOnPath`, and a stat-filtered probe, applied at session discovery, both Claude runners, the Codex app-server, standup generation, and both readiness probes. Prompts stay on stdin, never argv, which also keeps every call under the cmd 8191-char cap.
3. **Kill paths orphaned providers.** Cancels and shutdown killed only the direct child (cmd.exe), leaving the real CLI running and port 4769 held across restarts. Fixed with `terminateChildProcess` and the codex-app-server tree kill using `taskkill /PID <pid> /T /F` with a direct-kill fallback.
4. **Windows grid placement was invalid PowerShell.** The old script used `\"` escapes (PowerShell escapes with backticks) so `Add-Type` never compiled, and `WaitForInputIdle` always throws for console processes; a placement failure could orphan an untracked terminal. Rewritten in `src/project-launcher.mjs`: the emitted script contains no `\"` sequence, C# quotes are built from `[char]34`, a bounded `MainWindowHandle` poll replaces `WaitForInputIdle`, the whole block is try/catch so placement can never fail a launch, and background launches skip placement entirely.
5. **cmd /K quote stripping.** cmd rule 2 strips the first and last quote of a `/k` command line, corrupting a quoted resolved binary path. The `/k` argument now carries an outer sacrificial quote layer, and `cmdQuote` doubles trailing backslash runs so `D:\` cannot escape its own closing quote.
6. **Manually closed terminals leaked pool slots forever.** `taskkill` on a vanished PID exits non-zero; the throw skipped `forgetTrackedTerminal()` and the project slot stayed consumed until restart. `windowsTerminalProcessMissing` (exit 128 or `/not found/i`) now releases ownership for genuinely-gone processes; access denied and every other failure still fail closed and keep ownership. E2E pool tests cover both directions.
7. **Drive-letter case false rejections.** Provider-reported cwd case is not canonical on Windows. `sameWorkspacePath` (win32 folds case after platform resolve, POSIX stays strict) now guards the disposable executor gate, the keep-terminal-open retry, and Continue session. Everything else deliberately stays strict (see decisions).
8. **Copyable Claude launch command was POSIX-quoted.** `LAUNCH_COMMAND_QUOTE` in `src/server.mjs` picks `cmdQuote` on win32, `shellQuote` elsewhere. The Codex copyable command is literal-only and needed no change. Note: the command is for cmd.exe; pasted into PowerShell it fails to parse (safely).
9. **Display names showed whole Windows paths.** `workspaceName` in `public/app.js` now reuses `normalizedPath`; Codex sub-agent names split on `/[\\/]/` in both `public/event-stream.js` and `src/codex-app-server.mjs`.
10. **False-passing test.** `test/server-startup.test.mjs` used URL `.pathname` (yields `/C:/...` on Windows, so the child always exited 1 and the assertion passed vacuously); now `fileURLToPath`.

## Windows behavior differences that are by design

- Plan council runs headless on Windows; Claude terminal execution and live steering are macOS-only (`PLAN_COUNCIL_TERMINAL_EXECUTION` is darwin-gated and honestly advertised through `capabilities`).
- Terminal runtime recovery after a backend restart is macOS-only. Windows terminals from a previous backend stay visible but unclosable, matching [[terminal-close-review]].
- Grid placement coordinates can be offset on scaled displays because powershell.exe is not per-monitor DPI aware. Cosmetic.

## Decisions and deferrals

- **Case-fold scope (adjudicated by the adversarial reviewer):** fold only where provider-reported cwd meets stored `repo_path` on live disposable flows. Pinned projects pass through `realpathSync`, which canonicalizes case on Windows, so DB keys are consistent; folding the queue capacity bucket keys would desync them from pause and reservation keys. Deferred follow-up: canonicalize `repo_path` at its write point (needs a migration and touches UI display).
- **PID reuse on Windows close:** `taskkill` targets a numeric PID and Windows recycles PIDs. Pre-existing, accepted; a fix needs process start-time or image checks before close.
- **`writeFileAtomically` renameSync** can EPERM on Windows when an indexer or AV briefly holds the target. Deferred until observed.
- **`resolveExecutableOnPath`** ignores quoted PATH entries and custom PATHEXT order. Harmless for claude and codex.
- **Windows cancel has no fallback** when taskkill starts but exits 1 (access denied): the provider can survive a cancel. Listed for the smoke run.
- **Unclaimed concurrent work:** during this session an independent open-source-release stream committed the whole tree as `cca450b` (and follow-ups). The team's changes ride inside that commit; the pre-team baseline snapshot was the only artifact isolating team work for review.

## Unproven-on-macOS register

The first real Windows run must confirm: (a) `taskkill` exit code 128 for a missing PID (the locale-independent carrier of the already-exited tolerance); (b) the pre-existing `ForEach-Object {;` construct in listDisplays parses (if not, grid-enabled launches fail while plain launches still work); (c) real cmd.exe caret round-trips (tests prove self-consistency, not cmd behavior); (d) `$ErrorActionPreference = 'Stop'` in situ.

## Windows smoke-test checklist (ordered by risk; 1-5 gate the release)

1. Hand-close a CC Relay-launched cmd window, let the task end: expect `terminal.close.already_exited` and the pool slot freed; confirm `taskkill /PID 999999 /T /F & echo %errorlevel%` prints 128.
2. Repeat on a non-English Windows: the tolerance must trigger via exit code alone.
3. Attempt closing an elevated cmd tree: must fail loudly and keep the slot reserved.
4. Enable the terminal grid and launch: window opens and is placed; on failure, paste the listDisplays script into powershell.exe to test the `{;` construct.
5. Launch a Claude terminal with the npm shim under a spaced path: quoted command visible, `--session-id` injected, hooks settings intact.
6. Fresh Execute Claude task end to end; cancel must leave no `claude` or `node` orphan in tasklist.
7. Codex shared app-server via `codex.cmd`: starts, binds 4769, stop leaves no orphan holding the port across a restart.
8. Paste the copyable Claude command into cmd.exe (runs) and PowerShell (expected parse failure).
9. UI loads with all static assets; task images render; execute-plan attachment re-read works.
10. Standup via both providers: empty-string isolation flags respected.
11. Case probe: pin `C:\Repo`, produce a session reporting `c:\repo`: executor, keep-terminal-open retry, and Continue session all accept.
12. Quit CC Relay with several pooled terminals open: all owned windows close.
13. Minimized launch: opens minimized, no MoveWindow, slot accounting correct.
14. Project directory containing `%` and `&`: launch and headless task deliver the exact path.
15. Many `--add-dir` attachments: spawn stays under the 8191-char line cap.

## Verification evidence

- Full suite 1194/1194 after all fixes (1130 at session start); `node --check` clean on every touched entry file; `git diff --check` clean; `npm run release:check` passes for v0.1.0.
- Adversarial review verdict: Ship with Mitigations. Quoting proven by a UCRT plus cmd rule simulation; `isPathInside` proven by a parity table on both path modules; macOS reachability audit found byte-identical behavior everywhere except one cosmetic display delta (a POSIX folder name containing a literal backslash now folds in display names).
- All terminal-safety invariants from [[terminal-close-review]] held: exact-handle close targeting, fail-closed ownership on every path except the tested already-exited tolerance, no pgrep or pkill, loopback binding, no new dependencies or env vars.

See [[terminal-close-review]], [[desktop-packaging-review]], [[project-workspaces]], [[diagnostics]].

#relay #windows #terminal #spawning #review
