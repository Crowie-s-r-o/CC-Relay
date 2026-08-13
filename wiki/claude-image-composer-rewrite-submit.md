---
name: Claude Image Composer Rewrite Submit Recovery
description: Task 713 incident where Claude shortened an attachment-bearing held paste after converting its path into an image chip, causing Relay to classify the exact update as junk and send no guarded submit action.
type: incident
tags:
  - relay
  - claude
  - terminal
  - steering
  - continuation
  - attachments
  - reliability
---

# Claude Image Composer Rewrite Submit Recovery

> [!important]
> Task 713 exposed a separate image-update failure after the live-update outbox work. Claude can
> convert the attachment path into an image chip before Relay re-reads the composer. That conversion
> removes a path line and collapses blank lines, so the held paste widget reports the rewritten body
> line count rather than the injected source count. Relay now recognizes both complete forms, with
> an exact image-chip count guard, across live updates and normal continuation recovery. Rebuild and
> relaunch CC Relay after active work finishes to load this source fix.

## Reported behavior

The operator sent an image-bearing update while Claude was working. Relay pasted the message into
the correct Claude terminal, but it stayed in the composer. The update moved only after the operator
opened Terminal and pressed Enter manually.

This was not the native-draft wall from [[claude-live-steer-outbox]]. The request reached the live
steer injection path, but its guarded submit schedule performed no action.

## Task 713 evidence

| UTC time | Evidence | Meaning |
| --- | --- | --- |
| 15:42:15.203 | `task.claude.steer.requested`, one attachment | Relay accepted the running-turn update |
| 15:42:36.593 | Exact rewritten `queue-operation` enqueue record | Claude accepted the update after the operator pressed Enter |
| 15:42:36.908 | `task.claude.steer.completed` with `submitAttempted: false`, `submitAttempts: 0`, `composerStates: ["junk"]` | Relay observed the exact queue evidence but had sent no automatic submit action |

The queue record arrived 21.39 seconds after injection. It contains one cumulative image chip and
the complete rewritten body. Comparing the source prompt and that record reconstructs the composer
geometry exactly:

- Injected source: six lines, so a raw collapsed widget would report `+5 lines`.
- Claude rewrite: remove the absolute attachment path, convert it into one image chip, and collapse
  blank lines.
- Rewritten body: four lines, so the held widget reports `+3 lines`.
- Session-cumulative shape: `[Image #3][Pasted text #4 +3 lines]`.

The former classifier compared `+3` only with the raw `+5`. Its one-line tolerance could not bridge
the two-line difference, so it returned `junk`. The live-update loop intentionally sends no Return
for junk because that state normally means another human draft is in the composer. The safety rule
was correct; the set of exact forms was incomplete.

## Fix contract

`claudeComposerState()` now accepts known attachment paths with the prompt. It derives candidates
through the same `attachmentRewrittenPromptForms()` helper already used for exact hook, transcript,
and queue correlation.

- The raw prompt line count remains valid while Claude still shows the source paste.
- A rewritten line count is valid only when the composer also shows exactly the number of image
  chips derived from known path occurrences.
- Image chip numbers may start at any positive session-cumulative value; their count is exact.
- The existing one-line trailing-newline tolerance remains unchanged for each complete form.
- A missing path, wrong chip count, short foreign paste, or unrelated line count remains `junk`.
- Literal attachment forms below Claude's collapse threshold use anchors from the complete raw and
  rewritten forms.

The attachment paths are propagated to every composer decision that can act:

1. stable native-draft flush for a running update;
2. held-paste recovery for a running update;
3. held-paste recovery for an opening or normal continuation turn;
4. the post-clear verification before any re-injection or Return.

All prior terminal ownership and delivery guards remain. Relay still re-verifies the exact session,
window, tty, and process before acting, never presses Return for foreign text, never overwrites a
draft, and stops recovery as soon as exact hook, transcript, or queue evidence arrives.

## Regression coverage

- A Task 713 geometry test proves that a six-line source and one known attachment classify the
  one-chip `+3` widget as held.
- The same widget without the known path remains junk.
- The same widget with two visible chips remains junk when the prompt derives one chip.
- The Task 129 live-update test now renders the real rewritten `+3` body, swallows its first action,
  and succeeds on the second guarded action.
- A normal image continuation submits the rewritten held widget once, with no Ctrl+C and no second
  prompt injection.
- The executor suite passes 204 tests. The complete repository suite passes 1,450 tests.

## Activation

The installed CC Relay process was started before both the live-update outbox and this correction.
It was deliberately not restarted while active tasks were running. Source tests prove the fix, but
the packaged app must be rebuilt and relaunched before a manual smoke test can exercise it.

## Files

- `src/claude-terminal-executor.mjs`
- `test/claude-terminal-executor.test.mjs`
- `FEATURES.md`

See [[claude-live-steer-outbox]], [[claude-live-steer-held-paste-recovery]],
[[claude-held-paste-multi-attempt-submit]], [[claude-image-prompt-correlation]], and
[[same-task-session-continuation]].

#relay #claude #terminal #steering #continuation #attachments #reliability #incident
