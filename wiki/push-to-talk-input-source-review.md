---
name: Push-to-Talk Input Source Review
description: Adversarial shipping review of microphone selection and source-aware silence diagnosis.
type: review
tags: [relay, review, voice, microphone, electron, regression]
---

# Push-to-talk input source review

## Executive Summary

**Ticket confidence: High**

The repeated no-speech outcome is traced to the capture source, not faster-whisper. The two latest
diagnostics showed 1.26 and 2.46 second clips of only 590 and 870 bytes. macOS now exposes both
`Patrik’s AirPods Max` and the virtual `Microsoft Teams Audio` input, so the operator has a physical
source available but capture was still receiving digital silence. The change reveals and persists the
selected source, shows a live input meter while held, and distinguishes compressed digital silence
from an ordinary empty transcript before invoking Whisper.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `PushToTalkRecorder._openStream()` selects the named device, performs one post-permission re-resolution when labels were hidden, and closes every replaced or released stream. Settings also recovers from an initially empty device list. `transcribeVoiceAudio()` rejects encoded digital silence with the exact source named. |
| Regression risk (UI / backend / contracts) | Green | Old preference records normalize `microphoneLabel` to `null`; the HTTP transcription contract and worker protocol are unchanged. Desktop, 680 px, and 480 px dark layouts have zero horizontal overflow. |
| Gap risk (edge cases, error handling, completeness) | Amber | Two inputs with the same operating-system label cannot be durably distinguished across origin-scoped Chromium device IDs. The first matching named input wins. |
| Code quality (maintainability as safety) | Amber | Renderer and backend preference normalizers intentionally duplicate the bounded label rule. Focused tests cover both, but a future schema change must update both copies. |
| Unit tests | Green | The 78-test focused voice, preference, composer, completion, and dark suite covers exact selection, empty and hidden-label recovery, digital silence, live signal levels, analyzer cleanup, release races, cancellation, worker lifecycle, and persistence. |
| Performance & scalability | Green | Device work is O(d) for the small browser input list. Signal analysis uses one 80ms timer and a 512-sample analyzer only during a hold. |

## Top 3 Risks

1. `public/voice-input.js`, `PushToTalkRecorder._openStream()`: duplicate device labels select the
   first matching input because the only cross-origin durable key available here is the label.
2. `public/voice-input.js`, `voiceRecordingLooksSilent()`: the silence distinction is intentionally
   limited to WebM and Ogg Opus clips. Other browser formats retain generic no-speech guidance.
3. `public/app.js` and `src/ui-preferences.mjs`: normalization is duplicated across the renderer and
   backend and must stay byte-for-byte equivalent for the new preference member.

## Top Improvements

- If duplicate physical labels become a real operator problem, add an explicit per-origin device ID
  cache plus a durable label occurrence hint. Do not persist a raw device ID as the sole key.
- Add a browser-level audio fixture when CI gains a controllable virtual microphone. Unit tests prove
  selection, levels, and lifecycle, while the local visual pass cannot synthesize a trusted microphone
  feed into Chromium.
- If field reports still confuse quiet speech with silence, add a short calibration hint beside the
  existing meter rather than lowering the signal threshold globally.

## Recommendation

**Ship with Mitigations**

**Ship.** Select `Patrik’s AirPods Max` in Voice input settings and verify the bars move while holding
the shortcut. The current machine now has that physical input available beside the virtual Teams
device, so no hardware prerequisite remains.

## Change Map and Execution Trace

Ticket-owned code changes are limited to:

- `public/voice-input.js`: permission-backed device discovery, durable-label resolution, exact stream
  selection, source metadata, live RMS monitoring, cleanup, and Opus silence classification.
- `public/app.js`: preference caching, device list rendering, selection persistence, active-source
  status, live meter rendering, early digital-silence rejection, and empty-transcript copy.
- `public/index.html` and `public/style.css`: accessible microphone selector with compact and dark
  layout support.
