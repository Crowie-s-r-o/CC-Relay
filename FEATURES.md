# CC Relay Features

## What CC Relay is

CC Relay is a local workspace and task orchestrator for Codex and Claude Code. It connects to AI sessions that are already authenticated with your subscriptions, lets you queue work against a selected project, and coordinates when and where that work runs.

CC Relay does not call the OpenAI or Anthropic APIs directly. It uses the installed Codex and Claude Code tools, preserves their conversation context, and stores task history and artifacts locally.

CC Relay is designed to make AI development work easier to control:

- Pin projects and set separate maximum Codex and Claude instances for each one.
- Queue prompts instead of waiting for one task to finish before preparing the next.
- Choose the provider, model, and reasoning effort without keeping a target terminal open.
- Launch a fresh provider terminal only when a queued task receives capacity.
- Optionally keep final task terminal sessions open, with an independent saved choice for every project.
- Run independent tasks concurrently up to each project's provider limits.
- Continue a direct Codex or Claude task by relaunching and resuming its saved conversation.
- Attach screenshots and other reference images to tasks.
- Follow commands, file changes, tools, messages, errors, and results in a live activity view.
- Persist prompts, events, results, plans, errors, and attachments locally.
- Generate a date-selected, length-configurable daily standup from saved prompts and AI responses.
- Reorder, prioritize, reassign, cancel, retry, and delete tasks.

## Core workflows

### Execute

Execute sends one task to one selected provider. CC Relay creates the terminal and conversation when the task starts.

Use Execute when the task is already clear and you want an agent to perform the work, such as implementing a feature, fixing a bug, editing files, running tests, reviewing code, or answering a focused technical question.

You can choose:

- Codex or Claude Code
- The active project and its automatic provider pool
- The model and reasoning effort
- Optional reference images
- Normal queueing or priority execution

The project's Codex and Claude limits control how many independent direct tasks can run at once. Every fresh task receives a fresh conversation. An explicit continuation resumes its saved conversation and is serialized against any other work using that conversation ID. **Keep task terminals open** is disabled by default for each project. Enabling it keeps the final window connected without consuming an active task slot, and Continue session or Retry reuses it while it remains idle. The choice affects only the selected project and applies to new tasks immediately.

**Best for:** well-defined work that needs one agent and one execution context.

**Output:** the completed task result, a live execution trace, and locally stored task artifacts.

### Optional Plan council in Execute

Plan council creates a reviewed implementation plan without changing the project.

It uses a selectable, read-only collaboration loop:

1. Choose Claude first or Codex first, plus each provider's model and effort.
2. The first provider inspects the task and workspace, then writes the first plan.
3. The other provider independently reviews the draft for gaps, risks, and incorrect assumptions.
4. The first provider incorporates the review and produces the final revised plan.

This workflow combines two provider perspectives before implementation begins. It is useful when requirements are complex, architectural choices matter, or a single planning pass would be too easy to trust without review.

**Best for:** architecture, migrations, risky changes, multi-part features, and work that should be validated before code is edited.

**Output:** a first draft, opposite-provider review, final revised plan, live stage progress, an internal `plan.json` checkpoint, and a final-only `<project-root>/.data/tasks/<task-id>/plan.md` artifact.

### Forward-planning Turbo

Forward-planning Turbo turns a large objective into a dependency-aware execution graph and runs that graph across a temporary Codex fleet.

CC Relay launches one read-only Codex planner and the requested number of workers. The planner studies the workspace once and returns a structured plan containing execution packages and their dependencies. CC Relay validates the plan, assigns ready packages to workers, runs independent packages concurrently, and unlocks dependent packages as their prerequisites finish.

Workers share the same project workspace. The planner is expected to separate file ownership where possible and encode required ordering explicitly. CC Relay reuses workers until the graph finishes, then closes the complete fleet.

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
| Execute with Plan council | Produce a reviewed plan | Selectable Claude/Codex author, opposite-provider reviewer, original-provider reviser | No, read-only | Staged review loop |
| Forward-planning Turbo | Plan and execute a large objective | One disposable Codex planner and multiple disposable workers | Planner is read-only, workers can edit | Dependency-aware worker execution |

## Supporting features

### Project Launchpad

Pin frequently used folders and treat each one as a workspace. A project card scopes tasks, activity, plans, provider settings, and instance limits. The composer opens Claude and Codex automatically only for runnable work.

### Task queue and CC Relay assignment

Tasks are stored in SQLite and survive restarts. Each project owns its queue order, pause state, FIFO barriers, and provider limits. Waiting tasks can be reordered. Disposable tasks are not assigned manually because the pool creates their terminal when they start. Legacy persistent tasks retain compatible reassignment support.

Task Activity includes a compact continuation dock for direct tasks. A follow-up always reuses the selected task row and saved conversation. While a direct task is running, Codex and interactive Claude accept exact active-turn updates without creating queue work. After a task finishes, CC Relay uses a live retained session immediately, or reserves a free provider slot, relaunches the saved conversation, and sends the next turn without creating a task. If no slot is free, submission stays on the finished task and asks the user to try again. The Prompts disclosure above the event rail lists the original request and every accepted follow-up.

### Run now

Run now places an urgent task ahead of other waiting tasks. It does not interrupt work that is already running or bypass provider instance limits.

### Reference images

Tasks can include PNG, JPEG, or WebP reference images. CC Relay validates and stores them locally, then provides them to the selected workflow without uploading them to a separate CC Relay service.

### Task activity

CC Relay converts raw provider events into a readable activity stream containing commands, tool calls, file changes, messages, errors, and final results. Filters, follow mode, and log copying make long executions easier to monitor.

### AI daily standup

The Task queue includes a **Standup** action. Opening it does not run AI. Choose Short, Standard, or Detailed, then select a local calendar day to start generation. CC Relay gives a fresh isolated, non-persistent Codex or Claude CLI process the saved prompts, assistant responses, final results, and failures for that project and Relay scope. It never uses a task terminal.

The AI groups related work, explains what changed and how, and separates completed Tasks from unresolved Blockers. The modal lets you regenerate or copy plain sectioned text with no Markdown hyphen prefixes. Standup generation does not create a queue task, resume an existing task conversation, or add itself to history.

### Local persistence

CC Relay stores task records in local SQLite and writes readable artifacts for prompts, events, results, plans, errors, and attachments. This provides a durable record of what was requested, what ran, and what the agents produced.

## Choosing a workflow

- Choose **Execute** when you know what should be done.
- Enable **Plan council** in Execute when you first need a carefully reviewed implementation plan.
- Choose **Forward-planning Turbo** when the objective is large enough to benefit from automatic decomposition and multiple coordinated workers.
