---
name: Composer Corners and Toolbar
description: Rounded prompt focus and consistently aligned utility actions in the Launchpad composer.
type: review
tags: [relay, ui, composer, accessibility, review]
---

# Composer corners and toolbar

The September 5 correction belongs to `public/launchpad.css`, the presentation owner described
in [[launchpad-v2-design]]. The square textarea outline was clipped by the rounded, overflow-hidden
prompt shell. The voice wrapper also inherited padding, a border, and a minimum height from the
legacy stylesheet, while its nominal six-pixel dot retained a 22px flex basis.

> [!important]
> Paint prompt focus on `.prompt-field:has(#task-prompt:focus)` with an inset outline and the
> existing composer accent. Suppress only the textarea's own outline. Toolbar controls keep
> their individual keyboard focus indicators; focusing a toolbar action does not outline the shell.

The toolbar and saved actions now align from the left with six-pixel gaps. Actions wrap at the
available width. The voice wrapper has no extra padding, border, background, or minimum height;
its button matches the other 26px actions. The voice dot has a fixed six-pixel flex basis.
Listening and error states mark the button border and dot; request, processing, and transcription
states color the dot with the interaction accent. Existing labels, tooltips, and live status remain.

See [[active-project-composer-colors]], [[saved-quick-skills]], and [[push-to-talk-voice-input]].

## Executive Summary

**Ticket confidence: High.** Scope is CSS presentation only. Task submission, project selection,
voice recording, image handling, and saved-skill dispatch keep their existing DOM and handlers.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Isolated Electron measures the rounded focus owner, 26px actions, six-pixel dot, and left-aligned rows. |
| Regression risk (UI / backend / contracts) | Green | Focused composer, project-color, and voice tests pass; no backend or payload changes. |
| Gap risk (edge cases, error handling, completeness) | Green | Both themes, 1720/1200/480/320px viewports, voice hidden/visible, attachments, twelve skills, and long labels checked. |
| Code quality (maintainability as safety) | Green | Rules stay beside their owning Launchpad component rules without adding a competing stylesheet. |
| Unit tests | Green | Current 76 focused tests and all 2,058 full-suite tests pass. Geometry is verified in Electron rather than duplicated CSS-string tests. |
| Performance & scalability | Green | One local focus selector; no JavaScript listeners, allocations, requests, or recurring work added. |

## Top 3 Risks

1. Rounded shell clipping: verified through rendered screenshots and computed focus ownership.
2. Legacy voice styles leaking into geometry: wrapper dimensions and all six activity states checked.
3. Narrow toolbar wrapping: visible children remain left aligned without page overflow down to 320px.

## Top Improvements

The extra pass restored voice activity cues on the button after removing the obsolete wrapper chrome.
Future composer changes should continue to inspect the combined `application.css` cascade.

## Recommendation

**Ship.** The CSS correction passes its focused and visual checks. The final full suite,
release metadata checks, and `git diff --check` pass. The isolated fixture closes its
window, HTTP server, and WebSocket connections; no provider work is submitted.

## Confirmed Issues

Fixed the clipped square focus ring, mismatched voice wrapper, stretched indicator, and detached
saved-action alignment. The final pass found no remaining issue in this scope.

## Suspected Issues & Edge Cases

No remaining high-likelihood issue found. Browser layouts were tested with synthetic state;
microphone recording itself was not exercised because this change does not touch audio handling.
An intermediate full-suite run encountered concurrent terminal-window fixture changes. Their
independent fix landed before the final successful run; this correction edits neither that test
file nor the application JavaScript.

## Regression Risks

`renderVoiceInput()` still supplies state, accessible status, button labels, disabled state, and
tooltips. Image staging still uses the same input change handler. Saved skills keep their buttons
and dispatch handlers. The only before/after changes are painted geometry and state colors.

## Performance Risks

No new data processing or polling. Focus updates affect one composer shell.

## Test Gaps

Unit tests are adequate for unchanged wiring. They cannot prove clipping or alignment; isolated
Electron screenshots and bounding-box assertions supply that evidence. The temporary fixture
reuses `scripts/verify-launchpad.cjs` with synthetic data. Captures and measurements are available
locally at `/tmp/relay-composer-qa/`; they are temporary verification artifacts.

## Positive Improvements

One rounded prompt focus ring, consistent utility-button geometry, visible voice activity cues,
and predictable left-aligned wrapping in both themes.
