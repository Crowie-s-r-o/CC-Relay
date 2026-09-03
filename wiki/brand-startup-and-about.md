---
name: Brand Startup and About Experience
description: Left-aligned startup tile with segmented progress, branded About dialog, and desktop company identity contract.
type: design
tags:
  - relay
  - electron
  - startup
  - branding
  - about
---

# Brand Startup and About Experience

CC Relay presents a dedicated compact startup window before the embedded server is ready. Electron
shows the window's solid graphite background immediately after creating it, before awaiting the
local splash document. The main desktop window stays hidden until its loopback renderer finishes
the first load, then appears before the splash closes.

## Startup lifecycle

`src/electron-main.mjs` owns two windows during desktop startup:

1. A 376 by 376 frameless splash is created with `show: true` and background `#10151b` immediately
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
> fonts and the bundled Crowie SVG and requires no renderer JavaScript or IPC. It now carries a
> six-segment progress indicator and a shimmering status dot, both pure CSS and both disabled under
> `prefers-reduced-motion: reduce`. It still has no gradient, no decorative background effect, and no
> live process state.

> [!important]
> The Electron `backgroundColor` in `src/electron-main.mjs` and every background declaration in
> `public/splash.css` (`:root`, `html, body`, `.splash`) must be the same `#10151b`. Electron paints
> `backgroundColor` before the document loads, so changing one place alone ships a visible color
> flash on every launch while the focused test still passes. `test/brand-experience.test.mjs` pins
> both sides and forbids the previous `#0d0e11` anywhere in the stylesheet.

> [!important]
> The splash window is frameless and opaque, so `public/splash.css` must not round the tile. A CSS
> `border-radius` on `.splash` would paint the square opaque window corners behind the rounded tile.
> Any visible corner rounding is the operating system's own; macOS rounds frameless windows itself.
> Making the window transparent to allow a CSS radius would break the invariant that a solid
> background is visible immediately.

> [!important]
> `public/splash.html` declares `default-src 'self'; style-src 'self'`, so remote webfonts are
> unavailable by contract. The 3B source design called for Space Grotesk and IBM Plex Mono; the
> shipped splash substitutes the already bundled brand faces instead of loosening the policy or
> adding font files. `instrument-sans-latin.woff2` exists in `public/fonts` but is only
> `@font-face`'d by the main renderer's `public/style.css`, not by the splash.

> [!note]
> The right-hand status label reads `Starting local server`, not the design's `Opening terminals`.
> The splash carries no renderer JavaScript and no IPC channel, so it cannot report live progress.
> The label states the one thing that is always true at that moment. For the same reason the splash
> shows no version string, which would require injection.

## Visual identity

The brand surfaces extend the neutral graphite language from [[dark-mode]] and the font system from
[[interface-layout]]:

- Source Serif 4 carries the 32px `CC Relay` wordmark.
- JetBrains Mono carries every small label: the tagline, the status row, and the credit line.
- Graphite `#10151b` is the only background color. `#e9eff5`, the muted grays `#6d7b8a`, `#48535f`,
  and `#3f4a56`, the single accent green `#4ec98a`, and one `rgba(255,255,255,.07)` inset hairline
  provide the complete hierarchy.
- The frameless window and its content are one 376 by 376 left-aligned tile with 30px padding.
  Reading top to bottom: the Crowie bird mark, a flexible spacer, the `CC Relay` wordmark, the
  tagline `AI work, one task at a time`, the six-segment progress bar, the status row, and the
  credit line `Created by software development company Crowie s.r.o.`, which is now left aligned
  rather than centered.
- The splash reuses `public/favicon.svg` in a 112 by 112 CSS box at the top left. The same
  dark-surface filter used by the main renderer turns the near-black source artwork white without
  creating another asset.
- The progress bar is six equal `flex: 1` segments, 3px tall with 2px radii and 4px gaps. Each runs
  the `ccSeg` keyframe for 4.4s `ease-out infinite`, staggered by `0s`, `.45s`, `.9s`, `1.35s`,
  `1.8s`, and `2.25s`, so a green pulse travels left to right. The status dot is a 5px `#4ec98a`
  circle running the `ccDot` opacity shimmer.
- The mark, the progress bar, its segments, and the dot are `aria-hidden`. The `<main>` keeps
  `role="status"`, `aria-live="polite"`, and the `CC Relay is starting` accessible label, so the
  announced content is the wordmark, tagline, status text, and credit.
- `@media (prefers-reduced-motion: reduce)` removes both animations and settles the segments at a
  legible `rgba(255,255,255,.22)` resting fill, matching the pattern the main renderer already uses
  for `.standup-loading-line`.

The About dialog retains its own rotating signal orbit, which stops when reduced motion is
requested. The splash now carries its own quiet motion, which stops under the same query.

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
controls remain native while the renderer owns a 32px drag region. Its centered lockup contains the
Crowie mark from `public/favicon.svg` and the current local-day provider token sum. It deliberately
omits the repeated product name. Light and dark themes give the title bar matching neutral surfaces
and keep both the mark and compact `Today N` label legible. See [[daily-token-usage]].

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
> before the Crowie token lockup can replace the visible native product title.

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

- Left-aligned 3B tile revision: an isolated Electron capture at the exact production 376 by 376
  frameless dimensions, taken two seconds in so the segment stagger was mid-cycle, showed the white
  Crowie mark at the top left, the Source Serif 4 `CC Relay` wordmark and JetBrains Mono tagline
  above the six-segment bar with a green pulse partway across it, the `Starting` dot beside the
  muted `Starting local server` label, and the single-line company credit. Nothing clipped,
  overflowed, or collided, and the left edge aligned across all five text rows. The focused
  `node --test test/brand-experience.test.mjs test/desktop-icon.test.mjs` passed 10 of 10, the
  complete suite passed 1,945 of 1,945, `release:check` was green for v0.2.32,
  `node --check src/electron-main.mjs` passed, and `git diff --check` was clean.
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
