# Relay Features

## What Relay is

Relay is a local workspace and task orchestrator for Codex and Claude Code. It connects to AI sessions that are already authenticated with your subscriptions, lets you queue work against a selected project, and coordinates when and where that work runs.

Relay does not call the OpenAI or Anthropic APIs directly. It uses the installed Codex and Claude Code tools, preserves their conversation context, and stores task history and artifacts locally.

Relay is designed to make AI development work easier to control:

- Pin projects and set separate maximum Codex and Claude instances for each one.
- Queue prompts instead of waiting for one task to finish before preparing the next.
- Choose the provider, model, and reasoning effort without keeping a target terminal open.
- Launch a fresh provider terminal only when a queued task receives capacity, then close it at outcome.
- Run independent tasks concurrently up to each project's provider limits.
- Continue a direct Codex or Claude task by relaunching and resuming its saved conversation.
- Attach screenshots and other reference images to tasks.
- Follow commands, file changes, tools, messages, errors, and results in a live activity view.
- Persist prompts, events, results, plans, errors, and attachments locally.
- Reorder, prioritize, reassign, cancel, retry, and delete tasks.

## Core workflows

### Execute

Execute sends one task to one selected provider. Relay creates the terminal and conversation when the task starts.

Use Execute when the task is already clear and you want an agent to perform the work, such as implementing a feature, fixing a bug, editing files, running tests, reviewing code, or answering a focused technical question.

You can choose:

- Codex or Claude Code
- The active project and its automatic provider pool
- The model and reasoning effort
- Optional reference images
- Normal queueing or priority execution

The project's Codex and Claude limits control how many independent direct tasks can run at once. Every fresh task receives a fresh conversation. An explicit continuation resumes its saved conversation and is serialized against any other work using that conversation ID.

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

**Output:** a first draft, Codex review, final revised plan, live stage progress, an internal `plan.json` checkpoint, and a final-only `<project-root>/.data/tasks/<task-id>/plan.md` artifact.

### Forward-planning Turbo

Forward-planning Turbo turns a large objective into a dependency-aware execution graph and runs that graph across a temporary Codex fleet.

Relay launches one read-only Codex planner and the requested number of workers. The planner studies the workspace once and returns a structured plan containing execution packages and their dependencies. Relay validates the plan, assigns ready packages to workers, runs independent packages concurrently, and unlocks dependent packages as their prerequisites finish.

Workers share the same project workspace. The planner is expected to separate file ownership where possible and encode required ordering explicitly. Relay reuses workers until the graph finishes, then closes the complete fleet.

You can choose:

- The planner model and reasoning effort
- The worker model and reasoning effort
- The number of worker terminals

**Best for:** large features, coordinated refactors, broad repository changes, and objectives that contain several independent or partially dependent workstreams.

**Output:** a validated execution graph, live package status, worker assignments, dependency progress, and one completed parent task.

## Workflow comparison

| Workflow | Main purpose | Agents | Project changes | Parallel execution |
| --- | --- | --- | --- | --- |
| Execute | Complete a clear task | One disposable Codex or Claude instance | Allowed | Up to the project provider limit |
| Execute with Plan council | Produce a reviewed plan | Claude author, Codex reviewer, Claude reviser | No, read-only | Staged review loop |
| Forward-planning Turbo | Plan and execute a large objective | One disposable Codex planner and multiple disposable workers | Planner is read-only, workers can edit | Dependency-aware worker execution |

## Supporting features

### Project Launchpad

Pin frequently used folders and treat each one as a workspace. A project card scopes tasks, activity, plans, provider settings, and instance limits. The composer opens Claude and Codex automatically only for runnable work.

### Task queue and Relay assignment

Tasks are stored in SQLite and survive restarts. Each project owns its queue order, pause state, FIFO barriers, and provider limits. Waiting tasks can be reordered. Disposable tasks are not assigned manually because the pool creates their terminal when they start. Legacy persistent tasks retain compatible reassignment support.

Task Activity includes a compact continuation dock for direct tasks. A follow-up becomes a linked queue task on the original conversation and waits for both project capacity and any active turn using that ID. Prompt and Result remain available through dense preview disclosures above the live event rail.

### Run now

Run now places an urgent task ahead of other waiting tasks. It does not interrupt work that is already running or bypass provider instance limits.

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
