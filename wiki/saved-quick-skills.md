---
name: Saved Quick Skills
description: Operator-configurable one-click direct Execute presets beside push-to-talk in the task composer.
type: feature
tags:
  - relay
  - composer
  - skills
  - terminal
---

# Saved quick skills

The task composer has a compact saved-skill strip directly below the prompt. When push-to-talk is
available, each surface receives exactly half of the row. When browser audio is unavailable, the
saved-skill surface uses the full row. The strip holds up to twelve operator-defined quick actions,
edited in Terminal settings and persisted with the rest of the UI preferences record.

**Deploy check** is the built-in default, not a fixed catalog entry. Its exact label and prompt live
in `DEFAULT_QUICK_SKILLS`, and an operator can rename it, rewrite its prompt, reorder it, delete it,
or add eleven more beside it.

## Persistence contract

`uiPreferences.quickSkills` is the load-bearing invariant. `normalizeQuickSkills()` resolves it:

| Saved value | Result |
| --- | --- |
| `undefined` or `null` or any non-array | `DEFAULT_QUICK_SKILLS`, as a fresh mutable copy |
| an array, including `[]` | authoritative; `[]` means the operator deleted them all |

Each surviving entry is exactly `{ id, label, prompt }`:

- `id` matches `/^[a-z0-9][a-z0-9-]{0,63}$/`.
- `label` is 1 to 80 characters after trimming and collapsing interior whitespace.
- `prompt` is 1 to 20000 characters after `trimEnd()` only, because interior newlines are
  meaningful. `trimEnd` rather than a `/\s+$/` replace: that regex backtracks quadratically on a
  long interior whitespace run, and a twenty thousand character prompt is exactly that input.
- Unknown keys are stripped, so the persisted record never grows a fourth member.

Further rules, each pinned by a test:

- At most twelve entries, and the cap counts **survivors, not input slots**. The length check runs
  before an entry is normalized, so an invalid entry early in the list cannot push a valid later
  entry out of the strip.
- Invalid entries are dropped, never fatal. `quickSkills` alone can never void the preferences
  record. `normalizeUiPreferences()` still returns `null` for a non-object record and for bad
  `panelWidths`; `quickSkills` is never the reason.
- Duplicate ids keep the first occurrence, so display order stays the operator's order.
- Array order is display order.

> [!important]
> Because the persisted array is authoritative, an edit to the built-in `DEFAULT_QUICK_SKILLS` will
> never reach an operator who has saved preferences even once. Shipping a new built-in quick action
> requires an explicit migration, not a change to the constant.

### Where the value travels

- `state.quickSkills` is seeded at first paint from `localStorage['relay.quickSkills']` with the
  same null-means-default rule. That cache is first paint only.
- `restoreUiPreferences()` overwrites it from the server record and passes the member through even
  when it is missing, because missing means the built-in catalog rather than "keep whatever is
  local". `cacheUiPreferences()` then writes the normalized array back to `localStorage`.
- Every editor change rides `queueUiPreferencesSave()`, which PATCHes the **whole** preferences
  record.

