---
name: Monitor Bar Position
description: Persisted top or bottom placement and readable running-task card typography.
type: design
tags: [relay, ui, header, monitoring, accessibility]
---

# Monitor bar position

The complete CC Relay monitor bar can be placed at the top or bottom of the application. The
control is part of the bar and always describes the available move, **Bottom** or **Top**.

The preference is stored in browser `localStorage` under `relay.headerPosition`. `public/index.html`
restores `data-header-position` before the stylesheet loads so the bar does not jump after first
paint. `public/app.js` keeps the button label, arrow, accessible name, and `aria-pressed` state in
sync.

> [!important]
> Bottom placement moves the complete `.app-header`, not only the running-task rail. Branding,
> global monitoring, appearance, connection state, and queue controls therefore remain one
> coherent bar.

Bottom placement fixes the header to the viewport edge and reserves its measured height as body
padding. A `ResizeObserver` updates `--app-header-height` when the bar wraps, so it cannot cover
workspace content at responsive widths.

The running-card type scale is intentionally one pixel larger at each compact level: metadata
`8px`, prompt `11px`, response `10px`, and provider label `8px`. The card width and horizontal
scroll contract from [[interface-layout]] remain unchanged.

Files:

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/header-position.test.mjs`

## Verification

The focused header, layout, dark-mode, Planner, and hover suite passes 70 of 70 checks. The full
suite passes 915 of 916 checks. Its remaining failure is outside this feature:
`test/project-colors.test.mjs` expects exactly eight project accent definitions while the shared
working stylesheet currently contains eight.

> [!note]
> No connected browser surface was available in the non-interactive implementation run. Rendered
> screenshot verification remains useful after the other in-progress stylesheet work settles.

See [[compact-interface-density]], [[dark-mode]], and [[interface-layout]].

#relay #ui #header #monitoring #accessibility
