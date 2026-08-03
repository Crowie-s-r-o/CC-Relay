---
name: Codex Disposable Resume Review
description: Incident analysis and adversarial ship review for repeated Codex continuation terminals.
type: review
tags:
  - relay
  - codex
  - continuation
  - terminal
  - retry
---

# Codex Disposable Resume Review

## Incident

Task 328 continued completed disposable Codex task 327 and resumed conversation `019fa4cf-986a-7e42-ae7b-3e7caaa25b83`. The Codex CLI loaded the saved chat successfully, but CC Relay rejected or timed out its native-terminal binding and opened more resume terminals through automatic retry.

The structured diagnostics prove four separate failures in one chain:

1. Task 327 closed launch `9cc824db-cf57-4998-b4ea-c376e86fe851` at `18:28:58.553Z`.
2. The `/api/threads` recovery poll saw the provider connection while it was still draining and rebound the already closed Terminal.app window as runtime launch `runtime-925c986d-0573-4509-b69d-1502bbdab19e` at `18:28:59.831Z`.
3. Task 328 launched a valid resume client, and the proxy logged `proxy.thread.joined`, but `ProjectLauncher.bindOwnedTerminal()` rejected it because the stale runtime owner still claimed the saved conversation.
4. The binding exception escaped before `DisposableTerminalPool` remembered the new launch. Exact cleanup therefore did not run for that attempt, and the generic retry loop opened another terminal five seconds later.

Later retries also exposed a duplicate-client discovery problem. `listConnectedThreadIds()` intentionally deduplicates by conversation ID, while `launchIdForThread()` can report an older client for that conversation. The new resume client was healthy, but the launch coordinator could not prove that the deduplicated thread belonged to its exact launch.

> [!important]
> Loading the saved chat is not task completion. CC Relay must prove the new native launch, bind it, and then send the accepted continuation turn. A resume binding failure occurs before the prompt is sent and must never fan out automatically. Task 328 was a linked queue task under the historical contract; current continuation keeps that launch safety while running under the source task ID.

## Corrected contract

- Runtime recovery ignores a connected session while an owned launch for the same provider and project is still binding.
- A successfully closed terminal suppresses recovery of its bound or expected conversation ID during the provider connection drain window.
- Codex binding can resolve conversation identity from the exact launch reservation even when ordinary thread discovery reports an older client for the same conversation.
- A binding rejection returns the exact native launch to the disposable pool. The pool records it and closes it once.
- Identity rejection and resumed-conversation timeout are non-retryable. Fresh launch timeouts retain the existing bounded transient retry behavior.

See [[disposable-terminal-pools]], [[automatic-retry-safety]], [[diagnostics]], and [[terminal-close-review]].

## Change map

| File | Responsibility | Safety change |
| --- | --- | --- |
| `src/project-launcher.mjs` | Native launch ownership, recovery, and exact close | Blocks recovery during pending binding, retains expected conversation identity, and suppresses post-close resurrection |
| `src/terminal-launch-coordinator.mjs` | Stable provider-session binding | Uses the exact Codex launch reservation and returns rejected launches for cleanup |
| `src/disposable-terminal-pool.mjs` | Task-owned launch allocation and release | Remembers failed bindings, closes them, and classifies resumed failures as non-retryable |
| `src/websocket-proxy.mjs` | Codex CLI connection identity | Resolves a thread by exact launch ID without relying on deduplicated discovery order |
| `src/codex-app-server.mjs` | Codex runtime facade | Exposes exact launch-to-thread resolution |
| `src/server.mjs` | Runtime composition | Wires exact launch resolution into terminal coordination |
| `test/project-launcher.test.mjs` | Ownership and recovery regression coverage | Covers pending-launch theft, post-close resurrection, and unbound resume suppression |
| `test/terminal-launch-coordinator.test.mjs` | Binding state machine coverage | Covers duplicate conversation clients and rejected binding handoff |
| `test/disposable-terminal-pool.test.mjs` | Allocation and release coverage | Proves one exact close and non-retryable resume rejection |
| `test/websocket-proxy.test.mjs` | Proxy identity coverage | Proves exact launch lookup with an older client on the same conversation |

The blast radius is backend terminal ownership, Codex session discovery, disposable continuation dispatch, cleanup, and automatic retry. There is no database migration, new environment variable, renderer change, authentication change, or public API response change.

### Executive Summary

**Ticket confidence: High**

The corrected path matches the incident evidence and closes every observed leak. A resumed Codex CLI is identified through its unique launch reservation, recovery cannot steal its window while binding, a recently closed conversation cannot be resurrected from a draining connection, and any rejected launch reaches exact cleanup. No continuation prompt is sent before these guards pass.

### Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | The path from `POST /api/tasks/:id/follow-up` through pool preparation, exact proxy identity, binding, cleanup, and queue retry classification is covered. |
| Regression risk (UI / backend / contracts) | Green | No renderer or HTTP contract changed. Recovery is delayed only for the same provider and project while an owned launch is unbound, or for the exact recently closed conversation. |
| Gap risk (edge cases, error handling, completeness) | Amber | Unit tests simulate Terminal.app ownership deterministically, but there is no automated real Terminal.app continuation test against a restarted backend. |
| Code quality (maintainability as safety) | Green | Exact identity remains at the proxy and launcher boundaries. The pool still owns resource release and the queue still owns retry policy. |
| Unit tests | Green | Focused tests cover the incident races, duplicate clients, rejection cleanup, and retry classification. The complete repository suite passes. |
| Performance & scalability (if applicable) | Green | Recovery adds one project-path normalization per discovered thread and a scan of currently owned launches. Expected counts are bounded by configured per-project instance limits. |

