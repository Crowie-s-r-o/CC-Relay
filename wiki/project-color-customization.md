---
name: Project Color Customization
description: Bright automatic project identities, preset choices, custom colors, and shared persistence.
type: design
---

# Project Color Customization

Launchpad project identities use eight high-separation hues from `public/project-colors.js`:
electric blue, hot magenta, aqua, sunbeam, signal red, lime, ultraviolet, and bright cyan.
The palette excludes orange because orange remains Claude identity.

Automatic assignment still hashes the normalized project path and resolves collisions across the
visible project list. Up to eight pinned projects receive unique slots. Fallback ordering prefers
a separate hue family, not merely the next numeric palette slot. With the project order captured
in the July 31 screenshot, Relay resolves to bright cyan and talent-finder resolves to signal red.

The initial tile on every Launchpad card is a **Change project color** button. It opens a compact
dialog with:

- Automatic assignment
- Eight named predefined colors
- A native custom color picker
- A preview of the project tile and name

Choosing **Automatic** stores `NULL` and returns the project to collision-resolved assignment.
Preset and custom choices store a normalized six-digit lowercase hex value in `projects.color`.
The value is shared between localhost and desktop through `relay-config.sqlite`, using
`PATCH /api/projects/:id/color`. The `projectColors` status capability protects older renderer and
backend combinations.

Custom colors are treated as the user's source hue. `projectColorTokens()` derives separate light
and dark application tokens. The light token is darkened until it keeps at least 4.5:1 contrast
both against the strongest project tint and behind the white initial. The dark token is lightened
until it keeps at least 4.5:1 contrast against the dark initial ink.

The custom tokens flow through the same identity surfaces as automatic colors:

- Launchpad chip, initial, name, and selected outline
- Prompt composer controls and primary action
- Selected queue task
- Global running-task card

> [!important]
> Keep automatic palette colors synchronized between `PROJECT_COLOR_PRESETS` in
> `public/project-colors.js` and `.project-color-1` through `.project-color-8` in
> `public/style.css`. The JavaScript values are the bright dark-theme colors; the CSS light-theme
> values are their contrast-safe derived tokens.

> [!note]
> A user can deliberately choose the same custom color for two projects. Collision resolution
> guarantees uniqueness only for projects using **Automatic**.

Regression coverage lives in `test/project-colors.test.mjs`,
`test/project-config-store.test.mjs`, and `test/database.test.mjs`. See
[[project-workspaces]], [[active-project-composer-colors]], and [[dark-mode]].

#relay #ui #project-color #accessibility #shared-config
