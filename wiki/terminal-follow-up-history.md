---
name: Terminal Follow-up History
description: Read-only capture of native Codex and Claude follow-ups for task history and dated Standups.
type: architecture
tags:
  - relay
  - terminal
  - history
  - standup
---

# Terminal Follow-up History

Direct typing in the [[embedded-original-terminal]] or a retained external CLI bypasses `TaskQueue.startFollowUp()`. Codex releases its active subscription at completion, and Claude's active transcript watcher also ends with its Relay run. Consequently, saving only Relay follow-up receipts loses later terminal prompts, replies, and execution dates.

`src/terminal-history.mjs` adds an independent, read-only persistence reader. It captures existing task conversations from Codex session and archived-session JSONL files and Claude project transcripts. It never types, resumes a provider, starts work, reserves capacity, changes a task status, or modifies the original task prompt. The completed Turbo executor conversation is eligible after its original attempt finishes; internal planner and initial graph-execution prompts are excluded. Council conversations and unrelated provider sessions are excluded.

> [!important]
> Conversation history and queue ownership are different responsibilities. Imported turns live in additive `terminal_history_turns` and `terminal_history_messages` tables. They must never create active `task_attempts` rows, automatic retries, or duplicate queue tasks.

## Source and identity

- Codex requires the exact `session_meta.id` and resolved workspace. `task_started.turn_id` and matching completion/abort records establish execution boundaries. User and assistant message records supply evidence; duplicated legacy `user_message` echoes are deduplicated within the native turn.
- Claude requires the exact session ID and workspace in main-session records. Sidechains, meta messages, compaction summaries, tool results, command bookkeeping, and agent notifications are not operator prompts. Explicit textual `end_turn` or `stop_sequence` responses can confirm completion. Streaming/null stops, API errors, cancellation, and known outstanding background agents cannot confirm completed work.
- Claude queued input is recorded only after a human `queued_command` consumption record. Its matching removal supplies consumption time because the attachment itself carries the earlier enqueue timestamp. An enqueue or removal alone proves no executed request. Without a consumption timestamp the reader cannot date a new execution and does not invent one.
- Image-only requests get an `[Image attachment]` history label. Image bytes and tool output are not copied into history.
- When legacy task rows reuse a conversation, each native turn belongs to the most recently started eligible task at that time. The reader uses the earliest persisted Relay attempt as a direct task's ownership boundary, since `tasks.started_at` can move on later continuations.
- Source identity is checked again at each database write. Ambiguous matching files are skipped. Missing or unreadable persistence never permits another session or project to substitute.

## Persistence and Standup

Native turn and message keys make append polling, restart replay, and file replacement idempotent. Queue attempts remain authoritative over native turns that start inside their execution intervals. That prevents steering, Relay-originated follow-ups, and automatic goal continuations from inflating execution counts. The interval end is exclusive so a new turn at the preceding completion boundary remains separate.

`taskAttemptsMap()` merges uncovered native executions into its dated history. Only successful native executions become `execution_starts` in task summaries, so both the browser's date gate and the backend's [[daily-standup]] selection see them. Queue duration and token accounting continue to describe queue-owned attempts; this importer makes no token-usage estimate.

`listTaskPrompts()`, `listTaskResponses()`, and task search include imported messages. Matching Relay receipts and provider echoes collapse within their execution. Repeated terminal responses on different executions retain their actual dates. A `terminal_history_revision` in task summaries invalidates selected-detail caching even when no raw activity event or task status changed. The existing prompt merge supplies native prompts to the conversation views.

Standup source records retain `source: terminal` and `executionStartedAt` on native evidence. The latest successful terminal response can supersede an older task-row result for synthesis. When a long conversation exceeds the source limits, messages for selected executions take precedence over unrelated later conversation entries. Successful work still belongs to its execution start day, including turns crossing midnight.

## Refresh, bounds, and cleanup

The backend syncs every five seconds and before task lists, task details, search, generation, and Standup Q&A. The filesystem index is cached for 30 seconds. Both Standup actions force a fresh index, preventing a newly created transcript from being missed by cached discovery. Concurrent scans share one pending operation; a forced refresh waits for any earlier scan before reading again.

Reads use asynchronous 64 KiB chunks and complete JSONL offsets. Partial UTF-8 records are retried, and oversized unfinished lines are skipped incrementally instead of being reread in full every poll. Individual lines are capped at 2 MiB and saved messages at 100,000 characters. Queued-message correlation keeps at most 100 hashes, not full prompt copies. Unchanged files are only statted. Shutdown clears the timer and awaits the reader before closing SQLite. No subprocess or environment variable was added.

> [!note]
> Capture depends on provider-persisted JSONL under the standard home directories. Deleted, compressed, unavailable, or ambiguous source files cannot be reconstructed. Unknown provider completion formats remain unconfirmed. Transcripts may flush after the UI finishes a turn, so a subsequent refresh can reveal additional evidence.

The focused integration tests in `test/terminal-history.test.mjs` use synthetic provider transcripts, real temporary SQLite databases, the actual importer, and the production Standup selectors. See [[terminal-follow-up-history-review]], [[same-task-session-continuation]], and [[session-tasks]].