### Top 3 Risks

1. A real Codex CLI or Terminal.app behavior change could differ from the deterministic fakes in `test/project-launcher.test.mjs` and `test/websocket-proxy.test.mjs`.
2. `ProjectLauncher.recoveryRetryMs` is still a bounded drain guard. A provider connection that remains stale beyond that interval can become a recovery candidate, although exact pending-launch and launch-reservation checks protect active resumes.
3. The currently running CC Relay backend predates this fix. Restart recovery must occur before manually retrying task 328, or the old process will repeat the original behavior.

### Top Improvements

- Add a macOS Electron integration test that completes a disposable Codex task, immediately continues it, and proves exactly one new Terminal.app window and one new turn.
- Emit the expected conversation ID in `terminal.binding.timed_out` diagnostics to make future resume incidents easier to distinguish from fresh-launch failures.
- Consider clearing post-close recovery suppression from an explicit proxy disconnect signal rather than relying only on the bounded recovery interval.

### Recommendation

**Ship with Mitigations**

Task 328 was cancelled while still queued so the older running backend cannot launch it again. Restart CC Relay before manually retrying that continuation.

---

### Confirmed Issues

1. `ProjectLauncher.recoverConnectedTerminals()` could rebind a terminal immediately after CC Relay closed it because the Codex proxy connection outlived the native process for several seconds.
2. `TerminalLaunchCoordinator.launchNow()` could throw from `bindOwnedTerminal()` before the disposable pool recorded the native launch, so the task cleanup path had no allocation to release.
3. Deduplicated Codex thread discovery could expose an older launch ID when two clients temporarily joined the same saved conversation.
4. All three failures defaulted to retryable queue errors, causing repeated resume terminals even though the saved chat had already loaded.

### Suspected Issues & Edge Cases

- A provider connection that never disconnects could outlive the current recovery suppression interval. This is mitigated for an active resume by pending-launch exclusion and exact launch reservation identity.
- A manual same-project terminal may not gain native close ownership during another unbound launch's short binding window. Task execution and discovery remain available; only recovery ownership is deferred.
- Cancellation during binding remains safe because the disposable guard closes the exact remembered launch before the queue releases the task.

### Regression Risks

- Resume binding timeout now stops for manual attention instead of opening another terminal automatically. This is an intentional safety change and is visible in Task Activity.
- Recovery no longer claims any same-provider, same-project session while an owned launch is still unbound. The window is bounded by binding success, timeout, cancellation, or cleanup.
- Fresh task launch timeouts remain retryable, preserving the existing transient recovery behavior for conversations that have not yet been established.

### Performance Risks

`recoverConnectedTerminals()` remains small and bounded. Candidate filtering is approximately O(T x L), where T is discovered terminal count and L is owned launch count. With project instance limits from 1 through 8, expected work is negligible compared with provider discovery and native process inspection.

### Test Gaps

- No real Terminal.app end-to-end test proves the process-drain timing and exact visible turn.
- No isolated HTTP test submits a disposable continuation through the route and observes the complete native binding lifecycle.

**Are there adequate UNIT tests? Yes.** The unit suite directly reproduces each state transition that caused the incident, including duplicate conversation clients, pending recovery, recently closed recovery, unbound expected identity, binding rejection cleanup, and non-retryable classification.

### Positive Improvements

- Exact launch identity no longer depends on connection insertion order.
- Failed bindings cannot leak their native terminal handle past pool cleanup.
- Automatic retry cannot multiply an ambiguous resumed conversation.
- The fix preserves fresh-task retries, project capacity accounting, and the existing disposable continuation API.

## July 30 2026 resume audit addendum

Nothing above is superseded. Every task 328 invariant was re-verified against the current source on July 30, 2026 and all of them still hold inside one backend process: exact launch-reservation identity, pending-launch recovery exclusion, post-close resurrection suppression, one exact close for a rejected binding, and non-retryable resumed failures. The evidence is recorded per invariant in [[resume-dispatch-audit]].

Two limits were added to the record rather than changed:

- The guards are per-process. On July 30 a packaged desktop backend and a standalone `node src/server.mjs` ran together. The desktop bound its council Claude terminal at 13:22:23.808 and the standalone instance runtime-recovered that same window at 13:22:24.566. The recovery happened after binding, so the pending-launch exclusion was not exercised; the gap is that a second backend cannot see the first backend's in-memory ownership at all. Run one backend.
- `CodexAppServer.waitForIdleThread()` has no deadline. A resumed thread that never leaves `active` would hold a running task with its terminal open and no turn sent. It has never fired in the recorded diagnostics and was left unchanged.

The reported repeat failure on task 39 was not a Codex resume defect. Codex resumed, bound, and completed its review stage in both attempts.

#relay #codex #continuation #terminal #retry #review
