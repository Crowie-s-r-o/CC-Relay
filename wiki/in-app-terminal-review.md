---
name: In-App Original Terminal Review
description: Direct review and verification of keeping the original terminal screen and follow-up composer inside CC Relay.
type: review
tags: [relay, terminal, renderer, review, macos]
---

# In-App Original Terminal Review

## Executive Summary

**Ticket confidence: High for the macOS in-app screen.** **Show original terminal** now opens CC Relay's existing dialog and reads the original terminal screen. The follow-up composer stays visible and uses its existing task-scoped submission path. The current renderer makes no native foreground request. See [[original-terminal-default]] for the current contract and [[original-terminal-review]] for the superseded external-window behavior.

The extra verification pass found and fixed a CSS cascade bug that squeezed the composer out of the dialog. It also tightened mutable native identity checks and direct-task retry selection. Final validation on September 5, 2026: **169 focused tests**, **1,990 full-suite tests**, release metadata check for **v0.2.36**, and `git diff --check` all pass.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Actual Electron clicks open the existing dialog, render the screen, and make zero external-open requests or new windows. A synthetic follow-up reaches the original task's `/steer` route exactly once. |
| Regression risk (UI / backend / contracts) | Green | Dock restoration, view preferences, filters, drafts, composer, screen copy, and task ownership retain focused coverage and the full suite passes. |
| Gap risk (edge cases, error handling, completeness) | Amber | Native screen reads are macOS-only. Windows, Linux, and headless tasks use the in-app activity fallback. The embedded screen does not implement raw terminal keyboard input. |
| Code quality (maintainability as safety) | Green | Reads reuse the task candidate selector and existing native screen reader. No provider execution mode, database schema, dependency, or project environment variable was added. |
| Unit tests | Green | Executable cases cover changed task/project/launch/request ownership, headless sessions, council choices, retries, delayed responses, selection, manual scroll, stale recovery, modal opening, and poll cleanup. |
| Performance and scalability | Green | One bounded request at a time and one timer per visible renderer. One-second successful polling and five-second retry delay; hidden views and documents cancel requests and timers. |

## Change Mapping and Execution Trace

- `public/app.js`: the button opens `#terminal-window-modal`; the screen uses the GET endpoint, safe text rendering, cancellable polling, actual screen copy, and the existing composer. The dock also preserves native scroll offsets.
- `public/index.html` and `public/style.css`: add the screen region, replace external-link indicators, keep screen actions inside the app, and allocate separate screen/composer/status rows in the dialog.
- `src/task-original-terminal.mjs`: `read()` selects only persisted task conversations intersected with current launcher ownership and validates task/request ownership again after reading.
- `src/server.mjs`: the screen route validates the optional conversation query and delegates to the task-scoped reader. The pre-existing startup-order fix remains intact.
- `src/project-launcher.mjs`: post-read checks compare against captured window/TTY values, including changes made in place to the ownership record.
- Focused tests, README, FEATURES, [[terminal-window]], [[original-terminal-default]], and [[hot]] track the resulting behavior.

Normal path: task or screen selection -> bounded task GET -> one current owned session or explicit workflow choice -> exact native window/TTY read -> current task and launch recheck -> `textContent` in Relay's panel/dialog -> next visible-screen poll. Follow-up input keeps the existing same-task submission path.

Failure path: unknown task, invalid conversation query, unsupported/headless session, changed ownership, disconnected request, OS read failure, or delayed UI response -> reject the screen, keep proven prior text explicitly stale when available, otherwise show activity. No replacement CLI launches and no native focus action occur in this path.

## Top 3 Risks

1. `NativeTerminalScreenReader` depends on macOS Terminal scripting access. A denied or slow read uses a bounded timeout and the existing in-app fallback.
2. `.events-section` has different visible row counts inline and docked. The later inline native rule must exclude `[data-terminal-window="open"]` or it collapses the composer. The focused stylesheet test and actual textarea geometry check guard this.
3. A process identity or task conversation can change while the screen request is in flight. Both service and launcher revalidate; only explicit workflow choices pin conversations, so direct retries can follow the new saved terminal.

