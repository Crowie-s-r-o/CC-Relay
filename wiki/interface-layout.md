---
name: Interface Layout
description: Reference-driven visual system, responsive workspace, and persisted panel resizing.
type: architecture
---

# Interface Layout

> [!note]
> The task-scope control uses the same compact bordered button treatment as the adjacent **Queue** and **History** view controls. It defaults to **All Relays** within the selected Launchpad project and offers **This Relay** only as an explicit temporary filter, as documented in [[task-history]].

> [!important]
> Current backends advertise `capabilities.disposableTerminalPools`. In that mode the composer shows per-project Codex and Claude maximum instance controls instead of a live terminal picker. References below to a selected Relay, immediate finished-task follow-up, manual assignment, or the parallel batch bar describe the legacy persistent-task compatibility path unless stated otherwise. See [[disposable-terminal-pools]].

The Relay UI follows the supplied `Relay.html` reference at its 1680 by 1180 desktop target. The main visual system uses bundled local copies of Instrument Sans, Source Serif 4, and JetBrains Mono, blue interaction states, white rounded panels, and a navy execution console.

The Electron window enforces a 100 percent page zoom and blocks Command or Control zoom shortcuts. The compact reference dimensions assume normal zoom; allowing the window to retain a 200 percent zoom makes project cards and every neighboring control appear twice their intended size.

## Workspace columns

The wide desktop workspace contains Composer, Task queue, and Task activity panels. Two keyboard-focusable separators surround Task queue. Dragging either separator resizes the queue boundary while preserving minimum usable widths for all three panels.

Column preferences are stored in `localStorage` under `relay.panelWidths`. The default composer and detail widths are 540px and 620px. The queue consumes the remaining space. At 1344px and below, Relay switches to its responsive layout and hides the resize separators.

> [!note]
> Separators use pointer capture and `role="separator"`. Left and Right arrow keys adjust the corresponding boundary in 20px steps.

## Assets

- `public/fonts/instrument-sans-latin.woff2`
- `public/fonts/jetbrains-mono-latin.woff2`
- `public/fonts/source-serif-4-latin.woff2`
- `public/style.css`
- `public/index.html`
- `public/app.js`

## Global running-task header

The center of the application header is a global monitoring rail, not a connection, session, queue, or status summary. It contains only tasks whose persisted status is `running`, including simultaneous work from every project. Queue and History remain scoped to the selected Launchpad; this header rail is the intentional cross-project exception.

Each compact card shows the task number, project, Relay or Claude session, live duration, prompt, and latest recorded agent response. `src/running-task-feed.mjs` selects only Codex `agentMessage` and Claude `claude/message` events, so command output, tool protocol, and hidden reasoning never replace the response preview. A task without an agent message says **Waiting for the first agent response**. Clicking a card selects its pinned project when available, returns to Queue and All Relays, and opens the task's complete Task Activity view.

The rail scrolls horizontally instead of compressing or dropping running tasks. Its empty state is the single neutral **No tasks running** message. A running card inherits the deterministic six-color identity of its project for its edge, live dot, task number, focus ring, and hover tint. Codex response ownership remains blue, and only Claude response ownership uses the reserved orange. At 1344px and below the rail moves to its own full-width header row; narrow cards remain horizontally scrollable.

## Execution ledger

The task activity console renders as a realistic terminal on a near-black Tokyo Night background rather than a card ledger. Its palette is defined through `--term-*` variables scoped to `.events-section`, so the dark surface and syntax colors never leak into the rest of the light app, and semantic failure still reads as red. Its hierarchy is:

1. A slim metrics strip (thinking tokens, commands, file changes, messages, errors, active work)
2. A filter toolbar (Highlights, Commands, Messages, All) with Copy log
3. The scrollback: one numbered line per grouped signal
4. The follow-up input prompt line
5. A tmux-style status bar of solid colored segments

Each signal renders in a terminal-idiomatic shape instead of a bordered card. Commands render as a shell prompt line, `~/workspace ❯ <syntax-highlighted command>`, followed by a `✓/✗ exit N · duration · time` meta line and a `▸ N lines` output disclosure with a left-border block. A JavaScript tokenizer (`highlightCommand`) colors the command into program, arguments, flags, numbers, strings, and operators; every token is escaped first. Reasoning renders as `┊ provider reasoned for Xs` when done or `┊ provider thinking▍` with a blinking block cursor while streaming, plus an optional muted italic preview. File changes use `+` create and `~` modify glyphs with the patch behind a disclosure. Final Codex or Claude responses render as a prominent, comfortably sized response block. Commands, file changes, failures, and final messages stay visually loud; queue, protocol, reasoning, and session-lifecycle lines stay dim. Errors and Claude session-busy waiting stay red with output expanded by default. Provider is never the only status cue: kind, glyph, and text differ as well.

The tmux status bar is built inside `renderEventStream` from real task state: a LIVE segment from the session state (only pulsing while actually running), the Relay identity, provider and model, the visible/total signal count, the follow-live toggle, effort, and the live task duration (kept current every second through `refreshTaskDurations`). Unknown segments hide rather than inventing a value. On widths below 620px the lower-priority Relay, provider, and effort segments hide so the bar never overflows, keeping LIVE, signals, following, and duration. The four filter buttons and Copy log always remain in the toolbar with their ids, `data-event-filter`, and `aria-pressed` behavior intact; follow-live lives in the status bar but toggles the same state and stays keyboard accessible.

The right task inspector is a three-row grid: independently scrollable task content, a horizontal drag separator, and the pinned activity terminal. The terminal defaults to the lower 50 percent, spans the full panel width, and manages its own event-list scrolling. Dragging the separator changes terminal height between safe content minimums, keyboard Up and Down adjust it in 20px steps, and the pixel height persists under `relay.terminalHeight`. On narrow screens, the default split uses 45 percent for the terminal.

