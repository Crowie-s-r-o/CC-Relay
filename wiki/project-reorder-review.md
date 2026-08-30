---
name: Project Reorder Review
description: Adversarial ship review for persisted Launchpad project drag and keyboard reordering.
type: review
---

# Project Reorder Review

## Executive Summary

**Ticket confidence: High**

Launchpad project order is now a shared, persisted catalog property controlled by pointer drag or Left and Right keys. The request carries both the expected order and replacement order, and `ProjectConfigStore.reorderProjects()` validates them under a write lock before changing any position. The active project path and every project-owned queue remain untouched.

Two regressions were found during the extra verification pass and fixed before completion. Periodic project refreshes initially removed focus from a moved grip, and non-reorderable cards initially retained an empty drag column. `restoreProjectListFocus()` now preserves the exact focused project control, and only `.project-chip-reorderable` uses the four-column layout.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `public/project-reorder.js` validates complete ID permutations; `persistProjectOrder()` owns optimistic state and recovery; `ProjectConfigStore.reorderProjects()` commits positions atomically. |
| Regression risk (UI / backend / contracts) | Green | The active path is never written by reorder. Single-project and older-backend cards keep the original three-column grid. All 1,737 repository tests pass. |
| Gap risk (edge cases, error handling, completeness) | Amber | The available browser surface cannot synthesize native HTML drag events. Keyboard movement, persistence, stale writes, geometry, themes, compact layout, and drag source markup were verified. The grip matches the shipped queue drag pattern. |
| Code quality (maintainability as safety) | Green | Reorder calculations live in a small pure module, backend validation is independent, and UI transient state has explicit cleanup and refresh guards. |
| Unit tests | Green | `test/project-reorder.test.mjs` covers moves, drops, invalid membership, unchanged requests, persistence, stale snapshots, incomplete snapshots, append order, capability markup, keyboard wiring, and focus restoration contracts. |
| Performance & scalability | Green | Each client calculation is O(P), each successful write updates P project rows in one transaction, and P is the pinned-project count. No task or event rows are scanned. |

## Change Map

- `public/project-reorder.js`: pure project ID movement and request validation.
- `public/app.js`: grip rendering, native drag lifecycle, keyboard movement, optimistic persistence, stale recovery, auto-scroll, announcements, and focused-control restoration.
- `public/style.css` and `public/index.html`: compact grip, identity-colored insertion rail, dark-theme treatment, and polite live status.
- `src/project-config-store.mjs`, `src/database.mjs`, and `src/server.mjs`: transactional persistence, database delegation, API route, broadcast, and `projectReorder` capability.
- `test/project-reorder.test.mjs` and `test/project-layout.test.mjs`: behavior, persistence, concurrency, and layout contracts.
- `FEATURES.md`, [[project-workspaces]], [[shared-project-configuration]], and [[interface-layout]]: operator and architecture documentation.

The blast radius is the Launchpad project rail, shared project configuration, renderer refresh focus, project-color collision assignment, and downgrade mirroring. Task queue order, task ownership, project selection, provider capacity, terminal ownership, and repository files remain outside the write path.

## Functional Execution Trace

1. Pointer drag starts only from an enabled reorder grip. The renderer freezes the current complete project ID order and reads the dragged card's identity color.
2. Dragover clears stale markers, preserves the source treatment, scrolls near rail edges, and marks only a valid target edge.
3. Drop calls `dropProjectInOrder()`. Keyboard Left or Right calls `moveProjectInOrder()` against the same complete snapshot.
4. `persistProjectOrder()` validates the permutation, applies the order optimistically, disables another reorder, and posts both ID arrays to `/api/projects/reorder`.
5. The server requires both arrays. `ProjectConfigStore.reorderProjects()` enters `BEGIN IMMEDIATE`, compares the expected array with the current locked order, validates exact membership, renumbers from one, commits, and mirrors the shared catalog.
6. Success adopts the authoritative response and announces the new position. Failure clears the pending state and reloads. A stale write receives specific operator copy.
7. Event-stream and two-second refreshes preserve the exact focused project control and cannot repaint while a drag is active.

Null, non-array, non-integer, duplicate, missing, extra, unchanged, stale, and boundary move inputs either produce no client request or fail before a database update. Two live backends cannot both win from the same expected order. A timed-out response may have committed, so the client reloads instead of retrying blindly.

## Top 3 Risks

1. **Native drag automation gap:** the available Chrome control did not emit HTML drag events. The source uses the same draggable span contract as queue cards, and all drag calculations and lifecycle wiring are covered, but a first-class drag E2E remains desirable.
2. **Cross-process lost update:** desktop and localhost share `relay-config.sqlite`. Exact expected-order comparison under `BEGIN IMMEDIATE` turns this into a loud stale failure rather than a silent overwrite.
3. **Refresh-driven interaction loss:** Launchpad redraws every two seconds and after broadcasts. Drag and pending guards prevent mid-gesture replacement, while focused-control restoration survives the later authoritative redraw.

## Top Improvements

- Add a native `dragstart` through `drop` browser test when the Electron or browser harness exposes standards-compliant drag synthesis.
- Add an HTTP-level route test if the server test harness gains isolated route injection without starting provider probes.
- Keep future project-card controls inside the conditional reorder grid contract so one-project and compatibility cards do not lose width.

## Recommendation

**Ship**

The core request, persistence, and concurrency paths are deterministic and covered. The residual Amber is a test-harness limitation, not an observed product defect, and the implementation reuses a proven native drag source pattern.

## Confirmed Issues

No confirmed issue remains open.

The review found two confirmed issues that were fixed in the same change: keyboard focus was lost after the broadcast refresh, and non-reorderable cards reserved an empty drag column.

## Suspected Issues & Edge Cases

- Touch-native reordering is not claimed. CC Relay is currently validated on macOS desktop, and keyboard movement remains available at compact widths.
- If the shared commit succeeds but the response is lost, the UI may briefly report a request failure before the reload reveals the committed order. This is intentionally conservative and avoids an unsafe automatic retry.

## Regression Risks

- Reordering can change collision-resolved automatic project colors because visible order participates in unique palette assignment. This is pre-existing documented behavior in [[project-workspaces]].
- Removing the active project later selects the first remaining project in the newly persisted order. Reorder itself does not change the active path.
- Older backends do not advertise `projectReorder`; those cards render no grip and retain the prior three-column geometry.

## Performance Risks

No material risk found. Client helpers allocate at most a few arrays and maps of P projects. The database performs P indexed primary-key updates inside one short transaction. Periodic rendering already visited every visible project; focus preservation adds one scoped query and at most one focus call.

## Test Gaps

- No standards-compliant automated pointer drag was available in the connected browser harness.
- The API route is contract-tested from source while transactional behavior is exercised through `RelayDatabase`; it is not driven through an isolated HTTP integration test.

**Are there adequate UNIT tests? Yes.** The pure movement rules, all important validation boundaries, persistent ordering, stale concurrency failure, active-project preservation, and append-after-reorder behavior are exercised. The remaining gaps are integration and E2E concerns rather than missing unit cases.

## Positive Improvements

- Shared project order now has the same stale-snapshot protection expected from task queue reorder.
- Keyboard operation is first-class and keeps focus after optimistic, authoritative, broadcast, and periodic redraws.
- The insertion rail inherits the dragged project's identity without adding a new palette or a gradient.
- The implementation required no schema migration and no environment variable.

#relay #projects #review #drag-and-drop #sqlite #accessibility
