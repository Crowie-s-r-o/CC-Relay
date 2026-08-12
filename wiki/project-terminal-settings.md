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
> Terminal behavior belongs to the exact pinned project. Terminal session or workflow retention, legacy idle CC Relay routing, grid enablement, rows, columns, monitor, and minimized launch must never read a value from another project. The only cross-project write is the explicit **Apply to all projects** window-layout action.

The terminal retention choice defaults to disabled for every new project. Existing explicit project choices remain unchanged. Turning it on changes only the selected project. Direct Execute labels it **Terminal session mode** and snapshots manual completion; Plan council and Turbo label it **Keep workflow terminals open** and retain terminals without changing automatic completion. The renderer no longer reads or writes `relay.keepTerminalOpen`, `relay.preferIdleTerminal`, or `relay.terminalLayout`.

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
- minimized launch enabled

The in-memory [[project-workspaces|project composer session]] also carries these settings as an older-backend fallback. Current backends treat the project row as authoritative and save changes immediately.

> [!important]
> A persisted `terminal_layout: null` means clean defaults for that project. It must not fall back to the previously selected project's layout. `normalizeProjectTerminalSettings()` distinguishes an explicit project row from an older backend that exposes no project setting fields.

The terminal setting controls are disabled while their project write is active. The project object is updated optimistically so switching Launchpads immediately uses the selected project's own values. Background project refreshes do not repaint settings during a write.

## Explicit window-layout copy

The settings dialog labels the stored `terminal_layout.background` field as **Open new terminals minimized**. The compatibility field name remains unchanged, but its product meaning is narrow: minimize only the native terminal window created by that launch. It does not place the window behind every app, hide Terminal.app, or affect unrelated Terminal windows. Grid launches still use the next available cell.

**Apply to all projects** sends the current grid enabled state, columns, rows, monitor, and minimized-launch choice to `PATCH /api/projects/terminal-layout`. `ProjectConfigStore.updateAllProjectTerminalLayouts()` updates every pinned project with one SQLite statement and then refreshes the shared legacy mirror. The bulk write changes only `terminal_layout_json`; project retention, idle routing, instance limits, colors, and active-project state remain untouched. Later edits return to normal project-specific saving.

> [!note]
> The terminal settings dialog no longer exposes **Copy diagnostics** or its local-path warning. The diagnostics API and internal diagnostic logging remain available for engineering use; this change removes only the end-user control from this dialog.

> [!note]
> Retention changes apply to new task submissions immediately. When a renderer is temporarily connected to an older backend without `capabilities.projectTerminalSettings`, it keeps the choice in that project's in-memory composer session without showing a restart requirement. A current backend also persists the same snapshot through the project settings API.

## Task snapshot boundary

Each submitted task still snapshots `keep_terminal_open`. New direct Execute tasks also snapshot `manual_completion` when the backend supports [[manual-terminal-session-mode]]. Changing the project setting later cannot rewrite queued, running, open, or historical task intent. Breakdown, plan execution, Plan council, Turbo, Retry, and Continue session continue to carry the existing task-level retention contract from [[retained-terminal-sessions]].

## Validation

- 136 focused renderer, database, shared-config, launcher, and dark-theme tests passed.
- Database coverage proves a bulk layout copy changes both project layouts while preserving their different retention and idle-routing values.
- An isolated live backend copied a 4 by 2 minimized layout to two projects through the bulk API and returned both projects with their other settings intact.
- Browser checks covered the dark desktop dialog and a 620 pixel compact viewport. The compact dialog had no horizontal overflow, its action stacked below the explanation, and the console reported no warnings or errors.
- `npm run release:check` and `git diff --check` passed.

## Files

- `public/project-composer-state.js`
- `public/app.js`
- `public/index.html`
- `src/project-config-store.mjs`
- `src/database.mjs`
- `src/server.mjs`
- `public/style.css`
- `test/project-composer-state.test.mjs`
- `test/project-config-store.test.mjs`
- `test/database.test.mjs`
- `test/composer-workflows.test.mjs`

See [[retained-terminal-sessions]], [[shared-project-configuration]], [[interface-layout]], and [[project-workspaces]].

#relay #projects #terminal #settings #isolation