> [!note]
> `PATCH /api/ui-preferences` reads at most **1 MB**, which is `readJson()`'s own module default.
> The route was 16 KB before saved quick skills existed, and an interim 512 KB was still half the
> codebase norm for the one route that had just grown a 240000-character member. Because the route
> replaces the whole record, a rejected save takes every unrelated layout preference down with it.
> Measured serialized sizes for a full twelve by twenty thousand strip, plus the other preference
> members: ASCII 235 KB, emoji or other four-byte-heavy text 470 KB, CJK 704 KB. A Chinese or
> Japanese operator with twelve prompts averaging about 14500 characters exceeded 512 KB with
> nothing exotic. At 1 MB the CJK worst case fits with roughly 340 KB of headroom.
> The renderer refuses an oversized body before the wire call.
> `MAX_UI_PREFERENCES_PAYLOAD_BYTES` in `public/app.js` is `1024 * 1024 - 16 * 1024`, one 16 KB
> margin under the route cap for request framing and members the payload gains later. It is
> measured with `TextEncoder`, so a multi-byte prompt is counted in bytes and not in characters.
> **Move that constant and the route cap together or neither.** The generic
> "Request body is too large. Reduce the attached images and try again." from `readJson()`, which
> takes no message parameter, is now reachable only for a body inside that 16 KB margin, or for a
> client that skips the pre-check. Even then the route text reaches `console.warn` alone: the
> operator sees the client's own "Could not save these settings" notice, because the save path does
> not read the server message. Residual limit: text that JSON escapes six bytes per character,
> such as a prompt of raw control characters, still reaches about 1408 KB, and the client refuses
> it with its own message before the route sees it. `test/ui-preferences.test.mjs` parses the cap out of `src/server.mjs` and
> measures `Buffer.byteLength(JSON.stringify(record))`, so lowering the cap or adding a preferences
> member fails there instead of in an operator's browser.

> [!warning] An over-cap save is announced, and it still loses the edit on reload
> The failure chain is unchanged; only its silence is gone:
>
> 1. `cacheUiPreferences()` writes `localStorage` **before** the size check and before the PATCH
>    resolves, so the UI and the local cache both look correct.
> 2. The refusal is **surfaced**, not only logged. `uiPreferencesPayloadIssue()` measures the exact
>    body about to go on the wire, and `reportUiPreferencesSaveIssue()` puts the message in
>    `#quick-skill-editor-status` while `#terminal-settings-modal` is open, and through
>    `setComposerAlert()` when it is closed. `console.warn` remains, as a second channel only. The
>    same path reports a network or server failure of the save.
> 3. Every **subsequent** save also fails, because the same oversized `quickSkills` array rides
>    every payload: panel widths, voice input, completion alerts, terminal window view.
> 4. On reload, `restoreUiPreferences()` lands the stale server record and `cacheUiPreferences()`
>    overwrites `localStorage` with it, discarding every edit since the first oversized save.
>
> Steps 1, 3, and 4 are by design: the server record is authoritative, and the operator is told to
> shorten a quick-action prompt so the next edit saves. Any future tightening of this route must
> keep the client constant, the message, and both surfaces in step with it.

## Duplicated normalizer

`normalizeQuickSkills` and `DEFAULT_QUICK_SKILLS` exist twice, deliberately: once in
`public/quick-skills.js` for the renderer and once in `src/ui-preferences.mjs` for the server.
Nothing in `src/` imports from `public/`, and no precedent for doing so exists; this mirrors the
arrangement `public/voice-input.js` already uses. A parity table in `test/quick-skills.test.mjs`
runs both copies over the same inputs.

> [!important]
> Anyone editing one copy MUST edit the other. The parity test is the only thing standing between a
> one-sided edit and a server that silently disagrees with the renderer about what is valid.

`QUICK_SKILLS` stays exported from `public/quick-skills.js` as an alias of `DEFAULT_QUICK_SKILLS` so
the pre-configurable import surface keeps working.

## Dispatch contract

Clicking a saved skill calls the same guarded task submission path as the normal task form, with
these deliberate overrides:

- The workflow must be direct Execute without Plan council.
- The active project and selected provider, model, and effort remain authoritative.
- The request uses `runNow: true`.
- The saved label becomes the task name when task naming is supported.
- The saved prompt is sent exactly as cataloged.
- Composer task references and image attachments are not appended.
- The task name, prompt draft, references, and images already in the composer are not cleared.
- The global submission-intent guard still deduplicates an ambiguous retry.

> [!important]
> Do not implement a saved skill by copying its prompt into the required textarea and calling
> `requestSubmit()`. Native form validation blocks an empty textarea before the saved prompt can be
> applied, and a successful ordinary submission clears the operator's unrelated draft. Call
> `submitComposerTask()` with the cataloged skill instead.

