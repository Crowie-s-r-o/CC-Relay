---
name: Claude Stale Background Stop Hook
description: Task 129 incident where a completed Claude session stayed open because an old Stop-hook background task snapshot survived later prompt boundaries, reproduced by tasks 218 and 223 and fixed by the boundary-advance rule.
type: incident
tags:
  - relay
  - claude
  - terminal
  - completion
  - background-agents
  - diagnosis
---

# Claude Stale Background Stop Hook

> [!important]
> Fixed in `src/claude-terminal-executor.mjs`. A Stop hook from a later prompt boundary of the same
> session now replaces the frozen background snapshot, while a delayed Stop from an older prompt
> stays rejected. Rebuild and restart the packaged desktop app after active tasks finish: a running
> CC Relay process still holds the wedged code. See [[dual-backend-ownership-guard]].

## Incident

Relay task 129 used Claude session `2ea3c7ca-9a9b-488d-b00f-16e86ac1f11a` in
`talent-finder-ef` with Claude Code 2.1.222. It was an automatic disposable task with
`keep_terminal_open = 0` and `manual_completion = 0`, so [[live-terminal-retention]] did not cause
the open terminal.

| UTC time | Evidence | Meaning |
| --- | --- | --- |
| 22:33:05 | Transcript `turn_duration` omitted `pendingBackgroundAgentCount` | Claude's authoritative pending count had reached zero |
| 22:33:08 | Relay emitted `3 background tasks still running` | The remaining blocker came from the Stop-hook snapshot, not the transcript count or sub-agent ledger |
| 23:42:00 | Final named agent notification arrived | The last visible agent finished |
| 23:42:33 | Final assistant `end_turn` said all requested work was done | Claude produced a real final response |
| 23:42:33 | Final `turn_duration` again omitted `pendingBackgroundAgentCount` | Claude still reported no pending background agents |
| 00:08:41 | The terminal session disappeared | Relay failed the task because its stale three-task snapshot was still pending |

The task row then recorded:

`The Claude terminal for talent-finder-ef closed before the turn produced a final response. 3 background tasks had not finished when the terminal closed.`

That wording describes Relay's internal completion state, not Claude's actual final transcript.

## Root cause

The packaged `src/claude-terminal-executor.mjs` keeps three independent background signals:

- transcript `pendingBackgroundAgentCount`
- the parsed background sub-agent launch and finish ledger
- Stop-hook `background_tasks` and `session_crons`

Any positive signal blocks completion, as required by [[claude-background-sub-agent-completion]].
The Stop-hook arrays are replaced only when a Stop hook passes the current prompt-ID filter.

Task 129 crossed several prompt boundaries. Some updates were queued Relay steers, whose queue
records carry no prompt ID, and later updates were entered directly in the Claude terminal. Relay's
`hookPromptId` therefore remained attached to an older recognized prompt. The packaged executor
rejects a later hook when both IDs exist and differ:

```js
if (
  promptSubmitted
  && hookPromptId
  && payloadPromptId
  && payloadPromptId !== hookPromptId
) return;
```

That guard correctly rejects a delayed final reply from an older prompt, but it also rejects the
newer Stop hook before the code replaces `hookBackgroundTasks`. The old three-task array can then
survive indefinitely. The transcript count reached zero and every observed sub-agent launch had a
matching finish, but neither channel clears the separate Stop-hook array.

> [!note]
> The final Stop hook did run. Claude's transcript contains a successful Stop-hook summary with no
> hook errors. Relay mirrored the final answer only when it later drained the transcript, which is
> consistent with the HTTP Stop payload being accepted by the bridge and then discarded by the
> prompt-ID guard.

## Falsified explanations

- Intentional retention was off. The task row has `keep_terminal_open = 0`, and the screenshot's
  control still read **Stop auto-close**, not **Auto-close stopped**.
- Claude had produced final text. The final assistant record has `stop_reason: end_turn`.
- Claude's authoritative pending count was not three. Its last two zero-pending turns omit the
  optional `pendingBackgroundAgentCount` field.
- The parsed agent ledger was not holding three unmatched agents. Every backgrounded Agent launch
  recorded by Relay had a matching finish by tool-use ID or agent ID.

## Reproductions on August 11 and 12, 2026 UTC

