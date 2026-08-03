---
name: Claude Terminal Input
description: Human-in-the-loop question handling for terminal-driven Claude Execute tasks.
type: behavior
---

# Claude Terminal Input

> [!important]
> An idle status from an interactive Claude session is not a terminal outcome or proof of a question. Claude can report idle while an `AskUserQuestion` selector is waiting, during compaction, or while a pasted continuation is still held. CC Relay therefore requires a current structured question event before it displays **Input needed**.

## Task 270 diagnosis

Task 270 reproduced the failure on July 26, 2026:

1. CC Relay started the Claude turn at `15:45:11Z`.
2. Claude displayed a **Review scope** selector in Terminal.app.
3. The assistant record carried timestamp `15:47:17Z`, but CC Relay's transcript tail had not received an `AskUserQuestion` event while the selector was open.
4. `claude agents --json` reported the interactive session as idle.
5. The former watcher treated four idle observations without a final transcript record as interruption and marked the task failed at `15:47:21Z`.
6. The user answered at `15:48:38Z`. The transcript then contained the question tool use and its matching tool result, and Claude continued in the terminal after CC Relay had already stopped watching.

The command failure immediately before the question was not the task failure. The incorrect idle heuristic was the root cause.

## Runtime contract

`ClaudeTerminalExecutor.watchTurn()` now tracks human input with question-specific evidence:

- A current-turn `PreToolUse` hook for `AskUserQuestion`, or the equivalent anchored transcript record, creates a pending question.
- It emits one `claude/input-required` event only when that pending question remains visible across the idle grace period, and keeps the task in `running`.
- The event tells the user to answer in the exact native Claude terminal.
- The task and session stay reserved, so no other work can claim that conversation.
- A matching `PostToolUse`, `PostToolUseFailure`, or transcript tool result clears the question and emits `claude/input-resumed`.
- Busy status alone is liveness. It neither creates a question nor claims that an answer was submitted.
- Sustained idle with no pending question emits a quiet progress note instead of a false input request.
- Current-turn hook events are filtered by `prompt_id`, so a delayed question from an older turn cannot claim the new task.
- A final assistant record still completes normally.
- Cancellation, exact terminal closure, transcript shrinkage, and the 45-minute inactivity ceiling still stop the watcher.
- CC Relay never injects, retries, or guesses an answer.

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

Regression coverage now exercises both sides of the contract. One test receives a verified `AskUserQuestion`, remains idle, proves a generic busy sample does not emit resume, receives the matching tool completion, and finishes normally. Another proves an unanswered verified question still reaches the inactivity ceiling. Task 15 separately proves that compaction plus idle never emits `claude/input-required`; see [[claude-continuation-compaction-recovery-review]].

See [[claude-terminal-visibility]], [[task-history]], [[project-workspaces]], and [[interface-layout]].

#relay #claude #terminal #input #human-in-the-loop
