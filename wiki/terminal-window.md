---
name: Terminal Window
description: Full-viewport terminal review surface built by reparenting the live events section and its tools cluster, with the two-slot dock record, six ordering invariants, the docked grid-row and specificity traps, filter separation, and the app-wide view preference.
type: implementation
tags:
  - relay
  - terminal
  - renderer
  - dialog
  - persistence
---

# Terminal Window

The task terminal can be opened in a near full-viewport **Terminal window**. A **Window** control sits
in the events toolbar (`.event-tools`, beside **Thinking** and **Copy log**) and opens
`<dialog id="terminal-window-modal">`. The control is disabled while no task is selected, or while the
detail panel is hidden, because the window has nothing to show without a live terminal underneath it.

The window shows the original terminal by default and offers a four-view rail
(`#terminal-window-views`) so the operator can read the conversation without leaving the terminal
surface. The view the operator selects becomes the default the window opens on next time, for any
task, across restarts. See [[terminal-conversation-filters]] for the underlying role contract and
[[interface-layout]] for the surrounding execution ledger.

## Views and labels

| View id | Rail label | Meaning |
| --- | --- | --- |
| `all` | **Terminal** | the original terminal output, identical to the inline `all` filter |
| `conversation` | **Conversation** | the inline `conversation` filter |
| `mine` | **My messages** | the inline `mine` filter |
| `ai` | **`<Provider>` messages** | the inline `ai` filter, relabelled at render time; falls back to the literal **AI messages** when no task is selected |

The `ai` label, the dialog title, and the subtitle are written with `textContent` from
`providerLabel(taskProvider(task))`, so they read "Claude messages", "Codex messages", or
"OpenCode messages" against the real task. A `mode: 'plan'` task is stored with provider `council`
(`src/server.mjs`), and `providerLabel` maps `council` to `Plan council`, so a plan task's rail reads
**Plan council messages**.

> [!important]
> Never hardcode a provider name in the window markup or copy. Task title, provider, and status are
> task-controlled values, so the heading, subtitle, and rail labels must stay on `textContent` and
> never reach `innerHTML`.

## Reparenting contract

The window does not duplicate the terminal. **Two** live nodes are moved on open and moved back on
close:

1. `.events-section` into `#terminal-window-mount`.
2. `.event-tools` (the **Thinking**, **Copy log**, and **Window** cluster) into the dialog header slot
   `#terminal-window-tools`.

> [!important]
> There is exactly ONE render target. `renderEventStream()` is unchanged and keeps working through
> its existing element references, so live SSE refresh, disclosure restore, follow-to-bottom, the
> continuation composer, and **Copy log** all keep working inside the window with no parallel code
> path. Do not add a second render target, a cloned subtree, or a window-only renderer. A second
> target would immediately split live refresh, copy payloads, and follow state into two states that
> have to be reconciled, which is the failure this design exists to avoid.
>
> The tools fold does not weaken that. The cluster is the same live nodes moved, never a copy, so
> **Thinking** and **Copy log** keep their existing listeners and their existing `aria-pressed` state.

### The toolbar fold

While docked the whole `.event-toolbar` row is `display: none`. The window rail replaces
`#event-filters` and the header slot holds the cluster, so the row would otherwise be a full-width
strip of nothing, which is exactly what a live browser pass called out.

The tools move runs **after** the section is docked and **before** `showModal()`, so the dialog never
paints with an empty tools slot. `.terminal-window-tools:empty { display: none; }` covers the state
before the first move, so the slot reserves no space and paints no border of its own.

> [!important]
> The move is load-bearing on both sides. If the app.js move is ever reverted while
> `.events-section[data-terminal-window="open"] .event-toolbar { display: none; }` stays, **Thinking**
> and **Copy log** become unreachable for the whole time the window is open, with no error. Revert the
> CSS in the same change or not at all.

## The dock record

`state.terminalWindowDock` is captured at open time and holds **six** fields, recording **two** DOM
slots:

- `parent`: the section's `parentNode` before the move
- `nextSibling`: the node the section must be reinserted before
- `toolsParent`: `.event-tools`'s `parentNode` before the move, that is `.event-toolbar`
- `toolsNextSibling`: the node the cluster must be reinserted before
- `scrollTop`: `elements.detailEvents.scrollTop` at open time
- `follow`: `state.eventFollow` at open time

> [!important]
> Both slots are captured in the SAME object literal, before EITHER move. One record and one
> mechanism means the existing re-entrancy guard and the dock-null-first ordering already cover the
> tools cluster with no second guard, no second flag, and no second code path that could drift out of
> step with the section's. Do not give the cluster a dock record of its own.

It is also the docked-state flag. `terminalWindowIsDocked()` is `state.terminalWindowDock !== null`,
and every docked-only behavior reads that one predicate.

