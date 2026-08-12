---
name: Provider Plan and Goal Visibility
description: Codex plan and goal notifications, the folded Claude task board, and the plan and goal rows in Task Activity.
type: architecture
tags:
  - relay
  - terminal
  - plan
  - goal
  - codex
  - claude
---

# Provider Plan and Goal Visibility

> [!important]
> Task Activity renders one **Plan** checklist row per provider board and one **Goal** row per Codex thread that carries a goal, mirroring the Codex TUI "Updated Plan" block. Both providers publish the complete plan on every revision, so the newest event for a fold key is the whole truth unless it says otherwise. A finished, failed, or cancelled task may never render a live step or a live goal.

## Codex plan and goal notifications

The app-server emits `turn/plan/updated` carrying the **full** plan every revision, never a delta. Steps arrive as `{ step, status }` with status `pending`, `inProgress`, or `completed`, alongside a nullable `explanation`. No feature flag is required: `codex features list` reports `goals` as `stable` and enabled on Codex CLI 0.147.0.

> [!important]
> Plan and goal notifications must be routed by `threadId` **above** the existing turnId guard in `handleNotification`. A live probe proved that a thread carrying a goal emits plan and goal notifications with a turn id from a different id space than the one `turn/start` returns, so the guard would silently drop exactly the threads that have a goal. Each branch returns, so the generic store path cannot record a second unnormalized copy of the same notification.

CC Relay never calls `thread/goal/set`. It only observes a goal that a connected or shared Codex thread already carries. Setting one is a product decision, not an implementation detail, and it shifts the turn-id space described above.

> [!note]
> Goal timestamps are dual-shape: either an epoch number or an ISO 8601 string. They are preserved exactly as received and never unit-converted. The schema declares int64 with no unit, so converting would mean guessing seconds against milliseconds, and reading a seconds value as milliseconds writes a 1970 date into stored history.

A turn that observed a goal records one turn-final `thread/goal/updated` with a **top-level** `turnEnded: true` when the turn completes, so a finished task's goal stops reading live. `finishActiveTurn` is the only caller of `recordTurnFinalGoal`, and it deletes the `activeTurns` entry immediately after replaying, so the second finish of one turn (the `turn/completed` notification and the one-second poll both call it) finds no record left. Once-per-turn therefore rests on that delete plus one fresh record per `run`, and it assumes no `onEvent` consumer synchronously re-enters `finishActiveTurn` from inside the replay itself. No flag on the record encodes any of that, so this page is where the invariant lives.

A goal update naming neither an objective nor a status never becomes the turn's last goal. It is still logged verbatim, because Codex output is reported as it arrived, but replaying a blank record at turn end would erase a real objective and its usage behind a bare "Recorded" label, and that replayed record is the one nothing can revise afterwards.

> [!note]
> The Codex `planKey` is `threadId:turnId`, so two turns on one thread keep two plan rows. Two turns that both omit a turn id share one thread-scoped row. That is known and pinned by test, not fixed.

## Claude board folding

Claude Code 2.1.228 has no `TodoWrite`. Its board is `TaskCreate`, `TaskUpdate`, `TaskList`, and `TaskGet`, mirrored to `~/.claude/tasks/<sessionId>/<n>.json`. `TodoWrite` support is kept for older builds, and a `TodoWrite` full publish wins over the mirror for the rest of the turn: those builds write no task files at all, and a directory left over from a newer build describes a different board entirely.

> [!important]
> Folding happens at the `tool_result`, not at the `tool_use`. A real `TaskUpdate` can answer `{"success": false, "error": "Task not found"}` as an ordinary result with **no** `is_error` flag, so an optimistic fold would report steps the board never moved. `TaskCreate` also only learns its id at the result. The headless stream-json path carries no result object, which is why the text guard exists beside the structural one. See [[non-interactive-relay-prompts]].

The mirrored directory is authoritative for what the board **contains**. The per-turn fold stays authoritative for this turn's own mutations. The directory is an overlay, never a replacement: overwriting the fold made a later unreadable directory emit nothing at all and freeze the row, because the ids this turn created are the only thing left to publish once the mirror stops being readable.

> [!note]
> The mirror is read per call, not remembered. A sticky overlay resurrects deleted tasks, because a delete-all leaves `readPlanDirectoryBoard` returning `null` rather than an empty board.

