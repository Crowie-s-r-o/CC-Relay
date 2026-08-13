---
name: Reliable Claude Live Update Outbox
description: Nonblocking, ordered live updates for an active Claude terminal turn, including stable native-draft recovery.
type: architecture
tags:
  - relay
  - claude
  - continuation
  - steering
  - terminal
  - reliability
---

# Reliable Claude Live Update Outbox

A running direct Claude task keeps its Relay composer available while earlier updates are still being delivered. Each press of **Update turn** captures that message, clears only the Relay textarea and attachment picker, increments the task-scoped sending count, and immediately hands the request to the backend. The operator can type and send the next update without waiting for the earlier HTTP request to finish.

The backend advertises this contract through `capabilities.claudeSteerOutbox`. The renderer opts into native-draft recovery with `flushComposer: true`. An older renderer keeps the former fail-closed behavior, and a newer renderer connected to an older backend does not expose the outbox.

## Incident evidence

Task 697 reproduced the permanent wall on August 13, 2026. Four `task.claude.steer.failed` records over about four minutes reported `deliveryUncertain: false`, `submitAttempts: 0`, and no composer classifications. Every request stopped at the same guard because the `namiru-ai-45` native Claude composer contained unsent text. Relay never overwrote or submitted that text, so every later send was rejected too. The desired message appeared only after the native composer was handled manually.

The failure was deterministic, not a transient network problem: a nonempty native draft had no transition that a Relay send could drive.

## Renderer contract

- The reliable Claude branch ignores the global continuation submission lock. Other providers and mixed-version Claude sessions keep their previous behavior.
- Every send snapshots its prompt and attachments before clearing the visible Relay composer.
- The task-scoped pending count is visible as `N sending`; the input and attachment controls stay enabled.
- Requests start immediately. The active Claude watcher owns the existing `steeringTail`, which serializes terminal delivery for that task.
- A confirmed or delivery-uncertain result never clears text typed after that request was captured.
- A definite failure retains its own prompt and attachments for retry. It restores them only when the task has no newer visible draft or attachments, and a restored retry is painted immediately.
- Task switches do not move, erase, or apply one task's retry to another task.
- The browser timeout is 210 seconds for this branch. That exceeds the two possible 80 second backend windows: native-draft recovery, then exact confirmation of the newly injected update.

## Exact-terminal delivery contract

`ClaudeTerminalExecutor.deliverActiveSteer()` still re-proves the active task, session, workspace, owned Terminal window, tty, runtime process, and visible Claude composer before every action.

If the native composer is empty, Relay injects the requested update and uses the existing exact hook, transcript, queue-record, and bounded held-paste recovery rules.

If the native composer contains text, the opt-in outbox performs an ordered send:

1. Read the same native draft twice with the configured screen-settle gap. A changing draft receives no Return.
2. Re-verify terminal identity and confirm that the active watcher still owns a busy or brief idle Claude boundary.
3. Submit the stable native draft with the existing nonempty Apple Event. Never clear it and never type over it.
4. Re-read the composer after each bounded action. At most four actions can occur inside the 80 second recovery window.
5. If the visible draft matches either this request's decorated payload or its exact raw text, allow only exact hook or transcript evidence to acknowledge it. Exact evidence returns without injecting a duplicate.
6. After a different native draft clears, inject the captured Relay update and run its independent exact-delivery window.

If the earlier draft survives the bounded submit schedule, the new update was not typed. The API marks the composer as blocked and the renderer restores that update for a safe retry. If a matching draft may have reached Claude but exact evidence is unavailable, the result remains delivery-uncertain and Relay does not automatically resend it.

> [!important]
> The outbox removes the operator lock, not the identity and evidence guards. It sends only through the exact active terminal, never creates queue work or a second Claude process, never overwrites native text, and never clears newer Relay typing.

## Files

- `public/app.js`
- `public/task-continuation-state.js`
- `src/server.mjs`
- `src/claude-execution-runner.mjs`
- `src/claude-terminal-executor.mjs`
- `test/task-continuation-state.test.mjs`
- `test/composer-workflows.test.mjs`
- `test/claude-execution-runner.test.mjs`
- `test/claude-terminal-executor.test.mjs`

## Regression coverage

- The composer stays enabled with multiple sends pending.
- Every outbox request carries the capability-gated native-draft option.
- Multiple updates enter the active watcher immediately and complete in order.
- A stable native draft is submitted before the requested update, including across a brief idle boundary.
- A changing native draft is never submitted until two reads agree.
- A matching native draft, including the exact raw message without Relay's appended notice, receives exact acknowledgement without duplicate injection.
- An attachment-bearing held update is matched against both its raw source line count and Claude's complete rewritten body, with an exact image-chip count for the rewritten form.
- A draft that never clears exhausts the bounded actions, never injects the requested update, and returns a definite composer block that restores the new update when the texts differ.
- A restored failure cannot overwrite newer typing and cannot remain hidden after the newer message is sent.
- Legacy clients retain the former native-draft refusal.

The four focused continuation, runner, and terminal suites pass 323 tests. The complete repository suite passes 1,450 tests, and release metadata is consistent for v0.2.6. Rebuild and restart CC Relay after active work finishes to activate the capability and the Task 713 attachment-rewrite correction.

See [[claude-live-steering-review]], [[claude-live-steer-held-paste-recovery]], [[claude-image-composer-rewrite-submit]], [[claude-steer-text-hold-reliability]], [[same-task-session-continuation]], and [[claude-terminal-input]].

#relay #claude #continuation #steering #terminal #reliability