The task header is intentionally dense: reduced inspector padding, a 20px task title, inline compact metadata, a smaller action button, and tighter Prompt and Result sections. The execution terminal should receive as much vertical room as possible without hiding task context.

The terminal has no title header. Runtime state lives in the slim metrics strip, the compact filter toolbar, and the tmux status bar. Scrollback lines use a small left gutter line number and dense monospace type. This is intentionally an information-dense monitoring surface rather than a presentation card.

Direct tasks place a compact **Continue session** command dock below the event scrollback, styled as the shell input prompt line with a green `❯` caret and the near-black terminal surface. Its context line names the conversation, provider, model, and effort. A finished disposable task shows **Resume available** even after its terminal has closed. Sending creates a linked queue task, while **Conversation busy** prevents two queued or running owners of the same saved conversation. The multiline `textarea` expands only to 92px, Enter sends, and Shift+Enter adds a line. It remains editable while submission is unavailable and is disabled only during an active request. Codex uses blue and Claude uses its reserved orange identity accent. The dock is hidden for Plan council and Turbo.

Finished disposable submission requires `capabilities.resumableDisposableSessions` and calls `/api/tasks/:id/follow-up`, which returns the linked task. Finished legacy submission requires `capabilities.taskDirectFollowUp` and starts the next turn in the original live session. When current UI assets run against an older backend, the dock shows **Restart required** and disables Send instead of calling the ordinary Execute endpoint. Running Codex steering is separately gated by `capabilities.taskSteering`.

Task-detail requests use `taskLoadSequence`. A newer card selection invalidates every older in-flight detail response, and the continuation dock hides while selection changes. Without this guard, polling and a fast user selection can resolve out of order and expose a follow-up input bound to a different task than the selected card.

Prompt and Result use compact evidence disclosures in the upper task pane. Their summaries retain a truncated preview so the important context remains visible when collapsed. A newly selected task collapses Prompt and opens Result only when an outcome exists, leaving more room for live execution and continuation without discarding the complete stored text.

Codex agent-message lines also omit their repeated provider, title, state, and timestamp header. Their full response text renders directly in the prominent response block without the long-message disclosure wrapper. Commands, file changes, errors, tools, and non-Codex providers retain their signal-line header because their execution metadata remains useful.

Direct Codex and Claude response bodies use `font-weight: 650` through `.detail-panel .event-list .term-response-body`. This stronger weight is reserved for text written directly by the AI. Commands, reasoning, queue protocol, and generic event messages remain regular weight so the response stays visually distinct from its execution trace.

The **Continue session** dock includes one low-contrast, icon-only image action between its textarea and Send button. Follow-up images may also be pasted. The four visual grid items are the generated terminal caret, flexible textarea, image action, and Send button, so the final override must use `auto minmax(0, 1fr) auto auto`. The dock deliberately avoids thumbnails and hides image metadata until an image is attached; it then shows a plain image count and **Clear images**, while the submitted task detail remains the durable visual list. Image drafts follow the selected task just like text drafts.

> [!important]
> Do not define only three columns for the continuation prompt row. Its generated `::before` caret participates in grid layout and otherwise pushes Send onto a second row while shrinking the textarea.

Expanded terminal disclosures persist across live polling and filter rerenders. Each event article exposes its stable grouped-entry ID, while each nested `details` element is keyed by its index inside that event. A capture-phase `toggle` listener updates `state.expandedEventDetails`; render snapshots current DOM state before replacement and restores matching disclosures afterward. The set is cleared only when selecting a different task.

Expanded command output has its own nested scroll container. Before live polling replaces event markup, Relay records each output's vertical offset and whether it was already near the bottom, keyed by the same stable event and disclosure identity. After rendering, it restores the exact offset for inspected output or follows the new bottom only when that individual output was already at the bottom. Selecting another task clears these positions.

Expanded command output must use the opaque `#0c0e17` terminal surface. The app-wide `pre` rule is intentionally light for task evidence, so the terminal override uses `.detail-panel .events-section .event-output > pre.event-output-content` and an explicit opaque background color. Keep the subtle blue-gray inset edge, but do not turn command output into a white or translucent light card.

## Task artifact copy actions

Prompt, Result, Claude draft, Codex review, and Final revised plan each expose a compact **Copy** action in Task Activity. Copy uses the stored source text, so Plan council Markdown remains intact instead of being flattened from the rendered document. Result copies the task error when an error is the visible outcome. Pending or absent content disables its action, and selecting another task clears the prior copy payload before the detail request resolves.

> [!important]
> Keep copy payloads separate from rendered `innerHTML`. Plan draft, review, and final plan must copy `plan.draft`, `plan.review`, and `plan.finalPlan` directly.

The terminal defaults to the **All** filter so the complete task activity is visible when a task opens. All includes Codex reasoning summaries while they stream. Relay consumes `item/reasoning/summaryTextDelta`, accumulates each summary part by item ID, and publishes `item/updated` snapshots that the browser folds into one live reasoning entry. Reasoning remains excluded from Highlights to keep that optional view compact. Relay intentionally displays only the model-provided summary stream, not private hidden chain-of-thought.

Codex `thread/tokenUsage/updated` notifications are retained in the eventual `turn/completed` task event. The console metrics show the task's summed `reasoningOutputTokens` as **thinking tokens**. This is usage telemetry only and does not expose private hidden chain-of-thought. Older completed tasks recorded before this support show zero because their persisted events contain no token snapshot.

Task reference images render as compact 64px square thumbnails, falling to 56px on narrow screens. Filenames and file sizes remain available through the image link and accessible image alternative, while only the sequence number overlays the thumbnail.

The composer accepts up to 99 reference images per task. The independent safety limits remain 5 MB per image and 20 MB total, so the higher count supports collections of small screenshots without increasing the maximum request payload.

