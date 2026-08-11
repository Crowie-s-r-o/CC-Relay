---
name: Live Terminal Retention
description: A task-level safety latch that stops automatic terminal close while an automatic task is running.
type: architecture
tags:
  - relay
  - terminal
  - retention
  - queue
  - ui
---

# Live Terminal Retention

A running automatic task exposes **Stop auto-close** in Task Activity when the backend advertises `capabilities.liveTerminalRetention`. The control is a one-way latch for that run. After it succeeds, it reads **Auto-close stopped**, remains visibly armed, and cannot accidentally restore automatic close before the task ends.

> [!important]
> This is a task-level override. It does not change the selected project's **Keep task terminals open** setting and does not affect any queued or future task. Project settings still snapshot into each new task as described in [[project-terminal-settings]].

## Queue contract

`TaskQueue.keepTerminalOpen(taskId)` accepts only a task that is both:

- currently `running` and owned by this queue process
- using `terminal_lifecycle = 'disposable'`

The method persists `tasks.keep_terminal_open = 1`, refreshes the active runtime copy and any dispatch guard copy, writes one queue event, and emits the ordinary queue change notification. Repeated calls are idempotent and do not duplicate the event.

Task completion and failure no longer decide from the task object captured at dispatch. They re-read the normalized task row immediately before retention or release. This lets a late latch affect the current outcome without weakening exact launch ownership. An automatic retry still closes its intermediate attempt and carries the latched setting into the final attempt, matching [[automatic-retry-safety]].

CC Relay shutdown also re-reads the persisted row and promotes a prepared latched launch before cancelling the active turn. A launch still in its incomplete preparation phase is not retained because its native identity is not yet safe to promote. See [[retained-terminal-sessions]] and [[disposable-terminal-pools]].

## API and interface

`POST /api/tasks/:id/keep-terminal-open` delegates to the queue latch and returns the updated task. `/api/status` advertises `capabilities.liveTerminalRetention`.

The renderer shows the control for every running disposable workflow, including direct Execute, Plan council, and Turbo. Plan council and Turbo retain their complete terminal fleets. A refreshed renderer against an older backend shows **Restart to stop auto-close** disabled instead of calling an unsupported route.

The control uses explicit text and `aria-pressed`, not color alone:

- available: cyan outline, **Stop auto-close**
- saving: cyan pulse, **Stopping auto-close...**
- armed: solid teal, **Auto-close stopped**
- unsupported: neutral disabled restart state

Success and failure stay in the task header's local status region. The renderer does not send failures to the composer or open an alert. The teal safety-interlock treatment remains distinct from purple running state, red destructive actions, and Claude orange.

> [!note]
> The compact action uses a 13px pin mask and an 8px control radius. The pin communicates that the
> terminal will stay open after the run; the former hollow circle looked like a radio button or a
> reversible toggle, which is incorrect for this one-way latch. Keep the explicit label and
> `aria-pressed` state because the icon and color remain supporting cues only. Its dark available
> state uses a restrained cyan tint over `--app-control`, while the protected state remains solid
> teal. See [[compact-interface-density]].

> [!note]
> Direct tasks become [[session-tasks]] as soon as the latch persists. Their session strip and paired conversation surface can therefore appear during the active run, and the queue card gains its factual session state. The latch does not set `manual_completion`, so the current task still reaches its automatic outcome. Only a new direct task submitted with [[manual-terminal-session-mode]] uses explicit completion.

## Validation

- A deferred-run queue test proves a task submitted with retention off can latch it while running and calls `retain`, never `release`, at completion.
- A shutdown test proves promotion happens before runner cancellation and the task remains marked for retention.
- Route, capability, older-backend, accessible-state, local-feedback, theme, and reduced-motion contracts are pinned by focused tests.
- The complete repository suite passes 1,184 tests.
- An isolated local browser preview verified available and armed states in light and dark themes, no horizontal overflow at 1180, 720, and 420 pixels, and zero console warnings or errors.
- The August 12 control polish reverified the available pin action beside Cancel in both themes at
  the current desktop layout, with a computed 30px height and zero console warnings or errors.

## Files

- `src/queue.mjs`
- `src/server.mjs`
- `public/app.js`
- `public/index.html`
- `public/style.css`
- `test/queue.test.mjs`
- `test/session-tasks-api.test.mjs`
- `test/session-tasks-ui.test.mjs`

See [[live-terminal-retention-review]], [[retained-terminal-sessions]], [[project-terminal-settings]], [[session-tasks]], and [[terminal-close-review]].

#relay #terminal #retention #queue #ui
