---
name: Interface Layout
description: Reference-driven visual system, responsive workspace, and persisted panel resizing.
type: architecture
---

# Interface Layout

> [!note]
> Queue and History always show every CC Relay in the selected Launchpad project. The obsolete **All Relays** queue-header button and renderer scope state were removed. See [[task-history]].

> [!important]
> Current backends advertise `capabilities.disposableTerminalPools`. In that mode the composer shows per-project Codex and Claude maximum instance controls instead of a live terminal picker. References below to a selected CC Relay, immediate finished-task follow-up, manual assignment, or the parallel batch bar describe the legacy persistent-task compatibility path unless stated otherwise. See [[disposable-terminal-pools]].

The CC Relay UI follows the supplied `CC Relay.html` reference at its 1680 by 1180 desktop target. The main visual system uses bundled local copies of Instrument Sans, Source Serif 4, and JetBrains Mono, blue interaction states, white rounded panels, and a navy execution console.

The Electron window supports bounded whole-page zoom through Command or Control plus and minus, with Command or Control zero resetting to 100 percent. The rightmost **Display** cog repeats Zoom out and Zoom in as visible controls with the current percentage between them. `src/desktop-zoom.mjs` provides factors from 50 through 200 percent, and `src/desktop-menu.mjs` gives macOS an explicit menu so its accelerators use those bounded factors instead of Electron's default unbounded zoom roles. Native page zoom is used because it scales legacy pixel geometry and JavaScript-authored pixel panel sizes together with text; new adaptive inspector geometry uses `em` units. See [[task-detail-modal-and-app-zoom]].

## Workspace columns

The wide desktop workspace contains Composer, Task queue, and Task activity panels. Two keyboard-focusable separators surround Task queue. Dragging either separator resizes the queue boundary while preserving minimum usable widths for all three panels.

Column preferences are stored durably in shared application configuration under `ui-layout-preferences`, with `localStorage` under `relay.panelWidths` retained as a fast origin-local cache. The default composer width is 580px, the queue is 500px, and Task activity consumes the remaining space. Composer has a 400px usable minimum, so older saved 360px layouts receive a little more room without discarding the operator's queue preference. This deliberately makes the terminal the largest panel on wide screens while keeping the queue near the compact reference width. The left separator resizes Composer and the right separator resizes the queue. Preferences saved by the older composer-and-detail model are migrated once by deriving their former queue width. At 1344px and below, CC Relay switches to its responsive layout and hides the resize separators. See [[durable-ui-layout-preferences]].

The responsive workspace has only two structural states. From 1101px through 1344px it keeps Composer, Task queue, and Task activity in one fluid row, with minimum tracks of 300px, 320px, and 380px and the largest share reserved for activity. At 1100px and below it changes directly to one full-width reading lane in DOM order. Whole-page zoom therefore cannot turn a large Electron window into the former Composer plus Queue split with Task activity hidden in a second row.

> [!important]
> Do not restore an intermediate two-panel workspace. Medium widths retain all three operational surfaces, and compact widths stack all three. In the desktop shell, the workspace remains the bounded scroll owner so a stacked panel never escapes under the fixed title bar, monitor, or Launchpad.

Queue cards use an 8px list rhythm, 11px by 12px card padding, an optional two-line prompt preview, and a compact two-row footer. Prompt-derived task names stand alone because repeating the same request immediately below them adds no information. Explicit task names retain the prompt preview when it is distinct. Task state, task name, execution owner, duration, and both lifecycle dates remain visible; density comes from tighter typography and spacing rather than removing operational evidence.

> [!note]
> Separators use pointer capture and `role="separator"`. Left and Right arrow keys adjust the corresponding boundary in 20px steps.

## Assets

- `public/favicon.svg` is the Crowie logo supplied as the CC Relay browser tab icon and top-left in-app brand mark. Keep its transparent background, `63.86` square view box, and near-black `#0f0f11` mark unless the product branding changes.
- `build/icon.png` is the 1024px transparent Crowie source for the native Electron application icon.
- `public/fonts/instrument-sans-latin.woff2`
- `public/fonts/jetbrains-mono-latin.woff2`
- `public/fonts/source-serif-4-latin.woff2`
- `public/style.css`
- `public/index.html`
- `public/app.js`
- `public/running-task-layout.js`

> [!note]
> `public/index.html` loads `public/favicon.svg` through both `<link rel="icon">` and the `.brand-mark` header image, but that does not control the native Electron application icon. Development launches apply `build/icon.png` to the macOS Dock in `src/electron-main.mjs`. Packaged macOS and Windows builds convert the same PNG through `electron-builder.yml`.

## macOS desktop shell containment

The macOS Electron shell adds a centered, logo-only Crowie title bar above the application layout.
The renderer body becomes a four-row viewport grid containing the title bar, global monitor,
Launchpad rail, and workspace. When the saved monitor position is Bottom, the same grid moves the
monitor into its final row instead of relying on a fixed overlay and body padding. See
[[brand-startup-and-about]] and [[header-position]].

The outer document is never the scroll owner in this desktop shell. At wide sizes, each existing
panel keeps its own scrolling behavior. At 1344px and below, the responsive multi-row panel layout
can exceed the remaining height, so `.workspace` becomes the bounded scroll viewport while the
title bar, monitor, and Launchpad stay visible. Browser rendering keeps the previous responsive
page-scroll behavior because it has no desktop title bar.

> [!note]
> An isolated Electron check measured exact document containment at both target sizes: 1540 by 980
> produced a 1540 by 980 root scroll area, and 1120 by 760 produced a 1120 by 760 root scroll area.
> At the compact size, the workspace had a 505px client height, a 1000px scroll height, and
> `overflow-y: auto`. Composer and Queue each retained a 481px visible panel height, confirming
> that overflow stays inside a usable full-height workspace row.

## Global task monitor

The center of the application header is a global monitoring rail, not a connection, queue, or generic status summary. It contains every task whose persisted status is `running` plus every valid manual Terminal session mode task whose status is `open`, including work from every project. Running tasks sort first. An open manual session remains until the operator uses **Complete session**, so moving the monitor to the bottom never makes that workspace disappear between turns. Queue and History remain scoped to the selected Launchpad; this monitor is the intentional cross-project exception.

Each compact card shows the task number, project, CC Relay or Claude session, live or open duration, prompt, and latest recorded agent response. `src/running-task-feed.mjs` selects only Codex `agentMessage` and Claude `claude/message` events, so command output, tool protocol, and hidden reasoning never replace the response preview. A running task without an agent message says **Waiting for the first agent response**. An open session falls back to its latest result or error and otherwise says that it is ready for another command. Clicking a card selects its pinned project when available, returns to Queue, and opens the task's complete Task Activity view.