Tasks 218 and 223 hit the same wedge without any steer or manually typed prompt, which identified
the general trigger: a background sub-agent reporting back re-invokes the parent with a prompt ID
CC Relay never submitted. Task 223 ran Claude session
`8e54cf9b-6f2a-4531-ab01-05a8e00c9147` in `talent-finder-57`.

| UTC time | Evidence | Meaning |
| --- | --- | --- |
| 22:16:34 to 22:16:52 | Parent launched `dev-1`, `dev-2`, and `code-reviewer` in the background | Three async agents in flight |
| 22:17:17 | The parent's first turn ended while `dev-1` was still running | That boundary's Stop matched `hookPromptId` and snapshotted one background task |
| 22:37 to 22:57:43 | Every launched agent produced a matching finish notification | Each notification re-invoked the parent under a new prompt ID, and each of those turns' Stop hooks was discarded |
| 22:59:04.101 | Final assistant record, `stop_reason: end_turn` | Claude answered |
| 22:59:04.102 | `stop_hook_summary` and `turn_duration`, `pendingBackgroundAgentCount` omitted | Authoritative pending count zero |
| 22:59:06 | Relay emitted `1 background task still running` | Only the frozen hook array still held work; the ledger was empty and the transcript count was zero |
| 23:02:06 | Terminal closed | Task failed with `1 background task had not finished when the terminal closed` |

The timestamps at the final boundary also settled the ordering the fix depends on: Claude writes
the final assistant record before it runs the Stop hook.

## Fix

`consumeHook` now keeps a per-turn `acceptedTurnEnded` latch and the prompt-ID guard reads it.

- **Boundary advance.** A Claude session runs one turn at a time, and sub-agent hooks were already
  excluded by `payload.agent_id`. Once the accepted prompt's own turn has been observed to end, no
  older turn of that session can still be running, so a mismatched `Stop` can only come from a
  newer boundary. The guard adopts `payload.prompt_id` as the current `hookPromptId` and lets the
  normal Stop handler replace `background_tasks` and `session_crons`, reconcile background work,
  mirror `last_assistant_message`, and record the final signal.
- **Latch definition.** `recordFinalSignal` sets the latch as its first statement, above the
  pending branch. Both callers are genuine boundaries of the accepted prompt, and the wedge is
  precisely the case where that boundary was reached while background work was still running.
- **Drain first.** The guard drains the transcript before deciding. Claude writes the final
  assistant record before running the Stop hook, so when the Stop beats the file watcher, the drain
  is what proves the turn ended. Without it, the two orderings of the same boundary would behave
  differently.
- **Same-boundary count clear.** The Stop HTTP exchange can finish before the same turn's closing
  `turn_duration` record is written. The numeric pending count moves only in that closing record,
  so clearing it confirms the final response already held for the same boundary. Relay re-arms that
  response only when no independent channel remains pending. New work, a real agent finish, or a
  cleared hook snapshot still invalidates the earlier response and requires fresh consolidation.
- **Single message emission.** Completion reconciliation may clear `lastText`, but it no longer
  clears the separate record of the latest console message. A Stop whose assistant record was just
  drained therefore completes the boundary without mirroring the same final response twice.
- **Pending-work fence.** A mismatched Stop is adopted only while tracked background or hook work
  is actually pending. That is the entire wedge class. A mismatched Stop arriving after a clean
  turn end has nothing to repair and is left rejected.
- **Preserved old-Stop rejection.** While the accepted turn is still in flight the latch is false
  and every mismatched hook is dropped exactly as before, which is the task 129 protection. Every
  mismatched non-Stop event is still dropped unconditionally.
- **Steer interaction.** An acknowledged live update moves the boundary onto a turn that has not
  ended, so `acknowledgeSteerPrompt` clears the latch unconditionally and `anchorSteerAtBoundary`
  clears it in the branch that discards an earlier final. The branch that preserves a final proved
  the current prompt already completed, so there the latch survives.
- **Ordering.** `hookRegistration.activate` now runs after the `drain` definition, because the
  guard calls `drain` and a bridge that delivers a buffered payload synchronously from `activate`
  would otherwise reach it inside the temporal dead zone.

