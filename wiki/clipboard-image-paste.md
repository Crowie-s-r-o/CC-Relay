---
name: Clipboard Image Paste
description: Explicit clipboard image controls, desktop permissions, draft ownership, and verification.
type: engineering
tags:
  - relay
  - composer
  - clipboard
---

# Clipboard image paste

New prompts and the [[task-history|same-session follow-up composer]] expose **Paste image**.
The existing keyboard paste and file picker remain available. The button reads the clipboard
only when clicked, chooses one PNG, JPEG, or WebP representation per clipboard item, and stages
ordinary image attachments. It does not submit the message. Existing 99-image, 5 MB per-image,
and 20 MB total validation still applies.

`public/clipboard-images.js` owns the asynchronous reader and actionable empty, unsupported,
denied, and unavailable-API messages. Generated filenames are unique because clipboard screenshots
often share a name and byte length. Alternate MIME representations are not separate images.
Keyboard text-only paste is still handled by the browser.

> [!important]
> Electron's `src/desktop-microphone.mjs` permission gate formerly denied clipboard reads.
> Both permission phases now allow `clipboard-read` only when the requesting origin and current
> WebContents URL match the configured Relay renderer origin, with `isMainFrame === true`.
> Foreign ports, foreign origins, subframes, and missing frame evidence remain denied. Rebuild
> and restart the desktop app to activate the main-process change.

The main composer captures its project and attachment draft before asynchronous reads. A changed
draft cannot be overwritten by a late completion. Follow-up clipboard reads register immediately
inside `ContinuationAttachmentDrafts.merge`, so task selection and **Clear images** preserve the
existing cancellation contract. Rejections are observed immediately even when another merge is
ahead in the queue. Send waits while the button is reading and staging its image. Failed delivery
retains staged attachments through the existing request path.

`public/index.html`, `public/app.js`, and `public/launchpad.css` own the controls, state, and theme
styles. The Launchpad toolbar wraps at compact widths. See [[launchpad-v2-design]].

## Verification

- `test/clipboard-images.test.mjs`: representation preference, exact bytes, unique filenames,
  missing API, denied access, unsupported/empty contents, blob failure, keyboard extraction.
- `test/voice-input.test.mjs`: exact-origin main-frame permissions in both phases.
- `test/task-continuation-state.test.mjs`: per-task serialized merges and cancellation.
- `node node_modules/electron/cli.js scripts/verify-launchpad.cjs /tmp/relay-paste-ui --paste-images`:
  isolated synthetic Electron and HTTP fixtures verify both buttons, draft text, clear during a
  delayed read, submission blocking, actual outgoing image envelopes, rejection retention, empty
  and denied clipboard recovery, and light/dark 1720, 480, and 320 pixel layouts. The renderer's
  clipboard reader is simulated; the operator's clipboard and providers are untouched.

The extra pass found and fixed stale clipboard error text surviving a successful retry. It also
kept new continuation listeners outside the terminal-window test fixture's extracted event range.
All 2,058 tests, release metadata validation for 0.2.38, and whitespace checks pass.

## Executive Summary

**Ticket confidence: High.** The inferred request was to make copied images easy to include in
Relay messages. No backend request schema, provider dispatch logic, or database migration changed.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Both real renderer controls stage PNG bytes and send existing attachment envelopes. |
| Regression risk (UI / backend / contracts) | Green | Full suite passes; keyboard paste, picker, limits, and delivery-failure drafts remain covered. |
| Gap risk (edge cases, error handling, completeness) | Amber | OS clipboard and packaged permission prompts are not exercised by the simulated clipboard fixture. |
| Code quality (maintainability as safety) | Green | One clipboard reader, existing image validator, cancellable task merges, exact renderer permission checks. |
| Unit tests | Green | Reader errors and representations, desktop permission rejection cases, existing cancellation tests. |
| Performance & scalability | Green | No polling or retained background process; work scales with explicitly pasted image bytes. |

## Top 3 Risks

1. Browser clipboard availability differs. `readClipboardImageFiles()` explains keyboard/picker fallback.
2. Delayed clipboard and file reads can outlive drafts. `addImageFiles()` guards project/draft identity;
   `addContinuationImageFiles()` uses generation-based cancellation.
3. Desktop builds require the updated `configureDesktopPermissions()` handler. Static asset refresh
   alone does not activate its main-process permission change.

## Top Improvements

Validate a copied OS screenshot in a rebuilt desktop app during the next packaged smoke test.

## Recommendation

**Ship with Mitigations.** Retain the keyboard/file fallback and packaged smoke-test follow-up.

## Confirmed Issues

No unresolved defect found within the change. The denied desktop read and stale retry notice were fixed.

## Suspected Issues & Edge Cases

Native clipboard policy is the remaining platform test gap. Unsupported images fail visibly.

## Regression Risks

Clipboard-read permission is newly allowed for Relay's main renderer only. Microphone and other
permission decisions remain unchanged. Existing task and provider ownership paths are reused.

## Performance Risks

Clipboard blob reads and FileReader conversions are linear in image bytes. Existing attachment
limits bound staged message data; no new recurring work or external fetches were introduced.

## Test Gaps

The fixture verifies real DOM behavior with simulated clipboard contents, not an OS clipboard or
real provider turn. This distinction is deliberate and is not evidence of packaged OS validation.

## Positive Improvements

Visible clipboard actions, precise fallback feedback, draft ownership guards, and retained images
after rejected sends make copied screenshots easier to include and recover.
