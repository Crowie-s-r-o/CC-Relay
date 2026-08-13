---
name: Task Completion Alerts
description: Selectable browser sounds and configurable spoken context for real task completion transitions.
type: feature
tags:
  - relay
  - tasks
  - notifications
  - audio
  - accessibility
---

# Task completion alerts

CC Relay plays a completion alert when a task moves from any unfinished state to `complete`.
The default is **Gentle chime**. The Settings modal also offers **Silent**, **Bright bell**, and
**Digital pulse**, plus a separate **Voice announcement** switch and a **Test** action.

The voice phrase is configurable. The operator can independently include the final project folder,
the task name, and a closing `Task complete` phrase. A numeric field limits the task-name portion
to its first 1 through 12 words. The exact phrase appears in a **Spoken preview** strip before the
operator presses **Test**. Existing preferences preserve the earlier behavior: project and task
name selected, one task-name word, and no closing phrase. A task named `Add completion sounds` in
the `relay` project therefore still speaks `relay. Add.` until the operator changes those choices.

> [!important]
> At least one spoken part must remain selected. If all three checkboxes are cleared, normalization
> restores **Project name**. This prevents an enabled voice switch from silently producing an empty
> utterance.

> [!important]
> The completion transition and the unread badge are related but not identical. A task already
> open in Task Activity is considered read, but it still plays its completion alert. Historical
> completed tasks in the first snapshot never alert.

## Implementation

`public/completion-alerts.js` owns preference normalization, speech text, three synthesized Web
Audio effects, and best-effort browser speech. `completionSpeechText()` composes only the selected
parts and applies the bounded task-name word limit. No audio files or environment variables are
required. Audio and speech failures are swallowed so an unavailable browser media API can never
block task refresh or completion.

`ProjectCompletionNotifications.observe()` returns the exact task objects that transitioned to
complete while retaining its existing unread tracking. `public/app.js` sends those transitions
to `CompletionAlerts`, spacing simultaneous completions by 650 milliseconds so tones remain
legible. Durable UI preferences load before the first task snapshot, preventing a default chime
from firing before a saved **Silent** choice is restored.

The saved `completionAlerts` object lives with [[durable-ui-layout-preferences]] in shared project
configuration and is mirrored to origin-local storage for fast same-origin startup. Its `speech`
member stores `project`, `task`, `status`, and `taskWords`. Older saved records receive the defaults
without losing their sound or voice-enabled choice.

## Settings layout

Sound and voice now occupy aligned full-width rows in the completion section. Voice details sit in
a nested fieldset directly below the master switch, so the switch no longer floats beside an
unrelated-width sound select. Turning voice off keeps the choices visible for discovery but disables
them. Desktop renders the three content choices in one row; narrow layouts stack the sound field,
choice boxes, word-limit field, and spoken preview. Light and dark surfaces have explicit rules.

## Verification

- Focused alert, preference, terminal-settings, layout, and dark-theme checks pass 65 of 65. They
  cover normalization, word limits, composition, persistence, compact layout rules, and the
  enabled and disabled control states.
- The complete repository suite passes 1,472 of 1,472 tests, `release:check` is green for v0.2.8,
  and `git diff --check` is clean.
- The browser-control surface was unavailable during the August 13 implementation run, so the
  change was not represented as live screenshot verification.

See [[launchpad-completion-notifications]], [[durable-ui-layout-preferences]], and
[[task-naming]].

#relay #tasks #notifications #audio
