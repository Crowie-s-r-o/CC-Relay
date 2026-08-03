---
name: Dark Mode
description: Persistent midnight theme, interaction contract, and visual palette for CC Relay.
type: design
---

# Dark Mode

CC Relay has a locally persisted light and dark appearance. The header toggle writes `relay.theme`
to browser `localStorage`; on a first visit, the app follows `prefers-color-scheme`. A small
initializer in `public/index.html` sets `data-theme` before the stylesheet loads so the initial
frame does not flash the wrong appearance.

## Visual direction

Dark mode extends the [[interface-layout|execution ledger]] into the full application. The shell is
a neutral graphite ladder anchored on the ledger canvas. Hue belongs to status and identity only,
never to a background:

- Canvas: `#08090d`
- Inset wells: `#0d0e11`
- Panels: `#131418`
- Raised controls: `#1b1d22`
- Lines: `#2b2e35`, strong lines `#3d414c`
- Primary text: `#e9ebef`
- Body text: `#d3d6dc`
- Secondary text: `#9ca2ad`
- Quiet interactive text: `#858b96`
- Interaction blue: `#7aa2f7`

> [!important]
> The shell surfaces and text tones are neutral greys, not tinted navy. The July 30, 2026 pass
> replaced the indigo family (`#12162a` panels, `#0c0e17` wells, `#e5ebff` ink and roughly eighty
> related hardcoded navys) because the accumulated blue cast read as murky rather than calm, and it
> muddied the accent hues it was meant to support. `test/dark-mode.test.mjs` now fails any shell
> token whose largest channel spread exceeds 14, so a navy cannot creep back in as a token value.
> The canvas stays flat: the blue and violet radial pools behind the workspace were removed.

Violet `#bb9af7` means running, teal `#73daca` means complete, green `#9ece6a` means live, amber
`#e0af68` means warning, red `#f7768e` means failure, and orange `#ff9e64` remains reserved for
Claude. Bright primary actions use terminal ink `#071021` instead of white text.

The execution ledger keeps its Tokyo Night syntax hues, but its own chrome tokens (`--term-panel`,
`--term-border`, `--term-line`, `--term-sep`, `--term-meta`, `--term-muted`, the gutter number and
the timestamp) were neutralised to match the shell and lifted out of the 1.6:1 to 2.1:1 band they
had drifted into. Those tokens are shared by both themes, so the change is visible in light mode
too, where the ledger is also dark.

> [!important]
> Dark project and CC Relay identities use six bright terminal hues: blue, violet, teal, cyan,
> magenta, and green. Orange is not an identity slot because it remains Claude-specific.

> [!note]
> The smallest normal dark-theme text token is `#7f89b5`. It measures 4.72:1 against the raised
> `#1a2035` control surface. Primary, body, and secondary text exceed that threshold by a wider
> margin. `test/dark-mode.test.mjs` protects these contrast floors.

> [!important]
> The Tokyo Night execution ledger owns its own complete palette. Dark-mode selectors must not
> target `.events-section` or its descendants. This preserves the terminal's established syntax
> hierarchy and opaque sub-surfaces described in [[interface-layout]].

> [!note]
> The Crowie SVG is near-black and receives a dark-mode-only CSS filter so it remains visible in
> the header. The source asset is unchanged.

## Implementation

- `public/index.html` contains the pre-paint initializer and accessible header toggle.
- `public/app.js` applies, labels, and persists the theme.
- `public/style.css` owns the final `html[data-theme="dark"]` cascade. The higher-specificity
  Result and Prompt disclosure rules must stay in that final cascade because their light surfaces
  otherwise override the generic dark document rule.
- `test/dark-mode.test.mjs` protects pre-paint restore, toggle accessibility, persistence, core
  palette values, disclosure coverage, text contrast, modal coverage, and terminal isolation.

The dark theme covers the application shell, Launchpad, composer controls, task cards, detail
documents, terminal settings, task editor, Planner, Standup, Turbo graph, and Plan council. It does
not change layout, backend contracts, or project-level settings.

## Surfaces that had no dark values at all

