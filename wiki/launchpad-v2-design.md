---
name: Launchpad v2 Design
description: Structural port of the Launchpad v2 reference, cascade ownership, live controls, and visual verification.
type: design
tags: [relay, ui, design, accessibility]
---

# Launchpad v2 design

The September 5 revision follows `CC Relay Launchpad v2.html`, including 1A (workspace), 1B
(council), 1C (Turbo), and 1D (terminal settings). The first pass retained too much of the old
component structure. This revision replaces those stacked blocks with the reference's shared rows
and tables. Reference data and terminal output are never embedded in the application.

## Presentation ownership

`public/application.css` imports `style.css` into the `legacy` cascade layer, then imports
`launchpad.css` without a layer. Existing compatibility components keep their styles while the
Launchpad rules consistently own the redesigned surfaces. This avoids escalating selector
specificity against the many older theme and project-color rules. Existing `[hidden]` rules remain
binding. The interactive terminal keeps its own small stylesheet and renderer.

- Space Grotesk is the interface face. IBM Plex Mono is used for metadata and the terminal. Fonts
  remain local WOFF2 assets with their existing licenses and release checks.
- Dark surfaces are `#0b0e12`, `#0d1116`, `#10151b`, and `#151b22`. The primary action is `#8b6cff`.
  Body and metadata colors remain readable in both themes; provider colors have separate light
  and dark values. Theme still follows the system until the operator selects one.
- The reference-sized viewport is 1720 by 1040. The dock is 51px high. Composer and Queue start
  at 420px and 440px. Activity takes the remaining 860px. Panels share hairline borders with no
  layout gutters. Resizers retain overlapping 8px pointer and keyboard targets.
- Project chips are 30px high and fit their contents, up to 300px or the available rail width.
  Every project shows its state as visible text. Running uses a filled violet badge; Idle uses
  neutral text and a hollow dot. Names truncate before status or close controls can shrink.
  Reorder handles remain keyboard accessible; names, colors, completion counts, color editing,
  and close controls retain the existing ownership and handlers. See [[project-activity-visibility]].
- Daily recorded token usage and its project popover now belong to the project dock in both the
  browser and desktop app. The first content bar also owns macOS dragging and native control clearance, without a separate empty strip. See [[desktop-chrome-and-monitor-defaults]].

## Composer and workflows

The provider card contains the live slot summary, three provider tiles, and one Model/Effort row.
Each tile has a real minus/input/plus stepper. It dispatches the existing input change handler and
therefore uses the existing project PATCH, bounds checks, saving lock, and rollback behavior.
Changing capacity does not select a provider or submit a prompt. The effort slider uses the active
project's accent, a full-width rail with fixed stops, and a value beside its heading. Its accessible
value still includes the word "effort". Keeping the value outside the rail prevents label changes
from resizing an active drag target. See [[task-selection-and-effort-control]].

Direct council and automatic-terminal options share adjoining rows. When council is enabled, the
provider card is replaced by a matrix with aligned Agent, Model, Effort, and Role rows. Columns
follow the actual author provider. Turbo uses aligned Planner and Execution rows; its reviewer
row appears only when council is enabled and follows the actual author order.

The task name is a 34px field. The prompt is the flexible surface. Voice input, image selection
and count, and real quick actions share its footer. Image previews appear only when images exist.
The prompt shell owns its rounded focus ring. Footer actions align from the left, wrap with
consistent gaps, and share a 26px height without extra voice-wrapper chrome. See
[[composer-corners-and-toolbar]].
Paste/drop, limits, references, drafts, voice setup, submission shortcuts, and immediate quick-action
execution retain their original controls. The primary action is 38px high.

> [!important]
> A cached active project can cause `selectProject` to skip its initial mode render. After
> `loadSnapshot` has loaded capabilities and projects, it must refresh automatic pool controls.
> The extra visual pass found that omitting this left the old terminal picker on a reload even
> though the backend advertised automatic pools. The Electron smoke checks this cached reload.

## Queue, activity, and monitor

The queue header owns search and the live summary. Cards use an identity line, a two-line title,
and a compact dates/tokens/runtime footer. Full owner labels remain in tooltips and accessibility
text. Same-day completion timestamps show only the ending time, while overnight completions retain
the ending date and all `<time datetime>` values. Stars, rename, assignment, reorder, attachments,
workflow state, and task selection keep their existing actions.

Selected Queue and History cards use their project's accent border and a tinted surface, including
on hover. The border keeps its one-pixel geometry so selection never moves a pointer target.

