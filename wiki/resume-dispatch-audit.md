---
name: Resume Dispatch Audit
description: July 30 2026 audit of every resume path outside the Claude terminal executor, with the native inventory defect that silently killed an exact-terminal council stage.
type: review
tags:
  - relay
  - resume
  - terminal
  - plan-council
  - codex
  - claude
---

# Resume Dispatch Audit

Task 39 in `/Users/patrikkelemen/WebstormProjects/Asora/src/Agreau` failed twice on July 30, 2026 and was reported as one continuous "resume is broken" symptom. The recorded diagnostics show two different failures with two different causes fourteen minutes apart, and only the second one is the known Claude submit defect.

## What actually happened

| Time (UTC) | Run | Outcome |
| --- | --- | --- |
| 13:22:19 to 13:22:27 | Fresh council launch | Claude bound `85369a08-266b-477d-8450-318d7956fc18` on window 92746, Codex bound `019fb330-c7c3-77d2-961b-4e8a779c0535` on window 92752. |
| 13:38:29.230 | Codex review stage | Completed. |
| 13:38:29.743 | `terminal.recovery.native_inspection_failed` | `TypeError: null is not an object (evaluating 'window.tabs().map')`. |
| 13:38:30.660 | Claude revision stage | Failed: `CC Relay could not resolve the exact owned terminal for agreau-f0`. Both exact launches were closed first. |
| 13:51:45 to 13:51:56 | Resumed council launch | `claude --resume 85369a08...` bound on window 93689, `codex resume 019fb330...` bound on window 93710. |
| 13:52:25.657 | Claude revision stage | Failed: pasted prompt never submitted. Both exact launches were closed first. |

The second failure belongs to the Claude terminal submit contract in [[claude-resumed-council-submit-review]] and [[claude-continuation-compaction-recovery-review]]. The first one was a separate, previously unrecorded defect.

## Confirmed defect: one unreadable Terminal window blinded every exact identity

`TerminalRuntimeResolver` inspected Terminal.app with a single JXA expression that called `window.tabs().map(...)` for every window. Terminal.app answers `null`, not an empty list, for a window whose tabs it cannot describe. One such window threw inside the script, `resolve()` caught the process failure, logged `terminal.recovery.native_inspection_failed`, and returned an empty list for **every** candidate session in that pass.

Everything that proves exact native identity then failed at once:

- `resolveClaudeTerminal()` in `src/server.mjs:141-159` returned null.
- `ClaudeExecutionRunner.resolveTerminalTarget()` in `src/claude-execution-runner.mjs:666-681` returned null.
- `require_terminal === true` is set for every Plan council Claude stage in `src/plan-council-runner.mjs:264-284`, so `src/claude-execution-runner.mjs:606-610` raised a **non-retryable** stage failure.
- `PlanCouncilRunner` persisted the failed checkpoint, and the queue released both exact council launches.

The JavaScript side was already tolerant: `singleTabTerminalForTty()` treats a non-array `tabs` value as empty at `src/terminal-runtime-resolver.mjs:98`. Only the JXA string was intolerant, and it aborted before that guard could ever see the data.

> [!important]
> A native inspection helper must degrade per window. One undescribable Terminal window is normal; losing every session identity because of it turns a transient operating-system state into a permanent, non-retryable council failure with two terminals destroyed.

The inventory now reads each window and each tab defensively. An unreadable window contributes no tabs. An unreadable tab still occupies its position, so `singleTabTerminalForTty()` keeps seeing the true tab count and still refuses to treat a multi-tab window as a closable single tab.

The exact shipped script was executed read-only through `osascript -l JavaScript -e` on Darwin 25.5.0 and returned valid JSON for the live window list, which proves the syntax and the normal path under real JXA. The live window list held no undescribable window at that moment, so the null and throwing branches are proven only against a fake `Application` in the unit suite. Both shapes are covered, `if (!tabs)` for a null answer and `try` for a raised error, but neither branch has yet run under real JXA.

The failure message at `src/claude-execution-runner.mjs:608` still tells the user to select a Claude terminal as the council terminal. That advice belongs to the legacy persistent council; an automatic council has no selector. It is a wording gap, not a behavior gap, and it contributed to the misdiagnosis.