> [!important]
> Keep scrolling separated between `.task-detail-scroll` and `.event-list`. Restoring scrolling on `.detail-panel` makes the terminal move away from the bottom and breaks the monitoring layout.

> [!important]
> Preserving only `.event-list.scrollTop` is insufficient. Command output scrolls inside `pre.event-output-content`, and replacing that node during polling resets it unless its position is captured before `innerHTML` replacement and restored afterward.

> [!note]
> Motion is limited to the running-event LIVE pulse and the blinking reasoning and input cursors. All of it is disabled under `prefers-reduced-motion: reduce`. The continuously updating event list carries no decorative animation.

> [!important]
> The terminal must give each sub-surface (`.events-section`, `.event-metrics`, `.event-toolbar`, `.event-list`, and `pre.event-output-content`) its OWN opaque dark background, not rely on one container background showing through. A dark dock and status bar sitting over a white metrics row, toolbar, event list, or command output is the signature of a missing terminal override or partially cached `style.css`. Opaque per-surface backgrounds keep the terminal dark even under a partial cache. When the terminal looks white, hard-refresh (Cmd+Shift+R) or restart Electron before assuming a CSS regression.

> [!important]
> A running Codex task uses the structured app-server `turn/steer` protocol against its exact active turn. A non-running disposable task creates linked queue work that relaunches and resumes the saved conversation. Only the legacy persistent path starts the next turn against an already open session immediately.

## Execution settings

The Model control remains a native select for reliable keyboard and platform behavior, wrapped in a styled shell that supplies the visual surface, focus ring, and chevron. Reasoning effort remains the compact slider mapped directly to the selected model's ordered `supportedReasoningEfforts`. There is no synthetic **Model default** stop. A newly selected model starts on its declared default effort, or its first supported effort when no declared default is available, and Relay stores that explicit effort string.

All model selectors listen to `input`, not `change`. Direct execution, Plan council, and both Turbo model roles therefore update their state, supported effort options, defaults, validation, and submit readiness as soon as the highlighted model changes. Do not move model handling back to `change`, which can wait until a native picker closes or loses focus.

The composer has two workflow tabs: **Execute** and **Forward-planning Turbo**. Plan council is not a standalone tab. Execute contains an unchecked **Use Plan council for this prompt** option that reveals its Claude author, Codex reviewer, Claude revision route and readiness row. The copy states that this creates a reviewed read-only plan instead of direct execution. Enabling it selects Codex for the required review Relay, hides direct model and effort controls, and changes the primary action to **Build reviewed plan**. Provider tabs remain interactive. Choosing Claude turns Execute Plan council off and continues as direct Claude execution. Leaving Execute or successfully submitting also resets the option to off.

In automatic mode, direct Model and Effort state belongs to the selected provider inside the active project's composer snapshot. Fresh tasks have no terminal ID to own settings. The legacy compatibility path keeps `threadExecutionSettings` independently for each live Codex or Claude session.

The Effort slider updates terminal state during the `input` event. At direct submission, Relay maps the rendered slider index through its `data-values` array and copies the resulting effort string back to terminal state before building the request. The server then validates that exact model and effort pair against the corresponding provider catalog.

Submission snapshots the visible Model and Effort before awaiting idle-Relay discovery. When idle routing chooses a different terminal, Relay writes that same snapshot to the destination terminal. After enqueue succeeds, the task response is authoritative: its accepted `thread_id`, model, and effort are remembered again before the post-submit refresh. This prevents an `xhigh` task card from being followed by a `low` composer slider on the Relay that received it.

Terminal execution settings carry a provenance of `default`, `task`, or `user`. Initial rendering may create a `default` entry before task history finishes loading. `hydrateThreadExecutionSettings()` must replace that provisional value with the newest persisted Execute task for the terminal. A `user` entry represents a new unsent choice and must never be overwritten by history polling. A successful submission changes it to the server-confirmed `task` value and records the task ID for monotonic hydration.

Direct execution presents Model and Effort as compact horizontal controls below the automatic pool controls, or below the Relay picker on a legacy backend. Each control keeps its short identifier and hint on the left while the interactive surface occupies the remaining width. The model select is 28px tall, while the slider retains its value and step markers.

The slider footer shows only the current effort name on the left and one compact dot per supported effort on the right. Do not render every effort name across the footer because six-value model catalogs overflow the compact card. Each dot may expose its name as a title, while the range input reports the selected name through `aria-valuetext`.

> [!important]
> Never infer a fixed effort scale in CSS or markup. Models expose different effort lists, so `renderExecutionControls()` must rebuild the slider maximum and its index-to-value mapping whenever the provider, terminal, or model changes. Never submit the numeric range value as effort.

> [!important]
> Idle routing separates the terminal selected when the user presses submit from the terminal that receives the task. Execution state must be applied to both the selected terminal and the accepted destination terminal. Do not wait until after asynchronous routing to read the slider.

> [!note]
> Live verification against the Relay server selected the `vector-algo` project and Relay thread `019f802a-69da-7930-8b33-cba43dee1f0b`. The slider restored `xhigh` from task 171. Changing it locally to `ultra` remained `ultra` after the four-second thread poll, proving task hydration does not overwrite unsent user state.

## Terminal launch layout controls

On a current backend, the composer shows Codex and Claude provider tabs plus per-project maximum instance inputs. It shows each provider's active count and does not require a live Relay selection. A fresh task waits for capacity, launches the terminals required by its workflow, and closes those exact owned launches when it ends. **Settings** still opens the native dialog for launch layout and diagnostics. The project launchpad retains manual **Launch Codex** and **Launch Claude** actions for interactive sessions.

The former shared Relay picker, composer launch buttons, and **Close selected terminal** row are compatibility UI for a backend without `capabilities.disposableTerminalPools`. In that view the close row names the selected session, explains its complete availability reason, and permits closure only for an idle session with an exact native handle. The button, label, and reason are derived by `public/terminal-close-state.js`, whose pure-state tests protect all visible states.