> [!note]
> One deliberate consequence: after the boundary advances, later non-Stop hooks carrying the new
> prompt ID also pass the guard, so tool calls and messages from notification-triggered turns begin
> mirroring into the task console. That is correct, since those turns are the continuation of the
> work CC Relay is watching, and it makes the console match what the terminal shows.

## Residual accepted risk

A Stop hook from an older prompt that is delayed across the entire accepted turn **and** arrives
while background work is still pending would be adopted as a newer boundary. If its empty arrays
clear the last pending signal, its stale `last_assistant_message` could become the task result.
Hook payloads are posted over the loopback bridge, and adoption is additionally fenced by both
`acceptedTurnEnded` and live pending work, so a delay of that length is transport-implausible. The
cost of rejecting every mismatched boundary is the proven wedge: an indefinitely open terminal
and a failed task after Claude has already answered.

## Regression coverage

`test/claude-terminal-executor.test.mjs`:

- `a Stop hook from a later prompt boundary clears the frozen background snapshot` reproduces tasks
  218 and 223: matched Stop with one background task, transcript `end_turn`, then a Stop from a new
  prompt ID with empty arrays and the consolidated reply. Against the unpatched executor it fails
  with the production symptom, `1 background task never reported finishing`.
- `each later Stop boundary replaces the snapshot, and only an empty one completes the turn` proves
  a mid-work notification boundary replaces the snapshot without releasing the task.
- `a delayed Stop from an older prompt cannot end a turn that is still in flight` keeps the task
  129 protection with real tracked background work present, so the latch is the only rejector.
- `an accepted live update makes a mismatched Stop hook rejectable again` proves the steer reset:
  removing it lets the stale response through.
- `a Stop hook that outruns the transcript still finds its own turn ended` covers the other
  ordering. A steer leaves the snapshot frozen while the latch is clear, then one boundary arrives
  as an unread `end_turn` plus a Stop under a new prompt ID. Removing the drain from the guard
  fails it with the production symptom.
- `a later Stop survives the stale pending count until its closing duration clears it` reproduces
  task 223's exact HTTP/file order: a prior `turn_duration` reports one pending agent, the final
  assistant record and later Stop arrive with empty hook arrays, and a count-omitting duration lands
  only after the Stop. The test also proves the final message is mirrored exactly once.
- `a pending count cleared after the final assistant record still releases the turn` covers the same
  clear on the transcript channel, which is the only channel a terminal with no registered hooks
  has: no Stop hook at any point, a prior count of one, the consolidated `end_turn`, then the
  count-omitting duration.
- `a Stop rejected by the pending fence still leaves the drained transcript final armed` covers the
  ordering where the closing duration is already on disk when a mismatched Stop arrives. The guard's
  own drain clears the count, so the pending fence correctly rejects that Stop, and the confirmed
  transcript final is what completes the turn without a second mirror of the same text.
- The existing Stop-hook, session-cron, and steer tests are unchanged and still pass.

Restricting the confirming clear to a Stop adopted through the boundary advance keeps
`a later Stop survives the stale pending count until its closing duration clears it` green and fails
both tests above, which is what makes the channel-independent rule load bearing rather than a
restatement of the boundary advance.

Every rule above was mutated individually and the suite was rerun. Reversing the guard,
moving the latch below the pending branch of `recordFinalSignal`, removing the drain, and removing
the steer reset each fail at least one of these tests. The reset inside `anchorSteerAtBoundary` is
the one rule no test discriminates: it is reachable only when a Stop matching an unanchored steer
arrives while background work is pending, and it is kept because the anchor record proves the
steered turn is only starting.

## Follow-up contract

The original contract, kept for reference. A fix must preserve the old-prompt Stop rejection while
ensuring a newer authoritative prompt boundary can clear stale Stop-hook work. Regression coverage
should include:

- a matched Stop hook that reports background tasks;
- a queued Relay steer with no prompt ID;
- one or more direct terminal prompts with new prompt IDs;
- a final Stop and transcript `end_turn` with zero pending work;
- completion and automatic terminal close only after the fresh final response;
- a genuinely delayed old Stop hook that remains unable to finalize the newer prompt.

See [[claude-steer-delivery-evidence]], [[claude-live-steering-review]], and
[[claude-background-sub-agent-completion]].

#relay #claude #terminal #completion #background-agents #incident
