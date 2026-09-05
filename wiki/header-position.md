---
name: Monitor Bar Position
description: Persisted top or bottom placement and readable running-task card typography.
type: design
tags: [relay, ui, header, monitoring, accessibility]
---

# Monitor bar position

> [!important]
> **September 5: [[launchpad-v2-design]] is the current design contract.** The application entry
> stylesheet layers legacy rules beneath the structural reference port: 51px dock, 420/440px fresh
> columns, shared prompt toolbar, council/Turbo tables, and two 24px Bottom monitor rows. Older visual descriptions
> below are historical where they conflict; saved layout choices and execution contracts remain.


The complete CC Relay monitor bar defaults to the bottom and can be placed at the top or bottom of the application. Missing or invalid placement values use Bottom in the early HTML bootstrap, renderer restore, and backend normalization. Explicitly saved Top and Bottom values remain authoritative. See [[desktop-chrome-and-monitor-defaults]]. The
control lives inside the rightmost **Display** cog and always describes the available move,
**Bottom** or **Top**.

The preference is stored durably in shared application configuration as part of
`ui-layout-preferences`. Browser `localStorage` under `relay.headerPosition` remains a first-paint
cache. `public/index.html` restores `data-header-position` from that cache before the stylesheet
loads, while `public/app.js` reconciles it with the authoritative saved preference during startup.
The renderer keeps the button label, arrow, accessible name, and `aria-pressed` state in sync.

> [!important]
> Electron starts its embedded HTTP server on a new operating-system-assigned port. Browser
> storage is scoped to the complete origin, including that port, so `localStorage` alone cannot
> preserve the bottom choice across desktop launches. The `/api/ui-preferences` route stores the
> preference in `relay-config.sqlite`, which is stable across those origin changes. See
> [[durable-ui-layout-preferences]].

> [!important]
> Bottom placement moves the complete `.app-header`, not only the running-task rail. Branding,
> global monitoring, appearance, connection state, and queue controls therefore remain one
> coherent bar.

Bottom placement assigns the header to the last body grid row. Top placement assigns it before
the project dock. The workspace owns the remaining flexible row, so neither placement covers
workspace content. The existing height observer remains compatible with saved layout controls.

The running-card type scale is intentionally one pixel larger at each compact level: metadata
`8px`, prompt `11px`, response `10px`, and provider label `8px`. The card width and horizontal
scroll contract from [[interface-layout]] remain unchanged.

Files:

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/header-position.test.mjs`
- `src/ui-preferences.mjs`
- `test/ui-preferences.test.mjs`

## Verification

The durable preference update passes all 1,106 repository tests. Focused layout, header, database,
and preference coverage passes all 39 checks.

> [!note]
> No connected browser surface was available in the non-interactive implementation run. Rendered
> screenshot verification remains useful after the other in-progress stylesheet work settles.

See [[compact-interface-density]], [[dark-mode]], and [[interface-layout]].

#relay #ui #header #monitoring #accessibility