Plan council shows the selected project's Claude and Codex capacity. It needs one slot from each provider and launches both terminals as one atomic workflow reservation. The legacy composer exposes separate Claude author and Codex reviewer terminal selectors only when the automatic pool capability is absent.

Task Activity presents the saved draft, independent review, and final revision as separate readable sections, but only the final revision becomes the canonical Markdown artifact. The final section always shows its exact project-local `plan.md` path. A current backend adds **Open plan.md**; an older backend keeps the row visible as **Restart to open**. When the final plan exists, a cool-blue step **04** appears immediately after the council stage rail, before the long plan sources. It contains a Codex or Claude provider choice and queues execution through the selected project's disposable pool. The detail header repeats **Execute plan** as a shortcut that scrolls to the handoff and focuses its actionable control. A failed disposable council retry also relaunches and resumes its saved provider conversations through the pool.

> [!important]
> Do not reintroduce a required live-terminal picker into the current composer. New work is assigned to a project and provider pool. Existing sessions appear only in the legacy compatibility path and task history.

The terminal window grid controls in the settings dialog use a two-level layout. A full-width heading row contains the grid enable switch, followed by compact column and row inputs and a flexible monitor selector. This keeps the switch label readable and gives the monitor name the remaining width without allowing it to crowd the other controls. Below 760px, the monitor selector moves to its own row.

The persisted **Launch behind other windows** checkbox applies to every native launch path, including project cards. Relay omits Terminal activation and minimizes the captured new Terminal.app window on macOS. It starts `cmd.exe` with PowerShell's minimized window style on Windows. The option shares `relay.terminalLayout` storage with the grid settings and travels in the existing launch request object.

On macOS, each grid launch inspects the bounds of currently open Terminal.app windows and places the new window in the first unoccupied cell. Closing a terminal therefore frees that exact cell for the next launch. The launcher's in-memory rotating slot remains a fallback when Terminal window inspection is unavailable or every cell is occupied.

Codex and Claude share the same grid and slot sequence. Provider selection changes only the launched command. Terminal.app receives the selected bounds immediately, then Relay reapplies them to the captured new window after a short startup delay because full-screen terminal clients such as Claude can resize their window during initialization.

Native terminal launches are serialized inside `ProjectLauncher`. This is required even when browser requests arrive concurrently: slot inspection, window creation, and slot reservation must complete as one launch operation, otherwise several requests can observe the same empty cell and overlap. On macOS, `do script` returns the newly created tab. The AppleScript resolves the owning window by matching that exact selected tab, captures its numeric ID, and uses the stable ID for both bounds assignments. Terminal focus is not reliable enough to identify a newly launched window, so a delayed bounds assignment must never target the dynamically changing front window.

> [!important]
> Do not use only a monotonically advancing slot counter for Terminal.app. It cannot observe closed windows and eventually creates gaps or overlaps after normal close-and-reopen use.

> [!important]
> Do not remove the per-launch queue or identify the launched Terminal window through `front window`. Both changes reintroduce overlap when multiple launches are requested together. Retain the `launchedTab` ownership lookup and captured numeric window ID.

> [!note]
> Keep the column and row controls at stable compact widths on desktop. The monitor selector is the only field that should grow because display names and resolutions vary.

> [!important]
> Background launch must target only the newly created window. Hiding Terminal.app itself would also hide unrelated interactive terminals.

## Connected terminal cards

Connected terminal cards use two information rows. The workspace name and status form the primary row; the task preview and terminal metadata share the secondary row. Icons and selection marks stay compact so a connected session does not dominate the composer vertically.

On desktop, the terminal list uses a fixed three-column grid so three Relay workers sit in one row. Each card stacks its task preview and terminal metadata beneath the primary name and status row, with long values truncated inside the tile. Below 760px, the list returns to one column for readable touch targets.

The disconnected terminal empty state spans the complete terminal grid. It must not inherit the width of one worker column, because its explanatory copy becomes unreadably narrow when the desktop list has three columns.

Codex terminal cards render the persisted `relayName` and `relayNumber` fields, normally **Relay 1**, **Relay 2**, and so on. The labels are global to the Codex thread, not the current project or discovery array, so inserting or reordering terminals cannot change a name or number. They are also drop targets for queued task cards. The terminal section uses one compact heading row for its title, followed by the status text and task-routing options without the previous oversized fieldset spacing.

> [!note]
> Queue state and terminal discovery update automatically. Do not expose manual Refresh controls or instruct users to refresh. Server-sent events update queue changes immediately, visible-page polling repairs missed events, and terminal discovery runs silently in the background.

Relay cards derive their visible activity from task ownership rather than relying only on the provider thread title. A running direct task shows its task number and prompt, Turbo participants identify planner or worker role, an idle terminal with assigned work shows its waiting count and next task, and a free terminal says it is ready. The state badge follows this derived running, queued, or idle state.

Turbo queue cards retain the canonical `queued` or `running` status badge and add a compact secondary forward-plan stage badge. **Forward plan** means a queued Turbo parent has no reusable graph yet, **Planning ahead** means its queued graph is currently being prepared, **Plan ready** means a validated graph will bypass the planner at execution time, and **Workers running** means the parent is executing its graph. Complete and failed variants are terminal signals only. The stage badge is width-constrained so it cannot expand the task card.

Planner terminal activity follows the persisted lifecycle: a planner preparing a queued parent reads **Planning ahead · Task #n**, current worker terminals read **Turbo worker · Task #n**, and the original planner reads **Idle · Ready for work** after the parent graph reaches `executing`. If that same thread is preparing another queued parent, the look-ahead label takes precedence.