> [!important]
> Close restores scroll position and follow state **from the dock record, never from a live read**.
> The window list holds different entries at a different height, so its scroll offset does not
> describe the inline reading position, and a closed `<dialog>` is `display: none`, so a live read
> from a close handler returns 0. Replay the recorded offsets instead.

Reattaching a subtree also zeroes every descendant scroll position, so `rememberEventDisclosures()`
and `rememberEventOutputScroll()` run before each move and `restoreEventOutputScroll()` runs after
it, on both open and undock. Per-output offsets and disclosure state survive the trip in both
directions.

`applyTerminalHeight()` skips measuring `.events-section` while the window is docked, because the
section's rendered height is then the dialog's and says nothing about the resize handle's range.
`undockTerminalWindow()` calls `applyTerminalHeight()` again once the section is back inside the
detail grid, so the handle describes the real terminal again.

## Ordering invariants

Each of these is individually required. Removing any one of them produces a distinct defect.

1. **Capture BOTH slots BEFORE EITHER move.** After `append()` the moved node's parent is already the
   mount or the header slot, so a record captured afterwards can never describe where it came from.
   This applies to the tools cluster exactly as it applies to the section, which is why both pairs sit
   in one literal ahead of both moves.
2. **The re-entrancy guard makes a second open a no-op.** `openTerminalWindow()` returns early when
   `terminalWindowIsDocked()`. Without it, a second open overwrites `dock.parent` with the mount
   itself and `dock.toolsParent` with the header slot, and closing then reinserts the terminal and its
   cluster inside the closed dialog. Both are permanently lost from the app with no visible error.
3. **`state.terminalWindowDock = null` is set FIRST in `undockTerminalWindow()`.** Both the `cancel`
   and `close` dialog handlers call it, and `closeTerminalWindow()` calls it before `dialog.close()`
   fires `close` again, so every call after the first must be a cheap no-op rather than a second
   reinsertion. The function's `if (!dock) return;` guard depends on that field already being cleared.
4. **Each remembered sibling is re-validated against its OWN recorded parent before reinsertion.**
   `nextSibling.parentNode === dock.parent` for the section and
   `toolsNextSibling.parentNode === dock.toolsParent` for the cluster. A remembered sibling can be gone
   by close time, and `insertBefore` against a detached reference throws. Each falls back to appending
   at the end of its own recorded parent.
5. **Scroll and disclosure state are remembered before every move and restored after it.** See the
   dock record section above.
6. **On close, the TOOLS go home BEFORE the section.** The final tree is identical either way, so the
   reason is the intermediate state, not the result. The section must never appear back in the detail
   grid while its toolbar is still stripped of its controls: anything that measures or focuses it
   mid-move would see a half-assembled section, and the resize handle, focus fallbacks, and any future
   layout observer all run against whatever is in the grid at that instant. Restoring the cluster first
   means the section only ever re-enters the grid complete.

## Focus return

Focus returns to `#terminal-window-open` from the dialog's `close` handler, not from
`undockTerminalWindow()` and not from `cancel`.

> [!important]
> Content outside an open modal dialog is inert. A focus call issued while the dialog is still open
> is silently dropped, so Escape would strand the operator on `<body>`. The `cancel` handler undocks
> synchronously, before the browser hides the dialog; the `close` handler undocks as the fallback for
> a programmatic close and is the only place that restores focus.

`focusTerminalWindowOpenButton()` focuses the **Window** button only while it is connected, enabled,
and the detail panel is visible. When any of those is false the task the operator was reading is gone,
so focus falls through to `focusTaskDetailLandmark()`, which walks the empty-detail heading, the
empty-detail region, and then the task list, skipping any candidate that is hidden or disconnected.

> [!important]
> That three-part guard is a proxy for "visible and focusable" only because the toolbar fold is fully
> undone first. The **Window** button travels into `.terminal-window-tools` with the cluster and is
> hidden there by a parent-scoped rule, and the `.event-toolbar` row it came from is hidden by the
> section's docked attribute. `undockTerminalWindow()` clears both conditions, the reinsertion and the
> `delete elements.eventsSection.dataset.terminalWindow`, before any close route reaches
> `focusTerminalWindowOpenButton()`. Moving the focus call earlier, or undoing only one of the two,
> would focus a button that is connected and enabled but painted nowhere.

> [!note]
> A hidden candidate is never focused. `HTMLElement.focus()` on a hidden node silently leaves focus on
> `<body>`, which is the exact stranding this fallback exists to prevent. The landmark is a region
> rather than a control, so it takes a programmatic-only `tabindex="-1"` that keeps it out of the tab
> order while its focus ring stays visible.

`closeTerminalWindow()` is idempotent by design: it returns immediately when the window is neither
docked nor open. The hide routes call it defensively, and a close with nothing to close must never
pull focus off whatever the operator is using.

