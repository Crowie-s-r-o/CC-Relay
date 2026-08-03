---
name: Project Terminal Settings
description: Project-scoped retention, idle routing, and native terminal layout with no cross-project fallback.
type: architecture
tags:
  - relay
  - projects
  - terminal
  - settings
  - isolation
---

# Project Terminal Settings

> [!important]
> Terminal behavior belongs to the exact pinned project. **Keep task terminals open**, legacy idle CC Relay routing, grid enablement, rows, columns, monitor, and background launch must never read a value from another project.

**Keep task terminals open** defaults to disabled for every new project. Existing explicit project choices remain unchanged. Turning it on changes only the selected project. The renderer no longer reads or writes `relay.keepTerminalOpen`, `relay.preferIdleTerminal`, or `relay.terminalLayout`.

## Persistence contract

`relay-config.sqlite` stores these additive `projects` columns:

- `keep_terminal_open INTEGER NOT NULL DEFAULT 0`
- `prefer_idle_terminal INTEGER NOT NULL DEFAULT 0`
- `terminal_layout_json TEXT`

`GET /api/projects` returns normalized booleans and a parsed `terminal_layout` object. `PATCH /api/projects/:id/settings` validates and saves a complete project snapshot. `/api/status` advertises `capabilities.projectTerminalSettings`.

The same project configuration file may be opened by localhost and desktop CC Relay, as described in [[shared-project-configuration]]. That shares one project's own choices between those surfaces. It does not share a choice between different project paths.

## Renderer contract

`freshProjectTerminalSettings()` provides independent defaults:

- retention disabled
- idle routing disabled
- grid enabled
- 3 columns and 3 rows
- primary monitor
- background launch enabled

The in-memory [[project-workspaces|project composer session]] also carries these settings as an older-backend fallback. Current backends treat the project row as authoritative and save changes immediately.

> [!important]
> A persisted `terminal_layout: null` means clean defaults for that project. It must not fall back to the previously selected project's layout. `normalizeProjectTerminalSettings()` distinguishes an explicit project row from an older backend that exposes no project setting fields.

The terminal setting controls are disabled while their project write is active. The project object is updated optimistically so switching Launchpads immediately uses the selected project's own values. Background project refreshes do not repaint settings during a write.

> [!note]
> Retention changes apply to new task submissions immediately. When a renderer is temporarily connected to an older backend without `capabilities.projectTerminalSettings`, it keeps the choice in that project's in-memory composer session without showing a restart requirement. A current backend also persists the same snapshot through the project settings API.

## Task snapshot boundary

Each submitted task still snapshots `keep_terminal_open`. Changing the project setting later cannot rewrite queued, running, or historical task intent. Direct Execute, breakdown, plan execution, Plan council, Turbo, Retry, and Continue session continue to carry the existing task-level retention contract from [[retained-terminal-sessions]].

## Validation

- 765 repository tests passed.
- Database tests prove two project rows retain different retention, idle-routing, and layout values.
- Shared-config tests prove the values survive reopening while remaining isolated by project path.
- An isolated live backend started on an operating-system-assigned port, saved Alpha with retention off and a 2 by 4 foreground grid, left Beta at retention on with default layout, restarted, and returned both exact records unchanged.
- Browser click-through was unavailable because this session exposed no browser instance. Static renderer tests and the isolated HTTP test covered the same project switch and persistence contracts.

## Files

- `public/project-composer-state.js`
- `public/app.js`
- `public/index.html`
- `src/project-config-store.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `test/project-composer-state.test.mjs`
- `test/project-config-store.test.mjs`
- `test/database.test.mjs`
- `test/composer-workflows.test.mjs`

See [[retained-terminal-sessions]], [[shared-project-configuration]], [[interface-layout]], and [[project-workspaces]].

#relay #projects #terminal #settings #isolation
