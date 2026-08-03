---
name: Localhost Task Import
description: Safe, idempotent transfer of finished localhost tasks into the CC Relay desktop history.
type: architecture
---

# Localhost Task Import

The desktop app exposes **Import localhost** in the task queue heading. A standalone localhost backend registers its absolute `relay.sqlite` path in the already shared `relay-config.sqlite`. The desktop backend reads that registration and copies eligible task history into its own database.

## Ownership boundary

> [!important]
> The import copies only terminal outcomes: `complete`, `failed`, `interrupted`, and `cancelled`. It never copies `queued` or `running` rows. This preserves [[shared-project-configuration|the scheduler isolation boundary]] and prevents desktop and localhost from dispatching the same work.

Imported tasks receive new desktop-local IDs. Their source database path and source task ID form a unique origin key, so repeating the import refreshes existing copies instead of creating duplicates. `continued_from_task_id` links are remapped to the corresponding desktop-local task IDs.

Task events and task artifact directories are copied with each imported row. This keeps prompts, responses, results, logs, and image attachments inspectable in Task Activity. Source submission IDs are not copied because idempotency keys belong to the scheduler that accepted the original request.

> [!note]
> Active localhost tasks remain visible only in localhost until they reach a terminal outcome and the user imports again. The import is an explicit snapshot, not a live shared queue.

## Discovery

Standalone startup writes `localhost-task-database` into the shared project configuration store. Desktop startup is marked with `--relay-desktop`, so it never replaces the localhost registration with its own database path.

If no source is registered, the desktop button remains disabled and instructs the user to start localhost CC Relay once. When several localhost checkouts use the same shared configuration, the most recently started localhost backend is the registered source.

## Interface

Queue cards use a pale tint derived from the project canvas instead of a white surface. The operational queue adds date-ledger dividers labeled **Today** and **Past**. Dividers follow the existing task order, so task priority, drag behavior, and scheduler ordering do not change.

## Implementation

- `src/database.mjs`
- `src/server.mjs`
- `src/electron-main.mjs`
- `public/index.html`
- `public/app.js`
- `public/style.css`
- `test/database.test.mjs`

## Validation

- The dedicated database regression proves first import, repeat refresh, active-task skipping, event copying, and continuation-link remapping.
- All 819 repository tests passed on July 30, 2026.
- Browser-based visual inspection was unavailable in the non-interactive environment, so the interface was validated through syntax, static UI coverage, and the complete regression suite.

See [[task-history]], [[shared-project-configuration]], and [[project-workspaces]].

#relay #tasks #desktop #localhost #import #sqlite
