---
name: Claude Live Steer Held Paste Recovery
description: Task 129 incident where an image-bearing live update remained in Claude's composer after one swallowed submit action, plus the bounded exact-paste retry fix and ship review.
type: incident
tags:
  - relay
  - claude
  - terminal
  - steering
  - continuation
  - review
---

# Claude Live Steer Held Paste Recovery

> [!important]
> Task 129 proved that Claude can swallow both the Return appended to an image-bearing live update
> and Relay's one guarded submit action. The exact update then remains visible as image and pasted
> text chips. It is not stale text from an earlier successful update. Live steering now uses the
> same bounded four-attempt spacing as opening prompts, re-proves terminal identity and the exact
> held paste before every action, and never presses Return for an empty, unreadable, or foreign
> composer. Rebuild and relaunch CC Relay to activate both the backend and renderer changes.

## Incident evidence

The affected task was Relay task 129, Claude session
`2ea3c7ca-9a9b-488d-b00f-16e86ac1f11a`, running Claude Code 2.1.222 in
`talent-finder-ef`.

| UTC time | Evidence | Meaning |
| --- | --- | --- |
| 20:29:36.208 | `task.claude.steer.requested`, zero attachments | First additional message requested |
| 20:29:42.650 | Exact top-level user record | First message reached Claude |
| 20:29:42.653 | `task.claude.steer.completed`, `user-prompt-hook` | First message was confirmed |
| 20:30:55.244 | `task.claude.steer.requested`, one attachment | Second additional message requested |
| 20:31:22.941 | `task.claude.steer.failed`, `deliveryUncertain: true` | The 25 second evidence bound expired |
| 20:32:53.460 | Third steer requested | Operator tried another message |
| 20:32:54.070 | Definite nonempty-composer rejection | Relay protected the held second message |

The Claude transcript has no exact user record, queue enqueue record, or queued-command attachment
for the second update. The attached terminal screenshot shows its still-held form:
`[Image #2][Pasted text #3 +3 lines]`. This rules out the first successful update as the residue and
rules out a delivery-evidence correlation defect. The second update never left the composer.

## Root cause

`ClaudeTerminalExecutor.deliverActiveSteer()` gave a held live update one recovery action after six
seconds, then only waited for the remainder of its 25 second acceptance window. Opening prompts had
already moved to a four-attempt schedule after [[claude-held-paste-multi-attempt-submit|task 39]]
proved that one early Return can be swallowed while Claude converts a paste and its image paths
into chips. Live steering retained the obsolete one-action policy.

The later `already contains unsent text` error was correct. Clearing or overwriting that composer
would have destroyed the second update, and blindly submitting it as part of the third request
would have confused two distinct user messages.

## Fix contract

- A live update first gets the unchanged six second settle period.
- While no exact hook, transcript user record, or queue record acknowledges it, Relay may send up
  to four guarded actions using the existing 9, 12, and 15 second backoff.
- Every attempt freshly resolves the same session, window, tty, and process, then requires the
  composer to visibly hold this exact update.
- A cleared composer stops all further actions even if delivery evidence is missing. That state can
  mean the preceding Return landed, so another Return would be unsafe.
- Different composer text stops all further actions. Relay never clears or submits a human draft.
- An unreadable composer receives no action.
- If the earlier response becomes idle after injection, the pending steer still owns the watcher.
  The exact held-paste proof therefore remains sufficient to submit the update across that boundary.
- The acceptance bound is 80 seconds and remains fail-closed with `deliveryUncertain: true`.
- The browser waits 120 seconds so it receives the backend's authoritative result rather than
  aborting at the former 35 second client bound.
- Successful diagnostics now include the additive numeric `submitAttempts` field while preserving
  the existing `submitAttempted` boolean.

> [!note] Correction, 2026-08-07
> The fourth bullet above, "A cleared composer stops all further actions", overstates what the code
> does and always did. An `'empty'` classification does not end the recovery loop: the loop keeps
> watching, and the only thing it will act on afterwards is a **fresh positive `'held'` read**. The
> safety property the bullet was written to describe is unchanged and is still pinned by
> `a held live update receives no second Return once the composer is empty`:
> **no second Return is ever sent while the composer reads empty and delivery evidence is absent.**
> The distinction started to matter with the 2026-08-07 work in
> [[claude-steer-text-hold-reliability]], which made inconclusive reads re-read on a short gap
> instead of consuming an action slot, so the difference between "stops the schedule" and "keeps
> watching without acting" is now observable in the `composerStates` diagnostic. The bullets that do
> stop the schedule outright are the foreign-draft one below it and the acceptance bound. The
> original text is left in place because this is an incident record.

## Files

- `src/claude-terminal-executor.mjs`
- `public/app.js`
- `test/claude-terminal-executor.test.mjs`
- `test/composer-workflows.test.mjs`

## Regression coverage

The executor suite now pins these cases:

