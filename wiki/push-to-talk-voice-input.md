---
name: Push-to-Talk Voice Input
description: Local faster-whisper CPU dictation for task prompts with configurable hold and release keys.
type: architecture
tags: [relay, voice, microphone, faster-whisper, cpu, settings]
---

# Push-to-talk voice input

CC Relay provides optional local dictation in the task composer. The feature is disabled by
default. The operator turns it on in **Terminal settings**, explicitly installs the speech engine,
then holds either configured activation shortcut while the Relay window is active. Releasing the
main key or any required modifier ends capture immediately and starts transcription. The microphone
button in the composer implements the same pointer or keyboard hold contract.

Terminal settings lists the system default and every named browser audio input. A chosen device is
persisted by its normalized label rather than its Chromium device ID because Electron receives a new
loopback origin on later launches and device IDs are origin-scoped. If labels are hidden on that new
origin, or enumeration initially returns no inputs, Relay requests one temporary default stream,
enumerates again, and immediately releases every temporary track. Recording then switches to the
saved input. Unavailable saved inputs remain visible in settings and capture falls back to the current
system default. The selected label stays in local UI preferences and is not added to backend
diagnostics or task artifacts.

The default primary shortcut is `Control+Shift+Space`; the alternate starts unset. Two separate
setting buttons capture and render their chords as individual keycaps. Capture stores physical key
codes in a canonical Control, Alt, Shift, Meta order, so layout-dependent key labels do not change
matching. The visible label uses platform-native modifier glyphs on macOS. Bare supported keys are
allowed, but `Enter`, `Escape`, and `Tab` are excluded so task submission, cancellation, and focus
movement remain available. Duplicate shortcuts collapse to the primary. Delete or Backspace clears
the alternate while it is being captured. Shortcuts are scoped to the active Relay window and are
not system-wide hotkeys.

When transcription succeeds, the renderer inserts trimmed text at the task prompt's current
selection. It adds boundary spaces only when the neighboring text needs them, dispatches the normal
input event, and saves the selected project's composer draft. Empty speech results leave the prompt
unchanged.

The recorder also carries the exact browser track label and hold duration with the transient Blob.
While the hold is active, a compact four-bar meter renders the microphone's live RMS signal without
retaining samples. When Whisper returns no text, Relay combines that observed peak with the encoded
payload: an extremely low-bitrate Opus silence clip is rejected before transcription, names the input,
and directs the operator to choose a working microphone in settings. A normal-size payload with no
measurable signal reports the quiet source. A measured signal that still produces no transcript keeps
recognition-specific retry guidance.

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
word timestamps. When VAD removes a clip completely, the worker retries that clip once without VAD.
The explicit hold already bounds the audio, and Whisper's own no-speech check keeps true silence
empty. This recovers quiet speech without weakening the normal fast path. Keeping the model process
warm avoids reloading it for every hold. If voice input was enabled in the durable preferences,
server startup prewarms an already installed engine. Relay does not install or select a GPU runtime.

The helper is copied outside the ASAR because the private Python runtime must execute a normal file.
`VoiceInputService` refreshes that copy before every new worker, so decoding fixes ship with an app
update without forcing a Python package or model reinstall.

> [!note]
> The August 25 failure was not an empty upload. Diagnostics recorded six successfully decoded
> clips from 1.5 through 2.76 seconds, including normal 16 through 35 KB Opus payloads, but every
> result had zero characters. A controlled low-volume sample reproduced the VAD rejection and
> recovered through the no-VAD pass. A generated true-silence clip stayed empty through both passes.

> [!important]
> The August 26 repeated failure was a different class. Three 0.6 through 2.88 second uploads were
> only 436 through 968 bytes and every decode used the no-VAD fallback without producing text.
> macOS and AVFoundation exposed only `Microsoft Teams Audio`, while no Teams process was feeding
> that virtual device. The worker was healthy and received digital silence. This incident established
> the named-input selector and source-aware silence message. A physical input still has to exist.

> [!important]
> The August 27 follow-up found `Patrik’s AirPods Max` available beside `Microsoft Teams Audio`.
> The two latest failed holds were still only 590 and 870 bytes, confirming that capture was again
> reading digital silence. The unchanged local worker transcribed generated speech at normal volume,
> 3 percent volume, and 0.6 percent volume, while generated silence remained empty. This separates
> capture-source failure from speech-engine failure and is why source selection plus the live level
> meter are the primary repair.

The setup marker and worker handshake both require the pinned faster-whisper version and model.
Malformed output, a mismatched version, startup timeout, transcription timeout, process exit, or
write failure rejects the active request and tears down the worker so a later attempt starts cleanly.
The settings action changes to **Repair engine** when the backend reports an error.

## Capture, privacy, and limits

The renderer requests audio only while a hold begins, apart from the one released discovery stream
used to reveal device labels when settings opens. Release stops every recording media track and closes
the signal analyzer. A session generation guard also handles release or cancellation before microphone
permission resolves, so a late permission grant cannot leave the microphone active or submit unwanted
audio.

The transcription endpoint accepts supported browser audio MIME types up to 12 MB and permits only
one active request. It writes the clip with owner-only permissions inside a unique directory, sends
that path to the local worker, and removes the whole directory in `finally` on success or failure.
Audio and transcript text are not written to Relay diagnostics. Diagnostics contain only bounded
operational metadata such as audio byte count, transcript character count, detected language,
duration, and whether the VAD recovery pass ran.

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

The app-wide `voiceInput` preference contains `enabled`, the required primary `shortcut`, the
nullable `alternateShortcut`, and the nullable durable `microphoneLabel` inside the
`ui-layout-preferences` record. See
[[durable-ui-layout-preferences]]. Runtime files remain in Relay application data and are not copied
into project settings or task artifacts.

## Verification

`test/voice-input.test.mjs` covers two exact shortcuts and release, named and default microphone
selection, zero-device and hidden-label recovery across a new origin, released discovery tracks,
live level detection and analyzer cleanup, silence classification, normal recording, release before
permission, cancellation discard, Electron origin and media scoping, isolated setup, pinned
installation, persistent worker reuse, clip deletion, payload limits, invalid worker protocol, API
wiring, quiet-speech fallback, helper refresh, CPU configuration, and packaged microphone
disclosure. `test/ui-preferences.test.mjs` covers durable normalization and persistence. Dark-mode
and completion-alert contract tests protect the shared settings dialog. A real-engine regression
probe confirmed that generated speech at normal, 3 percent, and 0.6 percent volume produces text
while true silence remains empty. The focused voice, preference, composer, completion, and dark-mode
suites pass 78 of 78 tests, the complete repository suite passes 1,749 of 1,749 tests, release metadata
is consistent for v0.2.26, and `git diff --check` is clean. Dark browser QA at 1936, 680, and 480 CSS
pixels found no dialog, control, or page overflow.

See [[project-terminal-settings]], [[task-completion-alerts]], and [[desktop-packaging-review]].

#relay #voice #microphone #faster-whisper #cpu #settings
