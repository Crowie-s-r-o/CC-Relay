---
name: Uninterrupted Task Terminal Startup
description: Keep the original embedded terminal visible while provider registration becomes a persisted task conversation.
type: review
tags: [relay, terminal, startup, review]
---

# Uninterrupted Task Terminal Startup

## Executive Summary

**Ticket confidence: High.** A new task showed its startup terminal, lost it when the provider registered its conversation, then showed a replacement after screen polling reconnected. The same owned PTY now keeps one WebSocket and one renderer instance throughout registration and task persistence. Focus, selection, output, and keyboard input survive the handoff.

> [!important]
> Physical launch identity stays fixed. The only permitted socket identity change is from `launch:<that exact launch ID>` to its first persisted conversation. Afterward the socket pins that conversation and closes on ownership changes. This is not a general conversation-following exception.

## Change Mapping

| File | Responsibility and change |
| --- | --- |
| `src/project-launcher.mjs` | Tracks pending task assignment separately from provider registration, confirms persistence explicitly, and includes task ownership in embedded terminal metadata. |
| `src/disposable-terminal-pool.mjs` | Confirms direct, Plan council, and Turbo bindings immediately after saving their task assignments. |
| `src/task-original-terminal.mjs` | Resolves startup addresses through exact current owned launches, rejects another task's PTY, avoids duplicate startup targets, and includes saved Turbo executor and council targets. |
| `src/terminal-websocket.mjs` | Performs one strictly checked startup-to-conversation transition without disconnecting, then retains ordinary immutable ownership checks. |
| `public/embedded-terminal.js` | Keys the emulator by task and launch so a conversation ID update keeps the same DOM and socket. |
| `test/embedded-terminal-view.test.mjs` | Executes the real renderer class with controlled browser primitives to check continuity, replacement, late output, and disconnection. |
| `test/embedded-terminal.test.mjs`, `test/terminal-websocket.test.mjs`, `test/disposable-terminal-pool.test.mjs` | Exercise startup aliases, the real launcher/service/socket integration, delayed persistence, ownership rejection, and persistence ordering. |
| `scripts/verify-terminal-startup.cjs` | Runs the full renderer and production terminal services in isolated Electron with a synthetic PTY and saves screenshots and results. |

There is no database migration, package version change, environment variable, provider command change, or release action. Other in-progress checkout changes were preserved.

## Functional Execution Trace

1. A task-owned PTY launches with `taskBindingPending` set and becomes available at its exact startup address.
2. Provider registration binds its conversation to the immutable physical launch. The task assignment can still be pending, particularly while Plan council starts its second provider.
3. The pool writes the conversation IDs and immediately confirms the matching launch, task, and thread. The service now resolves the old startup address to that exact persisted target.
4. The socket checks the next identity against its captured identity. Only the conversation field may make the initial transition. Task, project, provider, workflow, and launch must match.
5. Subsequent checks use the canonical conversation, so a second rebind cannot follow the startup alias. A metadata refresh keeps the renderer instance because its task and launch are unchanged.

Missing tasks, dead PTYs, another task's launch, changed workspaces/providers/workflows, and replacement launches fail closed. Failed task persistence leaves the startup target only while its owning task and live allocation remain valid; the existing pool failure path closes the exact launch. Retained sessions still require their original task ownership. Explicit activity switches disconnect the view and reconnect normally when returning.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Real service/socket tests cover direct Codex, Claude Plan council, and Claude Turbo council through delayed persistence. Electron observes one emulator, one socket, and zero hidden frames. |
| Regression risk (UI / backend / contracts) | Green | Ownership fields remain fixed, the handoff latches once, another task cannot use the PTY, and actual view disconnection still works. |
| Gap risk (edge cases, error handling, completeness) | Amber | Electron verification is on macOS with synthetic provider output. Windows hardware and live provider inference were not exercised. |
| Code quality (maintainability as safety) | Green | Pending provider registration and persisted assignment are explicit phases. Each pool persistence path has an ordering assertion. |
| Unit tests | Green | Renderer behavior, exact ownership, binding gaps, stale input, and late output have executable regression coverage. |
| Performance & scalability | Green | One boolean per owned launch and one identity transition per connection. No additional provider process, socket, background poll, or unbounded history is added. |