Manual session cards add a compact state chip in the metadata row. The words are authoritative: **Session running** means a Relay turn owns the task, **Terminal idle** and **Terminal busy** describe a connected open terminal, **Terminal closed** reports a missing window, and **Session idle** covers an open workspace that has not bound a terminal. Violet, blue, teal, and neutral treatments reinforce those states in both themes without carrying meaning alone. Ordinary task cards remain implicitly running and do not spend compact width on a redundant state chip.

The rail scrolls horizontally instead of compressing or dropping monitored work. The rightmost header cog opens one **Display** popover containing global layout controls for one, two, or three rows and Compact 230px, Default 286px, or Wide 360px cards, followed by monitor position, theme, and application zoom. One row and Default width remain the defaults. Multi-row layouts keep the first task row between the brand and header actions, while rows two and three span the complete padded header width below it. Tasks retain column-first assignment: in a three-row layout tasks 1, 4, and 7 use the primary rail, while tasks 2, 3, 5, 6, 8, and 9 use the two-row full-width rail. Both rails remain horizontally scrollable. The header grows by the exact 44px card row and 7px gap budget, and `.workspace` subtracts the measured `--app-header-height` instead of assuming the old fixed 58px header. Its empty state occupies one canonical card slot at the selected width, with the same 44px height, 9px corners, violet-tinted surface, and outline as a running card. It contains only the neutral **No active tasks or sessions** label, with no live dot and no interaction. A monitored card inherits the deterministic eight-color identity or persisted custom color of its project for its flat surface tint, mixed-color outline, live dot, task-number chip, project name, focus ring, and hover tint. It has no directional accent edge or gradient. The CC Relay name remains neutral so project ownership and execution ownership stay separate. Codex response ownership remains blue, and only Claude response ownership uses the reserved orange. At 1344px and below the complete monitor already occupies its own full-width header row; narrow cards remain horizontally scrollable.

> [!important]
> Task-monitor rows and card width belong to the global durable `ui-layout-preferences` record, not a Launchpad project. The compatibility property remains `runningTaskLayout`. Keep the browser cache, first-paint data attributes, backend normalization, and settings controls synchronized when adding another supported choice. The cog stays in `.header-actions`, outside both monitor rails, so live feed rerenders cannot close or replace its controls.

> [!important]
> `/api/status.runningTasks` remains running-only so an older renderer never receives an idle session card without its state label. Current backends provide the additive `monitoredTasks` feed. A current renderer paired with an older backend merges exact `open` manual sessions from the complete task snapshot and deduplicates by task ID.

## Provider subscription runway

The right side of the global header uses the space formerly occupied by **Pause queue** for a compact four-meter subscription runway. Its visible labels are **Cla 5h**, **Cla Week**, **Fable**, and **Cod Week**, while the accessible progress-bar labels keep the full provider and window names. Below 50 percent is green, 50 through 74 percent is yellow, 75 through 89 percent is orange, and 90 percent or more is red. Percentage text and the semantic state keep the reading independent of color. When Claude reports no distinct Fable allowance, the Fable meter uses the all-model weekly percentage and reset as a marked shared fallback instead of showing `--` as though the model were unavailable. Hover titles expose the corresponding reset time, explain the shared fallback, and identify a retained value as last known. Remaining-time countdowns use larger 9px monospace text for readability.

The strip is a fixed compact instrument on wide layouts. In DOM and keyboard order it precedes the rightmost **Display** cog; monitor position and theme now live inside that cog instead of consuming separate header slots. The former **CC Relay online** pill is removed because provider readiness already appears in the provider controls and usage states. At 760px and below the strip moves to its own full-width row inside the wrapping header actions while the cog remains the rightmost utility control. Light and dark surfaces use their respective semantic palettes, and reduced-motion mode removes bar transitions. Each track is an accessible progress bar with a numeric value when known and descriptive checking or unavailable text otherwise.

The header no longer exposes queue pause or resume. Project pause state and backend pause routes remain intact for queue-management integrations and mixed-version compatibility. See [[provider-usage-monitor]].

## Execution ledger

The task activity console renders as a realistic terminal on a near-black Tokyo Night background rather than a card ledger. Its palette is defined through `--term-*` variables scoped to `.events-section`, so the dark surface and syntax colors never leak into the rest of the light app, and semantic failure still reads as red. Its hierarchy is:

1. An expanded-by-default execution manifest (runtime, current plan steps, sub-agent assignments, and compact telemetry)
2. A filter toolbar (Highlights, Commands, Messages, All) with Copy log
3. The scrollback: one numbered line per grouped signal
4. The follow-up input prompt line
5. A tmux-style status bar of solid colored segments

Each signal renders in a terminal-idiomatic shape instead of a bordered card. Commands render as a shell prompt line, `~/workspace ❯ <syntax-highlighted command>`, followed by a `✓/✗ exit N · duration · time` meta line and a `▸ N lines` output disclosure with a left-border block. A JavaScript tokenizer (`highlightCommand`) colors the command into program, arguments, flags, numbers, strings, and operators; every token is escaped first. Reasoning renders as `┊ provider reasoned for Xs` when done or `┊ provider thinking▍` with a blinking block cursor while streaming, plus an optional muted italic preview. File changes use `+` create and `~` modify glyphs with the patch behind a disclosure. Final Codex or Claude responses render as a prominent, comfortably sized response block. Commands, file changes, failures, and final messages stay visually loud; queue, protocol, reasoning, and session-lifecycle lines stay dim. Errors and Claude session-busy waiting stay red with output expanded by default. Provider is never the only status cue: kind, glyph, and text differ as well.

The tmux status bar is built inside `renderEventStream` from real task state: a LIVE segment from the session state (only pulsing while actually running), the CC Relay identity, provider and model, the visible/total signal count, the follow-live toggle, effort, and the live task duration (kept current every second through `refreshTaskDurations`). Unknown segments hide rather than inventing a value. On widths below 620px the lower-priority CC Relay, provider, and effort segments hide so the bar never overflows, keeping LIVE, signals, following, and duration. The four filter buttons and Copy log always remain in the toolbar with their ids, `data-event-filter`, and `aria-pressed` behavior intact; follow-live lives in the status bar but toggles the same state and stays keyboard accessible.

The right task inspector is a three-row grid: a compact operational header, a horizontal drag separator, and the pinned activity terminal. Ordinary and Plan council tasks default the terminal to 84 percent; retained-session tasks use 72 percent so their session controls remain visible. Narrow screens use 68 percent for ordinary sessions, while manual terminal sessions use 56 percent so **Complete session** and its state message remain exposed. Dragging the separator changes terminal height between safe content minimums, keyboard Up and Down adjust it in 20px steps, and the pixel height persists in `ui-layout-preferences`. `relay.terminalHeight` remains the local startup cache.