`.highwatermark` is not a count. It counts ids ever issued, not steps that still exist. Session `989d7801` had an empty board directory with `.highwatermark` reading 4, because the board was cleared after the session ended. A cleared directory must degrade to the transcript fold rather than reporting that the operator's plan is now empty.

A knowingly partial board carries an optional `partial: true`, present only when true so every existing consumer of `explanation` and `plan` keeps working unchanged. The renderer layers it onto the last whole revision instead of replacing the row, and shows a visible "partial board" hint. A later whole revision replaces the board outright, including shrinking it.

> [!note]
> The Claude `planKey` is the session id (falling back to `task-<taskId>`) and is frozen onto the execution context. A session id is constant across the turns of a conversation, so one Claude board keeps one row for the whole conversation, unlike the per-turn Codex key above. `eventStreamStats` therefore ranks plan events by event id rather than by row order, because a session-scoped Claude row stays put while later Codex turns append rows after it.

## Renderer rules

> [!important]
> A finished, failed, or cancelled task may never render a live plan step or a live goal. The `turnEnded` signal rides on the goal record and is cleared by the next goal record that does not carry it, so a same-session follow-up turn reads as live again. `task.status !== 'running'` is the fallback, and it also covers stored history written before the backend change.

Provider-keyed label and glyph maps must use a guarded own-property lookup. A raw bracket index rendered `[object Object]` for a goal status of `__proto__` and a function body for `constructor`, in the pill, in the step marker, and in the copied log.

The row bounds what it **draws**, never what it **reports**. Caps are 50 steps drawn with an honest overflow line naming the remainder, 220 characters per step, 600 for explanation and hover title, 300 for the objective, and 48 for the owner. The counts stay true, because they describe the unclamped details, and the copied log stays the lossless channel.

> [!note]
> Plan and goal entries file under the `system` category ahead of the event-kind fallthrough, which would otherwise file a `kind: 'claude'` plan under Messages. They are pinned into Highlights, they never set `startedEvent`, and `isSubAgentEntry` is false for them, so a live plan can never inflate the active-work metric or the sub-agent count.

## Implementation map

- `src/codex-app-server.mjs` normalizes and stores `turn/plan/updated`, `thread/goal/updated`, and `thread/goal/cleared` above the turn guard, and replays the turn-final goal.
- `src/claude-execution-runner.mjs` marks board tool calls, folds them at the result, reads the mirrored task directory, and emits `claude/plan`.
- `public/event-stream.js` folds plan and goal events, layers partial revisions, and keeps both out of the sub-agent and activity tallies.
- `public/app.js` renders the provider-neutral checklist, the goal row, the quiet plan-board tool row, and the lossless copied log.
- `public/style.css` carries the plan and goal presentation in both themes.
- `test/codex-app-server.test.mjs` pins the routing, the normalization, the timestamp shapes, and the turn-final replay.
- `test/claude-plan-events.test.mjs` pins the fold, the mirror, the partial rule, and the failure cases.
- `test/plan-visibility.test.mjs` and `test/event-stream.test.mjs` pin the renderer contract, the layering, the caps, and the prototype-key guards.

## Verification

The complete repository suite passes 1,395 tests with zero failures. That figure is tree-wide and includes concurrent unrelated work in the same tree. The four suites covering this contract pass 199 tests between them: 39 in `test/claude-plan-events.test.mjs`, 61 in `test/plan-visibility.test.mjs`, 41 in `test/codex-app-server.test.mjs`, and 58 in `test/event-stream.test.mjs`. `npm run release:check` reports release metadata consistent for v0.2.1, and `git diff --check` is clean. No dependency was added: the only new imports are Node builtins (`node:path`, `node:os`, `node:fs`).

> [!warning]
> CC Relay must be restarted and the desktop bundle rebuilt before these backend and renderer changes take effect. The packaged app runs `src/` from `app.asar`, frozen at build time, so an installed bundle keeps executing the code it was packaged with no matter what the working tree says. See [[desktop-packaging-review]] and [[packaged-renderer-startup]].

See also [[provider-sub-agent-visibility]], [[terminal-markdown]], [[claude-terminal-live-output]], and [[non-interactive-relay-prompts]].

#relay #terminal #plan #goal #codex #claude
