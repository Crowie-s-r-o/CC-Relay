---
name: Task Diff Preview
description: Capability-gated per-task Changes dialog that shows a live or frozen git diff of everything a task edited since it started.
type: feature
tags:
  - relay
  - ui
  - tasks
  - git
  - diff
  - observability
---

# Task Diff Preview

Every task that starts inside a git repository records a baseline tree of the working state at that moment and gains a **Changes** action in the task detail panel. The action opens `#task-diff-modal`: a changed-file tree on the left, a side-by-side before and after diff on the right, both drawn on the Tokyo Night terminal surface in either application theme. While the task is live the diff follows the working tree; after a terminal outcome it freezes against the tree captured when the task ended.

## Behavior

The **Changes** button renders only when `capabilities.taskDiffPreview` is true and the task row carries diff state with a baseline or a recorded capture error. Legacy rows read a null `diffState` and never show the button, so an existing database keeps its existing behavior.

- The left tree shows per-file status letters, `+N`/`-N` line counts, and collapsible folders. Rendering is budgeted at 400 rows (`FILE_ROW_LIMIT`); hidden entries are counted by an honest overflow line, `N more changed files not shown.`
- The right pane renders paired hunk rows with before and after line numbers. Each side scrolls horizontally on its own (`white-space: pre`), and the two-column body collapses to a single column at 760px.
- The summary bar carries file and line totals, a `LIVE` badge while the diff is moving, and the capture timestamp once frozen.
- While the task status is `running` or `open`, the dialog refetches every 3 seconds (`TASK_DIFF_POLL_MS`). The server sends a render signature with every payload; an unchanged signature skips the DOM write entirely, so scroll positions, text selection, and folder collapse state survive live refreshes. Rewrites also wait for the text-selection guard, and a 404 stops the poll instead of retrying forever.
- Terminal statuses (`complete`, `failed`, `cancelled`, `interrupted`) freeze the diff; a frozen payload keeps one signature, so later polls move nothing.

## API contract

- `GET /api/tasks/:id/diff` answers the summary: availability plus a reason code when unavailable, the bounded file list, totals, the live flag, `sharedTree`, `truncated`, the capture timestamp, and the render signature. A missing task is a 404.
- `GET /api/tasks/:id/diff/file?path=...` answers one file's paired hunks with its own signature and `truncated` and `tooLarge` flags. A malformed path is a 400; a path that is not part of this diff is a 404.
- Both routes are registered above the bare `GET /api/tasks/:id` route, and the diff API suite pins that ordering with a dedicated test.
- The capability is announced as `capabilities.taskDiffPreview` on `/api/status` and fails closed across mixed backend and renderer versions.
- `api()` in `public/app.js` now attaches `failure.status` to thrown request errors. The change is additive and available to every caller; the diff dialog uses it to end polling on 404.

## Capture lifecycle and invariants

The baseline is a git tree of the working state, tracked plus untracked with `.gitignore` respected, built through a temporary index: `GIT_INDEX_FILE` pointed into a temp directory, `read-tree --empty`, `add -A -- .`, `write-tree`. Snapshots never touch the user's real index, worktree, refs, or `HEAD`; the only residue is gc-prunable loose objects in `.git/objects`.

> [!important]
> The baseline is captured once per task, fire and forget, as the strictly last statement of `TaskQueue.beginTask` in `src/queue.mjs`. Awaiting it would break the same-tick invariant between `schedule()` and `planAhead()` that Turbo look-ahead depends on. The accepted residual: provider writes inside the roughly 100 to 250 ms snapshot window fold into the baseline. A follow-up or retry re-enters `beginTask`, keeps the original baseline, and only clears the frozen end so the diff goes live again.

- The end tree is captured at the terminal transition by the `queue.on('changed')` listener in `src/server.mjs` through `maybeCaptureTaskDiffEnd`. A shared in-flight guard prevents that listener and the lazy path below from double capturing.
- Lazy self-heal: a terminal task with no recorded end tree, because the backend restarted before the transition, records one on its first summary view and then stays frozen.
- The comparison is baseline against the current working tree while live, with tree and summary caches held 2.5 seconds per repository root, and baseline against the stored end tree once terminal.
- State persists in `tasks.diff_state_json` (an `ensureColumn` migration, whitelisted in `TASK_FIELDS`); `normalizeTask` exposes it as `task.diffState`. Concurrent read-modify-write interleavings on the column converge, which the adversarial review proved with runtime probes.
- `sharedTree` reports whether other tasks ran in the same repository during the baseline-to-end window, through `countOverlappingRepoTasks` in `src/database.mjs`. A `NULL finished_at` holds the tree open only while the row's status is still `running` or `open`; a bare `OR finished_at IS NULL` disjunct previously let any terminal row without an end time pin `sharedTree` true forever.

