# Relay Features

## What Relay is

Relay is a local workspace and task orchestrator for Codex and Claude Code. It connects to AI sessions that are already authenticated with your subscriptions, lets you queue work against a selected project, and coordinates when and where that work runs.

Relay does not call the OpenAI or Anthropic APIs directly. It uses the installed Codex and Claude Code tools, preserves their conversation context, and stores task history and artifacts locally.

Relay is designed to make AI development work easier to control:

- Pin projects and launch connected Codex or Claude terminals from one place.
- Queue prompts instead of waiting for one task to finish before preparing the next.
- Choose the provider, model, reasoning effort, and target terminal.
- Route direct Codex work to a genuinely idle Relay when one is available.
- Run independent Codex tasks concurrently on different Relay terminals while keeping work sequential within each terminal.
- Continue any direct Codex or Claude task from Task Activity in the exact same session, model, and effort.
- Attach screenshots and other reference images to tasks.
- Follow commands, file changes, tools, messages, errors, and results in a live activity view.
- Persist prompts, events, results, plans, errors, and attachments locally.
- Reorder, prioritize, reassign, cancel, retry, and delete tasks.

## Core workflows

### Execute

Execute sends one task directly to one selected AI session.

Use Execute when the task is already clear and you want an agent to perform the work, such as implementing a feature, fixing a bug, editing files, running tests, reviewing code, or answering a focused technical question.

You can choose:

- Codex or Claude Code
- A connected session in the active project
- The model and reasoning effort
- Optional reference images
- Normal queueing or priority execution

For direct Codex work, **Use an idle Relay when available** distributes consecutive tasks across free terminals. Different Relay terminals can execute independently at the same time, while tasks assigned to the same terminal remain ordered.

**Best for:** well-defined work that needs one agent and one execution context.

**Output:** the completed task result, a live execution trace, and locally stored task artifacts.

### Optional Plan council in Execute

Plan council creates a reviewed implementation plan without changing the project.

It uses a fixed, read-only collaboration loop:

1. Claude inspects the task and workspace, then writes the first plan.
2. Codex independently reviews the draft for gaps, risks, and incorrect assumptions.
3. Claude incorporates the review and produces the final revised plan.

This workflow combines two provider perspectives before implementation begins. It is useful when requirements are complex, architectural choices matter, or a single planning pass would be too easy to trust without review.

**Best for:** architecture, migrations, risky changes, multi-part features, and work that should be validated before code is edited.

**Output:** a first draft, Codex review, final revised plan, live stage progress, and saved `plan.json` and `plan.md` artifacts.

### Forward-planning Turbo

Forward-planning Turbo turns a large objective into a dependency-aware execution graph and runs that graph across multiple Codex terminals.

The selected Codex terminal acts as a read-only planner. It studies the workspace once and returns a structured plan containing execution packages and their dependencies. Relay validates the plan, assigns ready packages to worker terminals, runs independent packages concurrently, and unlocks dependent packages as their prerequisites finish.

Workers share the same project workspace. The planner is expected to separate file ownership where possible and encode required ordering explicitly. Relay reuses workers until the complete graph is finished.

You can choose:

- The planner model and reasoning effort
- The worker model and reasoning effort
- The number of worker terminals

**Best for:** large features, coordinated refactors, broad repository changes, and objectives that contain several independent or partially dependent workstreams.

**Output:** a validated execution graph, live package status, worker assignments, dependency progress, and one completed parent task.

## Workflow comparison

| Workflow | Main purpose | Agents | Project changes | Parallel execution |
| --- | --- | --- | --- | --- |
| Execute | Complete a clear task | One Codex or Claude session | Allowed | Across separate Relay terminals |
| Execute with Plan council | Produce a reviewed plan | Claude author, Codex reviewer, Claude reviser | No, read-only | Staged review loop |
| Forward-planning Turbo | Plan and execute a large objective | One Codex planner and multiple Codex workers | Planner is read-only, workers can edit | Dependency-aware worker execution |

## Supporting features

### Project Launchpad

Pin frequently used folders and treat each one as a workspace. A project card scopes connected sessions, tasks, activity, and launch actions. Separate buttons open Codex or Claude in the selected folder.

### Task queue and Relay assignment

Tasks are stored in SQLite and survive restarts. Each project owns its queue order, pause state, and FIFO barriers. Waiting tasks can be reordered or reassigned to another compatible Codex terminal in the same workspace. Direct Codex tasks can run concurrently on separate terminals, including while another project is running a Plan council, without forcing unrelated work to wait.

Task Activity includes a compact continuation dock for direct tasks. A follow-up becomes a linked queue task on the original session and waits behind any active turn there. Prompt and Result remain available through dense preview disclosures above the live event rail.

### Run now

Run now places an urgent task ahead of other waiting tasks. It does not interrupt work that is already running. If another compatible Relay is available, the task can start there immediately.

### Reference images

Tasks can include PNG, JPEG, or WebP reference images. Relay validates and stores them locally, then provides them to the selected workflow without uploading them to a separate Relay service.

### Task activity

Relay converts raw provider events into a readable activity stream containing commands, tool calls, file changes, messages, errors, and final results. Filters, follow mode, and log copying make long executions easier to monitor.

### Local persistence

Relay stores task records in local SQLite and writes readable artifacts for prompts, events, results, plans, errors, and attachments. This provides a durable record of what was requested, what ran, and what the agents produced.

## Choosing a workflow

- Choose **Execute** when you know what should be done.
- Enable **Plan council** in Execute when you first need a carefully reviewed implementation plan.
- Choose **Forward-planning Turbo** when the objective is large enough to benefit from automatic decomposition and multiple coordinated workers.