The task header is intentionally dense: reduced inspector padding, a 20px task title, inline compact metadata, a smaller action button, and tighter Prompt and Result sections. The execution terminal should receive as much vertical room as possible without hiding task context.

The terminal has no title header. Runtime state lives in the collapsible execution manifest, the compact filter toolbar, and the tmux status bar. The manifest starts expanded, shows the current plan and each worker's assignment, state, and elapsed time, and minimizes to its counters through a native disclosure. Scrollback lines use a small left gutter line number and dense monospace type. This is intentionally an information-dense monitoring surface rather than a presentation card. See [[task-activity-overview]].

Direct tasks place a compact **Continue session** command dock below the event scrollback, styled as the shell input prompt line with a green `❯` caret and the near-black terminal surface. Its context line names the conversation, provider, model, and effort. A finished disposable task shows **Resume available** even after its terminal has closed. Sending keeps the selected task ID, relaunches its saved conversation when needed, and never creates queue work. **Conversation busy** prevents two turns from owning the same saved conversation. The multiline `textarea` has no character cap, so operators can paste logs larger than the 12,000-character fresh-task limit. It expands only to 92px, Enter sends, and Shift+Enter adds a line. It remains editable while submission is unavailable and is disabled only during an active request. Codex uses blue and Claude uses its reserved orange identity accent. The dock is hidden for Plan council and Turbo.

Finished disposable submission requires `capabilities.resumableDisposableSessions` and calls `/api/tasks/:id/follow-up`, which returns the same source task. Finished legacy submission requires `capabilities.taskDirectFollowUp` and starts the next turn in the original live session. When current UI assets run against an older backend, the dock shows **Restart required** and disables Send instead of calling the ordinary Execute endpoint. Running Codex steering is separately gated by `capabilities.taskSteering`, and running Claude terminal steering by `capabilities.claudeTaskSteering`.

Task-detail requests use `taskLoadSequence`. A newer card selection invalidates every older in-flight detail response, and the continuation dock hides while selection changes. Without this guard, polling and a fast user selection can resolve out of order and expose a follow-up input bound to a different task than the selected card.

Prompts and Result use compact evidence disclosures inside the full task detail modal. The modal also owns attachments, session conversation, Turbo graph, and every Plan council stage and artifact. Prompts contains the original request plus every accepted follow-up in order and opens automatically after the first continuation. Its summary reports the prompt count and latest prompt preview. Result retains the latest outcome. A newly selected single-turn task keeps Prompts collapsed and opens Result only when an outcome exists. See [[task-detail-modal-and-app-zoom]].

> [!note]
> Result is a rendered Markdown document, while Prompts remains compact plain text. `public/markdown.js` escapes all source text before adding the supported heading, emphasis, list, quote, inline-code, and fenced-code structure. The Result preview removes Markdown punctuation, but Copy continues to use the untouched task result or error. The Result reading surface uses 12.5px text and a 320px scroll limit; the compact Prompt limit remains unchanged.

> [!important]
> Keep Result copy payloads separate from rendered `innerHTML`. Model output is untrusted, so new Markdown syntax must preserve the escape-first boundary in `public/markdown.js`. See [[diagnostics]].

> [!important]
> The light prompt evidence rule must remain `.detail-section > pre`, not `.detail-section pre`. Result fenced code is nested inside `.markdown-document`; a descendant selector overrides its dark `#182720` background while leaving the light `#e7f0ed` code foreground in place, making the text nearly invisible on `#fafbfc`. `test/result-markdown.test.mjs` protects the direct-child boundary and the fenced-code color pair.

Codex agent-message lines also omit their repeated provider, title, state, and timestamp header. Their full response text renders directly in the prominent response block without the long-message disclosure wrapper. Commands, file changes, errors, tools, and non-Codex providers retain their signal-line header because their execution metadata remains useful.

Direct Codex and Claude response bodies use `font-weight: 650` through `.detail-panel .event-list .term-response-body`. This stronger weight is reserved for text written directly by the AI. Commands, reasoning, queue protocol, and generic event messages remain regular weight so the response stays visually distinct from its execution trace.

The **Continue session** dock includes one low-contrast, icon-only image action between its textarea and Send button. Follow-up images may also be pasted. The four visual grid items are the generated terminal caret, flexible textarea, image action, and Send button, so the final override must use `auto minmax(0, 1fr) auto auto`. The dock deliberately avoids thumbnails and hides image metadata until an image is attached; it then shows a plain image count and **Clear images**, while the submitted task detail remains the durable visual list. Image drafts follow the selected task just like text drafts.

> [!important]
> Do not define only three columns for the continuation prompt row. Its generated `::before` caret participates in grid layout and otherwise pushes Send onto a second row while shrinking the textarea.

Expanded terminal disclosures persist across live polling and filter rerenders. Each event article exposes its stable grouped-entry ID, while each nested `details` element is keyed by its index inside that event. A capture-phase `toggle` listener updates `state.expandedEventDetails`; render snapshots current DOM state before replacement and restores matching disclosures afterward. The set is cleared only when selecting a different task.

Expanded command output has its own nested scroll container. Before live polling replaces event markup, CC Relay records each output's vertical offset and whether it was already near the bottom, keyed by the same stable event and disclosure identity. After rendering, it restores the exact offset for inspected output or follows the new bottom only when that individual output was already at the bottom. Selecting another task clears these positions.

Expanded command output must use the opaque `#0c0e17` terminal surface. The app-wide `pre` rule is intentionally light for task evidence, so the terminal override uses `.detail-panel .events-section .event-output > pre.event-output-content` and an explicit opaque background color. Keep the subtle blue-gray inset edge, but do not turn command output into a white or translucent light card.

## Task artifact copy actions

Prompt, Result, Claude draft, Codex review, and Final revised plan each expose a compact **Copy** action in Task Activity. Prompt and Result keep Copy in the disclosure summary, beside **View**, so the action remains directly available while the text is collapsed. Copy stops the summary click before writing to the clipboard, which prevents copying from opening or closing the disclosure. Copy uses the stored source text, so Plan council Markdown remains intact instead of being flattened from the rendered document. Prompt Copy joins only the user-authored prompt bodies and omits display metadata such as `01 · Original request`. Result copies the task error when an error is the visible outcome. Pending or absent content disables its action, and selecting another task clears the prior copy payload before the detail request resolves.