Activity has a compact identity header, live metrics, and Terminal/Conversation controls.
**More views** exposes Relay activity, Highlights, Commands, My messages, and AI messages, with the
active secondary view named in the summary. Existing full details, cancellation, retention,
changes, copy, and terminal-window controls remain available. Aggregate recorded in/out tokens
remain visible even when a throughput sample is unavailable.

> [!note]
> The view rail wraps with visible overflow so the More views dropdown escapes the tab row.
> Compact layouts anchor the dropdown inside the rail's right edge. Native pointer and keyboard
> checks live in `verify-launchpad.cjs --more-views`; see [[more-views-menu-review]].

The terminal uses actual task-scoped output. Interactive sessions use the CLI's own input; legacy
read-only screens retain the follow-up composer. The redesign does not change terminal ownership,
launch identity, transport, or conversation routing. Concurrent interactive-terminal work was
preserved and its visible surface was checked with a synthetic WebSocket snapshot.

Fresh preferences use Bottom and two 48px monitor rows separated by 5px. Existing saved row count,
card width, and placement win. Cards use the selected 230px, 286px, or 360px width, capped by the
available rail width, rather than stretching across spare space. Each card has a metadata line,
a project/title line, and the latest recorded agent message with its provider label. Long titles
and messages truncate with ellipses; their existing hover text retains the full content. The
existing response feed, waiting fallback, open-session result/error fallback, and refresh signature
remain authoritative. Both rows stay between the brand and usage controls. All five subscription windows are visible
in the monitor: Cla 5h, Cla Week, Fable, Cod 5h, and Cod Week. At compact widths they occupy their
own row with the Display cog alongside, keeping percentages and reset countdowns visible.
Codex five-hour-only accounts do not require a weekly window. See [[provider-usage-visibility-review]].

> [!note]
> The initial port used `minmax(..., 1fr)` columns and hid `.header-running-response`, producing
> very long cards without the last message. The September 5 follow-up restores bounded columns
> and the preview. Metadata stays separate so session state and metrics cannot consume the title
> or message line. See [[compact-task-monitor-review]].

## Terminal settings

The 640px dialog uses divided groups for layout, completion alerts, quick actions, and available
voice settings. Grid dimensions use real steppers. Quick-action labels and prompts remain editable;
a prompt grows when focused. Settings still save immediately, so the footer accurately says
**Changes are saved automatically** and provides **Done**. The reference's Save/Cancel controls
are not presented as transactional when the application saves on change.

## Layout invariants

The body owns dock, workspace, and monitor as explicit grid rows. The workspace is the bounded
scroll owner at compact widths. From 1101px through 1344px it uses three fluid columns; at 1100px
and below it stacks Composer, Queue, and Activity, with a bounded 780px Activity panel. The macOS
native controls share the first content row. There is no extra titlebar track. Moving the monitor never covers the workspace.

The terminal height separator overlaps its neighbors instead of consuming layout height. Its
pointer and keyboard targets remain available. A saved terminal height sets the event pane flex
basis; without a saved value, the compact reference header and flexible terminal are used.

> [!important]
> Overlapping resizers consume no layout width. Width constraints use the full workspace width
> and reserve 420px for Activity. Legacy composer/detail preference conversion still subtracts
> the original 64px of chrome. CSS, pointer behavior, keyboard bounds, and ARIA must agree.

Reset old grid areas, pseudo-elements, margins, and minimums when rebuilding a component. The
council's legacy `::before` stripe occupied a real table row; the Turbo reviewer had an inherited
conditional `display` rule. Settings groups must not shrink inside their scrolling body. The
monitor must retain an actual flex wrapper in multi-row mode; legacy `display: contents` expanded
the entire document beyond the viewport. These cases are checked in the rendered preview.

## Verification

Run `node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-launchpad-check` on
macOS. It serves repository assets with isolated synthetic HTTP and WebSocket fixtures, captures
both themes and workflow variants, and exits after closing its window, sockets, and server. It
never attaches to a live Relay server or launches provider work.

The smoke checks reference geometry, attachment staging/removal, capacity bounds and one PATCH
per click, provider isolation, council row alignment/order, Turbo reviewer visibility, secondary
views, draft/focus preservation, keyboard resizing, saved layout restoration, cached-project
startup, native titlebar layout, interactive output, the compact terminal dialog, and empty projects.
Screens cover 1720, 1200, 480, 380, and 320px. The full suite, release metadata, and whitespace gates
are recorded in [[launchpad-v2-design-review]].

See [[interface-layout]], [[compact-interface-density]], [[header-position]], [[dark-mode]],
[[durable-ui-layout-preferences]], and [[original-terminal-default]].
