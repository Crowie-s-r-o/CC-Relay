# CC Relay Features

## What CC Relay is

CC Relay is a local workspace and task orchestrator for Codex, Claude Code, and OpenCode. It connects to provider sessions that are already authenticated or configured in their native CLIs, lets you queue work against a selected project, and coordinates when and where that work runs.

CC Relay does not call model-provider APIs directly. It delegates execution and authentication to the installed Codex, Claude Code, and OpenCode tools, preserves their native conversation context, and stores task history and artifacts locally.

CC Relay is designed to make AI development work easier to control:

- Pin projects and set separate maximum Codex, Claude, and OpenCode instances for each one.
- Queue prompts instead of waiting for one task to finish before preparing the next.
- Give tasks recognizable names, star important records to keep them at the top, and rename titles at any stage.
- Search every saved task command and provider response inside the selected project.
- Attach earlier task messages, AI responses, or both as context for new work.
- Choose the provider, model, and reasoning effort without keeping a target terminal open.
- Run a saved Deploy check skill immediately with the selected direct-execution settings.
- Launch a fresh Codex or Claude terminal, or a headless OpenCode process, only when a queued task receives capacity.
- Optionally keep final Codex and Claude task terminal sessions open, with an independent saved choice for every project.
- Run independent tasks concurrently up to each project's provider limits.
- Continue a direct Codex or Claude task by relaunching and resuming its saved conversation.
- Retry a failed direct task with a newly selected Codex, Claude, or OpenCode executor, model, and effort.
- Attach screenshots and other reference images to tasks.
- Follow commands, file changes, tools, messages, errors, and results in a live activity view.
- See today's all-provider token total beside Crowie, plus cumulative native input and output use and average output tokens per attempt second during supported provider runs.
- Monitor Claude session, Claude weekly, Fable weekly, Codex five-hour, and Codex weekly subscription usage in the global header.
- Persist prompts, events, results, plans, errors, and attachments locally.
- Generate a date-selected daily changelog from saved prompts and AI responses.
- Reorder, prioritize, reassign, cancel, retry, and delete tasks.

## Core workflows

### Execute

Execute sends one task to one selected provider. CC Relay creates a terminal and conversation for Codex or Claude, or starts a headless native session for OpenCode, when the task starts.

Use Execute when the task is already clear and you want an agent to perform the work, such as implementing a feature, fixing a bug, editing files, running tests, reviewing code, or answering a focused technical question.

You can choose:

- Codex, Claude Code, or OpenCode
- The active project and its automatic provider pool
- The model and reasoning effort
- Optional reference images
- Normal queueing or priority execution

The project's Codex, Claude, and OpenCode limits control how many independent direct tasks can run at once. Every fresh task receives a fresh conversation. Codex and Claude support explicit continuation, serialized against any other work using that conversation ID. OpenCode saves its native session ID and resumes it when the same task is retried. **Keep task terminals open** applies only to Codex and Claude and is disabled by default for each project. Enabling it keeps the final window connected without consuming an active task slot, and Continue session or Retry reuses it while it remains idle. Direct Terminal session mode tasks stay open for more turns until the operator completes them or their retained terminal closes. The choice affects only the selected project and applies to new tasks immediately.

**Best for:** well-defined work that needs one agent and one execution context.

**Output:** the completed task result, a live execution trace, and locally stored task artifacts.

Codex model choices come from the connected Codex CLI and are validated against that live account
catalog before execution. The startup fallback catalog includes GPT-6 Astra with low through max
reasoning effort, while GPT-5.6 Sol remains the existing fallback default. This makes Astra
selectable during startup or a transient catalog read failure without silently changing saved or
default workflow choices. Actual execution still requires the installed Codex CLI and account to
advertise `gpt-6-astra`.

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

Forward-planning Turbo turns a large objective into a dependency-aware execution graph, then gives that complete graph to one fresh Codex execution session.

For each queued Turbo prompt, CC Relay opens a fresh read-only planner using the selected planner model and effort. The planner studies the workspace and returns a structured graph. As soon as the graph is valid, the planning terminal closes. When an execution lane is available, CC Relay opens a different fresh terminal using the selected execution model and effort and sends it the original objective plus the entire plan.

The executor owns integration and final verification. It may use Codex internal sub-agents for independent parts of the graph, but CC Relay does not split one prompt across native terminal windows. The configured concurrency controls how many planned Turbo prompts may be executing at the same time. This creates a pipeline with one planning lane and up to the selected number of execution lanes.