Connected Codex Relays use a repeating six-color identity palette based on their persisted Relay number. The readable `Relay n` name and task-card footer ownership label use the full accent. Unselected Relay selector cards use the matching soft background. Hover strengthens the tint slightly, while selection uses the Relay accent for the border, radio control, and a stronger tinted background. The palette deliberately contains no orange slot: Relay 4 uses sky blue, and orange remains reserved for Claude identity. The old heavy colored left stripe remains removed, and task cards remain neutral apart from their Relay ownership text. Status colors remain semantic and do not inherit the identity accent. Relay selector titles contain only the readable `Relay n` name; workspace and session metadata live in the bottom text row. The running, queued, or idle badge sits beneath the provider icon at the lower left, outside the text column, so status does not add a fourth text row or increase card height.

Relay selector titles use the Instrument Sans body face at a firm interface weight. They intentionally do not inherit Source Serif 4 from the display token, because worker names are operational controls rather than editorial headings.

> [!note]
> Connected task owners reuse the persisted Relay name color in their footer label. Historical owners without a connected Relay use neutral text because no live color can be applied safely. Relay colors come from the thread's immutable `relayNumber` through the six-color palette; they never depend on the current connected-terminal ordering. See [[task-history]].

> [!important]
> Do not assign colors or labels from the visible terminal index. Use the thread's persisted `relayNumber` for `relay-color-1` through `relay-color-6`, and use `relayName` as the display text. A disconnected or historical thread without a live identity stays neutral rather than receiving a guessed Relay number.

> [!note]
> Keep preview and metadata independently truncated. Long prompts, paths, and session identifiers must not widen the card or force an extra line.

## Turbo fleet and dispatch graph

Turbo task cards keep their canonical task status and forward-plan marker, then add one compact fleet manifest. The manifest reads **Planner** followed by one planner identity, an arrow, **Executes on**, and the ordered worker identities. A connected Codex thread is identified as **Relay n** and receives its existing `relay-color-n` class. A disconnected or historical thread uses its persisted title in a neutral chip. The renderer must not invent a Relay number from a worker slot or an old title. The manifest wraps within the task card and stays secondary to task status.

The detail graph is an operational dispatch ledger rather than a dashboard. A thin progress bar exposes an accessible `progressbar` label and complete-package count over the total. Each package is a compact dispatch ticket with a uniform outline, a state port, monospace package ID, title and dependency status, and a right ownership stamp. State is communicated by the outline, surface tint, and state port, never by a colored left border. The state port shows a check for `complete`, an accessible spinner for `running`, an error mark and message for `failed`, and a neutral ready or blocked state for `pending` packages. Ownership stamps use live Relay identity colors only when the matching connected thread is present; historical titles remain neutral.

> [!important]
> Dispatch tickets are owned by the final `.turbo-graph-*` rules. Do not reintroduce broad legacy selectors such as `.turbo-task-graph article` or `.turbo-task-graph article > span`: their higher specificity collapses the narrow layout, makes both state and ownership elements span rows, and truncates the package copy. The current ticket uses a compact state, copy, and ownership grid, with ownership moving below the copy only at the narrow breakpoint.

While an active Turbo plan has no graph packages, the progress header says **Planning dependency graph** instead of presenting the meaningless `0 / 0 complete`. It uses an indeterminate progress sweep, and three restrained skeleton tickets communicate that work is still arriving. The progressbar omits `aria-valuenow` while indeterminate and announces that planning is in progress. A running parent with no persisted graph is also treated as planning because workers cannot start without a validated graph.

Running tickets use one small comet-ring spinner and no additional pulse or dashboard animation. Live polling replaces graph markup, so the renderer seeds its negative animation delay from `performance.now()` to preserve the spinner phase across replacements and prevent an apparent frozen loader. The planning indicator, running spinner, and skeleton sweep stop under `prefers-reduced-motion: reduce`. At the narrow breakpoint, the ownership stamp moves below the ticket content, and all graph text remains `min-width: 0` with ellipsis so the graph cannot widen or overflow the detail panel.

## Turbo council route

The Turbo composer keeps the optional Plan council as one compact route. Its unchecked **Use Plan council for this prompt** option sits beside a keyboard-accessible question-mark button. The disclosure explains that the selected first provider creates the JSON graph, the second checks and corrects it, workers wait, the pass adds time, and Claude CLI sign-in is required.

> [!note]
> Execute and Forward-planning Turbo wrap their optional Plan council controls in the same compact neutral review surface. The shared surface uses a 12px radius, quiet gray-blue border, white toggle row, the **Optional review / Plan council** heading, and a pill-shaped **2 providers** badge. Checked state uses one soft blue focus treatment instead of nested blue outlines. Keep provider identity colors inside the expanded route only.

> [!important]
> Both workflows use the same `.plan-council-option` and `.plan-council-toggle` component structure, the same primary label, and the same checked and focus states. Turbo may add only its help disclosure and workflow-specific supporting sentence. `test/composer-workflows.test.mjs` protects this shared contract.

When enabled, both workflows use the same rounded provider nodes, 3px provider accent rails, numbered **Author** and **Reviewer** roles, agent icons, rounded model and effort controls, and central review handoff. The handoff is a thin line with one circular arrow marker, which is the route's signature visual and makes the execution sequence readable without extra decoration. Execute adds its compact Claude revision strip and readiness pills. Turbo adds only its **Codex first / Claude first** segmented control and swaps node order and role copy. Codex keeps its selected planner model and effort; Claude uses its catalog-backed model and normalized effort. Worker settings remain separate. Disabled routes are hidden in both workflows, and the expanded route collapses to one column on narrow screens.

The switch is unchecked by default, so disabled Turbo keeps its existing planner-to-worker behavior and does not require Claude availability. Enabling it adds one quality pass and latency before workers start. Reviewer readiness uses the selected Claude catalog and signed-in CLI state. Execute and Turbo keep independent per-prompt council switches.

Turbo task metadata states the selected provider order before workers. During `planning` and `reviewing`, copy identifies the provider that owns the current stage. A Codex Relay appears busy only while Codex owns that stage; it remains visually idle during a Claude stage. Queue and detail labels keep **Council review** alongside the canonical task badge.