## Top Improvements

Keep the actual textarea visibility check in future terminal smoke passes. If full terminal keyboard interaction is required later, it needs a provider PTY ownership design; do not present this read-only screen as a full emulator or revert the button to the external opener.

## Recommendation

**Ship with the documented screen/input boundary.** The requested in-app opening behavior is implemented and verified on macOS. Unsupported sources remain usable through the activity view.

## Confirmed Issues

All issues found during this change were fixed:

- The original button called the native foreground endpoint and took the user out of Relay. It now opens the existing in-app dialog and uses only the screen GET.
- The original view hid the follow-up composer. It now retains the same live form, draft, attachments, and provider availability rules.
- The later four-row inline grid overrode the three-row native dialog grid. The form remained `display: grid` but was squeezed to 15px, hiding its textarea. The inline rule now excludes the docked section. The repeated Electron pass measured a 95.7px composer and a fully contained 32px textarea at both widths and themes.
- Comparing a mutable tracked terminal to itself could miss an in-place window or TTY change during a read. Captured identity values now reject that stale output.
- Pinning every automatically read conversation would leave a retried direct task requesting its old session. Only an explicit workflow choice now pins the query.
- A background render on a server without the native screen capability could remain on a connecting notice. It now immediately shows activity.

## Suspected Issues and Edge Cases

The last proven screen can remain visible after its terminal closes, labelled **Last screen · reconnecting**. This is retained evidence, not a claim that the process is still running. Activity remains one click away. A workflow choice cannot silently retarget a different conversation when its original terminal disappears.

## Regression Risks

The old `/terminal/open` API and native opener remain available for older clients. The current renderer has no call to them. The screen endpoint now also handles council and Turbo targets and rejects headless companion windows using the same provider filter as the original terminal service. Existing queue execution, terminal launch/close ownership, provider credentials, and task schema are outside this change.

Other work appeared in the shared checkout during this task, including icon and composer-layout changes. Those edits were preserved. This review describes only the terminal changes; the full suite validates the combined current tree.

## Performance Risks

Native polling adds bounded OS reads while one screen is visible. Text processing is O(screen length), capped at 250,000 characters; unchanged content does not replace the DOM. Candidate work is O(the task's small conversation list). A hidden renderer or non-screen view stops periodic work, and the next request is scheduled only after the previous one settles.

## Test Gaps

**Are there adequate UNIT tests? Yes.** The dangerous ownership and asynchronous boundaries have executable cases, and the grid contract has a regression check. The Electron smoke used synthetic task/provider responses rather than starting a live provider inference. It verifies real markup, CSS, buttons, requests, focus/selection, and draft/input behavior. Native screen reading itself retains its existing OS identity tests. Windows and Linux do not gain native screen support from this change.

## Verification Evidence

- Focused terminal-window, terminal styles, original-terminal, native-screen, and project-launcher suites: **169 passed**.
- `npm test`: **1,990 passed**, zero failures.
- `npm run release:check`: consistent **v0.2.36** metadata.
- `git diff --check`: clean.
- Isolated actual Electron: live screen, safe literal markup, internal dialog, visible and enabled follow-up input, synthetic same-task send, preserved draft, live refresh, selection and scroll preservation, stale screen, role filters, fallback, dock restoration, and zero native-open calls or new windows.
- Dark and light themes at 1600px and 380px: no page overflow; screen height above 500px and fully visible 32px textarea in the native dialog.
- Extra verification included direct screenshot inspection, correction of the collapsed composer, stronger input bounds checks, and a repeat against the final code.
- Local smoke artifacts: `/tmp/relay-in-app-terminal-qa/`. Its temporary HTTP/SSE server, Electron window, and all processes started by this task were stopped. No real provider task was launched.

## Positive Improvements

The operator stays inside Relay with the original terminal's real screen and the existing follow-up composer. Task ownership survives asynchronous reads, unsupported sources have a useful fallback, and switching views no longer takes focus to another application.