## Bounds and honesty affordances

Every git spawn runs with an argument array, an explicit `maxBuffer`, a 15 second timeout, and `--` plus `:(literal)` pathspecs, so a hostile path cannot become an option or a glob and a wedged git cannot hang a request. Failures degrade to reason codes rather than crashes or hangs.

- Summary: at most 500 files; the notice says `Showing first 500 changed files.`
- File patch: at most 5,000 parsed lines, and a patch over 2 MB answers `tooLarge` instead of the text.
- Unavailable diffs carry one of `not-a-git-repository`, `git-unavailable`, `baseline-failed`, `captured-before-diff-support`, or `diff-failed`; the renderer maps unknown future reasons to a safe generic sentence, and an available diff with no files reads `No file changes recorded.`
- `sharedTree` shows `Other tasks ran in this project during this window; changes may overlap.`
- Every model-controlled or task-controlled value, including file paths and hunk text, passes through `escapeHtml` before HTML interpolation.

## The two CSS and test traps

> [!warning]
> The Tokyo Night `--term-*` palette on `.events-section` cannot be comma-extended to new selectors. `test/plan-visibility.test.mjs` slices the ledger palette with `style.indexOf('.events-section {')`, so widening that selector silently breaks the slice. The diff surface therefore declares its own copy on `.task-diff-modal .task-diff-surface`: the subset of thirteen `--term-*` values the dialog uses, each byte identical to the ledger's. `test/task-diff-view.test.mjs` pins ten of those tokens byte identical in both blocks. If the palette ever changes, change both blocks together by hand.

> [!warning]
> No new `@media (prefers-reduced-motion: reduce)` block may ever be appended to `public/style.css`. Five suites (`planner-board`, `plan-visibility`, `session-tasks-ui`, `provider-usage-ui`, and `task-diff-view` itself) anchor on the LAST reduce block via `lastIndexOf`. The diff dialog adds no motion, so it ships no reduce block at all.

The dialog styles sit between the markers `/* Task changes dialog` and `/* End task changes dialog. */` at the end of `public/style.css`. The dialog frame reuses the dual-themed `.terminal-settings-modal` chrome, and the diff surface itself is deliberately theme invariant, exactly like the Task Activity terminal; see [[dark-mode]] and [[task-activity-overview]].

## Known limitations

- Snapshot trees are unreferenced git objects. A `git gc` weeks later can prune them, after which a frozen diff answers `diff-failed`.
- A live snapshot re-hashes the working tree (`add -A` into the temporary index) on every capture. Very large repositories pay that cost per live refresh window; the 15 second git timeout bounds it and degrades to `diff-failed` instead of blocking.
- The lazy self-heal after a backend restart freezes the tree as it stands at first view, not as it stood when the task actually ended.
- A row stuck in status `running` after a backend kill keeps `sharedTree` true for later tasks in that project. That is correct under the current overlap definition; any staleness policy would be a product decision.

## Restart requirement

The routes, the capability flag, the queue-side baseline capture, the database column, and the renderer shipped together. Restart CC Relay and rebuild the desktop bundle to activate the feature; until then the capability stays absent and the renderer hides the action.

## Implementation map

- `src/task-diff.mjs` owns snapshots, state normalization, parsers, the summary and file builders, caches, and every bound.
- `src/queue.mjs` fires the baseline capture as the last statement of `beginTask`.
- `src/server.mjs` owns the two routes, the capability flag, and the terminal-transition end capture.
- `src/database.mjs` owns the `diff_state_json` column, the whitelist, `diffState` normalization, and `countOverlappingRepoTasks`.
- `public/task-diff-view.js` is the pure markup module: tree, hunks, notices, reason texts, and budgets.
- `public/app.js` wires the Changes action, the dialog lifecycle, the 3 second poll, and the signature render-skip.
- `public/index.html` carries the `#task-diff-modal` markup; `public/style.css` carries the marked dialog block.
- `test/task-diff.test.mjs`, `test/task-diff-api.test.mjs`, `test/task-diff-capture.test.mjs`, and `test/task-diff-view.test.mjs` cover the contract.

## Verification

The four focused diff suites pass 58 of 58. The complete repository suite passes 1,531 of 1,531 on August 13, `npm run release:check` reports consistent v0.2.9 metadata, and `git diff --check` is clean. The adversarial review ended verdict Ship with zero mandatory findings and 13 of 13 runtime probes passed: snapshots mutate nothing the user owns, no unhandled rejections escape the fire-and-forget captures, hostile filenames stay inert markup, and concurrent diff-state writes converge.

See also [[task-activity-overview]], [[interface-layout]], [[task-history]], and [[dark-mode]].

#relay #ui #tasks #git #observability