## Top 3 Risks

1. Future pool assignment paths must call `confirmTaskTerminalBinding()` after persistence. Calling it before the database write restores the startup gap.
2. `attachTerminalWebSockets()` must pin the first canonical conversation. Following the startup address forever would permit a later rebind.
3. `EmbeddedTerminalView.connect()` must preserve only the same task and launch. A changed task or launch still needs disposal and a new authorized socket.

## Top Improvements

The delayed-persistence tests wait beyond the idle socket verification interval, so they prove the gap is covered even without output. The renderer test checks actual instance and socket identity. The Electron fixture checks visibility on animation frames, retains focus and selection, sends a real keyboard event, refreshes metadata, expands the terminal, and verifies compact light-theme geometry.

## Recommendation

**Ship.** Source verification is complete. An installed desktop bundle needs a build containing this change; the running application was not restarted during active work.

## Confirmed Issues

- Startup authorization ended at provider registration, causing a socket close and a visible reconnection gap.
- Including conversation ID in the renderer key recreated an unchanged terminal during metadata refresh.
- Plan council could remain between provider registration and task persistence while starting its second terminal.
- The startup fix exposed a missing task-ID check for already bound PTYs. The launching task now remains part of their authorization.
- Turbo's saved executor and Claude council conversations were absent from terminal candidates. Their exact saved targets now participate in the same handoff.

## Suspected Issues & Edge Cases

No unresolved defect was found in the changed path. Startup addresses may remain in an already open view's metadata, but they resolve only to the same launch and the socket internally pins the canonical conversation. A later metadata refresh preserves the emulator.

## Regression Risks

An old or fabricated task row naming another task's embedded conversation is now rejected. Existing native read-only terminal handling remains on its original ownership path. A real socket failure continues to disable typing and reconnect normally; only successful startup registration keeps its existing socket.

## Performance Risks

Authorization retains the existing task-candidate and owned-launch scans. Pending target deduplication adds work proportional to the task's small startup target set. No benchmark was needed for the one-time renderer key and binding-state changes.

## Test Gaps

**Are there adequate UNIT tests? Yes.** Behavioral renderer tests, service/socket integration, explicit forbidden-ownership cases, and pool persistence assertions cover the changed boundaries. Provider-specific real authentication screens remain covered by their existing execution tests rather than new live inference runs. The Electron fixture is synthetic and makes no provider request.

The extra verification pass deliberately restored four failure modes in temporary source copies. It also found that an expected-output test could wait forever after a premature close. The socket test helper now fails immediately on that close, and forbidden handoff tests bound their expected-close wait.

## Validation

- Focused terminal and pool checks: 216 passed in the combined checkout.
- Final full repository suite: 2,051 passed in the combined checkout.
- `npm run release:check` and `git diff --check`: passed.
- Isolated Electron startup run: passed, including continuous visibility, focus, selection, typing, metadata refresh, docking, and intentional disconnect/reconnect.
- Extra mutation verification: all four deliberately reintroduced failures were caught by behavioral assertions. Results are recorded in `/tmp/relay-terminal-startup-mutations.json`.
- Screenshots and results: `/var/folders/y3/nk7bgz9j3b79568nsvh1m39r0000gn/T/relay-terminal-startup-0FmAJb/`.
- All started verification processes exited; the final process check found no remaining startup fixture or mutation process.

## Positive Improvements

The operator sees the same terminal throughout normal task startup. The fix removes the visual interruption while tightening task ownership and keeping stale input rejection intact. Synthetic verification starts no provider work, and its windows, sockets, HTTP server, host, and temporary project are cleaned up on success and failure.

See [[embedded-original-terminal]], [[disposable-terminal-pools]], [[terminal-window]], and [[hot]].