## Task card footers

Task cards use one compact footer row below a single divider. The left side combines model, explicit effort or `default`, optional image count, and workspace. The right side combines the status dot, live or final duration, and a `DD Mon HH:mm` timestamp. Completed durations omit a redundant `Took` prefix. Do not restore separate execution and workspace rows.

Queue containment is explicit at the panel, list, and card levels with `min-width: 0`; the list and cards also remain constrained to their available width. Prompt text keeps its three-line clamp and uses `overflow-wrap: anywhere` so long prose or uninterrupted tokens cannot widen the middle workspace column or render beneath the task activity panel.

Task states use one final semantic palette at the end of the stylesheet cascade: running is purple, queued is slate-blue, complete is green, failed and interrupted are red, and cancelled is neutral gray. Both the badge and footer dot follow the same state. Queued uses a blue badge and blue outlined waiting dot, while cancelled uses a gray badge and solid gray terminal dot, so the two states remain distinct without relying on text alone. The shared `--running` and `--running-soft` tokens also drive project activity, Relay status badges, header activity, planning stages, and terminal events. Orange is reserved for selectors explicitly owned by Claude. Keep this correction after legacy task-card rules so Running, Queued, and Cancelled cannot collapse into similar colors again.

## Interaction polish

The 2026 visual system moved the primary accent from the earlier signal green to blue, but several hover, selected-tint, and empty-state values were left in the old desaturated-green family, so interactive surfaces read slightly off against the cool neutral lines and mist background. A refinement pass finished that migration without touching the layout or the execution ledger.

Residual green interaction states are neutralized to the cool blue and neutral system: the generic `.button` hover, the `.text-button` hover, the `.mode-tab` hover, the base `.terminal-option` hover, the attachment dropzone and queue-reorder hover backgrounds, the empty task-activity glyph, and the disconnected-terminal empty state. The `--blue` and `--muted` token gaps are closed by aliasing them to `--signal` and `--slate`, which restores the parallel batch bar accent stripe, the parallel and idle-route checkbox accent colors, and the muted terminal-settings labels and close glyph.

App-chrome controls share one quiet 140ms color and shadow transition so hover, focus, and selection settle instead of snapping. Destructive `.button.danger` actions gain a red-tinted hover so Cancel, Delete, and Close read as consequential, the persistent header action lifts within its own navy family, and the primary action carries a single soft same-hue shadow lift with the disabled state kept flat. The dark Tokyo Night terminal, its follow-up dock, and every `.events-section` descendant are intentionally excluded.

> [!important]
> Residual green hover rules must be edited in place, never appended at end of file. `.mode-tab:hover` and `.mode-tab.selected` share specificity, as do `.terminal-option:hover` and its `relay-color` and `.selected` overrides. Because the green hover sits before the later blue selected rule, source order keeps the blue selected border while hovering a selected tab or terminal. An appended equal-specificity `:hover` would come after the selected rule and silently drop that accent on hover. Genuinely new rules (the `--blue` and `--muted` aliases, the danger and header hovers, the primary shadow, and the shared transition) are appended because no competing declaration exists.

## Round 2 layout revisions

A second design round restructured the three areas the operator called out ("the tasks in header are terrible, the launchpad also, I need much more space there in the launchpad") beyond CSS, into markup, while every capability and DOM contract was preserved.

**Header running-task monitor.** The rail is no longer a persistent bordered pill. `.header-running-tasks` is now a transparent horizontal scroll track, so its empty state is a compact content-hugging `.header-running-empty` chip (a hollow dot plus **No tasks running**) that reads as a quiet status line rather than a large void, at every width. At and below 1344px the rail moves to its own row and the empty chip stays left-aligned so the full-width row cannot become a new empty band. A running card is a three-tier grid: a mono meta line (`#256`, project · Relay, live duration), the prompt as its title, and the latest agent response tagged with its provider. `.header-running-response` and `data-running-task-id` stay intact (composer-workflows asserts them); the old `.header-running-task-topline` and bare `> strong` classes were renamed to `.header-running-meta`, `.header-running-loc`, and `.header-running-prompt`, updated in both the stylesheet and `renderHeaderRunningTasks`. Project identity color owns the edge, live dot, and task number; provider tags stay blue for Codex and reserved orange for Claude. The desktop header is 84px high so the three-tier card fits without stealing meaningful workspace.

**Launchpad as a compact card rail.** The dock uses a `.project-dock-bar` heading row above one horizontal `.project-list` rail. Each desktop `.project-chip` is exactly 42px high and 330px wide. Its grid areas are `head activity close`: initial, colored name, and path on the left; status-led activity in the center; and unpin fixed to the far-right edge. Project cards contain no Codex or Claude launch actions. Activity always exposes a concise state first, then the relevant task detail. The project name, tile, selected outline, and header task share the collision-resolved color produced by `public/project-colors.js`; up to six pinned projects receive different palette slots. The rail scrolls horizontally when projects exceed the available width and hides vertical overflow, so a second card row cannot be clipped by the fixed dock. The project selection hooks and last-project unpin guard remain unchanged. Below 760px, each card fills the viewport while preserving the same far-right close column.

**Vertical budget.** The compact desktop geometry is header `84px`, dock `104px`, `.workspace height: calc(100vh - 188px)`, and the legacy bounded `.task-list height: calc(100vh - 288px)`. These four must move as a set; the header plus dock total feeds both viewport offsets.

> [!warning]
> Reducing only the dock height is not a valid compacting strategy. The failed 124px revision retained two-row project cards and clipped their activity and launch controls at the dock boundary. Card structure and viewport offsets must be changed with the dock height.

