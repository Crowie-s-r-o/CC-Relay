---
name: Original Terminal Review
description: Final direct-session review of native terminal defaults, conversation fallbacks and cross-platform ownership.
type: review
tags: [relay, terminal, review, windows, macos]
---

# Original Terminal Review

> [!note]
> Historical review of the external-window handoff. The later September 5 correction keeps the terminal inside CC Relay; see [[original-terminal-default]] and [[in-app-terminal-review]].

## Executive Summary

**Ticket confidence: Medium.** The original CLI window is now the default task handoff and the existing conversation UI remains switchable. The implementation does not embed a native window inside Electron. macOS native opening was exercised live; Windows creation-time and native-window logic is covered by deterministic tests and still needs the existing real-machine release gate. OpenCode and Windows Claude execution use the explicit headless fallback.

The final suite passes **1,971 of 1,971 tests**. `npm run release:check` passes for the unchanged v0.2.35 metadata. `git diff --check` passes. No new dependencies or project environment variables were introduced. Implementation and operator behavior are in [[original-terminal-default]].

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Original-terminal POST selects only the task's owned conversations, and the OS opener restores that exact window. The actual Electron renderer passed native handoff and all three role filters. |
| Regression risk (UI / backend / contracts) | Green | Existing event rendering, canonical prompt history, message counts, continuation drafts and the two-node modal dock remain in use. The old screen endpoint remains compatible. Full suite passes. |
| Gap risk (edge cases, error handling, completeness) | Amber | Native Windows execution has not run on this macOS host. Headless providers and missing/changed windows explicitly expose the fallback. |
| Code quality (maintainability as safety) | Green | Task selection, launcher ownership and platform foreground operations have separate small modules. No input emulation or repeated focus timer was added. |
| Unit tests | Green | Native invocation, process birth, foreign targets, stale task/launch/request, multi-terminal choice, headless fallback, preference persistence and delayed renderer responses are covered. |
| Performance & scalability | Green | The 700 ms screen poll is removed. Native inspection occurs only on explicit open actions. Regular refresh keeps chooser nodes and focus stable. |

## Top 3 Risks

1. `src/project-launcher.mjs` now explicitly launches Windows consoles through `conhost.exe`. Native Windows must confirm real console creation, quoting, minimization, focus and task-tree cleanup, including an npm `.cmd` binary under a path with spaces.
2. `src/native-terminal-opener.mjs` may encounter OS automation or foreground restrictions. A bounded failure opens the Relay activity fallback; it never tries another window or launches a replacement CLI.
3. A native action already handed to the OS cannot be recalled by an HTTP abort. The renderer invalidates stale responses, and `TaskOriginalTerminal.open()` rechecks request liveness immediately before a queued action, minimizing that boundary.

## Top Improvements

Complete the original-window smoke check on real Windows using the checklist in [[windows-compatibility]]. If OpenCode or Windows Claude later gain interactive task execution, connect those real sessions to the same task-scoped native opener instead of displaying a companion window as live execution.

## Recommendation

**Ship with Mitigations.** Keep Windows described as experimental and keep headless fallback availability explicit. Do not claim an embedded terminal or native interactive execution for the headless providers.

## Change Mapping and Execution Trace

`public/app.js`, `public/index.html` and `public/style.css` change the default presentation, native-open action, fallback and expanded-window rail. `src/ui-preferences.mjs` accepts the inline mode and expanded activity selection. `src/server.mjs` adds the bounded task route and platform capability. `src/task-original-terminal.mjs` selects conversations from the persisted task and intersects ownership. `src/project-launcher.mjs` serializes opening and captures Windows birth evidence. `src/native-terminal-opener.mjs` owns bounded platform focus calls. Related tests and product/wiki documentation track the changed contracts.

Normal path: explicit task/view action -> bounded POST -> persisted task candidates -> one owned conversation or explicit chooser -> current project/provider/conversation/launch and request recheck -> live OS identity -> foreground -> return to Relay's existing message views when selected.

Failure path: invalid target, no task, headless execution, closed window, changed process, another backend owner, request cancellation or OS failure -> no substitute CLI -> activity fallback. Only a task conversation ID can arrive from the renderer, never a native handle. Unknown view preferences normalize safely. A late request result cannot change another task or replace a message view.

Blast radius includes Windows native launch parentage, both task presentation surfaces, task opening, view preferences and modal focus. Queue execution, provider credentials, transcript parsing, database task schema and destructive terminal actions keep their existing contracts.

## Confirmed Issues

All issues found during this task were corrected:

- The previous UI's Terminal view was a read-only text mirror and did not expose CLI controls. It is replaced by the original-window handoff, with the event ledger retained as an explicit fallback.
- Native inline layout expanded a 462 px pane to 754 px because a grid track used its automatic minimum. Bounded grid columns now preserve the pane width; the actual Electron repeat and a style regression test verify it.
- Automatic selected-task refresh could have foregrounded a window after a background task change. Background calls now pass `openOriginal: false`; explicit task selection remains native by default.
- Rebuilding a multi-terminal chooser during refresh could lose keyboard focus. Its content signature now preserves unchanged live buttons.
- A native fallback reached from an AI-only inline filter could have retained that filter while labeling the result as all activity. Original-terminal selection now resets the fallback to the all-events filter, with an executable regression case.
- Raw OS invocation errors could expose a long script in the fallback notice. Native open failures now return concise operator-facing messages.

## Suspected Issues and Edge Cases

A Windows foreground restriction or nonstandard console host can reject an otherwise owned window. The endpoint reports fallback, preserving ownership and conversation access. This is a platform limitation with a visible outcome, not evidence for retargeting.

The native-window feature exposes the existing CLI session. It does not introduce a new collector for turns entered independently after Relay stops observing a task. The structured views continue to show the task conversation evidence captured by existing provider execution and prompt-history paths.

## Regression Risks

The inline default changes from all events to Original terminal. Existing users can choose Relay activity, and that mode persists. The expanded window retains legacy `all` as its native view and adds `activity` for all events, preserving message IDs and filters. Completed/headless tasks have no usable original window and keep the fallback.

Windows ownership now tracks the dedicated console host, including process creation time for opening. Existing terminal-close and shutdown tests verify the same exact tracked process-tree contract. Native Windows cleanup still needs a real-machine smoke test.

## Performance Risks

No new periodic work was added. Candidate selection is linear in a task's small worker list and existing ownership map. One bounded native inspection is serialized with launch/close actions; OS errors time out. The task open endpoint caps its JSON body at 2 KiB. Removing screen snapshots eliminates their continuous subprocess, serialization and DOM update cost.

## Test Gaps

**Are there adequate UNIT tests? Yes.** The dangerous ownership and async boundaries have executable cases, in addition to full regression coverage. Unit tests cannot prove PowerShell/conhost behavior on a real Windows installation. The macOS native smoke used an isolated idle shell and the real OS opener, while the Electron renderer used synthetic task/provider data. No new provider inference was started for verification.

## Positive Improvements

The CLI keeps full responsibility for its own interface. Relay's role filters and saved evidence stay available without a second emulator, input reconstruction or duplicate session. Native opening fails closed on ownership changes, refresh never repeatedly takes focus, and temporary failures leave a usable task view.

> [!note]
> Review was performed directly in the current session. No sub-agents were spawned. The pre-existing [[trading-research-task-routing]] page and its index entry were preserved.
