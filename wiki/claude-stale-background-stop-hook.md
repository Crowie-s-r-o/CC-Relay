---
name: Claude Stale Background Stop Hook
description: Task 129 incident where a completed Claude session stayed open because an old Stop-hook background task snapshot survived later prompt boundaries.
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
> Task 129 did finish in Claude Code, but CC Relay did not accept the final Stop hook that would
> have cleared an older three-task background snapshot. The automatic completion gate therefore
> stayed closed and intentionally left the terminal open. This incident is diagnosed but not fixed.

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

## Follow-up contract

A future fix must preserve the old-prompt Stop rejection while ensuring a newer authoritative
prompt boundary can clear stale Stop-hook work. Regression coverage should include:

- a matched Stop hook that reports background tasks;
- a queued Relay steer with no prompt ID;
- one or more direct terminal prompts with new prompt IDs;
- a final Stop and transcript `end_turn` with zero pending work;
- completion and automatic terminal close only after the fresh final response;
- a genuinely delayed old Stop hook that remains unable to finalize the newer prompt.

See [[claude-steer-delivery-evidence]], [[claude-live-steering-review]], and
[[claude-background-sub-agent-completion]].

#relay #claude #terminal #completion #background-agents #incident
