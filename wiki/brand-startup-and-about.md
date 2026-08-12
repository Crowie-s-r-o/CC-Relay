---
name: Brand Startup and About Experience
description: Crowie splash lifecycle, branded About dialog, and desktop company identity contract.
type: design
tags:
  - relay
  - electron
  - startup
  - branding
  - about
---

# Brand Startup and About Experience

CC Relay now presents a dedicated Crowie startup window before the embedded server is ready. The
main desktop window stays hidden until its loopback renderer finishes the first load, then appears
before the splash closes. This removes the previous period where application launch had no visible
feedback.

## Startup lifecycle

`src/electron-main.mjs` owns two windows during desktop startup:

1. A 520 by 600 frameless splash loads `public/splash.html` immediately after Electron is ready.
2. The embedded server starts and selects its loopback ports.
3. The main application window is created with `show: false` and loads the live renderer.
4. The main window is shown and focused, then the splash closes.

The single-instance handler focuses whichever window currently exists, so a second launch brings
the splash forward during startup and the main application forward after handoff.

> [!important]
> The splash must be created before `await import('./server.mjs')`. Moving it after `serverReady`
> recreates the original invisible startup gap.

> [!note]
> The splash is a packaged local file, not part of the loopback renderer. It uses the existing
> `public/favicon.svg` Crowie artwork and bundled fonts, requires no renderer JavaScript, and keeps
> animation behind `prefers-reduced-motion`.

## Visual identity

The brand surfaces extend the neutral graphite language from [[dark-mode]] and the font system from
[[interface-layout]]:

- Source Serif 4 carries the CC Relay display name.
- Instrument Sans carries product copy.
- JetBrains Mono carries company and operational labels.
- Graphite `#0d0e11`, blue `#7aa2f7`, cyan `#7dcfff`, and teal `#73daca` connect the crow to Relay's
  operator palette.
- One rotating signal orbit is the shared signature across splash and About. It stops when reduced
  motion is requested.

The header brand lockup is now an accessible button that opens the in-app About dialog. The dialog
explicitly presents:

- Crowie s.r.o.
- Software Development company
- Ing. Patrik Kelemen
- Founder and software engineer

The dialog has full light and dark treatments, stacks at compact widths, stays horizontally bounded,
and scrolls vertically when its content exceeds the available height. Electron's native About panel
also receives the company, founder, copyright, version, website, and author metadata.

## Files

- `src/electron-main.mjs`
- `public/splash.html`
- `public/splash.css`
- `public/index.html`
- `public/style.css`
- `public/app.js`
- `test/brand-experience.test.mjs`

## Verification

- Focused startup, icon, dark-mode, and brand tests: 19 passed.
- Complete repository suite: 1,406 passed.
- `npm run release:check`: release metadata consistent for v0.2.2.
- Live isolated loopback renderer visual check at the exact 520 by 600 splash size.
- About dialog checked in light and dark themes at 1200 by 900.
- Compact About checked at 520 by 760 with no horizontal overflow.
- No browser warnings or errors during the visual checks.

See [[packaged-renderer-startup]], [[product-naming]], and [[desktop-updates]].

#cc-relay #electron #startup #branding #about
