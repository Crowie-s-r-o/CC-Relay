---
name: Task Review Visibility
description: Prominent completion review markers and the counted project-scoped review-only task view.
type: feature
tags: [relay, tasks, review, ui, accessibility]
---

# Task review visibility

The Queue header exposes three views on a dedicated row: **Queue**, **History**, and **Ready for
review** with a live count. The review view contains only completed tasks still awaiting review
in the exact selected project, across every date. Stars retain their existing precedence and
unstarred review tasks keep descending task-ID order. Queue execution order never changes.

The chosen view uses the existing `relay.taskView` preference, accepting `review` alongside
`queue` and `history`. Review membership stays in the durable database contract described in
[[launchpad-completion-notifications]]. No new storage key, backend endpoint, or environment
variable is required. `tasksReadyForReview()` in `public/task-history.js` combines completed status
with the same notification-store membership predicate used by card badges and project counts.

## Visibility and interaction

Every unread task card has a solid rose badge on its own line, a four-pixel left rail, and a rose
surface and border. Light and dark tokens live in `public/launchpad.css`. Selection still owns
the project-colored outline and surface; the review badge and rail remain independent signals.
The normal Complete status is retained. The filter stays visible and usable at zero, with a
specific empty message explaining when tasks appear.

> [!important]
> The newer unlayered Launchpad stylesheet overrides `style.css` in the legacy cascade layer.
> Updating only the older review selectors does not restore the review tint or rail. Keep the
> final card, hover, badge, divider, and filter treatments in the owning Launchpad stylesheet.

Opening a task clears only the exact completion outcome after its detail request succeeds.
The card leaves the review view while Task Activity keeps showing its result. Count and summary
refresh immediately. Keyboard activation moves focus to the remaining first review card or the
filter if the list becomes empty, provided focus has not moved elsewhere during the request.
Bulk review remains project-scoped and its button is re-enabled in `finally` after success or
failure, so a later completion can be cleared without restarting.

Search continues to cover all saved project conversations, including reviewed tasks. No view is
shown as pressed while search is active. Choosing any view clears the query, cancels scheduled
search, and invalidates late responses before rendering that view. Clearing search directly
returns to the saved view. See [[task-search]].

Review view hides History statistics, queue reordering, assignment, and parallel-batch controls.
Project switching retains the view and recalculates its count using normalized exact paths;
neither another project nor a nested workspace can leak into the list.

## Verification

- `test/task-history.test.mjs` exercises mixed statuses, old dates, stars, exact project isolation,
  acknowledgements, empty input, and non-mutating filtering against real notification state.
- Existing completion persistence tests cover database reopen, migration, and exact-outcome races.
- `scripts/verify-task-review.cjs` runs the real Electron renderer against synthetic HTTP fixtures.
  It checks both themes at 1720, 1180, and 380px, final computed card styles, project switches,
  reload, search and late responses, keyboard opening, the empty view, and reusable bulk review.
  All windows, SSE responses, and the synthetic server close in `finally`.

See [[task-review-visibility-review]], [[task-history]], and [[launchpad-v2-design]].