A large part of what read as a broken dark mode was not palette at all. These surfaces were
authored with hardcoded light values and never received a dark counterpart, so they punched white
and cream holes through the shell and in two cases hid their own labels entirely:

- `--council-ink`, `--council-muted`, `--council-line`. Declared once in light values and never
  redeclared, so `Use Plan council for this prompt` rendered at 1.19:1.
- `.terminal-keep-open-option`. A cream `#f3faf8` card that hid `Keep task terminals open` at
  1.12:1.
- `.plan-council-option`, `.council-minimum`, `.mode-tab-index`, `.execution-control-index`,
  `#attachment-count`, `.project-unpin`, `.turbo-council-help-button`, `.turbo-readiness`,
  `.composer-alert`, `.task-parent-link`, `.detail-attachment`.
- The whole Plan council preview: `.plan-execution-panel`, `.plan-agent-summary`, `.plan-waiting`,
  `.plan-source`, `.plan-final`, `.plan-final-heading`, `.plan-artifact-row`, `.council-return`,
  `.council-connector`, `.council-readiness`.
- `.parallel-batch-bar` and `.terminal-close-row`.

> [!important]
> These are all revealed states, so the default screenshot audit misses every one of them. Any
> future dark-mode check must unhide `[hidden]` inside `.workspace` before measuring, or it will
> report a clean sweep over a third of the interface.

Two defects were ordering, not colour, and a value tweak would not have fixed either:

- `.project-chip[class*="project-color-"] .project-pin` set dark ink on the bright identity square,
  but `.project-chip:not(.selected) .project-pin` has equal specificity and comes later, so the
  muted tone won and the initial sat at 1.02:1 on its own accent.
- `html[data-theme="dark"] :where(button, input, select, textarea):disabled` repaints the label on
  every disabled control, including buttons that carry their own saturated fill. Those buttons keep
  their own ink and rely on opacity instead.

## Project identity in the queue

A selected task card now carries its project's identity accent instead of a fixed blue. `app.js`
adds `projectIdentityColorClass(task.repo_path)` to every `.task-card`, and the selected and hover
treatments tint from `--project-accent` in light and `--project-accent-dark` in dark. The Launchpad
chip, the header running chip, and the queue selection now agree on one colour per project. See
[[project-workspaces]].

## Verification

> [!note]
> The July 30, 2026 terminal-palette pass completed with 885 tests passing. Browser screenshot
> capture was unavailable in that non-interactive run, so the evidence is the complete regression
> suite, explicit WCAG contrast calculations, balanced CSS structure, and `git diff --check`.

> [!note]
> The July 30, 2026 neutral-shell pass ran against the live app at `127.0.0.1:4768` through Chrome
> DevTools. Two audit scripts walked the rendered DOM: one flagged every element whose computed
> background was lighter than 0.5 relative luminance, the other computed the real foreground to
> nearest-opaque-ancestor-background ratio for every text node. Both were run with `[hidden]`
> cleared inside `.workspace` so the Plan council preview, Turbo config, parallel bar, and close
> row were measured too, and both were re-run in light mode to confirm no regression. Every
> remaining light background is an intentional accent: the identity squares, the live dot, and the
> session-state badge. 895 tests pass.

> [!note]
> Final verification on July 30, 2026 passed the six focused dark-theme checks, the related
> semantic palette, project identity, Markdown, Standup, and task-import checks, plus the complete
> 897-test suite. `git diff --check` also passed for the theme-owned files. No browser target was
> available in that run, so the existing live DOM audit above remains the rendered visual evidence.

> [!note]
> The August 3, 2026 revealed-control repair closes two later cascade gaps. The terminal command
> strip and grid number inputs had more specific light selectors than the generic dark input rule,
> while populated `.attachment-card` rows had no dark counterpart. The final dark cascade now owns
> those surfaces, their labels, image fallback, metadata, and destructive remove control. The
> background-launch label also needs a dark `!important` override because its base color is itself
> `!important`. Live computed-style verification confirmed the terminal command and grid controls
> resolve to `--app-control`, `--app-border`, and readable body text. A focused regression test pins
> every affected selector.

See [[compact-interface-density]], [[semantic-palette-review]], and [[interface-layout]].

#relay #ui #dark-mode #design #accessibility
