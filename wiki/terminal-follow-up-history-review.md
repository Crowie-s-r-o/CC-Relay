---
name: Terminal Follow-up History Review
description: Adversarial verification of native terminal capture, execution attribution, replay, and Standup grounding.
type: review
tags:
  - relay
  - terminal
  - standup
  - review
---

# Terminal Follow-up History Review

## Executive Summary

**Ticket confidence: High**

The gap was downstream of the terminal: direct CLI input bypassed Relay receipts, and provider watchers stopped with their queue attempt. [[terminal-follow-up-history]] adds a separate durable evidence path and keeps queue ownership unchanged. Review was performed directly in the current session using the review-crowie workflow.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Synthetic Codex and Claude transcripts pass through the actual importer, SQLite history, search, and both production date selectors. |
| Regression risk | Green | Native history never mutates task status, prompt, queue ownership, attempt duration, or token accounting. Existing database and Standup tests pass. |
| Gap risk | Amber | Provider transcript persistence can lag or be missing. Unknown completion records fail closed. Compressed archives are not decoded. |
| Code quality | Green | Identity checks precede writes; native provenance is separate from queue ownership; source parsing and persistence are independently inspectable. |
| Unit tests | Green | Coverage includes both providers, replay, append, partial UTF-8, oversized lines, consumed queues, image-only input, failures, backgrounds, ownership, date boundaries, Turbo, and selected-day evidence bounds. |
| Performance and scalability | Green | Cached path discovery, stat-only unchanged files, asynchronous bounded reads, compact identity queries, and one pending scan avoid full transcript materialization. |

## Top 3 Risks

1. `TerminalHistorySync.consume()` depends on provider JSONL shapes. Strict IDs, workspaces, explicit outcomes, and conservative background gates contain format changes.
2. `RelayDatabase.taskAttemptsMap()` merges two ledgers. Interval coverage and repeated-result tests prevent duplicate execution counts and loss of later dated evidence.
3. `boundedMessages()` could discard the requested day's evidence in a long reused session. Selected-execution priority now protects that evidence within existing source limits.

## Top Improvements

- A future provider format change should extend synthetic fixtures before loosening completion detection.
- A future compressed-archive reader must preserve the same identity, memory, and replay guarantees.

## Recommendation

**Ship**

## Confirmed Issues

The review found and fixed fallback-result duplication, legacy response reordering, a moving `started_at` ownership boundary, selected-detail refresh missing terminal-only changes, loss of repeated result dates, inclusive prior-attempt end boundaries, cached discovery missing newly created transcripts, and selected-day messages being displaced by later context.

The extra full-suite pass also exposed a stale source boundary in `test/terminal-window.test.mjs`: the terminal harness included a newly inserted image-paste listener without that control's DOM. The harness now ends at its final terminal listener, preserving the real terminal behavior checks while excluding unrelated continuation controls.

> [!note]
> Final September 5 verification: all 2,058 repository tests passed, including 77 focused history/database/Standup checks and 65 terminal-window checks. `npm run release:check`, syntax checks for the changed source modules, and `git diff --check` passed. Every test process started by this session exited. No live provider session or user task was restarted or stopped.

## Suspected Issues and Edge Cases

Provider records without a proven completion or queued consumption timestamp stay unconfirmed. Native sub-agent work is excluded from operator prompts, and known asynchronous agents require a fresh consolidated final after completion. No task execution is inferred from terminal screen text or an idle observation.

## Regression Risks

Task detail and search gain native evidence. Task summaries gain an additive history revision and successful execution dates. Existing events, queue task identity, manual-session state, completion alerts, dispatch capacity, cancellation, and provider interaction are unchanged. Turbo is limited to its exact saved executor conversation after the initial attempt ends.

## Performance Risks

Initial discovery is O(F) in provider history files, with a 30-second index cache. A scan is O(T) metadata reads plus newly appended bytes for tracked task conversations. Initial/restart replay is streamed. Message hydration remains proportional to a task's conversation history; Standup output retains the existing task, message, and total-text limits.

## Test Gaps

The test suite does not run paid live provider turns. Parser shapes were checked against local installed-provider record metadata; behavioral tests use synthetic identities and paths. No Windows hardware or compressed-archive validation was performed.

## Positive Improvements

Terminal follow-ups now contribute durable prompts, replies, and dated completed executions even after active Relay watchers stop. Capture is independent of terminal control, does not create work, and survives restart without duplicating history. See [[daily-standup]] and [[same-task-session-continuation]].
