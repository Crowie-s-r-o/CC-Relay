---
name: Launchpad v2 Design
description: Port of the supplied Launchpad v2 reference, design ownership, compatibility, and verification.
type: design
tags: [relay, ui, design, accessibility]
---

# Launchpad v2 design

The September 5 redesign follows `CC Relay Launchpad v2.html` from Downloads, specifically its
1A workspace and 1B, 1C, and 1D council, Turbo, and terminal-settings states. The source is a
self-contained bundled page. Its decoded template and embedded Latin font assets supplied the
reference; its demo scripts, invented terminal output, and static task data are not application code.

## Current visual contract

`public/launchpad.css` loads after `public/style.css` and owns the new application presentation.
The older sheet retains the component behavior and terminal styles. Scope final selectors through
`html[data-theme]`; ordinary `.class` overrides lose against legacy dark selectors. Project-aware
composer rules also require the existing `#task-form[class*="project-color-"]` boundary.

- Space Grotesk owns interface text and headings; IBM Plex Mono owns compact metadata. Both load
  from local WOFF2 files. The source bundle's unmodified fonts, their OFL licenses, third-party
  notices, and release license checks are all included. The existing terminal typography remains.
- Dark surfaces are canvas `#0b0e12`, panel `#0d1116`, well `#10151b`, and control `#151b22`.
  Text is `#e7edf4`, `#b6c2ce`, and `#8b9aab`. Light mode uses white, cool grey surfaces, and
  muted text `#596b7f`. The three text levels and primary action pass 4.5:1 on every base surface.
- The workspace has continuous surfaces and 8px keyboard-focusable separators. Fresh layouts
  start with a 420px Composer and 440px Queue, giving Activity the remaining width. The usable
  minimums remain 400, 360, and 420px. Saved widths remain authoritative.
- Launchpad tabs are content sized, 110 to 230px wide and 30px high. Names, worded activity,
  project colors, completion counts, reordering, color editing, and unpin controls remain.
- Workflow selection uses neutral raised chrome; provider selection uses provider identity;
  the primary queue action and effort accent use violet. Project colors still identify the
  Launchpad and global monitor, while selected queue cards use a quiet violet edge.
- Provider and direct Model/Effort settings form one group. Plan council exposes its author and
  reviewer in two adjacent columns and retains provider-order switching. Direct settings fold
  away while council is enabled. The same form elements and IDs still own all submissions.
- The writing surface groups the prompt, quick actions, and image picker. Image paste/drop,
  upload limits, attachment previews, task references, and submission shortcuts retain their
  existing event handlers. The primary action spans the Composer width.
- A fresh monitor preference is Bottom. An explicitly cached Top choice and the backend's
  authoritative preferences still restore. Theme continues to follow the system until chosen.

## Geometry and cascade gotchas

> [!important]
> Panel calculations subtract 16px for two 8px separators. The previous geometry subtracted 64px.
> Conversion from a legacy saved Activity width subtracts the additional 48px when deriving Queue
> so that migration still uses the previous coordinate system. ARIA maximum widths subtract 436px
> for the separators plus the 420px Activity minimum. Keep CSS, constraints, and ARIA synchronized.

At 1100px and below the workspace becomes a single scrolling sequence, with a bounded 700px
Activity panel. Electron keeps the workspace as its scroll owner. A fixed-height grid with automatic
rows silently compresses each panel into one third of the available height; use block flow here.
The compact monitor explicitly uses **row** flex direction plus wrapping. The old column direction
combined with wrapping sent entire monitor rails off the right edge despite their 100% widths.

> [!note]
> Model and effort cells must reset `grid-template-areas` as well as columns. The old
> `"index copy select"` named areas create implicit columns and hide labels behind selects when
> only `grid-template-columns` is changed. Council columns must explicitly follow `data-first`.

## Validation and review

The isolated Electron preview served repository assets and synthetic project/task API fixtures on
an ephemeral loopback port. It never contacted the live Relay database or launched provider work.
Captures covered 1720px desktop, 1200px medium, 480px compact, 320px narrow, light and dark themes,
Execute, both council orders, Turbo, terminal settings, and empty projects. No page overflow or
renderer console errors remained. Compact Activity remained reachable above the fixed monitor.

The extra pass verified draft preservation across provider selection, independent capacity focus,
visible keyboard focus, council column order, keyboard panel resizing, saved Top placement and
width restoration after reload, local font loading, enabled valid direct submission, and disabled
submission without a project. The legacy no-terminal empty state also receives an explicit
dark surface so an older backend cannot expose a white panel. Focus emulation was required for the hidden Electron fixture window;
without it Chromium correctly reports no active focus styling even after `element.focus()`.

`test/composer-workflows.test.mjs`, `test/header-position.test.mjs`, `test/project-layout.test.mjs`,
and `test/dark-mode.test.mjs` cover the updated grouping, defaults, saved-width compatibility,
stylesheet ownership, and numerical contrast floor. The full suite (1,990 tests), release metadata check,
and whitespace check pass. Temporary fixture servers and Electron processes exited on completion.

See [[launchpad-v2-design-review]], [[interface-layout]], [[compact-interface-density]],
[[dark-mode]], [[header-position]], [[active-project-composer-colors]],
[[durable-ui-layout-preferences]], and [[hover-stability]].
