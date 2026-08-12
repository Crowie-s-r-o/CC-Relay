---
name: CC Relay Core Product Story
description: The seven benefits that must lead the public README and the implementation facts behind them.
type: decision
tags:
  - relay
  - readme
  - product
  - release
---

# CC Relay Core Product Story

The public README leads with seven benefits, in this order:

1. Separate project-scoped concurrency limits for Codex and Claude, with provider terminals launched only after the complete workflow receives capacity.
2. A fresh terminal for each task execution, minimized by default on macOS and closed automatically at the terminal outcome, with finished direct tasks able to relaunch the saved conversation through **Continue session**.
3. Multiple repositories managed from one Launchpad without keeping a permanent wall of terminals open.
4. Prompts queued while other work is still running, with queue editing, ordering, and provider switching before dispatch.
5. Plan council, where one provider authors, the other challenges, and the author revises the reviewed plan.
6. Forward-planning Turbo, where a stronger planner builds the dependency graph and faster, lower-cost Codex workers execute it.
7. A compact subscription runway that keeps Claude session, Claude weekly, Fable weekly, and Codex weekly usage visible while work runs.

> [!important]
> These are the primary product story, not an unordered feature inventory. Live execution, local history, artifacts, attachments, diagnostics, loopback networking, and exact ownership checks remain supporting capabilities below this list.

## Verified implementation facts

- `projects.max_codex_instances` and `projects.max_claude_instances` are independent and project-scoped. [[disposable-terminal-pools]] documents the atomic workflow requirements.
- `freshProjectTerminalSettings()` defaults to `keepTerminalOpen: false` and `layout.background: true`. On macOS, `ProjectLauncher` miniaturizes the exact newly launched Terminal.app window. See [[project-terminal-settings]].
- `DisposableTerminalPool.release()` closes exact Relay-owned launches at completed, failed, cancelled, and interrupted terminal outcomes. It fails closed if ownership cannot be proved.
- Finished direct tasks keep their provider conversation ID. **Continue session** opens a replacement terminal and resumes that same conversation under the same task row. See [[same-task-session-continuation]].
- Project queues are isolated, so one repository can keep running while another queues or dispatches its own work. See [[parallel-project-queues]].
- Plan council and Turbo retain their provider-order and planner-worker contracts from [[plan-council]] and [[turbo-execution]].
- `ProviderUsageMonitor` samples the installed, authenticated provider CLIs every five minutes and serves only a cached status snapshot to the renderer. See [[provider-usage-monitor]].

> [!note]
> The minimized-launch statement is scoped to the tested macOS behavior. Windows has equivalent minimized-launch code, but Windows remains untested. Linux has no supported desktop terminal lifecycle yet.

#relay #readme #product #release