## Filter separation

The window view and the inline six-button rail are two independent selections over one filter state.

- On open, `state.eventFilter` is saved into `state.inlineEventFilter` and replaced with the persisted
  `state.terminalWindowView`.
- On close, `state.eventFilter` is restored from `state.inlineEventFilter`.
- The inline rail's `aria-pressed` reads `terminalWindowIsDocked() ? state.inlineEventFilter :
  state.eventFilter`, so opening the window never moves the inline selection.
- Clicking an inline filter while docked records the selection in `state.inlineEventFilter` and leaves
  `state.eventFilter` alone, because the stream then belongs to the window.

> [!important]
> The persisted default belongs to the window only. The inline rail still defaults to **All** and is
> not persisted. Opening or closing the window must not change the inline rail's selection.

The window rail reuses the `filterCounts` object already computed inside `renderEventStream()` and
passed to `updateEventControls()`. Do not recompute filter counts for the window.

## Styling contract

`.events-section` carries `data-terminal-window="open"` while docked. The attribute is removed on
close. CSS uses it to let the section fill the dialog, to hide the inline `#event-filters` rail that
the window rail replaces, and to hide the whole `.event-toolbar` row the cluster has left. The Tokyo
Night `--term-*` ledger palette and typography are untouched, so the docked terminal is the same
terminal.

The dialog frame follows the conventions already used by `.terminal-settings-modal` and
`.task-detail-modal`: a transparent `<dialog>` that owns width, height, and shadow, a rounded card
that owns and clips the surface, and a tinted `::backdrop`. Light and dark rules are declared
together.

The header is a **four-zone** grid, `"heading views tools close"`. At 1100px and below it restacks to
two rows, `"heading tools close"` over `"views views views"`, so the identity, the moved cluster, and
the close affordance share the first row and the rail owns a full-width second row that scrolls
horizontally rather than compressing or dropping views.

> [!note]
> Observed, not a defect. At **380px** that second row genuinely scrolls, so the fourth view needs a
> swipe to reach. That is the designed trade rather than a regression: it mirrors the inline
> six-button rail's existing pattern, and it is preferred over compressing the labels or dropping a
> view. Nothing escapes the card and the page never scrolls horizontally.

### Why parts of this block are id qualified

`#terminal-window-views.terminal-window-views` and every `#terminal-window-tools.terminal-window-tools`
rule double up an id on a class deliberately. The dialog is a descendant of `.detail-panel`, and
`.detail-panel .event-tools button` already carries docked geometry at class-plus-element specificity,
so a bare class pair would win only on source order and any later reshuffle would drop the header
styling. The id raises them above it for good.