A button is disabled while another submission owns the composer, when no project is selected, when
the selected provider CLI is confirmed missing, and in Plan council or Forward-planning Turbo. Its
visible context and accessible label identify the selected target and effort before dispatch.

### One delegated listener

`elements.quickSkillButtons` no longer exists. A single delegated listener,
`handleQuickSkillListClick`, sits on `#quick-skill-list` and resolves the skill from
`state.quickSkills` at click time. Per-button listeners would be lost the first time the operator
edited the strip. The handler **fails closed**: a button whose id left the catalog between paint and
click is a silent no-op, because inventing a prompt would dispatch work the operator never saved.

## Rendering and the refresh loop

`renderQuickSkills()` runs from `updateSubmitState()`, so it is on the two-second snapshot refresh
and on every composer keystroke path. A full `innerHTML` rewrite there would destroy focus and text
selection inside the strip, so:

- A djb2 signature folded over `[index, id, label]` (JSON-encoded, so a label carrying spaces cannot
  collide with its neighbour) gates the rebuild. The shift form `(hash << 5) + hash` is used rather
  than `hash * 33`, which loses precision past 2^53 before the xor.
- Disabled state, the context line, the accessible label, and the title are written **in place**
  every tick.
- The prompt is deliberately absent from the signature because nothing in the button renders it.

> [!important]
> Any new datum rendered into a strip button MUST join the signature fold, or the strip goes stale
> forever.

The strip is hidden entirely when the list is empty.

> [!note]
> The static Deploy check button in `public/index.html` is a pre-hydration placeholder only.
> `renderQuickSkills()` runs at module load, the signature starts `null`, so the first call always
> replaces it. It stays in the markup because `test/quick-skills.test.mjs` asserts it.

## Editor

Terminal settings carries a **Quick actions** section beside the other app-wide sections: an ordered
list of rows, plus **Add quick action** and **Restore default**.

- Each row has a label input, a prompt textarea, Move up, Move down, and Remove. The reorder ends
  are disabled at the list boundaries.
- Add is disabled at twelve, and the status line reads `N of 12`.
- Ids are stable handles. `uniqueQuickSkillId()` slugs the label once at creation, capped at 48
  characters, disambiguating with `-2` through `-999` and then a base36 timestamp. An id never
  follows a rename.
- A rebuild happens only when the row id sequence changed (open, add, remove, reorder). Any other
  refresh syncs values in place and never writes to the field holding the caret.
- Focus follows a moved or removed control to its new row, or to the nearest surviving control, so a
  keyboard operator is not stranded on `document.body`.
- Clearing a box is a keystroke on the way somewhere, not a delete. State keeps the last valid text,
  the row is marked `data-invalid="true"`, and a hint appears; writing the empty value through
  `normalizeQuickSkills` would drop the entry, remove its button, and persist the deletion.
- A rename lands on the strip as it is typed, without touching the editor rows.
- **Restore default** and per-row **Remove** are gated on `window.confirm`, matching the four
  destructive confirmations `public/app.js` already carries. Restore default would wipe every
  hand-authored prompt out of state, the cache, and the server record in one unconfirmed click, and
  Remove sits one row away from Move down with up to twenty thousand characters behind it and no
  undo.

### Draft rows

A row whose `prompt` is still empty is a **draft**: added but not yet written.

- `addQuickSkill()` creates `{ id, label, prompt: '' }`. A placeholder prompt would be a live strip
  button that queues a real provider run of text nobody wrote.
- Add, remove, and reorder go through `commitQuickSkillEdit()`, which assigns the list **as given**.
  `setQuickSkills()`, which normalizes, is reserved for external input: the server record and
  Restore default. Normalizing on an ordinary edit would delete every unfinished row as a side
  effect of touching an unrelated one, so a draft survives reordering and the removal of a
  neighbour.
