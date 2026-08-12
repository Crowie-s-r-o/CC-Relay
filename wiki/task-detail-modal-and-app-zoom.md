---
name: Task Detail Modal and App Zoom
description: Compact Task Activity header, taller terminal defaults, full task and council modal, and bounded desktop zoom shortcuts.
type: design
tags:
  - relay
  - ui
  - task-activity
  - terminal
  - plan-council
  - zoom
---

# Task Detail Modal and App Zoom

Task Activity now treats the terminal as the primary monitoring surface. Selecting a task keeps only its identity, metadata, task actions, and any retained-session controls above the terminal. Prompt history, result, attachments, session conversation, Turbo graph, and the complete Plan council record open in one modal.

> [!important]
> Do not put long-form evidence back into the fixed inspector header. Add new task evidence to `#task-detail-modal` so the terminal keeps its vertical budget.

The compact identity header has three explicit levels:

- Task number and status identify the record.
- A single-line task name is derived from the saved prompt and keeps the complete prompt in its title.
- Provider plus the complete execution label show model and effort at 13 pixels, larger than the 8 pixel workspace and lifecycle metadata.

> [!note]
> Do not duplicate provider, model, or effort in `.detail-meta`. Their operator-facing home is
> `#detail-execution-profile`; `.detail-meta` is reserved for status, workspace, dates, and
> continuation ancestry.

## Inspector split

- Ordinary tasks and Plan council tasks default the terminal to 84 percent of the Task Activity panel.
- A direct retained-session task defaults to 72 percent because its operational session strip must remain usable above the terminal.
- Narrow screens default to 68 percent.
- A saved `relay.terminalHeight` value remains authoritative. The defaults apply only when no explicit height has been saved.
- The drag and keyboard separator contracts are unchanged.

> [!note]
> Keep `calc(100% - 9.375em)` as the default-height safety cap so the compact controls retain usable space in short or highly zoomed windows. The separator's first keyboard adjustment must start from the rendered `.events-section` height, not an assumed 50 percent split.

The new split and modal geometry use root-relative `em` units. Live validation at a 1,920 by 1,080 viewport measured 793.8 pixels of terminal inside a 945 pixel Task Activity panel, with no overflow in the 145.1 pixel compact header.

## Full detail modal

`#task-detail-modal` is a native modal dialog. The static **Full details** button becomes **Council details** for Plan council tasks. The modal keeps the existing element IDs, render functions, copy payloads, Markdown escape boundary, Plan execution controls, disclosure state, and live refresh behavior.

The full record is a reading surface rather than part of the compact inspector. Prompt text is 13 pixels at a 1.55 line height, rendered results are 15 pixels at a 1.7 line height, disclosure labels are 13 pixels, and the modal title is 18 pixels. These increases are scoped to task evidence and the modal header so terminal output and the fixed Task Activity header retain their intentionally dense typography.

The Plan execution shortcut opens the modal before scrolling and focusing its execution panel. Closing works through the close button, Escape, or the backdrop. When no task remains selected, the modal closes before the empty Task Activity state appears.

> [!note]
> Completed council stage cards need modal-specific dark-theme colors. Their older light surfaces become low contrast on the dark modal canvas without those overrides.

## Desktop zoom

The desktop app no longer forces a 100 percent zoom level. `src/desktop-zoom.mjs` maps Command or Control plus and minus to bounded whole-page factors from 50 through 200 percent. Command or Control zero resets to 100 percent. Windows and Linux use Control for the same shortcuts.

macOS ignores `BrowserWindow.removeMenu()` and keeps Electron's default application menu, whose `zoomin`, `zoomout`, and `resetzoom` roles bind the same accelerators and step unbounded zoom levels outside the factor table. `src/desktop-menu.mjs` therefore installs an explicit macOS menu that keeps the standard application, edit, view, and window roles but routes every zoom accelerator into `nextDesktopZoomFactor`. Windows and Linux keep a menu-free window.

The `before-input-event` key handler stays registered on every platform. Whether a macOS accelerator also reaches the renderer is not observable from a test, so dropping the handler there would risk leaving the primary platform with no zoom at all. Instead both paths call one sink that ignores a second request inside `DESKTOP_ZOOM_REPEAT_MS`, so a single keystroke can never step twice.

The accelerator set covers Command or Control with plus, equals, minus, zero, and the numeric keypad equivalents. The equals and keypad items are hidden menu entries with `acceleratorWorksWhenHidden`, so zooming in does not require the Shift key.

> [!important]
> The key handler is registered before `loadURL`. Registering it after the load leaves the window without zoom shortcuts whenever the page load stalls or fails.

Whole-page `webContents` zoom is intentional. The renderer still contains legacy pixel geometry and JavaScript-authored pixel sizes for persisted panel splits. Changing only the root font size would enlarge some text while leaving those surfaces behind. Native page zoom scales text, CSS geometry, terminal content, dialogs, and inline pixel sizes together. New or reshaped responsive UI should still prefer `em` units.

## Files and verification

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `src/electron-main.mjs`
- `src/desktop-zoom.mjs`
- `src/desktop-menu.mjs`
- `test/task-detail-modal.test.mjs`
- `test/desktop-zoom.test.mjs`

August 12 verification for the single-owner zoom change: a live Electron probe built the real menu template, confirmed the accelerator list, and stepped the loaded window through 1.0, 1.25, the 0.5 floor, the 2.0 ceiling, and the reset. `test/desktop-zoom.test.mjs` covers the stepper, the direction parser, the menu template, and the pre-load handler registration. The full suite reports three unrelated `style.css` reduced-motion failures from concurrent in-flight work; every other test passes and `release:check` is green.

An isolated live renderer verified the 84 percent split, modal interaction, council content, dark-theme contrast, and zero browser console warnings. Focused modal, Markdown, and dark-mode tests cover the larger full-record typography. After the compact task-name and execution-profile refinement, the complete repository suite passes 1,069 tests.

See [[interface-layout]], [[plan-council]], [[session-tasks]], and [[compact-interface-density]].

#relay #ui #task-activity #terminal #plan-council #zoom