> [!important]
> That choice propagates to the dark half. Wherever the light rule is id qualified, its dark companion
> must carry the SAME id, or the light rule outranks it no matter where the dark rule sits in the
> file, and the theme override silently never applies. Every dark companion of an id-qualified light
> rule in this block now carries the id, including the moved chips' `:focus-visible` entry. That last
> one was the one place the rule had been missed; see [[#The dark ring on the moved chips]].

This is also the direct cause of the `display:` trap above: raising those rules over
`.detail-panel` put them over the class-only rule that hides the **Window** button too.

### The dark ring on the moved chips

The moved header chips' focus ring is the worked example of the rule above, and the one place it was
originally missed.

- Light: `#terminal-window-tools.terminal-window-tools .event-tools button:focus-visible` at **(1,3,1)**,
  setting the whole `outline` shorthand.
- Dark: `html[data-theme="dark"] #terminal-window-tools.terminal-window-tools .event-tools button:focus-visible`
  at **(1,4,2)**, setting `outline-color: var(--app-blue)`.

The dark selector was previously the bare-class
`html[data-theme="dark"] .terminal-window-tools .event-tools button:focus-visible` at (0,4,2). The id
in the light half outranked it, so the shorthand's `outline-color` component won and the chips kept
the light `--signal` ring in dark theme. Id qualifying the dark entry hands the color back to the
theme rule.

> [!important]
> **An id-qualified light rule that sets a whole shorthand forces its dark companion to carry the
> same id.** The shorthand is the mechanism, not an aside: `outline` writes `outline-color`, so a
> longhand dark override is competing for the same component and loses the cascade outright. The
> other two entries in that same dark comma list, the view rail and the close control, stay bare
> class on purpose, because their light halves carry no id. The asymmetric comma list is deliberate,
> not a leftover.

> [!note]
> Be precise about the benefit. In dark theme `--signal` and `--app-blue` both resolve to `#7aa2f7`
> today, so there is **zero visible change** right now. This is a cascade-correctness fix: the dark
> rule now genuinely owns the ring, so a future retune of either token actually lands instead of
> being silently swallowed. The dark ring measures **7.04:1** against the dark header `#17181c` and
> **6.70:1** against the chip's own `--app-control` surface, both clearing the 3:1 focus-indicator
> floor. `test/terminal-window-styles.test.mjs` now asserts the id-qualified dark selector and
> asserts the bare-class form is absent, so the losing form cannot come back.

### The docked grid-row count

`#terminal-window-mount > .events-section[data-terminal-window="open"]` declares
`grid-template-rows: auto minmax(0, 1fr) auto auto`. **Four rows, not five.**

> [!important]
> The row count is load-bearing and tied to the docked visible child count. Once `.event-toolbar`
> became `display: none` it left grid flow, and the five-row template that predated the fold shifted
> the four remaining children up a row: the scrollback would have collapsed to `auto` and the
> continuation composer would have taken the `minmax(0, 1fr)`. The scrollback is the entire reading
> surface, so that silently inverts the whole window. Count the visible docked children before
> touching this line. They are the overview details, the scrollback, the continuation form, and the
> status bar.

This is a different declaration from the inline
`.detail-panel #task-detail .events-section { grid-template-rows: auto auto minmax(0, 1fr) auto auto; }`,
which keeps five rows because the toolbar is visible there. Changing one does not change the other.

> [!warning]
> The two rules **tie on specificity**, and the docked one wins on SOURCE ORDER alone. Both compute to
> one id and two class-level components: an attribute selector is class-level and the child combinator
> adds nothing, so `#terminal-window-mount > .events-section[data-terminal-window="open"]` does not
> outrank `.detail-panel #task-detail .events-section`. The terminal window block simply sits later in
> `public/style.css`. Moving the block above the continuation dock rule, or moving that rule below it,
> silently restores the five-row template and collapses the scrollback, with every declaration in both
> rules still reading exactly as written. Keep the terminal window block below the
> `.detail-panel #task-detail .events-section` rule.

> [!note]
> That order is now **pinned**, not just documented. `the docked grid row template is declared after
> the rule it ties on specificity` in `test/terminal-window-styles.test.mjs` asserts the docked rule's
> index in `public/style.css` is greater than the five-row competitor's, and that the docked rule
> appears exactly once. It matches the competitor's body loosely on purpose, so a concurrent stream
> adding a declaration to that rule cannot cause a false failure. The stale comment that claimed
> `#terminal-window-mount` raises specificity above `.detail-panel #task-detail .events-section` is
> corrected in the same file: they tie, and source order alone separates them.
>
> The pin was proven discriminating. Moving the terminal window block above the competitor in a
> scratchpad copy failed exactly and only this test, 14 pass 1 fail, with every other check still
> passing. That is the point worth keeping: the layout inverts while every declaration in both rules
> still reads correctly and nothing else in the repository notices.

### The Window button hiding trap

`#terminal-window-open` now travels into the header with the cluster, so the old rule that hid it
through `.events-section` stopped matching. It is hidden through its new parent instead:

```css
.terminal-window-tools .terminal-window-open { display: none; }
```

> [!important]
> That rule carries only class specificity, and every rule that styles the moved chips is id
> qualified through `#terminal-window-tools`. ANY `display:` declaration added to an id-qualified
> tools rule therefore outranks it and puts a redundant **Window** button inside the already-open
> window. `test/terminal-window-styles.test.mjs` scans every `#terminal-window-tools...` rule for the
> string `display:` and fails on a match, so style the chips with color, border, background,
> geometry, and type, and never with `display`. The base `display: inline-flex` those buttons need
> already comes from the shared `.event-tools button` rule.

Hiding `.event-toolbar` while docked is also the fallback that keeps the button out of sight in the
case where the cluster never made the move at all.

### Hover must not read as selected

Hover and pressed once used the same blue at 28% against 44% border alpha, so on the 42px rail a
hovered unselected view read as selected until the operator hunted for the inset underline. They are
now separated on **five** channels at once, and only pressed owns any of them:

| Channel | Hover | Pressed |
| --- | --- | --- |
| Hue | none, neutral only | the only accent on the rail |
| Luminance (light theme) | moves darker than the rail | moves lighter, solid `--paper` |
| Inset 3px underline | none | yes |
| Elevation shadow | none | yes |
| Tinted count pill | none | yes |

> [!important]
> Both hover rules are scoped `:hover:not([aria-pressed="true"])`. A bare `button:hover` ties the
> pressed rule on specificity and wins only on source order, so any later reshuffle of the block would
> silently let hovering the current view repaint part of its pressed treatment. Keep the negation.

> [!note]
> Observed, not a defect. The luminance channel runs the way the table describes, and in light theme
> that means the hovered chip's grey fill reads as MORE filled than the pressed chip's white `--paper`
> surface for a beat. The three pressed-only signals settle the hierarchy immediately: accent text, the
> inset underline, and the tinted count pill. Do not "fix" this by darkening pressed or lightening
> hover; either move collapses the luminance separation the two states depend on.

### Contrast tokens that must not be reverted

Each of these moved off the house token for a measured reason. Reverting any one reintroduces a
sub-AA failure at the size it actually renders.

> [!important]
> **Rail labels and count pills use `--graphite`, not `--slate`.** They render at 11px weight 600 with
> a 9px pill, on the light `--mist` rail, where `--slate` reaches only 3.67:1, below the 4.5:1 AA
> floor for text that small. `--graphite` is the light palette's high-contrast small-text token,
> already paired with `--mist` by the planner chips, and takes the label to 9.55:1 and the pill to
> 8.22:1. The size is the whole reason: this is not a general "prefer graphite" rule, it is a rule for
> this rail at this type scale.

> [!important]
> **`.terminal-window-close` and `.terminal-window-heading p` also use `--graphite`.** Both sit on
> `--paper`, not on `--mist`, where `--slate` measures 3.98:1 and `--graphite` 10.36:1. The close glyph
> is a thin 21px stroke, so it needs the higher token even though its hit box is large.

The light pressed accent moved off `--signal` to **`#2239c9`**, the light pressed indigo the app
already uses for `.queue-view-switch button[aria-pressed="true"]` and
`.history-period-tabs button[aria-pressed="true"]`. `--signal` measured 4.88:1 for the pressed label
and 4.05:1 for the pressed count pill, both under the floor; `#2239c9` takes them to 8.41:1 and
6.98:1. Shifting this one rail's selected accent off `--signal` is a deliberate design decision, not a
drift. The pill keeps the `--signal` tint behind it because the approved 6.98:1 is measured against
that tint.

The moved header chips were restyled out of the ledger's dark navy chrome into the header's own chip
language, matching the 34px, `--line` bordered, 10px radius `--paper` control the close button already
is. **Thinking** ships `aria-pressed="true"`, and the ledger paints that state as `#eadfff` on a violet
wash, which is invisible on the white header; the header restates it in the same `#2239c9` the rail
uses, at 7.43:1 on `--signal-soft`.

### The empty-detail focus ring

`.empty-detail h2[tabindex]` and `.empty-detail[tabindex]` are styled on **both** `:focus-visible` and
`:focus`.

> [!important]
> This is not belt-and-braces. Browsers match `:focus-visible` on a programmatically focused
> non-input element only when the previously focused element already matched it, so after a mouse
> gesture a `:focus-visible`-only rule would draw nothing in exactly the scenario the ring exists for:
> the operator clicks a close affordance and focus is handed to the landmark. `tabindex="-1"` is
> unreachable by Tab, so `:focus` on these nodes can only ever mean this programmatic hand-off, which
> is what makes the bare `:focus` safe rather than noisy.

The ring is `--signal`, not the house `#6daff4`: on the panel's white surface `#6daff4` measures
2.31:1, under the 3:1 floor for a focus indicator, while `--signal` reaches 4.88:1. Dark theme swaps
the outline color to `--app-blue`.

> [!important]
> Two `public/style.css` slicing traps apply to any future edit in this block, and both are already
> recorded in [[task-diff-preview]] and [[session-tasks]].
> 1. Never comma-extend the `.events-section {` selector. `test/plan-visibility.test.mjs` slices the
>    ledger palette with `style.indexOf('.events-section {')`, and a comma extension empties that
>    slice. The mount repeats the ledger background value literally instead.
> 2. Never append a new `@media (prefers-reduced-motion: reduce)` block, and never even quote that
>    literal string in a comment below the existing last one. Five suites anchor on the LAST
>    occurrence with `lastIndexOf`. The window's only motion is one color transition declared inside
>    a `@media (prefers-reduced-motion: no-preference)` guard.

## Persistence contract

`terminalWindowView` is a member of the app-wide `ui-layout-preferences` record. Allowed values are
`all`, `conversation`, `mine`, and `ai`; anything missing, null, wrongly typed, or unknown falls back
to `all`. `src/ui-preferences.mjs` normalizes it through a `Set` whitelist inside
`normalizeUiPreferences()`. `relay.terminalWindowView` in `localStorage` is a first-paint cache only,
because the desktop app receives a new port on every launch and browser storage is scoped by port.
The database record is authoritative. See [[durable-ui-layout-preferences]].

The preference is application-wide. It is not stored on a project and is not copied by **Apply to all
projects**, which owns `terminal_layout_json` on the projects table only. See
[[project-terminal-settings]].

> [!important]
> `PATCH /api/ui-preferences` is a FULL-RECORD REPLACEMENT despite the verb. `normalizeUiPreferences()`
> returns `null` when `panelWidths.composer` or `panelWidths.queue` is absent, and `src/server.mjs`
> then throws **"Valid panel widths are required."**, so a one-field body is rejected outright. Any
> body that does validate replaces the whole record, and every member the payload omits silently
> resets to its default. Every save must go through the single `uiPreferencesPayload()` builder in
> `public/app.js`.

> [!warning]
> Two work streams extended this record concurrently in the same session, adding `terminalWindowView`
> and `quickSkills`. A stale copy of `uiPreferencesPayload()` from either stream would have silently
> erased the other stream's member on the next save. When adding a member to this record, re-read the
> builder immediately before editing it and confirm every existing member is still listed. See
> [[saved-quick-skills]].

A legacy record from a server that predates the member returns no `terminalWindowView`. The renderer
keeps the `localStorage` seed already in state in that case, so the window still opens on the
remembered view. This is deliberately unlike `quickSkills`, where a missing member means the built-in
catalog rather than "keep whatever is local".

## Non-obvious failure modes

> [!important]
> Both `#terminal-window-modal` and `#task-detail-modal` are children of `#task-detail`. An open
> modal dialog inside a `display: none` ancestor is still modal: the dialog is invisible while every
> control outside it stays inert because the top layer is still occupied, and the app is wedged with
> no visible cause. `hideTaskDetailPanel()` in `public/app.js` is therefore the ONLY place allowed to
> set `elements.taskDetail.hidden = true`. It closes the topmost dialog first
> (`closeTerminalWindow()`, then `closeTaskDetailModal()`), hides the panel, and moves focus to the
> detail landmark when a dialog held it. Four call sites route through it. A new route that hides the
> panel must call the helper rather than setting the flag itself.
>
> This is enforced, not just documented. `test/terminal-window.test.mjs` counts every
> `elements.taskDetail.hidden = true;` in `public/app.js` and asserts there is **exactly one**. Any
> work stream that adds a raw hide site anywhere in the renderer fails that assertion and must route
> through the helper instead. The searches that check the individual call sites are each bounded at
> the next top-level declaration, so a concurrent edit that grows one of those functions cannot fail
> the lock for an unrelated reason.

> [!note]
> `updateTerminalWindowAvailability()` also closes a docked window when the task is deselected, but it
> is only a reactive safety net: it runs when something calls `updateTerminalWindowControls()`, so it
> never substitutes for `hideTaskDetailPanel()`.

> [!note]
> Escape reaches only the topmost dialog, so closing the Terminal window leaves a surrounding task
> detail modal open. That isolation is not exercised in practice today; see the residual item below.

## Residual items

Recorded honestly rather than resolved.

- **Backdrop click can close the window mid drag-select.** A `click` event fires on the common
  ancestor of `mousedown` and `mouseup`, so a selection that starts inside the card and ends over the
  backdrop closes the window. This is pre-existing behavior, identical to `#task-detail-modal`.
- **Opening at a mid-scroll offset can flip follow on.** The window list is taller, so the recorded
  inline offset can land at the window list's clamped bottom and turn `state.eventFollow` on. The
  dock record still returns the inline follow state on close, so the inline terminal is unaffected.
- **A task switch keeps the window open with a stale dock record.** `dock.scrollTop` and `dock.follow`
  still describe the previous task's reading position, so closing after a switch replays the wrong
  offset.
- **The "must work for a task opened inside the task detail modal" contract line is unreachable as
  written.** `.events-section` is a sibling of `#task-detail-modal`, never a child, so the **Window**
  button is inert while that modal is open. The Escape isolation invariant is therefore vacuously
  satisfied rather than exercised.

> [!done]
> **Resolved: the dark focus ring on the moved tools chips.** The dark companion is now id qualified
> inside the same comma list and genuinely owns the ring. Recorded with its general rule and its
> honest "no visible change today" framing under [[#The dark ring on the moved chips]].

## Files and coverage

- `public/index.html`: the toolbar open control, the dialog, the four-view rail, the empty
  `#terminal-window-tools` header slot, and the mount point.
- `public/app.js`: `openTerminalWindow`, `undockTerminalWindow`, `closeTerminalWindow`,
  `setTerminalWindowView`, `updateTerminalWindowControls`, `updateTerminalWindowAvailability`,
  `terminalWindowIsDocked`, the two-slot dock record and the tools fold, the inline-rail separation,
  and the `uiPreferencesPayload()` member.
- `public/style.css`: the dialog frame, the four-zone header, the segmented rail with its separated
  hover and pressed states, the docked tools slot, the docked `data-terminal-window="open"` rules
  including the four-row grid, the empty-detail focus ring, the compact breakpoints, and the light and
  dark pairs.
- `src/ui-preferences.mjs` and `src/server.mjs`: the `terminalWindowView` whitelist, its fallback, and
  the full-record `GET` and `PATCH` routes.
- `test/terminal-window.test.mjs`: markup contract, the four views, reparenting, inline-filter
  restoration, the dock-recorded reading position, resize-handle isolation while docked, focus return
  after close, Escape and backdrop scope, reused filter counts, provider-derived `ai` label, inline
  rail independence, the empty header tools slot in the markup, and the disabled open control closing
  a stranded window. A behavioral half drives a simulated DOM through the ordering invariants: the
  first open recording the original slot rather than the mount, the first open recording the tools
  slot inside the toolbar rather than the header slot, the cluster moving after the section is docked
  and before the dialog paints, a second open being a corruption-free no-op for both slots, the
  section never being reinserted before its tools are back, a close restoring either node as last
  child when it had no next sibling, the **Window** button being reconnected in a visible toolbar
  before focus is attempted, a reopen using the persisted window view while the inline rail keeps its
  own, a live render while docked preserving the dock, the single guarded hide route with its
  exactly-one-assignment lock, focus landing on a visible landmark rather than `<body>`, an auto-close
  from a deselect never focusing a hidden landmark, and a close with nothing to close moving no focus.
- `test/terminal-window-styles.test.mjs`: the dialog geometry and backdrop, the four-zone header, the
  fixed header over a full-height mount, the segmented rail states, the neutral hover against the
  pressed signal, the light rail clearing AA with its dark companion still overriding it, the toolbar
  control, the docked toolbar folding into the header including the no-`display:` scan over every
  id-qualified tools rule, the docked section filling the mount and hiding the inline rail, the
  untouched ledger palette, paired dark rules, the empty-detail focus ring, the compact breakpoints,
  both `style.css` slicing traps, and the em dash ban. It also pins the docked grid row's SOURCE
  ORDER: `the docked grid row template is declared after the rule it ties on specificity` asserts the
  docked rule's index in `public/style.css` is greater than the five-row
  `.detail-panel #task-detail .events-section` rule's and that the docked rule appears exactly once,
  matching the competitor's body loosely so a concurrent declaration cannot false-fail it.
- `test/ui-preferences.test.mjs`: view normalization to the four supported ids and app-wide
  persistence including legacy records.

## Verification

Re-observed directly when the second live browser pass was recorded, on **v0.2.31**.

- The focused set (`terminal-window`, `terminal-window-styles`, `ui-preferences`,
  `terminal-conversation-filters`, and `plan-visibility`) passes **129 of 129 checks**, 0 failed.
- The complete repository suite passes **1,938 of 1,938 tests**, 0 failed, exit code 0.
- `npm run release:check` is green: "Release metadata is consistent for v0.2.31."

> [!note]
> Counts move quickly while several work streams land tests in the same session. Earlier runs during
> this feature's development reported 1,884, 1,904, and 1,937 against the same repository, and the
> focused set read 128 before the source-order pin was added. Re-ground the numbers rather than
> trusting these.

### The first live capture, against the pre-polish build

> [!note]
> A live pass ran against a stub preview server with an isolated headless Chrome and covered the four
> views, the persisted default proven three ways including a server-only proof, close and restore,
> Escape and focus return, responsive behavior at several widths, both themes, zero console errors, and
> zero non-200 responses. All ten of its checks passed.
>
> Be precise about what that capture is evidence for. It ran against the build that PRECEDES the design
> polish, and it is what surfaced the two visual defects the polish then fixed: the orphan toolbar row
> and hover reading as selected. It is evidence for the reparenting, persistence, and focus contracts,
> not for the visual treatment that replaced them. Keep this record: it is the reason the polish exists.

### The second live pass, against the final design

> [!done]
> **Live browser verification now covers the FINAL polished design, and it PASSED.**
>
> It ran on the same tree the gates ran on, and that was proved rather than assumed: the sha256 of
> `public/app.js`, `public/style.css`, `public/index.html`, and `src/ui-preferences.mjs` was identical
> at run start and at run end, so the browser and the suites saw one build. Stub preview server plus an
> isolated headless Chrome again, with the fixtures re-verified first (the `userMessage.content[]` and
> `reasoning.summary[]` shapes, counts 18/7/3/4, no duplication).

All **seven** changed items passed.

1. **Toolbar fold.** `.event-toolbar` is `display: none` and 0x0 while docked, and the `.event-tools`
   parent is `terminal-window-tools`. The cluster is functionally live from the header, not merely
   present: **Thinking** drove the row count 18 to 16 to 18 with the **Terminal** badge following it and
   `aria-pressed` tracking, and **Copy log** wrote 3,592 characters with zero errors.
2. **No Window button inside the window.** Exactly one `.terminal-window-open` in the DOM, at
   `display: none` and 0x0 while docked, and back to 66x22 after close.
3. **Hover is no longer confusable with pressed.** Pressed carries four signals hover has none of:
   accent text, a 3px inset accent underline, an elevation shadow, and a tinted count pill. Hover is a
   neutral lift only, with no shadow, no accent, and a neutral pill.
4. **Contrast measured from real rendered pixels rather than computed styles.** The light pressed accent
   renders `rgb(34,57,201)`, that is `#2239c9`, at 8.41:1 on the white header and 7.43:1 on
   `--signal-soft`. `--graphite` renders `rgb(52,64,90)`: rail labels 9.55:1, close 10.36:1, subtitle
   10.36:1. Dark theme ranges 6.57 to 14.86:1. These are the figures already recorded under
   [[#Contrast tokens that must not be reverted]], now confirmed against painted pixels.
5. **The docked grid rows.** Open measured `71.2px 659.8px 95.7px 26px`, **four** rows, with the
   scrollback the 660px hero and the composer at its 96px natural height. Closed measured five rows. The
   inversion that [[#The docked grid-row count]] exists to catch did not happen, and the hero holds at
   every width.
6. **The landmark focus ring.** Driven by a genuine deselect pushed over the app's own SSE
   `/api/events`, not by a synthetic call. The window auto-closed, the section returned to
   `#task-detail`, focus landed on `.empty-detail h2` with `tabindex="-1"`, and the ring rendered
   `3px solid rgb(122,162,247)` at offset 4px. The finding that matters is `matchesFocus: true` with
   `matchesFocusVisible: false`, which is exactly why the rule targets `:focus` as well as
   `:focus-visible`. That empirically confirms the reasoning already recorded under
   [[#The empty-detail focus ring]].
7. **The dark ring on the header chips.** It renders `rgb(122,162,247)` in dark and `rgb(79,95,246)` in
   light. Worth recording honestly: in dark theme `--signal` also resolves to `#7aa2f7`, so the rendered
   pixel alone does not discriminate between the two tokens. The discriminating evidence is structural,
   the id-qualified dark rule at (1,4,2) outranking the light rule. Both grounds pass, which matches the
   "no visible change today" framing under [[#The dark ring on the moved chips]] rather than overturning
   it.

Core behaviors all passed: open, close, return, render, and scroll; the inline rail still sitting on
**Commands** after a different view was picked inside the window, and correctly back to `all` after a
full reload, since only `terminalWindowView` persists; Escape closing the window with focus returning to
the **Window** button; and responsive behavior at 1600, 1100, 760, and 380 in both themes with zero
pairwise overlap of the four header zones, nothing escaping the card, and no horizontal page overflow.

> [!important]
> **The persistence headline, proven from the server record.** Picking a view fired exactly ONE `PATCH`
> carrying the FULL record, `terminalWindowView: "mine"` alongside `quickSkills`, the panel widths, the
> header position, the running task layout, the completion alerts, and voice input. Reopening landed on
> `mine`. Then `relay.terminalWindowView` was removed from `localStorage` and the page was fully
> reloaded: the cache repopulated from the server record and the window still opened on `mine`. That is
> direct evidence for [[#Persistence contract]], that the durable record drives the default and the
> browser cache is only a first-paint seed, and it is the strongest single result on this page.

**Zero Relay console errors and zero network failures** across roughly 1,061 stub requests.

> [!note]
> One honesty note about that console result. The first capture showed React Router warnings and a
> `localhost:3001` connection refusal that were NOT Relay's: they came from a stale tab in a persistent
> Chrome profile, replayed into the session by `Log.enable`. Everything reported above is from after a
> `Log.clear` and after closing the duplicate target. Expect the same trap in any future pass that
> reuses a persistent profile.

The pass also recorded two observations as non-defects rather than findings. Both are written down
beside the design they describe, under [[#Styling contract]] for the 380px rail scroll and under
[[#Hover must not read as selected]] for the light-theme hover fill.

> [!warning]
> **Do not overstate this.** Both live passes ran against a STUB preview server with SYNTHETIC fixtures
> in an isolated headless Chrome. That is real rendered pixels, real layout, real focus behavior, and
> real `PATCH` traffic against a real preferences record, so it is strong evidence for the markup, the
> CSS, and the renderer logic in this tree. It is NOT the user's live app against real provider output,
> and it cannot stand in for using the window on a real Codex or Claude session.

The verifier also ran the repository gates green on that same tree, `npm test` and
`npm run release:check` both exit 0 and `git diff --check` exit 0, consistent with the counts recorded
above.

See [[terminal-conversation-filters]], [[interface-layout]], [[durable-ui-layout-preferences]],
[[task-activity-overview]], [[task-detail-modal-and-app-zoom]], [[task-diff-preview]], and
[[saved-quick-skills]].

#relay #terminal #renderer #dialog #persistence