Both stage terminals close automatically by default, and each bound conversation remains resumable. **Keep workflow terminals open** retains a stage terminal after it finishes when hands-on inspection is useful. A completed Turbo task exposes continuation for its final execution conversation.

You can choose:

- The planner model and reasoning effort
- The execution model and reasoning effort
- The number of concurrent Turbo executions

**Best for:** large features, coordinated refactors, broad repository changes, and objectives that contain several independent or partially dependent workstreams.

**Output:** a validated execution graph, visible planning and execution stages, one resumable executor conversation, dependency progress, and one completed parent task.

## Workflow comparison

| Workflow | Main purpose | Agents | Project changes | Parallel execution |
| --- | --- | --- | --- | --- |
| Execute | Complete a clear task | One disposable Codex, Claude, or OpenCode instance | Allowed | Up to the project provider limit |
| Execute with Plan council | Produce a reviewed plan | Selectable Claude/Codex author, opposite-provider reviewer, original-provider reviser | No, read-only | Staged review loop |
| Forward-planning Turbo | Plan and execute a large objective | One fresh planner, then one fresh executor per prompt | Planner is read-only, executor can edit | Several planned prompts can execute concurrently |

## Supporting features

### Project Launchpad

Pin frequently used folders and treat each one as a workspace. A project card scopes tasks, activity, plans, provider settings, and instance limits. Drag a card by its grip to reorder the Launchpad, or focus the grip and use Left or Right. The order persists across restarts without changing the selected project. The composer offers Claude, Codex, and OpenCode automatically only for runnable work.

### Task queue and CC Relay assignment

Tasks are stored in SQLite and survive restarts. Each project owns its queue order, pause state, FIFO barriers, and provider limits. Waiting tasks can be reordered. Disposable tasks are not assigned manually because the pool creates their terminal when they start. Legacy persistent tasks retain compatible reassignment support.

The task-list search checks task names, original commands, every accepted Relay follow-up, every saved provider response, final results, and recorded errors. Search is case, accent, and punctuation insensitive, supports quoted phrases and task numbers, and ranks the strongest evidence first. Starred matches form a stable group above other matches while preserving relevance order inside each group. Matching cards show a highlighted command or response excerpt. Search spans all dates in the selected project; filtered results stay inspectable but do not expose reorder, assignment, or parallel-batch controls.

Task names are optional and fall back to a compact form of the request. The pencil beside every
ordinary task title opens a focused inline editor, including while a task is running or after it
finishes. Renaming preserves its task ID, prompt, status, position, routing, workflow configuration,
conversation, outcomes, and images. Planner breakdown titles remain linked to their plan steps.

The star beside a task title persists in SQLite and groups that task at the top of Queue, History,
search, and the active-task monitor. Starring is display organization only. It does not change a
queued task's execution position, FIFO barriers, provider capacity, or scheduler priority. Queue
reordering remains available inside the starred and unstarred groups.

Task Activity includes a compact continuation dock for direct tasks and for a completed Turbo task's final execution session. A follow-up always reuses the selected task row and saved conversation. While a direct task is running, Codex and interactive Claude accept exact active-turn updates without creating queue work. Running Claude keeps the dock editable while earlier updates are being delivered, captures every send in order, and sends a stable native Claude draft before the next Relay update instead of blocking the operator. Attachment-bearing updates remain recognizable after Claude converts their path lines into cumulative image chips and shortens the collapsed paste, so the guarded submit schedule does not leave them waiting for manual Enter. After a supported task finishes, CC Relay uses a live retained session immediately, or reserves a free provider slot, relaunches the saved conversation, and sends the next turn without creating a task. If no slot is free, submission stays on the finished task and asks the user to try again. The Prompts disclosure above the event rail lists the original request and every accepted follow-up.

Retrying a failed, cancelled, or interrupted automatic Execute task opens its execution settings first. The executor, model, and effort can change before the task returns to the queue. Keeping the same executor preserves the saved conversation when available. Switching among Codex, Claude, and OpenCode starts a fresh provider conversation while preserving the task ID, request, images, and queue history.

### Run now

Run now places an urgent task ahead of other waiting tasks. It does not interrupt work that is already running or bypass provider instance limits.

### Saved quick skills

The compact row below the task prompt shares its width equally between push-to-talk and saved skills. **Deploy check** is the first preset. One click creates a direct Execute task at Run now priority with the active project and the currently selected provider, model, and reasoning effort. Codex and Claude use the selected terminal lifecycle and layout settings. OpenCode uses its selected headless execution settings.