## Confirmed defect: a missing conversation ID could close another task's terminal

`DisposableTerminalPool.release()` fell back to `closeOwnedTerminal(allocation.threadId)` whenever an allocation had no `launchId`. Owned launches hold `threadId = null` until they bind, and `closeOwnedTerminalNow()` looked its target up with `find((item) => item.threadId === threadId)`. A null conversation ID therefore matched the first **unbound** owned launch, which is exactly the state of another task's terminal during its binding window. That call could destroy an unrelated terminal and then report it as this task's closed instance.

The lookup is now `ProjectLauncher.ownedTerminalForThread()`, which rejects a missing or empty conversation ID for every caller: close, `terminalForThread()`, `verifyTerminalForThread()`, `refreshTerminalRuntimeIdentity()`, and terminal attention. The pool skips an allocation that holds neither a launch handle nor a conversation, records `terminal.pool.cleanup_skipped`, and does not count it as closed.

## Verified invariants

Each of these was checked against the current source and left unchanged.

| Invariant | Evidence |
| --- | --- |
| A resumed Codex CLI is identified by its exact launch reservation | `src/terminal-launch-coordinator.mjs:60-70` matches `item.launchId === launched.launchId` or the thread reported by `threadIdForLaunch()`; `src/websocket-proxy.mjs:285-289` resolves that from the exact client, not from deduplicated discovery. |
| Recovery cannot rebind a terminal while an owned launch is binding | `src/project-launcher.mjs:371-376` filters candidates through `pendingLaunchMatches()` at `src/project-launcher.mjs:431-444`. |
| A closed terminal's conversation cannot be resurrected from a draining connection | `src/project-launcher.mjs:1084-1089` sets `recoveryRetryAt` for the bound or expected conversation before completion. |
| A binding rejection returns the exact launch and closes it once | `src/disposable-terminal-pool.mjs:303-325` remembers the launch before throwing, `prepare()` releases on failure at `src/disposable-terminal-pool.mjs:434-437`, and `release()` deletes the allocation so the queue's `finally` release is a no-op. |
| Identity rejection and resumed-conversation timeout are non-retryable | `src/disposable-terminal-pool.mjs:323`. A fresh launch with no resume ID keeps bounded retry. |
| A bound Codex terminal always receives its turn | `src/codex-app-server.mjs:889-958` runs `thread/resume` then `turn/start` with no early return between binding and dispatch. The two live diagnostics files record 16 of 16 and 7 of 7 `task.codex.run.requested` events followed by `task.codex.turn.started`. |
| Council stage 3 resumes the exact saved conversation with the right settings | `src/disposable-terminal-pool.mjs:354-370` relaunches `author_thread_id` for Claude and `thread_id` for Codex; `src/plan-council-runner.mjs:264-284` passes the session, `plan` permission mode, the read-only tool list, model, effort, and the task attachments. |
| A failed stage persists its checkpoint and closes both terminals | `src/plan-council-runner.mjs:598-612` persists then rethrows; `src/queue.mjs:1241-1251` releases the pool in `finally`. Confirmed live for both failures above. |
| Continue session validates capacity synchronously and keeps one owner per conversation | `src/queue.mjs:119-203` performs every check before any state change, including `reservedThreadIds()` and `DisposableTerminalPool.canRun()`. |
| Council capacity is atomic and cannot strand a partial fleet | `src/disposable-terminal-pool.mjs:219-228` requires both providers, and any partial launch failure releases every created launch. |

## Open risks

- `CodexAppServer.waitForIdleThread()` at `src/codex-app-server.mjs:748-773` waits without a deadline. A resumed Codex thread that never leaves `active` would hold a running task with its terminal open and no turn sent. Neither live diagnostics file contains a single `task.codex.waiting_for_idle` event, so this has never fired and was left alone rather than given a bound that could invent new failures.
- For a task that is not a Plan council, a failed exact-terminal resolution silently routes the turn to the headless Claude path at `src/claude-execution-runner.mjs:666-681`. That is intentional availability behavior, but the same inventory defect made it invisible.
- Two CC Relay backends were running at once on July 30, a packaged desktop instance and a standalone `node src/server.mjs`. The desktop dispatched its council Claude terminal at 13:22:19.889 and bound it at 13:22:23.808; the standalone instance runtime-recovered that same window at 13:22:24.566, after binding had already completed. The intra-process pending-launch exclusion was therefore never involved either way. What failed is visibility: launch ownership, `pendingLaunchMatches()`, and post-close recovery suppression are all in-memory and per-process, so a second backend can claim the first backend's terminals whether or not they are still binding.

