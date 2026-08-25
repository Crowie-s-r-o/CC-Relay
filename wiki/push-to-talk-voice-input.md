---
name: Push-to-Talk Voice Input
description: Local faster-whisper CPU dictation for task prompts with configurable hold and release keys.
type: architecture
tags: [relay, voice, microphone, faster-whisper, cpu, settings]
---

# Push-to-talk voice input

CC Relay provides optional local dictation in the task composer. The feature is disabled by
default. The operator turns it on in **Terminal settings**, explicitly installs the speech engine,
then holds the configured activation keys while the Relay window is active. Releasing the main key
or any required modifier ends capture immediately and starts transcription. The microphone button
in the composer implements the same pointer or keyboard hold contract.

The default shortcut is `Control+Shift+Space`. Shortcut capture stores physical key codes in a
canonical Control, Alt, Shift, Meta order, so layout-dependent key labels do not change matching.
The visible label uses platform-native modifier glyphs on macOS. Bare supported keys are allowed,
but `Enter`, `Escape`, and `Tab` are excluded so task submission, cancellation, and focus movement
remain available. Shortcuts are scoped to the active Relay window and are not system-wide hotkeys.

When transcription succeeds, the renderer inserts trimmed text at the task prompt's current
selection. It adds boundary spaces only when the neighboring text needs them, dispatches the normal
input event, and saves the selected project's composer draft. Empty speech results leave the prompt
unchanged.

## Local engine lifecycle

Engine setup is an explicit action and requires Python 3.9 or newer plus an internet connection.
`VoiceInputService` creates these private application-data resources under `voice-input/`:

- `python/`: an isolated virtual environment with faster-whisper pinned to 1.2.1
- `models/`: the downloaded multilingual Systran faster-whisper base model
- `faster-whisper-worker.py`: the packaged protocol helper copied outside the ASAR archive
- `engine.json`: the pinned protocol, package, model, device, and compute-type marker
- `recordings/`: transient per-request directories only

The helper loads one persistent `WhisperModel` with `device="cpu"`, `compute_type="int8"`, one
worker, and at most eight CPU threads. It uses voice activity detection, a one-beam decode, and no
word timestamps. Keeping the model process warm avoids reloading it for every hold. If voice input
was enabled in the durable preferences, server startup prewarms an already installed engine. Relay
does not install or select a GPU runtime.

The setup marker and worker handshake both require the pinned faster-whisper version and model.
Malformed output, a mismatched version, startup timeout, transcription timeout, process exit, or
write failure rejects the active request and tears down the worker so a later attempt starts cleanly.
The settings action changes to **Repair engine** when the backend reports an error.

## Capture, privacy, and limits

The renderer requests audio only while a hold begins. Release stops every media track. A session
generation guard also handles release or cancellation before microphone permission resolves, so a
late permission grant cannot leave the microphone active or submit unwanted audio.

The transcription endpoint accepts supported browser audio MIME types up to 12 MB and permits only
one active request. It writes the clip with owner-only permissions inside a unique directory, sends
that path to the local worker, and removes the whole directory in `finally` on success or failure.
Audio and transcript text are not written to Relay diagnostics. Diagnostics contain only bounded
operational metadata such as audio byte count, transcript character count, detected language, and
duration.

Electron grants only audio media requests from the exact loopback renderer origin. Video and other
permission types remain denied, apart from the existing sanitized clipboard-write path. Packaged
macOS builds include `NSMicrophoneUsageDescription`, so the operating-system prompt explains the
hold-to-talk use. Browser launches use the browser's normal microphone permission prompt.

## APIs and persistence

- `GET /api/voice-input/status` returns installation, model, readiness, busy, and error state.
- `POST /api/voice-input/setup` installs or repairs the isolated engine and loads the model.
- `POST /api/voice-input/transcribe` accepts one bounded raw audio body and returns text, detected
  language, and duration.
- `/api/status` embeds the voice engine snapshot and advertises `pushToTalkVoiceInput`.

The app-wide `voiceInput` preference contains only `enabled` and `shortcut` inside the durable
`ui-layout-preferences` record. See [[durable-ui-layout-preferences]]. Runtime files remain in Relay
application data and are not copied into project settings or task artifacts.

## Verification

`test/voice-input.test.mjs` covers exact shortcut matching and release, normal recording, release
before permission, cancellation discard, Electron origin and media scoping, isolated setup, pinned
installation, persistent worker reuse, clip deletion, payload limits, invalid worker protocol, API
wiring, CPU configuration, and packaged microphone disclosure. `test/ui-preferences.test.mjs`
covers durable normalization and persistence. Dark-mode and completion-alert contract tests protect
the shared settings dialog. The final focused voice suite passes 10 of 10 checks, the complete
repository suite passes 1,720 of 1,720 tests, the live loopback API smoke passes, release metadata
is consistent for v0.2.23, and `git diff --check` is clean. An isolated real-engine pass also
installed faster-whisper 1.2.1, loaded `base` on CPU with `int8`, and transcribed the generated
sample as "Relay Voice input works locally." Its temporary runtime and model cache were removed
afterward.

See [[project-terminal-settings]], [[task-completion-alerts]], and [[desktop-packaging-review]].

#relay #voice #microphone #faster-whisper #cpu #settings
