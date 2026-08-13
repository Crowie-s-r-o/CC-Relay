---
name: Localhost Task Import
description: Removed desktop feature that copied finished localhost tasks into the CC Relay desktop history, and the schema it left behind.
type: architecture
---

# Localhost Task Import

> [!warning] Removed on August 13, 2026
> The **Import localhost** action, its `POST /api/tasks/import-localhost` endpoint, the `localhost-task-database` shared-configuration registration, and `RelayDatabase.importTaskHistory()` were all removed. Desktop and localhost histories are now independent with no transfer path. This page is kept because the schema the feature created still exists.

## What remains

The `tasks` table keeps `import_source`, `import_task_id`, and the partial unique index `idx_tasks_import_origin`. Rows imported before removal keep their origin columns and their remapped `continued_from_task_id` links, so existing desktop history is unchanged. Nothing writes those columns any more.

> [!important]
> Do not drop these columns or the index without an explicit migration. Existing persistent task rows keep their legacy behavior.

> [!note]
> Existing installs still carry a `localhost-task-database` row in their shared `relay-config.sqlite`. Nothing writes or reads it any more. It is harmless and is left in place rather than migrated away.

## What the feature did

The desktop task queue heading exposed **Import localhost**. A standalone localhost backend registered its absolute `relay.sqlite` path in the shared `relay-config.sqlite`, and the desktop backend copied eligible history out of it.

The import copied only terminal outcomes: `complete`, `failed`, `interrupted`, and `cancelled`. It never copied `queued` or `running` rows, which preserved [[shared-project-configuration|the scheduler isolation boundary]]. Imported tasks received new desktop-local IDs keyed by source database path plus source task ID, so repeats refreshed instead of duplicating. Task events and task artifact directories came along; source submission IDs did not, because idempotency keys belong to the scheduler that accepted the original request.

## Queue interface

Queue cards use a pale tint derived from the project canvas instead of a white surface, and the operational queue has date-ledger dividers labeled **Today** and **Past**. Both shipped alongside the import feature and both survive its removal. Dividers follow the existing task order, so task priority, drag behavior, and scheduler ordering do not change. Coverage moved from the deleted `test/task-import-ui.test.mjs` into `test/queue-ledger-ui.test.mjs`.

## Removal surface

- `public/index.html` — the button and the `#task-import-status` live region
- `public/app.js` — element handles, `state.importingTasks`, the `renderTasks()` block, the click handler
- `public/style.css` — `.task-import-status` rules in both the light and dark blocks
- `src/server.mjs` — the endpoint, the `taskHistoryImport` status payload, the `localhostTaskImport` capability flag, `localhostTaskDatabasePath()`, the standalone registration write, and the now-unused `cpSync` import
- `src/database.mjs` — `importTaskHistory()`, `IMPORTABLE_TASK_COLUMNS`, `IMPORTABLE_TASK_STATUSES`, and the now-unused `existsSync` import
- `test/task-import-ui.test.mjs` — deleted; `test/queue-ledger-ui.test.mjs` replaces it and asserts the feature stays gone while the schema stays present
- `test/desktop-startup.test.mjs` — took over the `--relay-desktop` flag assertion the deleted test used to own

## Validation

- All 1436 repository tests passed on August 13, 2026, along with `npm run release:check` and `git diff --check`.
- The queue heading is a plain flex row with a 12px gap, so removing one control narrows the row without any other layout effect.

See [[task-history]], [[shared-project-configuration]], and [[project-workspaces]].

#relay #tasks #desktop #localhost #import #sqlite #removed
