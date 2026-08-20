---
name: Shared Project Configuration
description: Disk-backed Launchpad configuration shared safely by localhost and desktop CC Relay.
type: architecture
---

# Shared Project Configuration

CC Relay stores the Launchpad project catalog in a dedicated per-user SQLite database named `relay-config.sqlite`. Standalone localhost CC Relay and the Electron desktop backend open the same file:

- macOS: `~/Library/Application Support/dual-agent-orchestrator/relay-config.sqlite`
- Windows: `~/AppData/Roaming/dual-agent-orchestrator/relay-config.sqlite`
- Linux: `~/.config/dual-agent-orchestrator/relay-config.sqlite`

The shared records include pinned project path, display name, order, last launch time, maximum Codex and Claude instances, terminal retention, legacy idle routing, terminal layout, the optional default Standup prompt, and the active project path. The renderer reads projects and the active path from `GET /api/projects`, writes explicit selections through `POST /api/projects/active`, saves terminal choices through `PATCH /api/projects/:id/settings`, and saves Standup guidance through `PATCH /api/projects/:id/standup-prompt`.

## Isolation boundary

> [!important]
> Share project configuration only. Do not point localhost and desktop at the same task database while both can run. Each backend owns a scheduler and recovery lifecycle, so a shared task database could dispatch a task twice or interrupt work owned by the other process.

Task rows, events, plans, plan runs, task artifacts, and queue pause state remain in each backend's own data root. The shared store uses SQLite WAL mode and a busy timeout so the two live processes can read and update project configuration safely.

Terminal launch ownership is the one exception. Each backend still owns its own launches, but it now publishes a claim for each one into this same shared file so the other backend can see it, because per-process ownership let two live backends adopt and then close each other's terminals. See [[dual-backend-ownership-guard]].

Finished localhost task history could once be copied explicitly into the desktop database through **Import localhost**. That action and its `localhost-task-database` registration were removed on August 13, 2026. Task databases were never shared live, and scheduler ownership stays isolated per backend. See [[localhost-task-import]].

> [!important]
> Every terminal setting is stored on its own project row. Sharing the configuration database between localhost and desktop does not permit Alpha to inherit Beta's retention, idle-routing, grid, monitor, or background-launch choice. See [[project-terminal-settings]].

> [!important]
> `standup_custom_prompt` is also isolated on the exact project row. Standup generation reloads it server-side after resolving the requested pinned path, so Alpha cannot inherit a browser draft or saved prompt from Beta. See [[daily-standup]].

## Legacy migration

`RelayDatabase` accepts a `projectConfigPath` and delegates project operations to `ProjectConfigStore`. On first use of a particular shared path, each local data database contributes any legacy `projects` rows that are not already present. A marker in that local database prevents stale legacy rows from resurrecting a project later removed through the other process.

The shared rows are mirrored back into the local legacy table as a downgrade aid. Project paths are the migration identity. Shared integer IDs become authoritative after migration because tasks and plans reference a project by `repo_path`, not by project ID.

The additive `standup_custom_prompt` column is created with a non-null empty-string default in both shared and legacy project tables. This keeps inserts from older schemas valid, preserves existing configuration, and makes an unconfigured project behaviorally identical to the previous Standup implementation.

> [!note]
> An empty desktop database may initialize the shared file before localhost starts. Migration is tracked per local data database, so that ordering does not suppress import from the existing localhost database.

## Implementation

- `src/project-config-store.mjs`
- `src/database.mjs`
- `src/server-options.mjs`
- `src/server.mjs`
- `src/electron-main.mjs`
- `public/app.js`
- `test/project-config-store.test.mjs`

## July 28 validation

- All 752 repository tests passed in the final source regression run.
- The existing localhost database migrated five project rows with their exact Codex and Claude limits into the per-user config file.
- Project terminal settings were saved with different values for two isolated project paths and survived a backend restart.
- The final signed packaged app started on HTTP port `52596`, advertised `capabilities.sharedProjectConfig`, and returned the same five projects with CC Relay as the active path.
- The desktop task database remained empty while the localhost queue stayed independent.
- Strict code-signature verification passed, ZIP integrity reported no errors, and the DMG checksum was valid.
- The installed `/Applications/CC Relay.app` has the same `app.asar` SHA-256 as the validated build output.

## July 28 history visibility diagnosis

The packaged app and localhost can show the same active Launchpad while displaying very different History contents. This is expected because the Launchpad selection comes from shared `relay-config.sqlite`, while History comes from the backend-local `relay.sqlite`.

A live read-only inspection on macOS found:

- localhost `.data/relay.sqlite`: 379 tasks, including 240 for the CC Relay project
- desktop `~/Library/Application Support/dual-agent-orchestrator/relay.sqlite`: a newly initialized desktop history containing only desktop-created tasks
- shared `relay-config.sqlite`: CC Relay selected as the active project for both

> [!important]
> Matching Launchpads do not imply matching task history. Do not diagnose this state as lost data or a project filter problem when the older rows remain in the localhost database.

See [[task-history]] for the second visibility boundary: History is also filtered to the exact active project inside whichever backend-local database is open.

See [[project-workspaces]], [[desktop-updates]], and [[diagnostics]].

#relay #projects #configuration #desktop #sqlite
