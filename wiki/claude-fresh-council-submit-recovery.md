---
name: Fresh Council Claude Submit Recovery
description: Task 364 incident where a positively absent first-turn transcript suppressed the guarded terminal submit action.
type: incident
tags:
  - relay
  - claude
  - terminal
  - plan-council
  - recovery
---

# Fresh Council Claude Submit Recovery

## Incident

Task 364 failed its Claude draft again on July 28, 2026 after
[[disposable-retry-conversation-initialization]] correctly reopened its saved UUID for a
first turn.

CC Relay launched the exact disposable terminal, restarted Claude with Opus at max effort in
read-only plan mode, pasted the prompt, and then timed out without sending its guarded submit
action. The event history contained no `sent one separate submit action` progress message, and
the error used the branch that says only that CC Relay sent the prompt. The saved Claude UUID still
had no transcript file under `~/.claude/projects`.

## Root cause

`ClaudeTerminalExecutor.watchTurn()` required a nonnegative transcript size before it could send
the guarded submit action. That is correct for an established conversation because a failed stat
is uncertainty and Return could answer a real interactive question.

It is incorrect for a positively fresh conversation. Claude does not create the transcript file
until it accepts the first prompt, so `size() === -1` is the expected held-paste state. The guard
treated this known absence as an unreadable file and suppressed recovery until the no-start
timeout.

> [!important]
> A missing transcript and an unreadable transcript are different safety states. A first turn
> whose file was positively absent before injection may receive the one guarded submit action
> while the file remains absent. An established, deleted, or unreadable transcript remains
> fail-closed.

## Correction

- `fsTranscriptSource.state()` now returns `present`, `absent`, or `unreadable` from the exact
  stat result. Only `ENOENT` means absent.
- An unreadable start-time state fails retryably before injection instead of being guessed fresh.
- `runTurn()` carries the start-time fresh-session classification into `watchTurn()`.
- The guarded submit permits a negative size only when the conversation was fresh at turn start
  and the current source state is still positively absent.
- A metadata error such as `EACCES` still suppresses Return.
- Established conversations retain the existing readable-transcript requirement.

The task 364 regression recreates a fresh UUID, an idle held paste, no transcript file, the
guarded action, transcript creation, and normal completion. A paired test proves that an
unreadable fresh transcript still receives no action. The full repository passed 761 of 761
tests.

## Live recovery

The running backend could not load the source change while task 378 was using it. Task 364 was
therefore resumed once under the old process, then recovered manually through the same production
submit helper after verifying all of the following:

1. The exact session UUID was present, interactive, idle, and in the Agreau workspace.
2. The exact single-tab Terminal window resolved from its current pid and tty.
3. The council had recorded `Claude is running this turn` and the transcript was still absent.
4. One submit action was sent to that exact window.

The transcript appeared immediately, Claude became busy, CC Relay mirrored tool activity, and task
364 remained running past the former 20-second failure point. The permanent correction becomes
active at the next normal CC Relay backend restart.

## Task 370 stale-runtime confirmation

Task 370 reproduced the same held first-turn paste at 18:20 local time, after the source correction
had been written but before CC Relay was restarted. The serving backend process had started at 17:10,
while `claude-transcript-tail.mjs` and `claude-terminal-executor.mjs` were updated at 17:46 and
17:54. Its event history again omitted the `sent one separate submit action` progress event and
ended with the pre-correction no-start message.

> [!important]
> This was deployment skew, not a second submit algorithm defect. A Node process does not reload
> changed ESM modules. Finish active tasks and restart the CC Relay backend before validating the
> corrected retry path.

The focused executor and disposable-pool suites passed 83 of 83 after the incident. They cover the
direct Claude retry that reopens an empty UUID, a fresh absent transcript receiving exactly one
guarded submit action, unreadable metadata suppressing that action, exact terminal identity changes,
delayed transcript growth, and single-action idempotency.

## Falsified ideas

- The nonempty whitespace submit helper did not fail in this incident. CC Relay never called it.
- A transient busy sample was not the blocker. The task timed out from the fresh-file guard.
- The retry conversation initializer worked as designed. Its positive absence exposed the
  watcher state mismatch.

See [[claude-resumed-council-submit-review]], [[claude-terminal-submit-review]],
[[disposable-retry-conversation-initialization]], [[plan-council]], and [[hot]].

## July 30 task 39 supersession

> [!important]
> The fresh-absent transcript rule described here is unchanged and still gates every action. What
> changed is the count: a positively fresh and still-absent conversation may now receive each
> attempt of a bounded schedule, not only one. This page's live recovery is also the strongest
> evidence that the helper itself works, because it called the production `submitHeldTerminalPaste`
> by hand long after the paste settled and the transcript appeared immediately. See
> [[claude-held-paste-multi-attempt-submit]].

#relay #claude #terminal #plan-council #incident
