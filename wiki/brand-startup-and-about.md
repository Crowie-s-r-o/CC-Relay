---
name: Brand Startup and About Experience
description: Minimal square startup lifecycle, branded About dialog, and desktop company identity contract.
type: design
tags:
  - relay
  - electron
  - startup
  - branding
  - about
---

# Brand Startup and About Experience

CC Relay presents a dedicated minimal startup window before the embedded server is ready. Electron
shows the window's solid graphite background immediately after creating it, before awaiting the
local splash document. The main desktop window stays hidden until its loopback renderer finishes
the first load, then appears before the splash closes.

## Startup lifecycle

`src/electron-main.mjs` owns two windows during desktop startup:

1. A 320 by 320 frameless splash is created with `show: true` and background `#0d0e11` immediately
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
> The splash is a packaged local file, not part of the loopback renderer. It loads only bundled
> fonts and the bundled Crowie SVG, requires no renderer JavaScript, and has no animation,
> transition, progress track, gradient, or decorative background effect. The Electron
> `backgroundColor` and CSS background are identical so the first frame and loaded document match.

## Visual identity

The brand surfaces extend the neutral graphite language from [[dark-mode]] and the font system from
[[interface-layout]]:

- Source Serif 4 carries the CC Relay display name.
- JetBrains Mono carries the small operational label.
- Graphite `#0d0e11` is the only background color. White, muted gray, and one inset hairline provide
  the complete hierarchy.
- The frameless window and its content are one 320 by 320 square. The centered product name and
  `Starting` sit above the Crowie bird mark, and the quiet two-line attribution `Created by software
  development company Crowie s.r.o.` sits below it.
- The splash reuses `public/favicon.svg` in a 64 by 64 CSS box at the visual center. The same
  dark-surface filter used by the main renderer turns the near-black source artwork white without
  creating another asset. The splash still omits the tagline, progress indicator, rounded corners,
  and motion. The attribution uses an accessible 4.61:1 muted-gray contrast without competing with
  the startup state. The fuller company identity remains available in About.

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
uses one centered founder credit beneath the version, without the in-app company's descriptive
tagline, and also receives copyright, version, website, and author metadata.

> [!note]
> Keep the native `credits` value to one line. macOS centers that single credit in the standard
> About panel; adding a newline produces the visually left-aligned block used by the earlier design.

## macOS main-window title bar

The main macOS Electron window uses `titleBarStyle: 'hiddenInset'` so the standard traffic-light
controls remain native while the renderer owns a 36px drag region. That region contains only the
centered Crowie mark from `public/favicon.svg`. It deliberately omits the repeated product name.
Light and dark themes give the title bar matching neutral surfaces and keep the mark legible.

The desktop-only renderer state is set in the early `public/index.html` bootstrap only when three
facts agree: the user agent is Electron, the user agent is Macintosh, and the URL carries the
versioned `desktopTitlebar=hidden-inset-v1` marker. `src/desktop-titlebar.mjs` gives the main process
both the `hiddenInset` BrowserWindow option and that matching renderer URL. Browser use, non-macOS
Electron windows, and an older Electron main process therefore retain their native chrome without
rendering an extra title-bar row.

> [!important]
> BrowserWindow chrome is fixed when the window is created. Refreshing newer renderer files inside
> an older default-title shell cannot retrofit `hiddenInset`. The versioned URL marker keeps that
> split-version window from drawing a second title bar, but a rebuild and relaunch are still required
> before the Crowie mark can replace the visible native product title.

> [!note]
> Task 752 exposed this boundary with the installed v0.2.10 app while the repository was already at
> v0.2.12. The installed `app.asar` had neither the `hiddenInset` option nor title-bar markup. Treat
> the installed bundle version and process start time as authoritative when a screenshot disagrees
> with the current renderer source.

> [!important]
> Do not use `setRepresentedFilename()` to place this logo. That API declares that the window
> represents a real file and adds document-proxy behavior that is false for CC Relay. Keep the
> branded drag region and the Darwin-only `hiddenInset` window option paired.

See [[interface-layout]], [[dark-mode]], and [[header-position]].

## Files

- `src/electron-main.mjs`
- `src/desktop-titlebar.mjs`
- `public/splash.html`
- `public/splash.css`
- `public/favicon.svg`
- `public/index.html`
- `public/style.css`
- `public/app.js`
- `test/brand-experience.test.mjs`
- `test/desktop-icon.test.mjs`
- `test/desktop-titlebar.test.mjs`

## Verification

- Centered Crowie mark revision: an exact Electron 43.4 capture at the production 320 by 320
  dimensions showed the white bird centered between the startup label and company credit, with no
  clipping or overflow. The focused startup and icon checks passed 10 of 10, the complete suite
  passed 1,574 of 1,574, `release:check` was green for v0.2.14, and `git diff --check` was clean.
- Minimal square revision: an isolated Electron 43.4 capture at the exact 320 by 320 production
  dimensions showed one sharp graphite square containing `CC Relay`, `Starting`, and the restrained
  Crowie s.r.o. company attribution, with no overflow or additional artwork. The attribution wraps
  cleanly onto two centered lines. The 32 focused startup, icon, title-bar, and layout checks passed.
  The complete suite passed 1,551 tests, `release:check` was green for v0.2.12, and
  `git diff --check` was clean.
- Versioned shell-marker revision: 39 focused title-bar, startup, zoom, and layout tests passed. An
  isolated Electron 43.4 macOS window using the production option and URL helpers showed one 36px
  title bar with native traffic lights and the centered Crowie mark, with no visible `CC Relay`
  title. The temporary probe and its process were removed after capture. The complete suite passed
  1,551 tests, `release:check` was green for v0.2.12, and `git diff --check` was clean.
- Centered title-bar and fixed-shell revision: `node --test test/desktop-icon.test.mjs
  test/project-layout.test.mjs` passed 18 of 18.
- Current complete suite: `npm test` passed 1,551 of 1,551.
- Current `npm run release:check` and `git diff --check`: passed for v0.2.12.
- Isolated macOS Electron captures checked dark and light title bars at 1540 by 980 and 1120 by
  760. The root scroll area matched the viewport at both sizes, the centered mark stayed visible,
  and the compact workspace retained full-height Composer and Queue panels inside its own scroll.
- `node --test test/brand-experience.test.mjs`: 4 passed.
- Complete clean-worktree suite with only the splash revision applied: 1,419 passed.
- `npm run release:check`: release metadata consistent for v0.2.3.
- `node --check src/electron-main.mjs` and `git diff --check`: passed.
- The original branded splash revision was also captured at its former 520 by 600 size before the
  later minimal-square redesign.

See [[packaged-renderer-startup]], [[product-naming]], and [[desktop-updates]].

#cc-relay #electron #startup #branding #about
