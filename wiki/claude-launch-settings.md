---
name: Claude Launch Settings
description: Complete task settings travel on the first disposable Claude launch command, with pid-bound proof that lets the executor skip its stop-and-relaunch.
type: architecture
tags:
  - relay
  - claude
  - terminal
  - queue
---

# Claude Launch Settings

> [!important]
> A disposable Claude terminal for direct Execute or Plan council now opens **already configured**.
> Direct work carries `--model` and `--effort`. Plan council also carries its plan permission,
> tool allowlist, and attachment directories. These are on the first launch command next to the
> session argument and hook `--settings` payload. `ClaudeTerminalExecutor`
> skips `relaunchForTask` when the launcher can prove the live process is the one it started with
> exactly those settings. Every uncertainty keeps the old stop-and-relaunch unchanged.

## The churn this removes

Claude Code applies model, effort, permission mode, tool allowlist, and extra readable directories
as **process launch options**. There is no supported way to change them inside a live session. So
`ClaudeTerminalExecutor` used to open a terminal, wait for the session to bind, verify the exact
window, tty, and pid, then **kill that just-launched Claude process** and relaunch the same session
in the same tab with the task's flags. See [[claude-terminal-settings-review]] for why that path
exists and what it guarantees.

That was correct and invisible when the user never opened the terminal. It became visible when
disposable pools started opening a fresh terminal per task: every task, and every **Continue
session** follow-up, showed the terminal open, close, and reopen before anything was typed. Desktop
task 88 reproduced it on every follow-up.

The cause was purely one of ordering. CC Relay already knew the model and effort before it built
the launch command; it just did not put them there.

## The launch-with-settings contract

`src/claude-launch-settings.mjs` is the single source of truth. Both sides derive from the same
stored task row through the same function, so "the settings match" is a fact and not an assumption:

- `claudeTerminalExecutionSettings(task)` is what the executor would relaunch with. It moved here
  out of `src/claude-terminal-executor.mjs` unchanged.
- `claudeCompleteLaunchSettings(task)` removes the runtime `apply` marker and returns the complete
  settings object accepted by a task-owned launch.
- `claudeFirstLaunchSettings(task)` is the subset a first launch may carry: **model and effort
  only**, for direct Execute compatibility.
- `claudeLaunchSettingsRecord(launchSettings, hookSettings)` is the structured fact stored against
  one exact native launch, including the hook payload in its serialized form.
- `claudeLaunchSettingsMatch(recorded, settings, hookSettings)` is a total comparison over model,
  effort, permission mode, tools, add-directories, and the hook payload.

`ProjectLauncher.launchNow()` accepts `claudeLaunchSettings` and threads it into
`claudeRelayCommand()`. All three session-argument shapes carry it:

```text
claude --dangerously-skip-permissions --session-id <fresh-uuid>   --model <model> --effort <effort> --settings <hooks>
claude --dangerously-skip-permissions --resume     <conversation> --model <model> --effort <effort> --settings <hooks>
claude --dangerously-skip-permissions --session-id <saved-uuid>   --model <model> --effort <effort> --settings <hooks>
claude --permission-mode plan --session-id <council-uuid> --model <model> --effort <effort> --tools <tools> --add-dir <attachments> --settings <hooks>
```

The hook `--settings` payload needed no change. `ClaudeHookBridge.settingsForSession()` already
mints a **stable per-session token**, and the launcher already called it, so the JSON on the launch
command is byte-identical to what `register()` hands the executor later. Registration therefore
stays where it is, immediately before the turn.

`claudeRelayCommand()` emits `--permission-mode <mode>` instead of
`--dangerously-skip-permissions` when complete Plan council settings are present. Tool lists and
add-directories travel on that same command. Tests reject the conflicting unrestricted flag from
the resulting Plan command.

## Skip conditions

`ClaudeTerminalExecutor.runTurn()` skips `relaunchForTask` only when **all** of these hold:

1. The terminal object carries a `launchSettings` record. It exists only when this CC Relay process
   built that launch command itself with explicit task settings. `trackOwnedTerminal()` defaults it
   to `null`, so recovery and runtime adoption never produce one.
2. The launch actually ran. A macOS shell that never became ready never received the provider
   command, so no record is stored.
