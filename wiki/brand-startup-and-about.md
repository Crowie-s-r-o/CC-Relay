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
> flash on every launch while the focused test still passes. `test/brand-experience.test.mjs` holds
> the graphite in one `GRAPHITE` constant, asserts the Electron literal against it, extracts the
> `:root`, `html, body`, and `.splash` rule bodies with `splashRule()` and asserts the constant
> inside each one independently, and forbids the previous `#0d0e11` anywhere in the stylesheet.

> [!warning]
> Assert splash CSS declarations inside an extracted rule body, never with a lazy
> `/selector \{[\s\S]*?declaration/` scan across the stylesheet. That pattern walks past the end of
> the named rule and is satisfied by any later block, so it silently accepts a mutated value.
> `splashRule()` anchors on the previous rule's closing brace, and that anchor is what keeps
> `.splash-credit` from resolving to the grouped typography selector it also appears inside.
>
> The brace anchor is *not* what saves `.splash-seg` and `.splash-dot` from the
> `prefers-reduced-motion` overrides. Those overrides are themselves preceded by a closing brace and
> would satisfy the same pattern. They are avoided only because `String.match` returns the first
> match and the standalone rules appear earlier in source order. Keep every standalone splash rule
> above the `@media (prefers-reduced-motion: reduce)` block, or these assertions silently start
> reading the override body.
>
> `splashRule()` also matches raw stylesheet text, so `public/splash.css` comments are stripped once
> when the test module loads. Without that strip a commented-out decoy such as
> `/* legacy: } .splash-credit { color: #000000; } */` placed before the real rule is returned in
> place of the live declaration. A renamed selector still throws loudly rather than matching an
> empty body.

> [!important]
> The splash window is frameless and opaque, so `public/splash.css` must not round the tile. A CSS
> `border-radius` on `.splash` would paint the square opaque window corners behind the rounded tile.
> Any visible corner rounding is the operating system's own; macOS rounds frameless windows itself.
> Making the window transparent to allow a CSS radius would break the invariant that a solid
> background is visible immediately.

> [!warning]
> Never check the splash for overflow with `document.documentElement.scrollHeight`. The
> `html, body { overflow: hidden }` rule pins that value at the 376px viewport regardless of content:
> a probe with a 102px-tall credit line and another with a 300px mark both still reported 376. A
> splash layout check must measure element geometry instead, for example each row's
> `getBoundingClientRect().bottom` against the 376px window height. Do not relax `overflow: hidden`
> to make the measurement easier; that rule is what keeps the frameless window from scrolling.

> [!important]
> `public/splash.html` declares `default-src 'self'; style-src 'self'`, so remote webfonts are
> unavailable by contract. The 3B source design called for Space Grotesk and IBM Plex Mono; the
> shipped splash substitutes the already bundled brand faces instead of loosening the policy or
> adding font files. `instrument-sans-latin.woff2` exists in `public/fonts` but is only
> `@font-face`'d by the main renderer's `public/style.css`, not by the splash.

> [!important]
> The splash grays were deliberately raised above the raw 3B design spec and must not be "restored".
> The spec's greys put the only informative text far below WCAG AA on `#10151b`: the left status was
> `#6d7b8a` at 4.24:1, the right status note `#48535f` at 2.34:1, and the credit line `#3f4a56` at
> 2.03:1, down from the 4.61:1 credit the previous splash shipped. Every text row now clears WCAG AA
> 4.5:1 on the graphite ground, and the five rows form one deliberate brightness ladder: the wordmark
> `#e9eff5` at 15.83:1, the tagline `#8392a3` at 5.77:1, the left status `#7e8c9d` at 5.35:1, the
> right status note `#798797` at 5.00:1, and the credit line `#748190` at 4.62:1, quietest. The
> reduced-motion resting segment fill moved from `rgba(255,255,255,.22)` at 2.00:1 to
> `rgba(255,255,255,.34)` at 3.11:1; that fill is a non-text graphic, so 3:1 is its bar.
>
> An interim revision raised only the two status labels, to `#7a8898` at 5.07:1 and `#718192` at
> 4.59:1, and left the tagline at the spec's `#6d7b8a` (4.24:1) and the credit at `#6a7684`
> (3.96:1). Both of those were still below AA for 11px and 9.5px body text, and the 3:1 tier does
> not apply to either row. Raising all four together also removed the earlier oddity where the right
> status note read brighter than the 11px brand tagline. The four small-label greys sit on one
> blue-grey axis (r/b 0.803, g/b 0.894), the same axis `#7a8898` was on, so the ramp itself did not
> change. The wordmark, the accent green `#4ec98a`, and the animated segment colors are unchanged.

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
- Graphite `#10151b` is the only background color. `#e9eff5`, the muted grays `#8392a3`, `#7e8c9d`,
  `#798797`, and `#748190`, the single accent green `#4ec98a`, and one `rgba(255,255,255,.07)` inset
  hairline provide the complete hierarchy.