> [!important]
> The two-second selected-task refresh must not clear copy payloads or reset copy feedback. That creates a short disabled interval on every poll, which makes a compact button flicker and intermittently miss clicks. Only an actual task selection change invalidates the previous task's payload and active feedback timer.

> [!important]
> Keep copy payloads separate from rendered `innerHTML`. Plan draft, review, and final plan must copy `plan.draft`, `plan.review`, and `plan.finalPlan` directly.

> [!note]
> A control placed after a `<summary>` is hidden by the browser whenever its `<details>` is closed, even when CSS positions it over the summary. Directly available disclosure actions must live inside the summary action group.

The terminal defaults to the **All** filter so the complete task activity is visible when a task opens. All includes Codex reasoning summaries while they stream. CC Relay consumes `item/reasoning/summaryTextDelta`, accumulates each summary part by item ID, and publishes `item/updated` snapshots that the browser folds into one live reasoning entry. Reasoning remains excluded from Highlights to keep that optional view compact. CC Relay intentionally displays only the model-provided summary stream, not private hidden chain-of-thought.

Codex `thread/tokenUsage/updated` notifications are retained in the eventual `turn/completed` task event. The console metrics show the task's summed `reasoningOutputTokens` as **thinking tokens**. This is usage telemetry only and does not expose private hidden chain-of-thought. Older completed tasks recorded before this support show zero because their persisted events contain no token snapshot.

Task reference images render as compact 64px square thumbnails, falling to 56px on narrow screens. Filenames and file sizes remain available through the image link and accessible image alternative, while only the sequence number overlays the thumbnail.

The composer accepts up to 99 reference images per task. The independent safety limits remain 5 MB per image and 20 MB total, so the higher count supports collections of small screenshots without increasing the maximum request payload.

> [!note]
> Chromium may expose one pasted image through both `clipboardData.files` and `clipboardData.items`, with a different `File` wrapper for each view. `clipboardImageFiles()` deduplicates those representations by name, MIME type, size, and last-modified timestamp before the composer checks its existing attachments. Object identity alone causes the image to attach successfully and then show a false **already attached** error. This shared extractor covers both the main composer and Continue session.

> [!important]
> Keep scrolling separated between `.task-detail-scroll` and `.event-list`. Restoring scrolling on `.detail-panel` makes the terminal move away from the bottom and breaks the monitoring layout.

> [!important]
> Preserving only `.event-list.scrollTop` is insufficient. Command output scrolls inside `pre.event-output-content`, and replacing that node during polling resets it unless its position is captured before `innerHTML` replacement and restored afterward.

> [!note]
> Motion is limited to the running-event LIVE pulse and the blinking reasoning and input cursors. All of it is disabled under `prefers-reduced-motion: reduce`. The continuously updating event list carries no decorative animation.

> [!important]
> The terminal must give each sub-surface (`.events-section`, `.event-metrics`, `.event-toolbar`, `.event-list`, and `pre.event-output-content`) its OWN opaque dark background, not rely on one container background showing through. A dark dock and status bar sitting over a white metrics row, toolbar, event list, or command output is the signature of a missing terminal override or partially cached `style.css`. Opaque per-surface backgrounds keep the terminal dark even under a partial cache. When the terminal looks white, hard-refresh (Cmd+Shift+R) or restart Electron before assuming a CSS regression.

> [!important]
> A running Codex task uses the structured app-server `turn/steer` protocol against its exact active turn. A running interactive Claude task uses exact owned-terminal steering with hook or transcript confirmation. A non-running disposable task relaunches and resumes the saved conversation through a free provider slot under the same task ID. A retained or legacy persistent live session starts immediately. No continuation creates queue work or changes the selected Task Activity card.

## Execution settings

The Model control remains a native select for reliable keyboard and platform behavior, wrapped in a styled shell that supplies the visual surface, focus ring, and chevron. Reasoning effort remains the compact slider mapped directly to the selected model's ordered `supportedReasoningEfforts`. There is no synthetic **Model default** stop. A newly selected model starts at `high` whenever the model supports it. If `high` is unavailable, CC Relay uses the model's valid declared default and then its first supported effort. CC Relay stores that explicit effort string.

> [!note]
> `public/model-effort.js` owns the CC Relay-wide `high` default. This preference applies to fresh and newly selected model settings. Persisted task settings and unsent user choices keep their existing provenance and are not reset merely because catalogs refresh.

All model selectors listen to `input`, not `change`. Direct execution, Plan council, and both Turbo model roles therefore update their state, supported effort options, defaults, validation, and submit readiness as soon as the highlighted model changes. Do not move model handling back to `change`, which can wait until a native picker closes or loses focus.

The Turbo worker count is the deliberate exception. It is a number field, not a picker, so a per-keystroke handler that clamped it into range made a two-digit count impossible to type. It commits on `change`, guards Return so an implicit form submission cannot queue a fleet, and resyncs on `blur`. See [[turbo-execution]].

The composer has two workflow tabs: **Execute** and **Forward-planning Turbo**. Plan council is not a standalone tab. Execute contains an unchecked **Use Plan council for this prompt** option that reveals its Claude author, Codex reviewer, Claude revision route and readiness row. The copy states that this creates a reviewed read-only plan instead of direct execution. Enabling it selects Codex for the required review CC Relay, hides direct model and effort controls, and changes the primary action to **Build reviewed plan**. Provider tabs remain interactive. Choosing Claude turns Execute Plan council off and continues as direct Claude execution. Leaving Execute or successfully submitting also resets the option to off.

In automatic mode, direct Model and Effort state belongs to the selected provider inside the active project's composer snapshot. Fresh tasks have no terminal ID to own settings. The legacy compatibility path keeps `threadExecutionSettings` independently for each live Codex or Claude session.

The Effort slider updates terminal state during the `input` event. At direct submission, CC Relay maps the rendered slider index through its `data-values` array and copies the resulting effort string back to terminal state before building the request. The server then validates that exact model and effort pair against the corresponding provider catalog.

> [!important]
> A slider `input` event updates only the remembered effort and the current value, hint, progress, and marker presentation. It must not call the full `renderExecutionControls()` path, because that path rewrites the range element's minimum, maximum, and value while the native pointer interaction is still active.

Submission snapshots the visible Model and Effort before awaiting idle-CC Relay discovery. When idle routing chooses a different terminal, CC Relay writes that same snapshot to the destination terminal. After enqueue succeeds, the task response is authoritative: its accepted `thread_id`, model, and effort are remembered again before the post-submit refresh. This prevents an `xhigh` task card from being followed by a `low` composer slider on the CC Relay that received it.