3. A live provider process has been observed on that launch, and it is still the **first** one.
   `refreshTerminalRuntimeIdentity()` latches `launchSettingsProcessId` once and never rewrites it;
   `provenClaudeLaunchSettings()` returns the record only while `runtimeProcessId` still equals that
   latch. A user who restarts Claude by hand in an owned tab changes the pid, and the record stops
   proving anything.
4. Every field matches: model, effort, permission mode, tools, add-directories, and the hook
   payload.

Condition 3 arms on a task's **first** turn, not only after a relaunch.
`TerminalRuntimeResolver.resolve()` drops a Claude candidate that has no positive pid before it
resolves anything, so a resolved Claude terminal always carries `runtimeProcessId` on the first
pass, and `resolveClaudeTerminal` reads the proof immediately after the refresh that latches it.
Were that not true, the feature would pass every unit test and still be dead code: the first turn
would relaunch, and the post-relaunch pid would invalidate the record forever after. That ordering
is pinned by its own test.

Comparison happens at **read time** in `provenClaudeLaunchSettings()` rather than by clearing the
record on a pid change. Several paths refresh `runtimeProcessId` independently, and a clearing
scheme would have a hole in each of them; read-time comparison makes all of them fail safe without
knowing this feature exists.

On the skip path CC Relay emits `claude/progress` with `deliveryState: 'launch-settings-preapplied'`
in place of the former "Restarting the ... Claude terminal with ..." line. That message is the
production evidence that the churn is gone.

## Preserved fallbacks

- **Plan council shares one stage-task builder.** The pool derives its complete first-launch
  settings through `claudeCouncilLaunchTask`, and the runner uses the same builder for execution.
  Model, effort, permission mode, tools, and attachment directories therefore cannot drift.
- **Turbo keeps the relaunch.** Its Claude stage still synthesizes settings separately at run time.
- **Legacy interactive Launchpad launches are unchanged.** The user-facing "Launch Claude in
  project" buttons pass no launch settings, so their command is byte-identical to before and their
  terminals are never treated as pre-configured.
- **A retained terminal reused by a task with different settings relaunches**, and keeps
  relaunching on later turns, exactly as it does today: the record still describes the original
  launch and the pid latch still points at the original process. See
  [[retained-terminal-sessions]].
- **An older backend, an adopted terminal, or a missing record** all answer "not proven" and take
  the existing path.

## The resume picker still owns the screen

The picker classification and resolution were never inside `relaunchForTask` alone.
`ensureComposerScreen()` runs on **every** path before the injection offset is captured: it
classifies the exact owned viewport, answers a resume picker with the verified digit `2`
("Resume full session as-is"), approves the exact known folder trust prompt for the task-selected
workspace once, and fails closed on an unknown screen with a sanitized excerpt. Skipping the
relaunch changes nothing about that gate. Pre-discovery trust handling lives in the launch binding
coordinator because Claude does not register while that prompt is open. See
[[claude-folder-trust-startup]] and [[claude-resume-picker-guard]].

One deadline did move. `relaunchTimeoutMs` was widened from 20 s to 30 s specifically to cover
"answer the picker, then load a large full session". On the skip path that window no longer exists,
so `ensureComposerScreen()` is given `max(readinessTimeoutMs, relaunchTimeoutMs)` instead of the
15 s readiness budget. Without that, a 187k-token resume could fail a gate the relaunch path would
have absorbed.

## Windows

The flags are built by the same function on both platforms, so a Windows task-owned Claude launch
also carries them. On Windows the queued turn runs through the headless path, which passes its own
model, so this is cosmetic correctness for the visible terminal rather than a churn fix.

## Files and coverage

- `src/claude-launch-settings.mjs`
- `src/project-launcher.mjs`
- `src/disposable-terminal-pool.mjs`
- `src/claude-terminal-executor.mjs`
- `src/server.mjs`
- `test/project-launcher.test.mjs`
- `test/disposable-terminal-pool.test.mjs`
- `test/claude-terminal-executor.test.mjs`

See [[disposable-terminal-pools]], [[same-task-session-continuation]], [[claude-resume-picker-guard]],
[[claude-terminal-settings-review]], [[claude-terminal-visibility]], and [[retained-terminal-sessions]].

#relay #claude #terminal #queue
