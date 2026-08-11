---
name: Task Completion Alerts
description: Selectable browser sounds and optional short spoken context for real task completion transitions.
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
**Digital pulse**, plus a separate **Speak project and task word** option and a **Test** action.

The voice phrase is deliberately brief. It uses the final folder in `repo_path` and the first
word of the canonical task title, falling back to the request when needed. A task named `Add
completion sounds` in the `relay` project speaks `relay. Add.`.

> [!important]
> The completion transition and the unread badge are related but not identical. A task already
> open in Task Activity is considered read, but it still plays its completion alert. Historical
> completed tasks in the first snapshot never alert.

## Implementation

`public/completion-alerts.js` owns preference normalization, speech text, three synthesized Web
Audio effects, and best-effort browser speech. No audio files or environment variables are
required. Audio and speech failures are swallowed so an unavailable browser media API can never
block task refresh or completion.

`ProjectCompletionNotifications.observe()` returns the exact task objects that transitioned to
complete while retaining its existing unread tracking. `public/app.js` sends those transitions
to `CompletionAlerts`, spacing simultaneous completions by 650 milliseconds so tones remain
legible. Durable UI preferences load before the first task snapshot, preventing a default chime
from firing before a saved **Silent** choice is restored.

The saved `completionAlerts` object lives with [[durable-ui-layout-preferences]] in shared project
configuration and is mirrored to origin-local storage for fast same-origin startup. Older saved
records normalize to `{ sound: "chime", speak: false }`.

## Verification

- Focused alert, transition, preference, layout, dark-theme, and Launchpad checks pass 35 of 35.
- The full repository suite passes 1,130 of 1,130 tests.
- Live Chrome QA selected Digital pulse and voice, played a preview, reloaded, and restored both
  choices with no browser warnings or errors.

See [[launchpad-completion-notifications]], [[durable-ui-layout-preferences]], and
[[task-naming]].

#relay #tasks #notifications #audio