Terminal execution settings carry a provenance of `default`, `task`, or `user`. Initial rendering may create a `default` entry before task history finishes loading. `hydrateThreadExecutionSettings()` must replace that provisional value with the newest persisted Execute task for the terminal. A `user` entry represents a new unsent choice and must never be overwritten by history polling. A successful submission changes it to the server-confirmed `task` value and records the task ID for monotonic hydration.

> [!important]
> Automatic provider-level Model and Effort settings carry the same provenance as legacy per-terminal settings. When a disposable task later receives its `thread_id`, hydration restores the accepted settings on that exact terminal. It may update the provider default only when there is no unsent `user` choice and the task ID is newer than the provider's remembered `task` value. The former shared write let an older Claude task binding change a newly selected `max` effort back to `high`, making the control appear to require a second selection. See [[disposable-terminal-pools]].

Direct execution presents Model and Effort as compact horizontal controls below the automatic pool controls, or below the CC Relay picker on a legacy backend. Each control keeps its short identifier and hint on the left while the interactive surface occupies the remaining width. The model select is 28px tall, while the slider retains its value and step markers.

> [!note]
> In the two-column execution row, Effort receives exactly 20px more width than Model. The asymmetric tracks keep the selected effort label and all dynamic step markers inside the compact card. At the existing 760px breakpoint the controls still stack into equal full-width rows.

The slider footer shows only the current effort name on the left and one compact dot per supported effort on the right. Do not render every effort name across the footer because six-value model catalogs overflow the compact card. Each dot may expose its name as a title, while the range input reports the selected name through `aria-valuetext`.

> [!important]
> Never infer a fixed effort scale in CSS or markup. Models expose different effort lists, so `renderExecutionControls()` must rebuild the slider maximum and its index-to-value mapping whenever the provider, terminal, or model changes. Never submit the numeric range value as effort.

> [!important]
> Idle routing separates the terminal selected when the user presses submit from the terminal that receives the task. Execution state must be applied to both the selected terminal and the accepted destination terminal. Do not wait until after asynchronous routing to read the slider.

> [!note]
> Live verification against the CC Relay server selected the `vector-algo` project and CC Relay thread `019f802a-69da-7930-8b33-cba43dee1f0b`. The slider restored `xhigh` from task 171. Changing it locally to `ultra` remained `ultra` after the four-second thread poll, proving task hydration does not overwrite unsent user state.

## Terminal launch layout controls

On a current backend, the composer shows Codex and Claude provider tabs plus per-project maximum instance inputs. It shows each provider's active count and does not require a live CC Relay selection. A fresh task waits for capacity and launches the terminals required by its workflow. The selected project's **Keep task terminals open** choice decides whether final launches remain connected or close. **Settings** opens the native dialog for that project's launch layout and diagnostics. The Launchpad has one **Add project** action that pins and selects a folder without opening a terminal. Manual **Launch Codex** and **Launch Claude** actions for interactive sessions remain in the terminal panel.

The former shared CC Relay picker, composer launch buttons, and **Close selected terminal** row are compatibility UI for a backend without `capabilities.disposableTerminalPools`. In that view the close row names the selected session, explains its complete availability reason, and permits closure only for an idle session with an exact native handle. The button, label, and reason are derived by `public/terminal-close-state.js`, whose pure-state tests protect all visible states.

Plan council shows the selected project's Claude and Codex capacity. It needs one slot from each provider and launches both terminals as one atomic workflow reservation. The legacy composer exposes separate Claude author and Codex reviewer terminal selectors only when the automatic pool capability is absent.

Task Activity presents the saved draft, independent review, and final revision as separate readable sections, but only the final revision becomes the canonical Markdown artifact. The final section always shows its exact project-local `plan.md` path. A current backend adds **Open plan.md**; an older backend keeps the row visible as **Restart to open**. When the final plan exists, a cool-blue step **04** appears immediately after the council stage rail, before the long plan sources. It contains a Codex or Claude provider choice and queues execution through the selected project's disposable pool. The detail header repeats **Execute plan** as a shortcut that scrolls to the handoff and focuses its actionable control. A failed disposable council retry also relaunches and resumes its saved provider conversations through the pool.

> [!important]
> Do not reintroduce a required live-terminal picker into the current composer. New work is assigned to a project and provider pool. Existing sessions appear only in the legacy compatibility path and task history.

The terminal window grid controls in the settings dialog use a two-level layout. A full-width heading row contains the grid enable switch, followed by compact column and row inputs and a flexible monitor selector. This keeps the switch label readable and gives the monitor name the remaining width without allowing it to crowd the other controls. Below 760px, the monitor selector moves to its own row.

The persisted **Open new terminals minimized** checkbox applies to every native launch path for the selected project, including project cards. CC Relay omits Terminal activation and minimizes only the captured new Terminal.app window on macOS. It starts `cmd.exe` with PowerShell's minimized window style on Windows. The compatibility field remains `background`, but the UI does not describe this as launching behind everything. The option is stored with that project's grid settings in `projects.terminal_layout_json` and travels in the existing launch request object. Both **Arrange in a grid** and **Open new terminals minimized** default to enabled. A project without a saved layout receives clean defaults and never inherits the previously selected project's values. The settings dialog can explicitly copy only the complete window-layout object to all pinned projects; later changes remain project-specific. See [[project-terminal-settings]].

On macOS, each grid launch inspects the bounds of currently open Terminal.app windows and places the new window in the first unoccupied cell. Closing a terminal therefore frees that exact cell for the next launch. The launcher's in-memory rotating slot remains a fallback when Terminal window inspection is unavailable or every cell is occupied.

AppKit screen frames use a bottom-left origin, while Terminal.app bounds use a top-left origin anchored to the primary screen. Convert display Y coordinates against the top of `NSScreen.mainScreen.frame`, never the maximum top across the complete multi-monitor desktop. Terminal JXA window bounds use `{x, y, width, height}` on current macOS and must be normalized to edge coordinates before occupied-cell matching. See [[macos-terminal-grid-coordinates]].

Codex and Claude share the same grid and slot sequence. Provider selection changes only the launched command. Terminal.app receives the selected bounds immediately, then CC Relay reapplies them to the captured new window after a short startup delay because full-screen terminal clients such as Claude can resize their window during initialization.

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

On desktop, the terminal list uses a fixed three-column grid so three CC Relay workers sit in one row. Each card stacks its task preview and terminal metadata beneath the primary name and status row, with long values truncated inside the tile. Below 760px, the list returns to one column for readable touch targets.

The disconnected terminal empty state spans the complete terminal grid. It must not inherit the width of one worker column, because its explanatory copy becomes unreadably narrow when the desktop list has three columns.