**Launchpad cascade consolidation.** Rather than stack a fifth override layer, the operative launchpad CSS was consolidated into the base `.project-*` block and the conflicting 2026 project overrides were deleted (only the neutral `.project-dock-actions .button` height and the `#add-launch-project-button` accent were kept). The stale horizontal-flex responsive project rules in the older `max-width: 1180px` and `max-width: 760px` blocks were removed since the grid handles wrapping.

**Composer and queue polish (light touch).** `.mode-tab strong` now wraps instead of truncating, so **Forward-planning turbo** always reads in full while `.mode-tab small` still ellipsizes. The queue heading no longer wraps: `.queue-panel > .section-heading` gains `flex-wrap: wrap` and its `h2` is fixed at `23px` with `white-space: nowrap`, so **Task queue** stays on one line and the Queue/History and scope controls drop to their own row only when the middle column is tight. The protected Plan council shell, execution controls, and terminal picker were left structurally intact.

## Composer add-task reliability

Adding a task must always work and must feel immediate. Four separate things in the
composer could block it, lose it, or make it look frozen. All four are fixed, and the fixes
constrain future edits.

**Submit is gated on input validity only.** `composerValidationIssue` disables the button
for an empty prompt, no selected Relay, or attachments over the limits, and for nothing
else. It deliberately never reads `state.threads`.

> [!warning]
> Do not reintroduce liveness into the submit gate. `state.threads` is replaced wholesale
> every four seconds and on every SSE `threads` change, so gating on it made the button
> flicker to disabled and produced **Choose a connected terminal before sending** for a
> session that was in fact connected. Plan council readiness and the Turbo worker count are
> validated at submit time, where the message can be exact and a stale process list cannot
> block a valid prompt.

**A submission in flight owns the Relay selection.** `renderThreads` reads
`state.submitting` into `selectionLocked` and, while a submission is pending, only paints.
It does not reassign `state.selectedThreadId` and does not flip `state.selectedProvider`.
Before this, a background poll landing between Enter and the POST could send the task to a
different Relay than the one the user picked, and the pre-POST idle settle loop, which
polls threads itself, could do it too. That loop now refreshes with
`loadThreads({ render: false })`.

**The prompt survives failure.** Nothing inside the submit `try` clears the prompt or the
attachments. The POST result is captured into `createdTask`, and only after
`if (!createdTask) return` does the composer clear and the refresh run. The refresh uses
its own `catch` writing to `#queue-summary`.

> [!important]
> `await load()` must never sit inside the submit `try`. It previously did, after the
> prompt had already been cleared, so a refresh hiccup reported a task that had been
> created successfully as a failed add and the user lost their text at the same time.

The refresh is `load({ fresh: true })`. Concurrent refreshes still deduplicate, but a
caller that has just written chains a new snapshot after the in-flight one instead of
joining it, because a snapshot requested before the task existed does not contain it and
`loadSnapshot` would then discard the new selection.

**Failures have their own region.** `#composer-alert` sits inside `#task-form` above the
footer, `role="status"` and `aria-live="polite"`, hidden when empty. `#form-message` remains
a shared channel written by terminal launch, terminal close, diagnostics, and the plan
council toggles, so a submit failure written there could be overwritten by unrelated
activity. `setComposerAlert` takes a kind: a `validation` complaint clears as the user fixes
it, a `failure` from the server stays visible until the next attempt, because it is the only
record that the prompt still in the box was never accepted.

**Requests are bounded.** `api()` carries an `AbortController` with a 20 second default and
45 seconds for task creation, which also accepts image data. Without it a hung fetch left
`state.submitting` true forever: the button stuck on **Adding task**, Enter a silent no-op,
and no recovery except a reload.

**In-flight feedback.** `#task-form[data-pending="true"]` softens the prompt field and the
attachment composer and sets a progress cursor on the button, and the form carries
`aria-busy`. The prompt stays editable so nothing typed is lost.

> [!note]
> The in-flight disable and the quiet no-op on a repeated Enter are deliberate and stay.
> They are progress, not a rejection. Removing them reintroduces the false missing-terminal
> report from task 274, recorded in [[task-history]]. Equally, a successful submission still
> selects the new task and opens its details; the rule about not moving the activity panel
> applies to background refreshes, not to the user's own submit.

**The retry keeps its identity.** The submission signature identifies the intent, the
prompt and the routing that carries it, and deliberately excludes `runNow` and
`preferIdleTerminal`. Ctrl+Enter, an ambiguous failure, then a plain Enter retry is one
intent and reuses one UUID, so a first POST whose response was merely lost cannot become a
second task. The rule lives in `public/submission-intent.js` and is unit tested. See
[[duplicate-submission-review]].

**Idle routing has two implementations.** When the backend advertises
`capabilities.dispatchIdleRouting`, the browser posts immediately with the user's visibly
selected `threadId` plus a `preferIdleTerminal` boolean, and the server picks a free Relay
at dispatch. The preference is off for Plan council and for Ctrl+Enter **Run now**, which
keeps pinning to the selected Relay. An older backend keeps the client settle loop, which
is the only thing that can delay task creation: it waits up to three seconds for a
just-launched Relay to connect, so a task is not pinned to the busy Relay the user is
looking at. `settleIdleSubmissionThread` and its two `IDLE_SETTLE_*` constants are written
to be deleted in one piece once the capability is universal; it has a single call site.

## Unknown is not unavailable

Two backend states must never be rendered as an outage.

**Boot-time provider probes.** Codex and Claude are both probed in the background after
listen, so for the first moment after every Relay start `/api/status` reports
`available: false` with `pending: true` on the provider object. The header pill renders
that as the neutral `checking` state with **Checking Relay**, and `claudePlanIssue` returns
**Checking the Claude CLI** before it will say the CLI is unavailable. Rendering pending as
unavailable opened every launch with a false broken-backend banner. The checking dot needs
no CSS: the base `.live-dot` is already neutral grey and only `online` and `offline`
recolor it, which is why `index.html` ships with `data-state="checking"`.

