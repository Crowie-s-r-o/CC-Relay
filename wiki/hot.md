---
name: Current Relay Notes
description: High-signal context for the next development session.
type: hot
---

# Current Relay Notes

> [!note]
> The launchpad now treats pinned projects as selectable workspace cards. See [[project-workspaces]].

> [!note]
> Task records persist in SQLite. The queue follows the selected terminal session, with **All history** available for cross-session history. See [[task-history]].

> [!note]
> Task queues now follow the selected terminal session, workspace columns are user-resizable, and launch/send diagnostics are persisted locally. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> Terminal output now uses the refined execution-ledger hierarchy documented in [[interface-layout]].

> [!note]
> Direct execution Model and Effort cards are extra compact. Effort maps only to explicit supported values, starts at the selected model's declared default, and no longer exposes a synthetic **Model default** slider stop. See [[interface-layout]].

> [!note]
> **Run in parallel** bundles selected waiting tasks into one numbered Codex command sent to the currently selected Codex terminal. Codex receives explicit sub-agent instructions. See [[task-history]].

> [!note]
> Forward-planning turbo uses a read-only Codex planner and a dependency-aware Relay scheduler across multiple live worker terminals. Defaults are Sol high for planning, Luna high for execution, and three workers. See [[turbo-execution]].

> [!note]
> Ctrl+Enter prioritizes a new submission ahead of waiting tasks without interrupting the running task. Enter appends normally and Shift+Enter inserts a newline. See [[task-history]].

> [!note]
> Newly launched Codex terminals can accept their first Relay task even before Codex has persisted a rollout. Relay falls through from the expected `thread/resume` missing-rollout error to `turn/start`. See [[project-workspaces]].

> [!note]
> The **Connect another Codex terminal** disclosure now stays open across silent terminal polling. The populated-terminal render path must preserve the user's disclosure state. See [[project-workspaces]].

#relay #hot
