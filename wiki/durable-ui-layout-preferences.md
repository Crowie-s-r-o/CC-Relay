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
- Completion sound choice and optional short voice announcement

`GET /api/ui-preferences` restores the record. `PATCH /api/ui-preferences` validates bounded pixel
values and writes it through `ProjectConfigStore`. The renderer updates browser `localStorage` at
the same time so ordinary refreshes and first paint remain fast.

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