Codex terminal cards render the persisted `relayName` and `relayNumber` fields, normally **CC Relay 1**, **CC Relay 2**, and so on. The labels are global to the Codex thread, not the current project or discovery array, so inserting or reordering terminals cannot change a name or number. They are also drop targets for queued task cards. The terminal section uses one compact heading row for its title, followed by the status text and task-routing options without the previous oversized fieldset spacing.

> [!note]
> Queue state and terminal discovery update automatically. Do not expose manual Refresh controls or instruct users to refresh. Server-sent events update queue changes immediately, visible-page polling repairs missed events, and terminal discovery runs silently in the background.

CC Relay cards derive their visible activity from task ownership rather than relying only on the provider thread title. A running direct task shows its task number and prompt, Turbo participants identify planner or worker role, an idle terminal with assigned work shows its waiting count and next task, and a free terminal says it is ready. The state badge follows this derived running, queued, or idle state.

Turbo queue cards retain the canonical `queued` or `running` status badge and add a compact secondary forward-plan stage badge. **Forward plan** means a queued Turbo parent has no reusable graph yet, **Planning ahead** means its queued graph is currently being prepared, **Plan ready** means a validated graph will bypass the planner at execution time, and **Workers running** means the parent is executing its graph. Complete and failed variants are terminal signals only. The stage badge is width-constrained so it cannot expand the task card.

Planner terminal activity follows the persisted lifecycle: a planner preparing a queued parent reads **Planning ahead · Task #n**, current worker terminals read **Turbo worker · Task #n**, and the original planner reads **Idle · Ready for work** after the parent graph reaches `executing`. If that same thread is preparing another queued parent, the look-ahead label takes precedence.

Connected Codex Relays use a repeating six-color identity palette based on their persisted CC Relay number. The readable `CC Relay n` name and task-card footer ownership label use the full accent. Unselected CC Relay selector cards use the matching soft background. Hover strengthens the tint slightly, while selection uses the CC Relay accent for the border, radio control, and a stronger tinted background. The palette deliberately contains no orange slot: CC Relay 4 uses sky blue, and orange remains reserved for Claude identity. The old heavy colored left stripe remains removed, and task cards remain neutral apart from their CC Relay ownership text. Status colors remain semantic and do not inherit the identity accent. CC Relay selector titles contain only the readable `CC Relay n` name; workspace and session metadata live in the bottom text row. The running, queued, or idle badge sits beneath the provider icon at the lower left, outside the text column, so status does not add a fourth text row or increase card height.

CC Relay selector titles use the Instrument Sans body face at a firm interface weight. They intentionally do not inherit Source Serif 4 from the display token, because worker names are operational controls rather than editorial headings.

> [!note]
> Connected task owners reuse the persisted CC Relay name color in their footer label. Historical owners without a connected CC Relay use neutral text because no live color can be applied safely. CC Relay colors come from the thread's immutable `relayNumber` through the six-color palette; they never depend on the current connected-terminal ordering. See [[task-history]].

> [!important]
> Do not assign colors or labels from the visible terminal index. Use the thread's persisted `relayNumber` for `relay-color-1` through `relay-color-6`, and use `relayName` as the display text. A disconnected or historical thread without a live identity stays neutral rather than receiving a guessed CC Relay number.

> [!note]
> Keep preview and metadata independently truncated. Long prompts, paths, and session identifiers must not widen the card or force an extra line.

## Turbo fleet and dispatch graph

Turbo task cards keep their canonical task status and forward-plan marker, then add one compact fleet manifest. The manifest reads **Planner** followed by one planner identity, an arrow, **Executes on**, and the ordered worker identities. A connected Codex thread is identified as **CC Relay n** and receives its existing `relay-color-n` class. A disconnected or historical thread uses its persisted title in a neutral chip. The renderer must not invent a CC Relay number from a worker slot or an old title. The manifest wraps within the task card and stays secondary to task status.

The detail graph is an operational dispatch ledger rather than a dashboard. A thin progress bar exposes an accessible `progressbar` label and complete-package count over the total. Each package is a compact dispatch ticket with a uniform outline, a state port, monospace package ID, title and dependency status, and a right ownership stamp. State is communicated by the outline, surface tint, and state port, never by a colored left border. The state port shows a check for `complete`, an accessible spinner for `running`, an error mark and message for `failed`, and a neutral ready or blocked state for `pending` packages. Ownership stamps use live CC Relay identity colors only when the matching connected thread is present; historical titles remain neutral.

> [!important]
> Dispatch tickets are owned by the final `.turbo-graph-*` rules. Do not reintroduce broad legacy selectors such as `.turbo-task-graph article` or `.turbo-task-graph article > span`: their higher specificity collapses the narrow layout, makes both state and ownership elements span rows, and truncates the package copy. The current ticket uses a compact state, copy, and ownership grid, with ownership moving below the copy only at the narrow breakpoint.

While an active Turbo plan has no graph packages, the progress header says **Planning dependency graph** instead of presenting the meaningless `0 / 0 complete`. It uses an indeterminate progress sweep, and three restrained skeleton tickets communicate that work is still arriving. The progressbar omits `aria-valuenow` while indeterminate and announces that planning is in progress. A running parent with no persisted graph is also treated as planning because workers cannot start without a validated graph.

Running tickets use one small comet-ring spinner and no additional pulse or dashboard animation. Live polling replaces graph markup, so the renderer seeds its negative animation delay from `performance.now()` to preserve the spinner phase across replacements and prevent an apparent frozen loader. The planning indicator, running spinner, and skeleton sweep stop under `prefers-reduced-motion: reduce`. At the narrow breakpoint, the ownership stamp moves below the ticket content, and all graph text remains `min-width: 0` with ellipsis so the graph cannot widen or overflow the detail panel.

## Turbo council route

The Turbo composer keeps the optional Plan council as one compact route. Its unchecked **Use Plan council for this prompt** option sits beside a keyboard-accessible question-mark button. The disclosure explains that the selected first provider creates the JSON graph, the second checks and corrects it, workers wait, the pass adds time, and Claude CLI sign-in is required. Since August 12, 2026 the disclosure also carries the Turbo supporting sentence and the planner node description, which no longer print in the panel.

> [!note]
> Execute and Forward-planning Turbo wrap their optional Plan council controls in the same compact neutral review surface: a 12px radius, quiet gray-blue border, white toggle row, and a pill-shaped provider-count badge. Checked state uses one soft blue focus treatment instead of nested blue outlines. Keep provider identity colors inside the expanded route only. Execute prints the **Optional review / Plan council** eyebrow-plus-title heading above that surface. Turbo does not: its council surface sits under the single **Planner and workers** header row, which also carries the `1 planner` or `2 providers` chip and the readiness chip. The former **Planner and worker fleet** and **Planning route** titles were merged into that header.

