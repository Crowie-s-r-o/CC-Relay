---
name: Current Relay Notes
description: High-signal context for the next development session.
type: hot
---

# Current Relay Notes

> [!note]
> The launchpad now treats pinned projects as selectable workspace cards. See [[project-workspaces]].

> [!note]
> Project launch chips match the compact reference: neutral Codex, restrained orange Claude, regular monospace labels, thin borders, and no selected-card shadow. Electron is locked to 100 percent zoom. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Task records persist in SQLite. The queue follows the selected terminal session, with **All history** available for cross-session history. See [[task-history]].

> [!note]
> Task queues now follow the selected terminal session, workspace columns are user-resizable, and launch/send diagnostics are persisted locally. See [[task-history]], [[interface-layout]], and [[diagnostics]].

> [!note]
> The desktop header status is a compact 488px segmented capsule centered independently of the logo and actions. Sessions uses explicit `Codex n · Claude n` wording. See [[interface-layout]].

> [!note]
> Terminal output now uses the refined execution-ledger hierarchy documented in [[interface-layout]].

> [!note]
> Direct execution Model and Effort cards are extra compact. Effort maps only to explicit supported values, starts at the selected model's declared default, and no longer exposes a synthetic **Model default** slider stop. See [[interface-layout]].

> [!note]
> **Run in parallel** bundles selected waiting tasks into one numbered Codex command sent to the currently selected Codex terminal. Codex receives explicit sub-agent instructions. See [[task-history]].

> [!note]
> Forward-planning turbo uses a read-only Codex planner and a dependency-aware Relay scheduler across multiple live worker terminals. Defaults are Sol high for planning, Luna high for execution, and three workers. See [[turbo-execution]].

> [!note]
> Ctrl+Enter is labeled **Run now** and prioritizes a new submission on an available Relay without interrupting active work. Shortcut hints are visually separated. See [[task-history]].

> [!note]
> Newly launched Codex terminals can accept their first Relay task even before Codex has persisted a rollout. Relay falls through from the expected `thread/resume` missing-rollout error to `turn/start`. See [[project-workspaces]].

> [!note]
> After that first `turn/start`, Relay resumes the fresh thread again to subscribe to live output. This keeps the first task's Task Activity stream populated instead of relying only on final-result polling. See [[project-workspaces]].

> [!note]
> The **Connect another Codex terminal** disclosure now stays open across silent terminal polling. The populated-terminal render path must preserve the user's disclosure state. See [[project-workspaces]].

> [!note]
> Connected Codex terminals are numbered as Relay workers. Queued Codex tasks can be assigned by button or dropped onto another Relay in the same workspace, and direct submissions can opt into idle-terminal routing. See [[task-history]] and [[interface-layout]].

> [!note]
> Direct Codex tasks now run concurrently across distinct Relay terminals while remaining sequential per terminal. Claude, Plan council, and Turbo stay exclusive, and cancellation is tracked per task. See [[task-history]].

> [!note]
> Project cards and numbered Relay cards now expose live task activity, including running prompts, waiting counts, Turbo roles, attention-needed outcomes, and idle readiness. See [[project-workspaces]] and [[interface-layout]].

> [!note]
> Task cards use the reference footer: one divider, execution and workspace metadata on the left, and status dot, duration, and compact timestamp on the right. See [[interface-layout]].

> [!note]
> A task can contain up to 99 reference images while retaining the 5 MB per-image and 20 MB combined limits. See [[interface-layout]].

> [!note]
> Codex and Claude terminal launches share one window grid. Bounds are reapplied after CLI startup so Claude cannot resize itself out of the selected cell. See [[interface-layout]].

> [!note]
> Task badges and footer dots have distinct final-cascade colors for running, queued, complete, failed or interrupted, and cancelled states. See [[interface-layout]].

#relay #hot
