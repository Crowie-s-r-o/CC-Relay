---
name: Provider Sub-agent Visibility
description: Unified Claude and Codex worker rows, lifecycle folding, and completion safety in Task Activity.
type: architecture
tags:
  - relay
  - terminal
  - sub-agent
  - codex
  - claude
  - completion
---

# Provider Sub-agent Visibility

> [!important]
> Task Activity renders one named **Sub-agent** row per Claude or Codex worker. The row carries its role or model, launch brief, and live lifecycle state. The summary counts workers that are still active.

The expanded-by-default [[task-activity-overview]] repeats the operator-facing worker ledger above the terminal filters, with live workers first, per-worker elapsed time, assignment briefs, and explicit lifecycle states. The full signal row remains the lossless detail and copy surface.

## Provider signals

Claude exposes a worker launch as an `mcpToolCall` with `subAgent: true`. A background launch remains active after the launch call returns and resolves only when the matching `claude/agent-finished` notification arrives. Launch and finish records fold by tool use ID.

Codex exposes `collabAgentToolCall` and `subAgentActivity` thread items. Relay folds them by `agentThreadId`, including multi-worker `wait` updates, so one provider operation can update each affected row independently. `pendingInit` and `running` are live states. Authoritative completed, errored, interrupted, shutdown, or missing states resolve the row.

> [!note]
> Codex activity kind `interacted` records activity, not completion. It preserves the last lifecycle state. Only a new `started` activity or an authoritative running state can reopen a previously resolved row.

Standalone `claude/agent-finished` notifications are treated as workers only when they carry a worker name or an `Agent "..."` summary. Claude background command notifications use the same notification envelope, so this guard prevents build and shell completions from appearing as unnamed agents.

## Completion safety

The reported Claude premature-close failure was already fixed in [[claude-background-sub-agent-completion]]. Headless runs wait without a background ceiling and fail instead of reporting success when Claude warns that work was terminated or reports a positive pending count. Interactive turns hold the exact terminal while transcript launches, Stop-hook tasks, session crons, or the live worker ledger remain pending, then require a fresh consolidated response after the final child finishes.

The renderer ledger is observability, not a replacement completion signal. A finished top-level turn clears its active-worker summary. Codex task completion continues to follow the app-server turn lifecycle, while the worker rows explain the collaboration activity inside that turn.

## Implementation map

- `public/event-stream.js` recognizes, groups, and counts both provider protocols.
- `public/app.js` renders the provider-neutral worker presentation and copies its brief into the log.
- `src/codex-app-server.mjs` records useful human-readable messages for Codex collaboration items.
- `test/event-stream.test.mjs` covers concurrent workers, wait-state resolution, interruptions, historical activity ordering, and Claude command-notification separation.
- `test/claude-background-integration.test.mjs` and the Claude executor suites pin the no-premature-close contract.

## Verification

The complete repository suite passes 1,081 tests. The focused collaboration suite passes 46 tests, and the three Claude completion-safety suites pass 213 tests. An isolated live Relay server rendered one running Codex worker and one backgrounded Claude worker as separate named rows, counted both workers, and produced no browser console failure.

> [!warning]
> Restart CC Relay and rebuild the desktop bundle after current tasks finish to activate renderer and app-server changes. Do not replace the running bundle while provider turns are active.

See also [[task-activity-overview]], [[claude-terminal-visibility]], [[claude-background-sub-agent-completion]], [[terminal-markdown]], and [[provider-plan-and-goal-visibility]] for the plan checklist and Codex goal rows that share this stream.

#relay #terminal #sub-agent #codex #claude