- The small-label grays are contrast-driven, not decorative. Against `#10151b` the tagline `#8392a3`
  measures 5.77:1, the left status `#7e8c9d` measures 5.35:1, the right status note `#798797`
  measures 5.00:1, and the credit line `#748190` measures 4.62:1. Every text row on the splash, the
  `#e9eff5` wordmark at 15.83:1 included, must stay at or above WCAG AA 4.5:1, and that order is the
  intended ladder: wordmark brightest, tagline next as the 11px brand line, then the left status,
  then the right status note, then the credit quietest. `test/brand-experience.test.mjs` pins all
  five literals.
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
  legible `rgba(255,255,255,.34)` resting fill, matching the pattern the main renderer already uses
  for `.standup-loading-line`. That alpha composites to 3.11:1 over the graphite ground. The earlier
  `.22` measured 2.00:1 and was not legible at rest.

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

- Splash AA ladder and assertion-coverage revision: all five splash text rows now clear WCAG AA
  4.5:1 on `#10151b` in one fixed brightness order, wordmark `#e9eff5` 15.83:1, tagline `#8392a3`
  5.77:1, left status `#7e8c9d` 5.35:1, right status note `#798797` 5.00:1, credit `#748190` 4.62:1.
  `test/brand-experience.test.mjs` gained assertions for the wordmark color and `font-weight: 600`,
  the `@keyframes ccDot` body including the `50% { opacity: .35 }` stop, the `.splash-status`
  `font-size`, `text-transform: uppercase` and `justify-content: space-between`, the 5px
  `.splash-dot` size, the `.splash` inset hairline `box-shadow`, the `.splash-progress` and
  `.splash-credit` top margins, and both `@font-face` sources with an `existsSync` check that the
  referenced woff2 files are really on disk. Its rule extractor now strips CSS comments before
  matching. A scratchpad mutation run over a mirrored tree killed 19 of 19 with no survivors: 13
  mutations covering every coverage gap listed from the independent verifier's 60-mutation sweep,
  the four restored pre-fix colors, a comment decoy hiding a mutated `.splash-credit` body, and a
  renamed selector that must throw loudly. A control run confirmed a decoy comment in front of a correct rule does not fail the
  suite, and a direct comparison showed the pre-fix raw-text extractor returning
  ` color: #000000; margin-top: 4px; ` from the comment while the stripped extractor returns the
  live rule. An isolated Electron capture at the exact production 376 by 376 frameless size, taken
  two seconds in, showed the raised greys still reading as one muted band beneath the wordmark with
  the credit line quietest and nothing washed out or flat. The focused
  `node --test test/brand-experience.test.mjs test/desktop-icon.test.mjs` passed 10 of 10, the
  complete suite passed 1,950 of 1,950, `release:check` was green, and `git diff --check` was clean.
- Splash contrast and assertion-strength revision: the three small-label grays and the
  reduced-motion resting fill were raised above the raw design spec, with the before and after
  ratios recorded in the accessibility callout above. Isolated Electron captures at the exact
  production 376 by 376 frameless dimensions, taken two seconds in and then again under an emulated
  `prefers-reduced-motion: reduce`, showed the raised grays still reading as one muted band beneath
  the wordmark with the credit line quietest, and showed six flat, clearly visible resting segments
  in the reduced-motion frame. Only the segments lose their green there. The 5px `.splash-dot` stays
  `rgb(78,201,138)` at full opacity under reduced motion, because the query removes its shimmer
  animation and nothing else. The lazy cross-block CSS regexes in
  `test/brand-experience.test.mjs` were replaced with `splashRule()` block extraction; a scratchpad
  mutation run over a mirrored copy of the tree killed 23 of 23 of the mutations that revision
  defined, including each of the six
  segment `animation-delay` values, all four graphite surfaces, the `.splash-credit` font size, both
  `ccSeg` keyframe colors, the progress `gap`, the tagline font size, `overflow: hidden`, an
  `aria-hidden` added to the status row, and every restored pre-fix color. That 23 of 23 covered
  only the mutations that revision itself chose. An independent verifier later ran 60 mutations
  against the same suite and found 13 structural survivors, which the AA ladder and coverage
  revision above closes. The focused
  `node --test test/brand-experience.test.mjs test/desktop-icon.test.mjs` passed 10 of 10, the
  complete suite passed 1,950 of 1,950, `release:check` was green for v0.2.33, and `git diff --check`
  was clean.
- Left-aligned 3B tile revision: an isolated Electron capture at the exact production 376 by 376
  frameless dimensions, taken two seconds in so the segment stagger was mid-cycle, showed the white
  Crowie mark at the top left, the Source Serif 4 `CC Relay` wordmark and JetBrains Mono tagline
  above the six-segment bar with a green pulse partway across it, the `Starting` dot beside the
  muted `Starting local server` label, and the single-line company credit. Nothing clipped,
  overflowed, or collided, and the left edge aligned across all five text rows. The focused
  `node --test test/brand-experience.test.mjs test/desktop-icon.test.mjs` passed 10 of 10, the
  complete suite passed 1,950 of 1,950, `release:check` was green,
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