> [!important]
> The checking state must not mask a genuine outage. It applies only while a provider is
> still `pending`; once a probe answers with `pending: false` and `available: false` the
> pill returns to **Relay unavailable**. Both transitions are covered by tests and were
> confirmed against the running app.

**Stale Claude discovery.** A failed `claude agents --json` probe no longer implies an
empty session list. The registry keeps its last known good sessions, sets `lastError`, and
marks itself stale, so sessions and an error now arrive together. The sessions stay listed
and selectable and `claudeDiscoveryNote()` appends one quiet sentence to `#session-message`
saying the list may be out of date and that Relay retries automatically. The frontend
derives staleness from the error plus the presence of Claude sessions, so no extra API
field was needed.

See [[parallel-project-queues]] for what several simultaneously running tasks changed in the
header counts, the inferred activity selection, and the parallel batch guard.

## Planner dependency board

The Planner dialog grew from `min(1060px, 100vw - 32px)` to `min(1400px, 100vw - 32px)`. A wave
of steps carrying an editable title, an editable prompt, and a dependency picker does not fit the
old width, and the surface stays inside the `terminal-settings-card` shell using only `planner-*`
classes. See [[planner]].

Steps render as compact dispatch tickets in the **same visual language as the Turbo graph**
without reusing its selectors: a `auto auto minmax(0, 1fr) auto` grid of selection checkbox,
circular state port, copy column, and quiet controls, with a uniform outline plus a soft surface
tint per state and no colored left border. Waves are labeled groups; the wave currently executing
carries `data-active="true"` and the running tint. State is never carried by color alone: the port
glyph, the chip label, and the dependency sentence all change with it.

Step status uses the established semantic palette exactly: running purple, complete green, failed
red, blocked amber, cancelled neutral gray, queued blue. Orange is not borrowed, it remains Claude
identity. `retrying` deliberately takes the running tone with its own label and an inset ring,
because it is work still in flight rather than a failure.

> [!important]
> The app-wide `textarea` rule sets `min-height: 168px` for the composer prompt. Every compact
> Planner input must opt out of it (`.planner-field textarea` and `.planner-step-prompt`), or a
> three-row field renders as a tall empty block and one step ticket fills the dialog.

> [!important]
> Do not re-render the Planner board from the live poll. Board markup is rebuilt only when
> `plannerBoardSignature` changes; the 2.5 second refresh calls a targeted updater that writes
> `textContent` and `dataset` on existing nodes. Replacing `innerHTML` over a board full of
> textareas destroys the caret, the IME composition, and the native undo history on every poll,
> and it restarts the running spinner. The state port is the single exception and is rewritten
> only when that step's status actually changed.

Run progress is announced through one dedicated `#planner-run-announce` live region, written only
when its sentence changes. `#planner-detail` carries no `aria-live`: it is replaced whenever the
board structure changes, so making it a live region announces the entire dialog on every refresh.

At 900px the ticket controls move to their own row below the copy, which is the same narrow-width
behavior the Turbo dispatch tickets use. At 760px the plan sidebar moves above the detail and the
run controls stack. At 480px the dependency picker becomes a single column, the wave heading wraps,
and the plan brief shortens. The board never scrolls the dialog horizontally at any of these
widths. The step spinner and the progress-bar transition stop under `prefers-reduced-motion`.

## Provider tabs with integrated pool steppers

The composer no longer repeats each provider twice. The former **Automatic terminal pool** block
held two wide cards that showed the same icon, provider name, and usage count as the provider tabs
directly above them. The per-project maximum now lives inside the provider tab itself, and the
section below keeps only its heading row, **Settings**, the session message, and one quiet
lifecycle sentence.

Each entry in `#provider-tabs` is a `.agent-tab-shell` wrapper holding two independent siblings:

1. `button.agent-tab` keeps `id="provider-codex"` or `id="provider-claude"`, `role="tab"`,
   `aria-selected`, `aria-controls="terminal-panel"`, `data-provider`, the `selected` class, and the
   roving `tabindex`. `renderProviderTabs()` and `selectedExecutionProvider()` still read exactly
   these attributes, and `document.querySelectorAll('.agent-tab')` still returns only the buttons.
2. `div.agent-tab-pool` holds the `Max` caption and `#max-codex-instances` or
   `#max-claude-instances`.

> [!important]
> The stepper must stay a sibling of the tab button. A form control nested inside a button is
> invalid markup and swallows its own events. As siblings, a click, focus, keystroke, or spinner
> press on the stepper never reaches provider selection, and arrow keys inside the number field
> never move between tabs.

Enter inside a stepper is prevented and blurs the field instead. Both inputs sit inside
`#task-form`, so an unguarded Return would implicitly submit the composer and queue the prompt.
Blurring commits the value through the same `change` listener that saves the project limits.

`.agent-tab-shell` paints the card frame, the hover state, and the selected border and tint through
`:has()`. The selected provider name also takes its provider color, so selection never depends on
`:has()` alone. `.agent-tabs` sizes itself with `repeat(auto-fit, minmax(184px, 1fr))`: the two
cards sit side by side in a normal composer and stack to full width once the panel is narrower than
about 378px, which covers the 360px composer minimum and the 420px page width without truncating
the usage count.

`#codex-pool-usage` and `#claude-pool-usage` still exist inside each stepper as `.sr-only`
`aria-hidden` elements so `renderAutomaticTerminalPool()` keeps a valid write target. The visible
count belongs to the tab, and nothing states it twice. `#terminal-pool-controls` survives as the
single lifecycle sentence and keeps the `hidden` toggling that separates automatic and legacy
modes. On a legacy backend the whole tab container is hidden, so the steppers disappear with it and
the Relay picker path is untouched. See [[disposable-terminal-pools]] and [[project-workspaces]].

#relay #ui #layout #resizing #design #composer #planner
