---
name: Durable UI Layout Preferences
description: Stable persistence for panel widths, terminal height, and monitor-bar placement across desktop origin changes.
type: architecture
tags: [relay, ui, persistence, electron, layout]
---

# Durable UI layout preferences

CC Relay persists its global interface layout in the shared configuration database under the
`ui-layout-preferences` setting. The saved record contains:

- Composer and Task queue widths
- Task Activity terminal height, when the user has explicitly resized it
- Monitor bar position, `top` or `bottom`
- Running-task monitor rows, one through three, and card width, Compact, Default, or Wide
- Terminal window view, the default view the Terminal window opens on
- Completion sound choice, voice enabled state, selected spoken parts, and task-name word limit
- Push-to-talk enabled state, canonical activation shortcuts, and selected microphone label
- Saved composer quick actions, up to twelve `{ id, label, prompt }` entries

`GET /api/ui-preferences` restores the record. `PATCH /api/ui-preferences` validates bounded pixel
values and writes it through `ProjectConfigStore`. The renderer updates browser `localStorage` at
the same time so ordinary refreshes and first paint remain fast.

> [!note]
> Saved quick actions are the one member large enough to reach the route's JSON body cap, so the
> renderer measures the serialized body against `MAX_UI_PREFERENCES_PAYLOAD_BYTES` before the wire
> call and reports a refused save to the operator instead of logging it alone. That constant must
> track the route cap in `src/server.mjs`. See [[saved-quick-skills]].

> [!important]
> `PATCH /api/ui-preferences` is a FULL-RECORD REPLACEMENT despite the verb. `normalizeUiPreferences()`
> returns `null` when `panelWidths.composer` or `panelWidths.queue` is absent, and `src/server.mjs`
> then rejects the request with **"Valid panel widths are required."**, so a convenient one-field body
> does not work. A body that does validate replaces the entire record, and every member the payload
> omits silently resets to its default. Every save must go through the single `uiPreferencesPayload()`
> builder in `public/app.js`. When adding a member, re-read that builder immediately before editing it
> and confirm every existing member is still listed: two concurrent work streams each extending this
> record can silently erase each other's member from a stale copy.

> [!important]
> The desktop app requests port `0`, so its embedded server receives a different HTTP port on
> later launches. Since browser storage is scoped by scheme, host, and port, local storage from
> the previous launch is invisible on the next one. Stable database persistence is therefore the
> authoritative source, not a secondary backup.

On the first run after this support lands, an absent database record is initialized from the
current origin-local state. This migrates an existing bottom-bar choice and current panel geometry
when that origin still has them. On later runs, database state wins and refreshes the local cache.

Task alert settings use the same durability path because desktop ports also change between
launches. The renderer waits for this record before its first task snapshot, so a saved **Silent**
choice cannot lose a startup race to the default chime. See [[task-completion-alerts]].

Push-to-talk uses the same app-wide record. Its `voiceInput` member contains `enabled`, a canonical
primary `shortcut`, and a nullable canonical `alternateShortcut`; the primary default is
`Control+Shift+Space`. Its nullable `microphoneLabel` preserves a named input without persisting the
origin-scoped browser device ID. Backend and renderer normalizers use the same modifier ordering,
supported physical key codes, duplicate removal, and bounded device label, while local storage
provides only the fast origin-local cache. Engine binaries, model files, microphone permissions, and
recordings are not preferences.
See [[push-to-talk-voice-input]].

Files:

- `src/ui-preferences.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `public/app.js`
- `test/ui-preferences.test.mjs`

## Verification

The focused preference, header, panel-layout, task-detail, and database suite passes 39 of 39
checks. The complete repository suite passes 1,106 of 1,106 tests.

See [[header-position]], [[interface-layout]], and [[shared-project-configuration]].

## Running-task monitor layout

The running-task layout defaults to two rows and Default 286px card minimums. The renderer caches the
choice under `relay.runningTaskLayout` for first paint, then restores the authoritative shared
record through `GET /api/ui-preferences`. Backend normalization accepts only rows 1, 2, or 3 and
widths 230px, 286px, or 360px. Missing or stale values fall back independently to the defaults, so
older saved preference records remain valid.

> [!note]
> This is an application-wide monitoring preference. It must not be stored on a project or copied
> by **Apply to all projects**, which owns native terminal layout only. See [[project-terminal-settings]].

## Terminal window view

`terminalWindowView` records the view the Terminal window opens on. Allowed values are `all`,
`conversation`, `mine`, and `ai`; anything missing, null, wrongly typed, or unknown falls back to
`all` through a `Set` whitelist in `src/ui-preferences.mjs`. The renderer caches the choice under
`relay.terminalWindowView` for first paint, then restores the authoritative shared record through
`GET /api/ui-preferences`. A record from a server that predates the member returns nothing, and the
renderer then keeps its local seed rather than resetting the operator's choice.

> [!note]
> This is an application-wide terminal preference. It must not be stored on a project or copied by
> **Apply to all projects**, which owns native terminal layout only. It also governs the Terminal
> window alone: the inline Task Activity filter rail still defaults to **All** and is not persisted.
> See [[terminal-window]], [[terminal-conversation-filters]], and [[project-terminal-settings]].
