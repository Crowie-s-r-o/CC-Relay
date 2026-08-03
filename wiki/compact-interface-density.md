---
name: Compact Interface Density
description: Current header, Launchpad, composer density, and fresh color system.
type: design
---

# Compact Interface Density

CC Relay uses a high-density desktop shell that keeps monitoring and project selection visible without taking space from active work.

> [!important]
> The wide-screen vertical budget is header `58px`, Launchpad `44px`, `.workspace height: calc(100vh - 102px)`, and the legacy bounded `.task-list height: calc(100vh - 202px)`. Move these values as one set.

## Header

- The brand mark is `28px`, header actions are `32px`, and the global running-task cards are `286px` wide.
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
- Provider pool steppers remain siblings of the provider tab buttons. See [[interface-layout]].
- Lifecycle copy is deliberately short so it does not create unnecessary wrapped lines.

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
- `test/project-layout.test.mjs`
- `test/project-colors.test.mjs`
- `test/semantic-palette.test.mjs`
- `test/composer-workflows.test.mjs`

The complete `npm test` suite passes with 763 tests.

## Queue header control readability

The Queue, History, Import localhost, and Standup controls keep their compact 30px
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

#relay #ui #layout #density #color