Saved skills carry their own exact prompt and task name. They do not include or clear the task name, prompt draft, task references, or images already in the composer. They are unavailable in Plan council and Forward-planning Turbo because those workflows have different execution contracts. The button also stays unavailable while another composer submission owns the form, no project is selected, or the selected provider CLI is confirmed missing.

### Push-to-talk voice input

The task composer supports optional local dictation. Enable it in **Terminal settings**, select the system default or a named microphone, set up the local engine once, then hold the configured activation keys while the CC Relay window is active. Releasing the main key or any required modifier immediately stops the microphone, runs faster-whisper on the CPU, and inserts the transcript at the current prompt selection. The on-screen microphone control follows the same hold and release behavior. A saved named input is resolved again after desktop origin changes, and an empty low-bitrate clip identifies the microphone that captured silence so a virtual or disconnected source is not mistaken for a speech-model failure.

The default primary shortcut is `Ctrl+Shift+Space`, and an optional alternate shortcut can trigger the same recording. Each shortcut button accepts an exact combination of Control, Alt, Shift, or Meta plus a supported letter, digit, function, punctuation, space, Caps Lock, or numpad key. Both choices are app-wide durable preferences.

Setup requires Python 3.9 or newer and an internet connection. Relay creates an isolated runtime in its application data, pins faster-whisper 1.2.1, downloads the multilingual base model, and loads it with CPU `int8` inference. A clip rejected completely by the normal speech gate receives one recovery decode without that gate, which preserves quiet speech while true silence remains empty. Recorded clips are bounded, processed one at a time, and deleted after each transcription. Relay releases microphone tracks even when the activation keys are released before the operating-system permission prompt finishes.

### Reference images

Tasks can include PNG, JPEG, or WebP reference images. CC Relay validates and stores them locally, then provides them to the selected workflow without uploading them to a separate CC Relay service.

### Task references

Right-click a task card to attach My messages, AI responses, or Both to the new-task composer. Several task references can be combined, and each ticket keeps an editable Include choice. When the task is queued, CC Relay freezes the selected conversation material into a quoted context section after the new instruction, so Execute, Plan council, and Turbo receive one self-contained prompt.

### Task activity

CC Relay converts raw provider events into a readable activity stream containing commands, tool calls, file changes, messages, errors, and final results. The filter rail shows live counts for All, Highlights, Commands, Conversation, My messages, and AI messages. A separate **Thinking** switch starts on and can hide provider-exposed Codex reasoning summaries and OpenCode reasoning blocks without changing the selected view. Conversation keeps both speakers together in chronological order. My messages includes the canonical original request plus accepted updates, while AI messages includes only actual Codex, Claude, or OpenCode response text and excludes provider status notices. Filtered rows keep their original signal numbers, and tool rows show elapsed time when the provider reports it. Signal counts, the status bar, and Copy log all follow the same visible set. Task Activity text can also be selected directly; live refreshes preserve the range, and the desktop right-click menu exposes native Copy. Prompt Copy writes only the user-authored prompt bodies, without generated numbering or an Original request label.

On macOS, the full-viewport Terminal window opens on the real visible text from the task's exact owned Terminal.app tab, rather than reconstructing a terminal from Relay events. The backend requires the tracked window id and matching TTY before it reads anything, and never substitutes another Terminal window. The three alternate window views continue to use the structured Conversation, My messages, and provider-derived AI message filters. See [Terminal Window](wiki/terminal-window.md).

### OpenCode execution and native token accounting

OpenCode is a third direct Execute provider beside Codex and Claude. Relay discovers the installed CLI and its configured model catalog, then starts `opencode run --format json --thinking` as a headless child process in the selected project. The explicit thinking flag is required because OpenCode suppresses reasoning records by default in non-interactive runs. OpenCode does not open or retain a Terminal.app window. Its project limit still participates in the same queue capacity and cleanup rules.

Relay reads native OpenCode `step_finish` token statistics as the run progresses. It emits one cumulative usage record after each reported step and reconciles an incomplete final stream from the saved native session export when needed. Codex and Claude native usage events use the same normalized record. Task Activity shows the current attempt's exact native input and output totals. The visible speed is:

```text
native cumulative output tokens / elapsed attempt seconds
```

The rate is an average across the task lifecycle, not an instantaneous model sampling rate. Input and cached context are excluded from its numerator because large context windows describe prompt processing, not generated output. Running speeds refresh once per second. A finished task freezes the denominator at its finish time, while a manually open terminal session without a finish time freezes at its latest native usage event. Estimated or stale events from an earlier retry attempt are excluded.