> [!note]
> Resolved on August 3, 2026. Launch ownership is now published to the shared configuration database and every adoption, rebinding, and cleanup consults it first. See [[dual-backend-ownership-guard]].

## The reported "closed but still open" terminals

The queue event `2 disposable terminal instances closed` is emitted only after both `closeOwnedLaunch()` calls resolve. The evidence says those closes were real:

- No `terminal.close.failed` event exists in either diagnostics file.
- The vacuous `pgrep -t` and `pkill -t` mechanism from the [[terminal-close-review]] Darwin 25 section is absent from `src/`; only comments and the guarding test assertions mention it.
- Windows 92746, 92752, 93689, and 93710 no longer exist in Terminal.app.
- The 13:54:22 launch chose grid slot 0 with bounds `{0, 30, 1706, 473}`, the exact cell window 93689 had occupied. `firstAvailableGridSlot()` returns a cell only when no live Terminal window overlaps it, and neither diagnostics file contains a single `terminal.layout.inspect_failed` event, so the bounds inspection ran and saw that cell free.

The screenshot description, Claude holding unsent text beside an idle Codex composer, matches the 13:51 pair between the stage failure and the 13:52:25 release rather than the 13:38 pair whose queue event was being read. Logs cannot prove the instant a window disappeared, so that remains an inference rather than a measurement.

## Coverage

- `test/terminal-runtime-resolver.test.mjs`: executes the shipped JXA source against a fake Terminal application containing a null-tabs window and a throwing window, proves an unreadable tab keeps its position so a multi-tab window stays unclosable, and proves one unreadable window no longer hides every other exact session.
- `test/project-launcher.test.mjs`: proves a missing or empty conversation ID never targets a launch that is still binding and never reaches the native close script, and proves one window that refuses its bounds or a Terminal that refuses to report `running` never erases the whole grid placement pass.
- `test/disposable-terminal-pool.test.mjs`: proves a launch with no exact native target is skipped, diagnosed, and never counted as a closed terminal instance.

All 846 repository tests pass, including the concurrent Claude submit work that landed during this audit. An intermediate run showed six failures confined to `test/claude-terminal-executor.test.mjs` while that separate fix was mid-edit; the remaining 748 tests passed throughout.

## July 30 2026 review hardening addendum

Code review returned no confirmed issue and two consistency items in the same files. Both are applied.

`ProjectLauncher.listTerminalWindowBounds()` still enumerated grid placement rectangles with the one-expression pattern `terminal.windows().map((window) => window.bounds())`. The window that refuses its tabs can refuse its bounds the same way, and one of them would abort the whole pass. The blast radius was smaller than the identity defect, because the caller already catches the failure and records `terminal.layout.inspect_failed`, so the worst outcome was a degraded slot choice and never a wrong close target. A degraded pass still stacks a new terminal on an occupied cell, so the script now lives in `DARWIN_TERMINAL_BOUNDS_INVENTORY` and reads each window on its own. An unreadable window contributes `null`, which `normalizeMacTerminalWindowBounds()` already drops, so every readable rectangle survives. The shipped string was executed read-only through `osascript -l JavaScript -e` on Darwin 25.5.0 and returned the same `{x, y, width, height}` shape as before.

`terminalInventory()` also left its opening `terminal.running()` call outside the guard. That call needs no Apple Events grant, so the exposure is theoretical, but a throw there would have reproduced the exact pre-fix symptom of one failed pass losing every session. It is now inside the same `try`.

Neither change alters what CC Relay closes, binds, or dispatches.

See [[codex-disposable-resume-review]], [[terminal-close-review]], [[disposable-terminal-pools]], [[plan-council]], [[same-task-session-continuation]], and [[automatic-retry-safety]].

#relay #resume #terminal #plan-council #review