> [!important]
> Both workflows use the same `.plan-council-option` and `.plan-council-toggle` component structure, the same primary label, and the same checked and focus states. Turbo may add only its help disclosure and its compact single-line variant of the toggle row. `test/composer-workflows.test.mjs` protects this shared contract, and `test/turbo-composer-panel.test.mjs` protects the compact Turbo top. See [[turbo-execution]].

> [!warning]
> Execute's provider-order control is `class="turbo-council-order plan-council-order"`, so a rule written for the compact Turbo control restyles Execute unless it is scoped under `.turbo-config`. The Turbo council surface also keeps `.council-config` for its `--council-*` tokens, which means every `html[data-theme="dark"] .council-config` repaint outranks the single-class rule that removes its frame; the dark theme restates that removal after the last painting block.

When enabled, both workflows use the same rounded provider nodes, 3px provider accent rails, numbered **Author** and **Reviewer** roles, agent icons, rounded model and effort controls, and central review handoff. The handoff is a thin line with one circular arrow marker, which is the route's signature visual and makes the execution sequence readable without extra decoration. Execute adds its compact Claude revision strip and readiness pills. Turbo adds only its **Codex first / Claude first** segmented control and swaps node order and role copy. Codex keeps its selected planner model and effort; Claude uses its catalog-backed model and normalized effort. Worker settings remain separate. Disabled routes are hidden in both workflows, and the expanded route collapses to one column on narrow screens.

The switch is unchecked by default, so disabled Turbo keeps its existing planner-to-worker behavior and does not require Claude availability. Enabling it adds one quality pass and latency before workers start. Reviewer readiness uses the selected Claude catalog and signed-in CLI state. Execute and Turbo keep independent per-prompt council switches.

Turbo task metadata states the selected provider order before workers. During `planning` and `reviewing`, copy identifies the provider that owns the current stage. A Codex CC Relay appears busy only while Codex owns that stage; it remains visually idle during a Claude stage. Queue and detail labels keep **Council review** alongside the canonical task badge.

## Task card footers

Task cards use one compact footer row below a single divider. The left side combines model, explicit effort or `default`, optional image count, and workspace. The right side combines the status dot, live or final duration, and a `DD Mon HH:mm` timestamp. Completed durations omit a redundant `Took` prefix. Do not restore separate execution and workspace rows.

Queue containment is explicit at the panel, list, and card levels with `min-width: 0`; the list and cards also remain constrained to their available width. Prompt text keeps its three-line clamp and uses `overflow-wrap: anywhere` so long prose or uninterrupted tokens cannot widen the middle workspace column or render beneath the task activity panel.

Task states use one final semantic palette at the end of the stylesheet cascade: running is purple, queued is slate-blue, complete is green, failed and interrupted are red, and cancelled is neutral gray. Both the badge and footer dot follow the same state. Queued uses a blue badge and blue outlined waiting dot, while cancelled uses a gray badge and solid gray terminal dot, so the two states remain distinct without relying on text alone. The shared `--running` and `--running-soft` tokens also drive project activity, CC Relay status badges, header activity, planning stages, and terminal events. Orange is reserved for selectors explicitly owned by Claude. Keep this correction after legacy task-card rules so Running, Queued, and Cancelled cannot collapse into similar colors again.

## Interaction polish

The 2026 visual system moved the primary accent from the earlier signal green to blue, but several hover, selected-tint, and empty-state values were left in the old desaturated-green family, so interactive surfaces read slightly off against the cool neutral lines and mist background. A refinement pass finished that migration without touching the layout or the execution ledger.

Residual green interaction states are neutralized to the cool blue and neutral system: the generic `.button` hover, the `.text-button` hover, the `.mode-tab` hover, the base `.terminal-option` hover, the attachment dropzone and queue-reorder hover backgrounds, the empty task-activity glyph, and the disconnected-terminal empty state. The `--blue` and `--muted` token gaps are closed by aliasing them to `--signal` and `--slate`, which restores the parallel batch bar accent stripe, the parallel and idle-route checkbox accent colors, and the muted terminal-settings labels and close glyph.

App-chrome controls share one quiet 140ms color and shadow transition so hover, focus, and selection settle instead of snapping. Destructive `.button.danger` actions gain a red-tinted hover so Cancel, Delete, and Close read as consequential, the persistent header action lifts within its own navy family, and the primary action carries a single soft same-hue shadow lift with the disabled state kept flat. The dark Tokyo Night terminal, its follow-up dock, and every `.events-section` descendant are intentionally excluded.

> [!important]
> Residual green hover rules must be edited in place, never appended at end of file. `.mode-tab:hover` and `.mode-tab.selected` share specificity, as do `.terminal-option:hover` and its `relay-color` and `.selected` overrides. Because the green hover sits before the later blue selected rule, source order keeps the blue selected border while hovering a selected tab or terminal. An appended equal-specificity `:hover` would come after the selected rule and silently drop that accent on hover. Genuinely new rules (the `--blue` and `--muted` aliases, the danger and header hovers, the primary shadow, and the shared transition) are appended because no competing declaration exists.

## Compact shell revisions

A second design round restructured the three areas the operator called out ("the tasks in header are terrible, the launchpad also, I need much more space there in the launchpad") beyond CSS, into markup, while every capability and DOM contract was preserved.

**Header task monitor.** The primary and extra rails are transparent horizontal scroll tracks. The empty `.header-running-empty` state uses the complete card silhouette instead of a content-hugging pill: one selected-width by 44px slot, a 9px radius, the running-violet tint and outline, and only **No active tasks or sessions** as content. It has no hollow or live dot and remains non-interactive. On wide two-row and three-row layouts, `.header-running-primary` stays in the center header column and `.header-running-extra-tasks` spans grid columns `1 / -1` below it. At and below 1344px the complete monitor moves to its own row and the empty card keeps the same geometry. A monitored card is a tightly spaced three-tier grid: a mono meta line (`#256`, optional terminal-session state, project · CC Relay, duration), the prompt as its title, and the latest agent response tagged with its provider. `.header-running-response` and `data-running-task-id` stay intact. Project identity color owns a flat tint, mixed-color border, live dot, task-number chip, and the separately wrapped `.header-running-project` name. There is no full-height accent edge or linear gradient. The adjacent CC Relay name remains neutral. Provider tags stay indigo for Codex and reserved coral for Claude. The desktop header is 58px high, the brand mark is 28px, and each card is 286px wide.