Codex reports a thread-wide `total` and the most recent upstream response as `last`. Relay infers the pre-attempt baseline as `total - last` on the first update, then subtracts that fixed baseline from later totals. This keeps continued conversations isolated and prevents a single growing context window from being mislabeled as cumulative task usage.

The macOS Crowie title bar separately shows one compact total for the current local calendar day. Relay stores the increase between consecutive native cumulative snapshots, so repeated snapshots are not added twice and a run crossing midnight assigns only its post-midnight increase to the new day. This counter uses each provider's total, including cache and reasoning categories when reported. At Claude Agent completion, Relay sums the saved native sub-agent transcript by message ID and uses inline usage or a background `subagent_tokens` value only when that detailed trace is unavailable.

The average output rate appears in Task Activity and in the global running-task monitor. Exact input, output, and provider-reported thinking-token counts appear in the Task Activity execution summary, with the full cache and usage breakdown in hover text. Reasoning text and numeric reasoning usage are separate native signals: a provider can expose a reasoning block while reporting zero reasoning tokens, and Relay does not fabricate an estimate. OpenCode aggregate `stats` output is not used for task speed because it spans broader CLI history rather than the current Relay attempt. See [OpenCode provider and token throughput](wiki/opencode-provider-and-token-throughput.md) and [Daily Token Usage Ledger](wiki/daily-token-usage.md).

### Task changes

The task detail **Changes** action opens on **Exact task edits**, a per-file sequence of patches that Codex or Claude reported for that task. **Workspace window** keeps the original working-tree snapshot comparison so OpenCode, shell commands, external tools, and other disk changes remain inspectable. Relay labels the exact view as provider-reported evidence and calls out any file-change record that did not include a patch.

### Provider subscription usage

The global header shows five compact progress bars for Claude's current five-hour session window, Claude's all-model weekly window, Claude's distinct Fable weekly usage, Codex's five-hour window, and Codex's weekly window. The values refresh every 30 seconds, show provider-reported reset details on hover, and retain their last successful values when a provider returns stale data or is temporarily unavailable. Fable never borrows the all-model Claude percentage or reset. Green applies below 50 percent, yellow from 50 through 74, orange from 75 through 89, and red from 90.

The monitor uses each installed, authenticated provider CLI. It does not add API keys or copy provider credentials into CC Relay. The former header **Pause queue** action is removed; the backend pause contract remains available to queue-management integrations.

### AI daily standup

The Task queue includes a **Standup** action. Opening it does not run AI. Each Launchpad can save an optional default custom prompt for its Standups, such as preferred terminology, emphasis, or exclusions. Choose a one-day or two-day range, then select its local-calendar start date to begin generation. A two-day range includes the selected date and the following date, and its latest allowed start keeps the whole range at or before today. Selection follows completed execution attempts, so a saved task that was continued on a later day appears on every day when one of its successful attempts actually ran. Failed and interrupted attempts remain context only. CC Relay gives a fresh isolated, non-persistent Codex or Claude CLI process the saved project prompt plus exact attempt starts and completions, prompts, assistant responses, and final results from completed work in that project. It never uses a task terminal.

Standup has one output type: the same concise changelog structure used by deploy. Related work is synthesized into short Added, Changed, Fixed, and Security sentences. Empty categories are omitted, facts are deduplicated, and the result copies as ready-to-paste Markdown headings and bullet points. After generation, a dated question ledger accepts typed questions or one-click prompts about what ran each day, which work came from follow-up executions, and when changes started or completed. Each answer uses another fresh isolated process with bounded prior Q&A for reference resolution. Neither generation nor Q&A creates a queue task, resumes an existing task conversation, persists a provider session, or adds itself to history.

### Local persistence

CC Relay stores task records in local SQLite and writes readable artifacts for prompts, events, results, plans, errors, and attachments. This provides a durable record of what was requested, what ran, and what the agents produced.

### Desktop updates

Packaged macOS and Windows builds check the public `Crowie-s-r-o/CC-Relay` latest-release metadata after launch and every five minutes while running. When a newer version is available, the global header shows its version and opens a release-details modal with installed and latest versions plus the trusted release link. macOS DMG installations and Windows portable builds link to the manual download. Installed Windows NSIS builds additionally support user-confirmed download progress and restart installation. Linux desktop packages are not currently produced.

## Choosing a workflow

- Choose **Execute** when you know what should be done.
- Enable **Plan council** in Execute when you first need a carefully reviewed implementation plan.
- Choose **Forward-planning Turbo** when the objective benefits from a dedicated planning pass before a clean execution session takes ownership.
