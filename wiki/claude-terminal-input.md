---
name: Claude Terminal Input
description: Human-in-the-loop question handling for terminal-driven Claude Execute tasks.
type: behavior
---

# Claude Terminal Input

> [!important]
> An idle status from an interactive Claude session is not a terminal outcome. Claude reports idle while an `AskUserQuestion` selector is waiting in the native terminal, and the transcript may not expose that tool-use record until after the user answers.

## Task 270 diagnosis

Task 270 reproduced the failure on July 26, 2026:

1. Relay started the Claude turn at `15:45:11Z`.
2. Claude displayed a **Review scope** selector in Terminal.app.
3. The assistant record carried timestamp `15:47:17Z`, but Relay's transcript tail had not received an `AskUserQuestion` event while the selector was open.
4. `claude agents --json` reported the interactive session as idle.
5. The former watcher treated four idle observations without a final transcript record as interruption and marked the task failed at `15:47:21Z`.
6. The user answered at `15:48:38Z`. The transcript then contained the question tool use and its matching tool result, and Claude continued in the terminal after Relay had already stopped watching.

The command failure immediately before the question was not the task failure. The incorrect idle heuristic was the root cause.

## Runtime contract

`ClaudeTerminalExecutor.watchTurn()` now treats sustained idle after a started turn as a possible human-input pause:

- It emits one `claude/input-required` event and keeps the task in `running`.
- The event tells the user to answer in the exact native Claude terminal.
- The task and session stay reserved, so no other work can claim that conversation.
- When discovery returns to busy, Relay emits `claude/input-resumed` and continues transcript mirroring.
- When Claude flushes the delayed question and answer records, the existing stream consumer pairs the `AskUserQuestion` tool start and completion.
- A final assistant record still completes normally.
- Cancellation, exact terminal closure, transcript shrinkage, and the 45-minute inactivity ceiling still stop the watcher.
- Relay never injects, retries, or guesses an answer.

> [!note]
> The 45-minute ceiling measures continuous inactivity, not total turn duration. Waiting for a terminal answer is inactivity: the session reports idle, no transcript records arrive, and the transcript does not grow. An abandoned interactive prompt therefore still releases its task and session after 45 idle minutes, exactly as before. A session that keeps working never fails on elapsed time alone. The user can also cancel the running task explicitly. See [[claude-terminal-visibility]] for the full ceiling contract.

## Presentation

Task Activity renders the pause as **Claude needs input**, and its terminal status segment changes from **Live** to **Input needed**. The event remains in Highlights. The global running-task feed also treats input-required and input-resumed events as current Claude updates.

No new database task status was added. Keeping the persisted task status as `running` preserves queue ownership, cancellation, scheduling, history, and restart behavior without creating a parallel state machine.

## Files

- `src/claude-terminal-executor.mjs`
- `src/running-task-feed.mjs`
- `public/app.js`
- `public/style.css`
- `test/claude-terminal-executor.test.mjs`
- `test/event-stream.test.mjs`
- `test/running-task-feed.test.mjs`
- `test/composer-workflows.test.mjs`

Regression coverage recreates the late transcript flush: the session remains idle past the former failure threshold, then the question and answer records arrive together, Claude becomes busy, and the task completes. It also proves that an unanswered pause still reaches the safety ceiling, now after a full inactivity window rather than after a fixed slice of total turn time.

See [[claude-terminal-visibility]], [[task-history]], [[project-workspaces]], and [[interface-layout]].

#relay #claude #terminal #input #human-in-the-loop