**Launchpad as one workspace rail.** On wide screens, `.project-dock` places the heading, horizontal `.project-list`, and actions in one grid row. `.project-dock-bar` uses `display: contents`, preserving the existing markup while letting its heading and actions participate in the dock grid. Each desktop `.project-chip` is exactly 30px high and 176px wide. Its grid areas are `head activity close`: solid identity tile and colored folder name on the left, the current state in the center, and unpin fixed to the far-right edge. The identity tile is also the project color button. The complete path stays in the card title instead of consuming visible space. Project cards contain no Codex or Claude launch actions. The project name, solid tile, flat tint, selected outline, and header task share the collision-resolved or persisted custom color produced by `public/project-colors.js`; up to eight automatically colored pinned projects receive different palette slots. Unselected cards use a 4 percent tint that rises to 7 percent on hover. The selected state keeps the normal one-pixel geometry, uses an 11 percent flat identity tint and a quiet one-pixel shadow, and has no outer keyline, initial-tile ring, inset edge, or vertical lift. None of these surfaces use linear gradients. The rail scrolls horizontally when projects exceed the available width. At 900px and below the project list moves to a second row; below 760px each card fills the viewport while preserving the far-right close column. See [[project-color-customization]].

> [!note]
> The project accents are darker than the CC Relay selector accents because they now carry normal-size text on tinted surfaces. `test/project-colors.test.mjs` verifies at least 4.5:1 contrast for every project name on the strongest 16 percent tint and for every white initial on its solid tile. Orange remains excluded from the project palette because it identifies Claude.

**Vertical budget.** The compact desktop geometry is header `58px`, dock `44px`, `.workspace height: calc(100vh - 102px)`, and the legacy bounded `.task-list height: calc(100vh - 202px)`. These four must move as a set; the header plus dock total feeds both viewport offsets.

> [!warning]
> Reducing only the dock height is not a valid compacting strategy. The failed 124px revision retained two-row project cards and clipped their activity and launch controls at the dock boundary. Card structure and viewport offsets must be changed with the dock height.

**Launchpad cascade consolidation.** Operative Launchpad geometry stays in the base `.project-*` block. The wide dock grid is `heading list actions`, and the only responsive structure is the two-row `heading actions / list list` grid at 900px. Do not append a competing Launchpad geometry layer.

See [[compact-interface-density]] for the current density and color tokens.

**Composer and queue polish (light touch).** `.mode-tab strong` now wraps instead of truncating, so **Forward-planning turbo** always reads in full while `.mode-tab small` still ellipsizes. The queue heading no longer wraps: `.queue-panel > .section-heading` gains `flex-wrap: wrap` and its `h2` is fixed at `23px` with `white-space: nowrap`, so **Task queue** stays on one line and the remaining queue actions drop to their own row only when the middle column is tight. The protected Plan council shell, execution controls, and terminal picker were left structurally intact.

## Composer add-task reliability

Adding a task must always work and must feel immediate. Four separate things in the
composer could block it, lose it, or make it look frozen. All four are fixed, and the fixes
constrain future edits.

**Submit is gated on input validity only.** `composerValidationIssue` disables the button
for an empty prompt, no selected CC Relay, or attachments over the limits, and for nothing
else. It deliberately never reads `state.threads`.

> [!warning]
> Do not reintroduce liveness into the submit gate. `state.threads` is replaced wholesale
> every four seconds and on every SSE `threads` change, so gating on it made the button
> flicker to disabled and produced **Choose a connected terminal before sending** for a
> session that was in fact connected. Plan council readiness and the Turbo worker count are
> validated at submit time, where the message can be exact and a stale process list cannot
> block a valid prompt.

**A submission in flight owns the CC Relay selection.** `renderThreads` reads
`state.submitting` into `selectionLocked` and, while a submission is pending, only paints.
It does not reassign `state.selectedThreadId` and does not flip `state.selectedProvider`.
Before this, a background poll landing between Enter and the POST could send the task to a
different CC Relay than the one the user picked, and the pre-POST idle settle loop, which
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
selected `threadId` plus a `preferIdleTerminal` boolean, and the server picks a free CC Relay
at dispatch. The preference is off for Plan council and for Ctrl+Enter **Run now**, which
keeps pinning to the selected CC Relay. An older backend keeps the client settle loop, which
is the only thing that can delay task creation: it waits up to three seconds for a
just-launched CC Relay to connect, so a task is not pinned to the busy CC Relay the user is
looking at. `settleIdleSubmissionThread` and its two `IDLE_SETTLE_*` constants are written
to be deleted in one piece once the capability is universal; it has a single call site.

## Unknown is not unavailable

Two backend states must never be rendered as an outage.

**Boot-time provider probes.** Codex and Claude are both probed in the background after
listen, so for the first moment after every CC Relay start `/api/status` reports
`available: false` with `pending: true` on the provider object. The header pill renders
that as the neutral `checking` state with **Checking CC Relay**, and `claudePlanIssue` returns
**Checking the Claude CLI** before it will say the CLI is unavailable. Rendering pending as
unavailable opened every launch with a false broken-backend banner. The checking dot needs
no CSS: the base `.live-dot` is already neutral grey and only `online` and `offline`
recolor it, which is why `index.html` ships with `data-state="checking"`.

> [!important]
> The checking state must not mask a genuine outage. It applies only while a provider is
> still `pending`; once a probe answers with `pending: false` and `available: false` the
> pill returns to **CC Relay unavailable**. Both transitions are covered by tests and were
> confirmed against the running app.

**Stale Claude discovery.** A failed `claude agents --json` probe no longer implies an
empty session list. The registry keeps its last known good sessions, sets `lastError`, and
marks itself stale, so sessions and an error now arrive together. The sessions stay listed
and selectable and `claudeDiscoveryNote()` appends one quiet sentence to `#session-message`
saying the list may be out of date and that CC Relay retries automatically. The frontend
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
`:has()` alone. `.agent-tabs` sizes itself with `repeat(auto-fit, minmax(170px, 1fr))`: the two
cards sit side by side in a normal composer and stack to full width once the panel is narrower than
about 378px, which covers the 360px composer minimum and the 420px page width without truncating
the usage count.

`#codex-pool-usage` and `#claude-pool-usage` still exist inside each stepper as `.sr-only`
`aria-hidden` elements so `renderAutomaticTerminalPool()` keeps a valid write target. The visible
count belongs to the tab, and nothing states it twice. `#terminal-pool-controls` survives as the
single lifecycle sentence and keeps the `hidden` toggling that separates automatic and legacy
modes. On a legacy backend the whole tab container is hidden, so the steppers disappear with it and
the CC Relay picker path is untouched. See [[disposable-terminal-pools]] and [[project-workspaces]].

#relay #ui #layout #resizing #design #composer #planner