- `src/ui-preferences.mjs`: backward-compatible nullable `microphoneLabel` normalization.
- `test/voice-input.test.mjs` and `test/ui-preferences.test.mjs`: capture, restart, boundary, and
  persistence coverage.
- `README.md`, `FEATURES.md`, and the linked wiki pages: operator behavior and the incident record.

Unrelated concurrent changes in queue, session, header, and project-color files were preserved and
excluded from this review.

The main execution path is:

1. Terminal settings enumerates audio inputs. If the initial list is empty or anonymous, it requests
   one temporary stream, enumerates again, and releases that stream before rendering DOM text nodes.
2. A named label is normalized, cached locally, and saved in `ui-layout-preferences`.
3. Holding the shortcut resolves the label to the current origin's device ID.
4. If a new origin hid labels, the granted default stream reveals them and Relay switches before
   `MediaRecorder.start()`.
5. An audio analyzer updates the four-bar meter during the hold and retains only the peak numeric
   level. Release stops recording, every media track, the timer, and the audio context.
6. The renderer uses the exact track label, hold duration, format, encoded rate, and observed peak to
   reject digital silence before the API call.
7. Remaining clips use Whisper's VAD and no-VAD recovery. Empty results distinguish a quiet source
   from a measured signal that recognition could not decode.

Null labels use the system default. Missing saved labels fall back to the current default and remain
visible as unavailable in settings. A release before permission resolves invalidates the session and
stops the late stream. An exact-device reacquisition failure keeps the already granted default stream
rather than losing the whole recording.

## Confirmed Issues

- An unfed `Microsoft Teams Audio` source still returns digital silence. Relay can now expose that
  condition immediately, but code cannot recover speech that never reaches Core Audio.

## Suspected Issues & Edge Cases

- Identically named microphones are ambiguous after an Electron origin change.
- A browser that records a non-Opus format receives source-aware generic no-speech copy but no encoded
  silence classification.

## Regression Risks

- Before: every recording implicitly used the system default. After: `microphoneLabel: null` preserves
  that exact behavior; only an explicit named choice adds an exact `deviceId` constraint.
- Before: every empty worker result displayed the same generic message. After: only empirically tiny
  WebM or Ogg clips receive the digital-silence message.
- Before: voice preferences had three members. After: old records and omitted values normalize the new
  member to `null`, so database migration is unnecessary.

## Performance Risks

No hot queue or backend path changed. Enumeration is linear in the number of local audio inputs and
runs on settings open, device change, capture source adoption, and named-source resolution. The
recording and transcription payload limits remain unchanged.

## Test Gaps

An automated real-browser microphone waveform is unavailable. The local browser pass verified DOM,
dark styling, responsive widths, the source selector, and zero horizontal overflow, while unit tests
inject exact streams, analyzers, and recorders. System audio enumeration and live incident diagnostics
provide the real-device evidence. Separate generated-audio probes prove the unchanged worker recognizes
speech at normal, 3 percent, and 0.6 percent volume while leaving true silence empty.

**Are there adequate UNIT tests? Yes.** The tests cover the normal flow, initially empty and hidden
labels after a new origin, exact device constraints, released discovery tracks, live signal levels,
analyzer cleanup, missing bytes, digital silence boundaries, permission delay, cancellation, recorder
failure, backend persistence, and the existing worker and API lifecycle.

## Positive Improvements

- The UI now exposes the actual capture source instead of blaming speech recognition.
- The live meter makes an unfed or wrong source visible before the hold is released.
- Saved named inputs survive Electron's dynamic-port origins without persisting an invalid device ID.
- Replaced streams and late permission streams are stopped, preserving the microphone privacy contract.
- Device labels are rendered with text nodes, so operating-system strings cannot inject markup.
- The solution leaves the faster-whisper model, worker protocol, endpoint, and audio retention rules
  unchanged. See [[push-to-talk-voice-input]] and [[durable-ui-layout-preferences]].

#relay #review #voice #microphone #electron
