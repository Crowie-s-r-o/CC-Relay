---
name: Interface Layout
description: Reference-driven visual system, responsive workspace, and persisted panel resizing.
type: architecture
---

# Interface Layout

The Relay UI follows the supplied `Relay.html` reference at its 1680 by 1180 desktop target. The main visual system uses bundled local copies of Instrument Sans, Source Serif 4, and JetBrains Mono, blue interaction states, white rounded panels, and a navy execution console.

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

## Header status contrast

The header status modules use explicit foreground colors because legacy status rules also support the dark visual treatment. On the current white header, labels use muted slate, values use dark navy, and running, paused, and offline states receive blue, amber, and red accents. Keep these overrides scoped beneath `.app-header` and after the legacy rules so a background change cannot leave white status text on a white panel.

Each module uses a two-row CSS grid. The label spans both grid columns, while the state dot and value occupy the second row as one centered unit. The dot must remain in normal grid flow rather than being absolutely positioned, otherwise values with different widths appear inconsistently aligned.

## Execution ledger

The task activity console uses a navy execution-ledger treatment rather than a raw terminal transcript. Its hierarchy is:

1. Session title and live state
2. Command, file, message, error, and active-work metrics
3. Filters, signal count, copy, and follow controls
4. A compact chronological event rail

Event cards use provider-specific accents for Codex, Claude, Plan council, and Relay. Running and error states override the provider accent so urgent state remains scannable. Commands, patches, long messages, and tool payloads keep native disclosure controls and use larger monospace text when expanded.

The right task inspector is a two-row grid. `.task-detail-scroll` owns the independently scrollable upper half and retains normal content padding. The terminal owns the lower 50 percent, remains pinned in place, spans the full panel width, and manages its own event-list scrolling. On narrow screens, the split changes to 55 percent task content and 45 percent terminal.

The terminal has no title header. Runtime state lives in the compact toolbar, metrics use one horizontal 34px row, and event cards use reduced padding, type sizes, trace widths, and gaps. This is intentionally an information-dense monitoring surface rather than a presentation card.

Codex agent-message cards also omit their repeated provider, title, state, duration, and timestamp header. Their full message text renders directly at 13px without the long-message disclosure wrapper. Commands, file changes, errors, tools, and non-Codex providers retain compact headers because their execution metadata remains useful.

Expanded terminal disclosures persist across live polling and filter rerenders. Each event article exposes its stable grouped-entry ID, while each nested `details` element is keyed by its index inside that event. A capture-phase `toggle` listener updates `state.expandedEventDetails`; render snapshots current DOM state before replacement and restores matching disclosures afterward. The set is cleared only when selecting a different task.

The All filter includes Codex reasoning summaries while they stream. Relay consumes `item/reasoning/summaryTextDelta`, accumulates each summary part by item ID, and publishes `item/updated` snapshots that the browser folds into one live reasoning entry. Reasoning remains excluded from Highlights to keep that view compact. Relay intentionally displays only the model-provided summary stream, not private hidden chain-of-thought.

Task reference images render as compact 64px square thumbnails, falling to 56px on narrow screens. Filenames and file sizes remain available through the image link and accessible image alternative, while only the sequence number overlays the thumbnail.

> [!important]
> Keep scrolling separated between `.task-detail-scroll` and `.event-list`. Restoring scrolling on `.detail-panel` makes the terminal move away from the bottom and breaks the monitoring layout.

> [!note]
> Motion is limited to the existing pulse for actively running events and remains disabled under reduced-motion preferences.

## Execution settings

The model control remains a native select for reliable keyboard and platform behavior, wrapped in a styled shell that supplies the visual surface, focus ring, and chevron. Reasoning effort is a native range input mapped directly to the selected model's ordered `supportedReasoningEfforts`. There is no synthetic **Model default** stop. A newly selected model starts on its declared default effort, or its first supported effort when no declared default is available, and Relay stores that explicit effort string.

All model selectors listen to `input`, not `change`. Direct execution, Plan council, and both Turbo model roles therefore update their state, supported effort options, defaults, validation, and submit readiness as soon as the highlighted model changes. Do not move model handling back to `change`, which can wait until a native picker closes or loses focus.

The effort thumb, filled track, active step marker, and value label update during the `input` event so dragging feels immediate. Motion is disabled when reduced motion is requested.

Direct execution presents Model and Effort as compact horizontal controls. Each control keeps its short identifier and hint on the left while the interactive surface occupies the remaining width. The model select is 28px tall, and the effort slider retains its value and step markers without adding a second full-width row.

> [!important]
> Never infer a fixed effort scale in CSS or markup. Models expose different effort lists, so `renderExecutionControls()` must rebuild the range maximum and its index-to-value mapping whenever the provider or model changes.

## Terminal launch layout controls

The terminal window grid controls inside connection help use a two-level layout. A full-width heading row contains the grid enable switch, followed by compact column and row inputs and a flexible monitor selector. This keeps the switch label readable and gives the monitor name the remaining width without allowing it to crowd the other controls. Below 760px, the monitor selector moves to its own row.

On macOS, each grid launch inspects the bounds of currently open Terminal.app windows and places the new window in the first unoccupied cell. Closing a terminal therefore frees that exact cell for the next launch. The launcher's in-memory rotating slot remains a fallback when Terminal window inspection is unavailable or every cell is occupied.

> [!important]
> Do not use only a monotonically advancing slot counter for Terminal.app. It cannot observe closed windows and eventually creates gaps or overlaps after normal close-and-reopen use.

> [!note]
> Keep the column and row controls at stable compact widths on desktop. The monitor selector is the only field that should grow because display names and resolutions vary.

## Connected terminal cards

Connected terminal cards use two information rows. The workspace name and status form the primary row; the task preview and terminal metadata share the secondary row. Icons and selection marks stay compact so a connected session does not dominate the composer vertically.

> [!note]
> Keep preview and metadata independently truncated. Long prompts, paths, and session identifiers must not widen the card or force an extra line.

#relay #ui #layout #resizing #design
