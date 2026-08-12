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

CC Relay presents a dedicated Crowie startup window before the embedded server is ready. Electron
shows the window's solid graphite background immediately after creating it, before awaiting the
local splash document. The main desktop window stays hidden until its loopback renderer finishes
the first load, then appears before the splash closes.

## Startup lifecycle

`src/electron-main.mjs` owns two windows during desktop startup:

1. A 520 by 600 frameless splash is created with `show: true` and background `#0d0e11` immediately
   after Electron is ready.
2. `public/splash.html` loads into the already visible window.
3. The embedded server starts and selects its loopback ports.
4. The main application window is created with `show: false` and loads the live renderer.
5. The main window is shown and focused, then the splash closes.

The single-instance handler focuses whichever window currently exists, so a second launch brings
the splash forward during startup and the main application forward after handoff.

> [!important]
> The splash must be created before `await import('./server.mjs')`, and its window must be visible
> before `loadFile()` is awaited. Moving it after `serverReady` or waiting for the document before
> showing the window recreates an invisible startup gap.

> [!note]
> The splash is a packaged local file, not part of the loopback renderer. It uses the existing
> `public/favicon.svg` Crowie artwork and bundled fonts, requires no renderer JavaScript, and has no
> animation, transition, progress track, gradient, or decorative background effect. The Electron
> `backgroundColor` and CSS background are identical so the first frame and loaded document match.

## Visual identity

The brand surfaces extend the neutral graphite language from [[dark-mode]] and the font system from
[[interface-layout]]:

- Source Serif 4 carries the CC Relay display name.
- Instrument Sans carries product copy.
- JetBrains Mono carries company and operational labels.
- Graphite `#0d0e11` is the splash's only background color. Blue `#7aa2f7`, white, and muted gray
  provide the logo and text hierarchy.
- A centered crow mark, product name, company attribution, and plain startup message form the
  complete splash. The splash has no moving or ornamental status indicator.

The About dialog retains its own rotating signal orbit, which stops when reduced motion is
requested. The loading screen does not share that motion.

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

- `node --test test/brand-experience.test.mjs`: 4 passed.
- Complete clean-worktree suite with only the splash revision applied: 1,419 passed.
- `npm run release:check`: release metadata consistent for v0.2.3.
- `node --check src/electron-main.mjs` and `git diff --check`: passed.
- Isolated Electron capture checked at the exact 520 by 600 splash size. The rendered screen has one
  solid background, the Crowie logo, static text, no progress indicator, and no visual overflow.

See [[packaged-renderer-startup]], [[product-naming]], and [[desktop-updates]].

#cc-relay #electron #startup #branding #about
