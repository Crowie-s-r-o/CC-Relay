---
name: Claude Background Sub-agent Completion
description: August 3 incident where Claude print mode killed live sub-agents but CC Relay recorded success, plus the headless and interactive completion gates.
type: incident
tags:
  - relay
  - claude
  - sub-agent
  - completion
  - terminal
  - retry-safety
---

# Claude Background Sub-agent Completion

> [!important]
> Rebuild and restart CC Relay after active tasks finish. The source fix and verified desktop
> artifacts are ready, but the currently running process cannot load them. Do not start a second
> backend beside the current one. See [[dual-backend-ownership-guard]].

## Incident

On August 3, 2026, the headless Claude turn for the `agreau-8a` disposable session returned a
normal result and exit code 0 while four backgrounded developers were still working. Claude print
mode had reached its 600 second background wait ceiling, printed this warning, terminated the
agents, and then reported success:

```text
Background tasks still running after 600s; terminating.
Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.
```

CC Relay trusted the result and exit code, recorded `Task completed.`, released the disposable
pool slot, and closed the exact terminal. Partial edits had already reached the workspace.

The same run wrote a `system` record with subtype `turn_duration` and
`pendingBackgroundAgentCount: 4`. CC Relay already translated asynchronous `Agent` launches and
`<task-notification>` finishes for the console, but it did not use either signal when deciding
whether a turn was final.

## Decisions

1. A successful-looking headless exit is a non-retryable failure when stderr reports background
   termination or the latest authoritative pending count is positive. Replay is unsafe because
   Retry sends the original prompt into a workspace that may already contain partial work. The
   error directs the operator to Continue session with an audit-and-finish follow-up. See
   [[automatic-retry-safety]] and [[task-history]].
2. Interactive finality is held while any current signal remains pending: the latest transcript
   count, Stop-hook `background_tasks`, Stop-hook `session_crons`, or the per-turn launch and finish
   ledger. A transcript `end_turn` can no longer override the Stop hook.
3. Finishing background work invalidates every prior final reply. A task completes only after a
   fresh Stop or `end_turn` carries the parent agent's consolidated response. Notification plus
   idle is never enough.
4. `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` is set only on headless Claude child processes. Zero
   removes Claude print mode's background wait ceiling. Any user-supplied nonblank value is kept.
   The operator explicitly approved this specific Phase 2 change by replying `everything
   implement` after the variable and approval gate were named in chat.
5. Interactive waiting remains bounded by the existing continuous-inactivity ceiling. Cancel and
   shutdown retain the existing exact-process termination paths.

## Implementation

`src/claude-execution-runner.mjs` now:

- parses the real `turn_duration` shape, including tolerant nested fallbacks;
- tracks backgrounded launches until a matching tool-use or agent-id notification arrives;
- ignores duplicate and unknown notifications safely, and remembers out-of-order finishes;
- summarizes at most three agent labels for operator messages;
- fails an exit-zero headless run non-retryably when pending work was terminated;
- supplies the approved unlimited wait setting to headless children while preserving overrides.

`src/claude-terminal-executor.mjs` now keeps one turn-scoped background state across live hooks and
the transcript. It emits existing `claude/progress` events with
`background-work-pending` and `background-work-finished` delivery states, keeps the exact terminal
open, clears stale final candidates, and waits for a fresh consolidated response. Inactivity and
terminal-close errors name pending work rather than suggesting a blind retry. See
[[claude-terminal-live-output]], [[claude-terminal-visibility]], and
[[disposable-terminal-pools]].

No queue, database, API, schema, or frontend change was required. `retryable: false` already
selects the queue's needs-attention outcome, and runner settlement already controls pool release.

## Verification

- Full Node suite: 1,057 passed, 0 failed.
- Focused runner suite: 38 passed.
- Focused terminal executor suite: 174 passed.
- Focused queue suite: 48 passed.
- `public/app.js` and `public/event-stream.js` pass `node --check`.
- A real executable CLI shim replays both the incident stream and the clean notification stream
  through `ClaudeExecutionRunner` and `TaskQueue`. The incident stays Failed with no retry and a
  released pool slot; the clean path completes.
- The macOS arm64 desktop app, ZIP, DMG, and block maps were rebuilt. Deep code-sign verification,
  DMG verification, ZIP integrity, and exact `app.asar` source comparisons passed.
- DMG SHA-256: `f62fb82274692cb67ff5fecee3c7dede64afcddcf87fcddf63022821279796c2`.
- ZIP SHA-256: `957a28aa9d9da7ea794ca57bfe0ace68c2027f514c6359269ba2ef95dff41488`.

> [!note]
> The integration shim is intentionally extensionless. Node's default test discovery treats every
> `.mjs` file below `test/` as a test; an earlier fixture name caused the shim to wait for stdin
> when the full suite discovered it. The extensionless executable keeps discovery and production
> invocation behavior separate.

## Activation and live checks

Install the rebuilt DMG only after this task and every other active task finish, quit the old app,
and relaunch exactly one backend. Then perform the 660 second real Claude soak and the visible
interactive background-agent check from the reviewed plan. Those checks require the new backend
to be active and cannot safely be performed by the task whose process would need to restart.

See [[automatic-retry-safety]], [[disposable-terminal-pools]],
[[claude-terminal-live-output]], and [[task-history]].

#relay #claude #incident #sub-agent #completion #retry-safety