- A draft never reaches the strip: `quickSkillStripEntries()` filters on a non-empty `trimEnd()`ed
  prompt before the signature fold, so its presence change reaches the signature and it is never
  dispatchable.
- A draft never reaches the localStorage cache or the server record: `normalizeQuickSkills()` drops
  it in `cacheUiPreferences()` and again in the route. It rides the PATCH body and is discarded
  server-side; it is **gone on the next reload, by design**. The editor status line counts drafts
  and says they are not saved, and the row carries `data-invalid="true"` and its own hint from the
  first paint.
- Remove skips the confirmation for a draft alone, because a draft holds nothing to lose. That
  carve-out cannot swallow an authored entry: `handleQuickSkillEditorInput()` never writes a blank
  value into state, so an entry that was ever written keeps a non-empty `prompt` in state even while
  its textarea is visually cleared, and its Remove still asks.

> [!important]
> `#terminal-settings-modal` sits INSIDE `<form id="task-form">`, so the label input's form owner is
> the composer and Enter there would implicitly submit it and queue a real task out of a rename
> keystroke. `handleQuickSkillEditorKeydown` preventDefaults Enter on the label field. The prompt
> textarea is untouched, where Enter is a newline. Anyone adding a text input to that dialog needs
> the same guard.

## Test traps

Two tests read `public/app.js` as text and will break loudly, by design, on a rename or a move:

- `test/quick-skills.test.mjs` slices the click path anchored on the literal
  `function handleQuickSkillListClick(event)`.
- `test/quick-skill-editor.test.mjs` lifts the block between the `// begin quick skills` and
  `// end quick skills` markers and injects every free identifier listed in
  `QUICK_SKILL_DEPENDENCIES`. Referencing a new outside identifier inside that block, or moving the
  markers, surfaces as a `ReferenceError` when the extracted code runs.
- The same file lifts the save path between `// begin ui preferences save` and
  `// end ui preferences save`, injecting `UI_PREFERENCES_SAVE_DEPENDENCIES`. That block lives
  outside the quick-skill markers because it persists every preference, but a refusal is shown in
  the quick-action editor, so the two are proved together. Genuine Node globals such as
  `TextEncoder` resolve without being injected and are therefore absent from the list.

## Visual contract

The row uses the existing graphite control surfaces and active project accent. Each saved action has
a small `>_` command mark, its plain-language name, and a compact `Run now / provider / effort`
signature. Buttons are at least 34 pixels high and at least 92 pixels wide, flex to share the
surface, and the strip scrolls sideways (`overflow-x: auto`, no `flex-wrap`) so extra quick actions
never widen the composer. Focus remains visible, disabled state remains readable, and both light and
dark themes have explicit surfaces for the strip, the editor rows, and the editor status line.

### Verification status

- Prior round, single-entry strip: an isolated paused queue verified the one-click request without
  launching a provider terminal. The created task used the exact Deploy check prompt, Codex,
  `gpt-5.6-sol`, high effort, no attachments, and queue position zero. Synthetic name and prompt
  drafts remained unchanged. Browser checks at 1600 by 1000 and 480 by 900 found equal columns and
  no horizontal overflow in light and dark themes.
- This round: **no browser QA was performed**. In particular a full twelve-entry strip was not
  observed at the 400 pixel minimum Composer width or the 480 pixel breakpoint. The layout claims
  above rest on CSS assertions only: the two-column grid, the single-column collapse when audio is
  unavailable, the strip's `overflow-x: auto` with no `flex-wrap`, the button minimums, the
  focus-visible outline, the disabled opacity, and the dark-theme rules.

## Files and coverage

- `public/quick-skills.js`
- `src/ui-preferences.mjs`
- `src/server.mjs`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/quick-skills.test.mjs`
- `test/quick-skill-editor.test.mjs`
- `test/ui-preferences.test.mjs`

See [[interface-layout]], [[push-to-talk-voice-input]], and [[project-terminal-settings]].

#relay #composer #skills #terminal
