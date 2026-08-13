---
name: Compact Interface Density
description: Current header, Launchpad, composer density, and fresh color system.
type: design
---

# Compact Interface Density

CC Relay uses a high-density desktop shell that keeps monitoring and project selection visible without taking space from active work.

> [!important]
> The one-row wide-screen vertical budget is header `58px` and Launchpad `44px`. Two task rows make the header `109px`; three make it `160px`. `.workspace` subtracts the measured `--app-header-height` plus `44px`, while the legacy bounded `.task-list` calculation remains separate. Keep these values synchronized with the 44px task card and 7px row gap.

## Header

- The brand mark is `28px`, header actions are `32px`, and global running-task cards default to `286px` wide. The monitor cog can switch cards to `230px` or `360px` and expand the rail to two or three 44px rows.
- On wide multi-row layouts, row one stays between the brand and action cluster. Rows two and three span the complete padded header width, reclaiming the otherwise empty space below both fixed header regions.
- A running card still exposes metadata, prompt, and latest response, but uses tighter type and a `9px` radius.
- The empty running state remains a content-sized chip.
- At and below `1344px`, the running rail may wrap to its own row.

## Launchpad

On wide screens, `.project-dock` is a single grid row with `heading`, `list`, and `actions` areas. `.project-dock-bar` uses `display: contents` so its heading and actions participate in the dock grid without changing the existing HTML or interaction hooks.

Each desktop `.project-chip` is `176px` by `30px`. Only the folder name and current state are visible beside the identity tile and unpin control; the full path stays available through the card title. The list reserves `2px` of block padding around the cards for a clean scroll track. Unselected cards use a quiet 4 percent identity tint, rising to 7 percent on hover. Selected cards stay vertically centered and use the same one-pixel border geometry, an 11 percent identity tint, and only a quiet one-pixel drop shadow. Do not add an outer keyline or rings around the initial tile. The list scrolls horizontally. At `900px` and below, the project list moves to a second row while heading and actions stay together.

> [!important]
> Do not restore a heading row above the project rail on wide screens. That duplicates vertical structure and makes the Launchpad feel like a separate page section instead of an app control.

## Composer

- Composer and queue panel padding is `18px`.
- The composer heading, workflow tabs, provider tabs, Plan council shell, terminal lifecycle note, retention switch, model controls, and prompt spacing use the compact scale.
- The workflow selector keeps `10px` of internal padding around its heading and two workflow cards. This inset is required in dark mode, where the selector's contrasting well makes the section read as a card.
- Provider pool steppers remain siblings of the provider tab buttons. See [[interface-layout]].
- Lifecycle copy is deliberately short so it does not create unnecessary wrapped lines.

> [!note]
> Do not remove the workflow selector's horizontal padding while compacting the composer. Without it, both workflow cards sit directly against the visible dark-mode well edge.

## Color system

The active interaction color is fresh indigo `#4f5ff6` with soft surface `#eef0ff`. Claude uses coral `#c94f2c`; running uses violet `#7857d8`; failure uses rose `#c94155`. The canvas is cool mist `#f2f6fb` with blue-gray lines `#dbe3ef`.

Project identity uses six brighter dark accents with chromatic soft surfaces:

- Blue `#3558d4`
- Violet `#7442b7`
- Teal `#006f65`
- Sky `#006690`
- Pink `#b33168`
- Green `#4f7022`

All project accents retain at least 4.5:1 contrast both on the strongest project tint and behind the white initial tile. Orange remains reserved for Claude.

## Files and verification

- `public/style.css`
- `public/index.html`
- `public/app.js`
- `public/running-task-layout.js`
- `test/project-layout.test.mjs`
- `test/running-task-layout.test.mjs`
- `test/project-colors.test.mjs`
- `test/semantic-palette.test.mjs`
- `test/composer-workflows.test.mjs`

The complete `npm test` suite passes with 763 tests.

## Queue header control readability

The Queue, History, and Standup controls keep their compact 30px
geometry, but their JetBrains Mono labels use `10px` text instead of `8px`. This matches the
surrounding compact header actions without forcing another queue header row.

> [!note]
> The former **All Relays** button is intentionally absent. Queue and History always include every
> CC Relay in the selected Launchpad, as documented in [[task-history]].

Disabled Standup text remains visibly disabled without becoming illegible. Light mode uses
`#667185` on `#f3f5f8`, a 4.51:1 contrast ratio. Dark mode uses the existing
`--app-text-quiet` token at full opacity on the raised control surface, a 4.92:1 contrast ratio.

> [!note]
> Keep disabled queue header labels opaque. The global dark disabled-control opacity is intended
> for larger controls and makes these small utility labels too faint.

The contract is covered by `test/project-layout.test.mjs`. See [[dark-mode]] for the neutral
graphite palette and contrast tokens.

See [[interface-layout]], [[project-workspaces]], and [[semantic-palette-review]].

## Compact queue cards and panel priority

The wide-screen workspace treats Task queue as a compact index and Task activity as the primary working surface. The default columns are a 580px Composer, a 500px Task queue, and a flexible Task activity panel that receives all remaining width. Composer clamps to a 400px minimum, including for older saved layouts. The right separator now resizes the queue directly. Older saved Composer and Activity widths migrate by deriving the equivalent queue width on first load.

At medium desktop widths, the responsive grid keeps all three panels visible with fluid 300px, 320px, and 380px minimum tracks. At 1100px and below it switches straight to one full-width column. There is no two-panel Composer and Queue state, because that state used the complete first viewport row while pushing Task activity below it at common Electron zoom levels. See [[interface-layout]] and [[task-detail-modal-and-app-zoom]].

Queue cards use 11px by 12px padding and an 8px list gap. Names remain two lines. A distinct prompt preview is capped at two lines, while an automatically prompt-derived name suppresses the repeated preview. The footer keeps owner, runtime, start, and completion evidence in a tighter grid. Manual terminal-session cards use the same geometry with their mode bar aligned to the reduced padding.

> [!note]
> Do not make the queue the flexible desktop column again. Its job is fast scanning around 500px; the terminal needs the surplus width for command output, diffs, and live responses.

## Compact queue action controls

Queued task operations use a 26px instrument scale. **Rename** is a raised secondary control with
a 10px pencil mask. The up and down operations share one segmented shell with 26px square targets,
a single internal divider, and 12px chevrons. The status badge remains outside that control group so
task state is not mistaken for an action.

Dark mode must give `.task-rename-button`, `.task-assign-button`, `.queue-reorder`, and their child
buttons explicit graphite surfaces from [[dark-mode]]. Generic button rules do not cover these
queue-only classes. Without those late dark selectors, their hardcoded light backgrounds punch white
holes through a dark task card. Interaction blue is reserved for hover and focus; idle chrome stays
neutral. Disabled directions remain present but quiet so the pair does not change width at the top or
bottom of the queue.

> [!note]
> The visual chevrons and pencil are CSS masks. Keep the existing button text and `aria-label`
> contracts in `public/app.js`; the masks improve shape without replacing accessible names. See
> [[task-naming]] and [[live-terminal-retention]].

`test/project-layout.test.mjs` protects the 26px geometry, segmented shell, mask icons, and explicit
dark surfaces. An isolated browser preview at the real 500px queue width rendered 457px cards in
both themes with no wrapping and no console warnings or errors. The complete suite passes 1,184
tests.

#relay #ui #layout #density #color
