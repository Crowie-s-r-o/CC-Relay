---
name: Session Tasks
description: Queue and Task Activity treatment for keep-terminal-open tasks with live terminal state, a kill action, and paired conversation history.
type: architecture
tags:
  - relay
  - terminal
  - session
  - tasks
  - ui
---

# Session Tasks

A session task is a task row carrying `keep_terminal_open = true` with `terminal_lifecycle = 'disposable'`. Its retained native terminal survives the task outcome, and **Continue session** runs later turns in the same task row and saved conversation. The August 3, 2026 session-surface work makes these tasks visibly different and operable from CC Relay, aimed at long-running research sessions. Only direct single-session work gets the full surface: `mode` execute or breakdown with provider codex or claude. Plan council and Turbo keep-open fleets keep their previous presentation everywhere.

Direct Execute tasks created with the project's **Terminal session mode** also carry `manual_completion = true`. They alternate between `running` and `open`, accept unlimited same-task turns, and finish only through **Complete session**. Their stronger queue-card rail, manual badge, project activity state, completion control, recovery rules, and final continuation boundary are documented in [[manual-terminal-session-mode]]. Existing retained tasks without that flag still complete automatically and keep the original continuation behavior described on this page.

## Queue cards

- `isDirectSessionTask()` in `public/app.js` gates a `data-session="true"` article attribute, a `data-session-state` attribute, and a `task-session-badge` chip after the task number.
- States: `open-idle` (Terminal open), `open-busy` (Terminal busy), `pending` (queued task with no bound thread yet), `closed`. The state word is always text; the colored dot is reinforcement only, and the card aria-label carries the state.
- State derives from `state.threads` (four-second discovery poll) matched by exact thread id, provider, and normalized project path, so a badge can lag a few seconds behind the native window.

## Task Activity session surface

- `#session-strip` sits between the detail header and the plan preview: provider, relay, and model context, a state pill, the optional **Complete session** button, a **Close terminal** kill button, and `#session-strip-message` (`role="status"`) for outcomes. Status writes are inequality-guarded so the live region is not re-announced by the two-second poll.
- Kill reuses the existing `DELETE /api/terminals/:threadId` and the per-thread `terminalControl` ownership state from `/api/threads`. The button is enabled only when `capabilities.terminalControl` is present, the session thread is listed, and `terminalControl.canClose === true`; a queued, running, or retrying task on the terminal blocks the close upstream in `terminalControlState`. `window.confirm` precedes the destructive call, and errors land in the strip message, never the composer.
- After a successful close, the server records a queue event on the retained task (`The retained terminal window was closed from CC Relay.`) selected by `retainedSessionTaskForThread()` in `src/terminal-control.mjs` (strict `keep_terminal_open === true` plus disposable lifecycle, highest task id wins, status-agnostic because the coordinator already refused active terminals). The event write is wrapped so it can never fail the close, and the route broadcasts `{ threads: true, tasks: true, taskId }`. Non-retained closes keep the original `{ threads: true }` payload.
- `#session-history` replaces the flat Prompts and Result disclosures for direct session tasks (both are hidden while their copy keys stay populated). Ordinary, plan, and turbo tasks render exactly as before; `promptSection.hidden` and `resultSection.hidden` are now assigned on every path.

## Conversation pairing

- `GET /api/tasks/:id` now returns `responses: database.listTaskResponses(taskId)` beside `prompts`. `listTaskResponses` pre-existed for the standup feature; the detail route is a new consumer.
- `public/task-session-history.js` pairs them. `buildSessionTurns()` assigns each response to the latest prompt with `created_at <= response.created_at`; undated responses fall to the last turn, pre-prompt responses to the first; `pending` marks only the last turn of a running task with no response yet; when `responses` is missing or empty (older backend), the task row `result` or `error` is synthesized onto the last turn.
- The final response renders as markdown through the shared `renderMarkdown`; earlier same-turn messages sit in a sub-disclosure. `sessionConversationText()` backs the `data-copy-content="conversation"` copy action with every message, not only finals.

## Refresh stability

`renderSessionHistory` skips the DOM rebuild when `sessionHistorySignature()` is unchanged: task id, status, turn count, response count, newest response length, pending flag, `taskProvider(task)`, and `sessionTurnContentHash()` (a djb2 fold over turn ids, prompt timestamps, and prompt texts). Disclosure open state is remembered per turn id and restored after a rebuild; an explicit collapse outranks the newest-turn default-open.

> [!important]
> The signature must cover every datum the turn markup derives. The queued-task editor can change prompt text and provider without changing id, status, or counts; the content hash and provider component exist exactly for that case. Live terminal state is deliberately excluded so idle and busy flapping cannot rebuild the transcript under the reader; that exclusion is pinned by `test/session-tasks-ui.test.mjs`.

> [!important]
> Do not add a new `prefers-reduced-motion: reduce` block at the end of `public/style.css`. `test/planner-board.test.mjs` asserts against the last reduce block in the file. Declare new animation inside a `prefers-reduced-motion: no-preference` guard instead.

## Compatibility

- Older backend without `responses`: the timeline synthesizes from the task row; nothing crashes and no new capability flag was invented.
- Missing `capabilities.terminalControl`: the kill button is disabled with a restart title.
- Restart CC Relay (or rebuild the desktop bundle) to serve `responses` and the retained-close task event; a refreshed renderer degrades cleanly against an older process until then.

## Files and coverage

- `public/task-session-history.js` (new pure module)
- `public/app.js`, `public/index.html`, `public/style.css`
- `src/server.mjs`, `src/terminal-control.mjs`
- `test/task-session-history.test.mjs`, `test/session-tasks-ui.test.mjs`, `test/session-tasks-api.test.mjs` (new)
- `test/terminal-control.test.mjs`, `test/database.test.mjs` (extended)

Adversarial review executed a coordinator harness proving the kill chain: a retained launch stays in `ProjectLauncher.ownedTerminals` after `retainOwnedLaunch()`, so `terminalForThread()` keeps resolving it, a finished task never blocks `terminalControlState`, and a running follow-up on the same row refuses the close. Verdict Ship at 1039 of 1039 tests on August 3, 2026; the one finding (signature missing prompt text and provider) was fixed and pinned the same day.

See [[retained-terminal-sessions]], [[task-history]], [[same-task-session-continuation]], [[disposable-terminal-pools]], and [[terminal-close-review]].

#relay #terminal #session #tasks #ui