- Task 129's image chip and collapsed-paste shape ignores the first action, crosses from busy to
  idle, succeeds on the second action, and anchors through the cumulative image rewrite.
- A composer that becomes empty after one action receives no second Return when evidence is absent.
- A paste that remains held exhausts the configured action limit exactly, then reports uncertainty.
- The existing native-draft test still sends zero actions for foreign text.
- Queued updates still confirm from their exact enqueue record and receive zero submit actions.
- The renderer source contract requires a 120 second Claude live-update request bound.

Focused runner, executor, continuation-state, and renderer contract suites passed 287 tests. The
complete repository suite passed 1,089 of 1,089 tests.

## Ship review

### Executive Summary

**Ticket confidence: High**

The observed failure is reproduced at its exact terminal boundary and the fix is narrower than a
general retry. Relay repeats only Return, never the prompt, and only while the exact held paste is
positively visible in the exact owned terminal. Empty and foreign-composer negatives are pinned.

### Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Task 129 succeeds on the second guarded action, including its image rewrite and busy-to-idle transition. |
| Regression risk (UI / backend / contracts) | Green | No route, task, attachment, queue, or database contract changed. The client bound now exceeds the backend bound, and the response field is additive. |
| Gap risk (edge cases, error handling, completeness) | Amber | The real active terminal was not mutated for a live smoke test, and a renderer left open across a mixed-version restart still carries its old JavaScript until refresh. |
| Code quality (maintainability as safety) | Green | Attempt count, deadline, composer state, and exact evidence remain separate, named state. Existing opening-prompt timing settings are reused. |
| Unit tests | Green | Exact recovery, no-repeat, hard-cap, native-draft, queued-delivery, UI-timeout, and full-suite coverage all pass. Adequate UNIT tests: Yes. |
| Performance & scalability (if applicable) | Green | Only a held live update enters the loop. Work is bounded to four session resolutions and screen reads across 80 seconds. Normal and queued updates resolve on their first evidence. |

### Top 3 Risks

1. `claudeComposerState()` depends on Claude's visible composer representation. A future Claude
   version can cause a safe false negative and an unconfirmed update, but cannot license a blind
   Return without the exact held classification.
2. `public/app.js` must reload with the backend. An already-open old renderer still has its former
   35 second request bound until the app is relaunched or the page is refreshed.
3. A permanently held update now occupies one HTTP request and one active steer for up to 80
   seconds instead of 25. The bound is deliberate and no prompt is re-pasted.

### Top Improvements

- After active tasks finish, rebuild and relaunch CC Relay and run one real image-bearing live
  update whose first Return is deliberately swallowed.
- Consider advertising the live-steer acceptance bound through backend capabilities if renderer
  and backend versions are ever deployed independently.
- Add per-attempt diagnostics if operators need to distinguish first-action recovery from later
  recovery without reading the terminal.

### Recommendation

**Ship with Mitigations**

Rebuild and relaunch the desktop app before validation, then perform the one safe live smoke test.

### Confirmed Issues

- Live steering had only one guarded submit action even though the same Claude paste widget already
  required multiple attempts for opening prompts.
- The first draft of this fix extended the backend to 80 seconds while leaving the renderer at 35
  seconds. Adversarial review caught and corrected that mismatch before completion.

### Suspected Issues & Edge Cases

- A transient terminal-resolution failure after injection still ends recovery as uncertain rather
  than consuming another schedule slot. This is pre-existing fail-closed behavior, not a new
  regression.
- Claude may change how attachment chips affect collapsed-paste line counts. Existing one-line
  tolerance and cumulative image correlation cover the observed 2.1.222 form; other drift fails
  closed.

### Regression Risks

- Before: a dead held paste failed after one action and blocked every later update. After: it can
  receive up to four exact-held actions.
- Before: the renderer bounded the 25 second server operation at 35 seconds. After: it allows 120
  seconds for an 80 second server operation, preserving the authoritative delivery outcome.
- Before and after: a nonempty foreign draft is never cleared, overwritten, or submitted.
- Before and after: exact queue enqueue evidence resolves immediately without any recovery action.

### Performance Risks

Worst case adds three terminal identity resolutions and screen reads beyond the former one-action
path. The work is O(1), bounded by four attempts, and occurs only after a live update is visibly
held with no exact delivery evidence.

### Test Gaps

- There is no automated Terminal.app fixture that can force Claude Code 2.1.222 to swallow exactly
  the first Return.
- There is no restarted packaged-app smoke test for this specific image-bearing path.

### Positive Improvements

- The failed second message is recovered without asking the operator to press Enter manually.
- Response-boundary idle no longer strands an exact held update.
- Missing evidence plus an empty composer cannot cause a duplicate Return.
- Backend and renderer timeouts now form an explicit safe ordering.

See [[claude-live-steering-review]], [[claude-steer-delivery-evidence]],
[[continuation-input-review]], and [[same-task-session-continuation]].

#relay #claude #terminal #steering #continuation #incident #review
