---
name: Terminal Input Attention Review
description: Adversarial ship review of exact-window centering and sound for Claude and Codex questions.
type: review
---

# Terminal Input Attention Review

### Executive Summary

**Ticket confidence: Medium**

The macOS implementation is safe to load. Both provider triggers reach one shared exact-window action, all task and Codex response contracts remain intact, and the full 727-test suite passes. Confidence remains Medium because Terminal.app focus, movement, and audible output were compiled but not executed against a live question while two unrelated tasks were running. Windows native attention is outside the implemented platform boundary.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `ClaudeTerminalExecutor.watchTurn()` requests attention once on `claude/input-required`. `CodexAppServer.handleServerRequest()` emits attention for both generated input-request methods. `ProjectLauncher.requestTerminalAttentionNow()` resolves and rechecks the exact window, TTY, and tab before movement. |
| Regression risk (UI / backend / contracts) | Green | No API, database, renderer, queue status, or persisted event contract changed. Codex still returns the previous empty-answer and cancel fallbacks. Claude attention is fire-and-forget and cannot block its watcher. |
| Gap risk (edge cases, error handling, completeness) | Amber | A live Terminal.app smoke was not safe while unrelated tasks were active. Full-screen or Automation-denied windows may sound and then reject movement. Windows and Linux skip native centering. |
| Code quality (maintainability as safety) | Green | One launcher method owns centering and identity checks for both providers. Diagnostics separate completed, skipped, and failed outcomes. Bounds calculation is pure and tested. |
| Unit tests | Green | Adequate unit tests cover normal flow, identity mismatch, nonblocking native work, both Codex request types, protocol response preservation, source wiring, and multi-display math. |
| Performance & scalability (if applicable) | Green | Work occurs only on input requests. Each request does one bounded runtime resolution and a constant number of native calls. There is no polling, database growth, or renderer work added. |

### Change Map and Execution Trace

| File | Responsibility and change | Downstream impact |
|------|---------------------------|-------------------|
| `src/claude-terminal-executor.mjs` | Starts best-effort attention after the existing input-required event. | Claude task ownership, cancellation, and transcript monitoring continue independently. |
| `src/claude-execution-runner.mjs` | Passes the attention callback into the default terminal executor. | Headless and injected custom executors remain compatible because the callback is optional. |
| `src/codex-app-server.mjs` | Emits `userInputRequested` for tool questions and MCP elicitation before writing the existing fallback reply. | Codex turn protocol and response payloads are unchanged. |
| `src/server.mjs` | Wires both providers to `ProjectLauncher`, using cached or freshly read Codex thread identity. | No HTTP route or capability contract changes. |
| `src/project-launcher.mjs` | Re-resolves native identity, computes centered bounds, fronts the exact Terminal window, and plays the alert. | Shares the existing launch and close serialization boundary and terminal diagnostics. |
| Focused test files | Cover triggers, centering, safety refusal, protocol stability, nonblocking behavior, and wiring. | Protect the complete provider-to-native execution paths. |

Normal Claude flow is `transcript-confirmed turn -> sustained idle -> claude/input-required -> async attention -> user answers -> busy -> claude/input-resumed`. A missing or moved terminal records a skip while the Claude watcher keeps running.

Normal Codex flow is `server request -> input-request diagnostic and event -> existing fallback response -> async thread lookup -> exact native attention`. A null, disconnected, or unowned thread records a skip and cannot redirect another terminal.

### Top 3 Risks

1. `src/project-launcher.mjs`, `requestTerminalAttentionNow()`: Terminal.app can reject bounds changes for a full-screen Space or when Automation permission is unavailable. The action is bounded, diagnostic, and nonfatal.
2. `src/codex-app-server.mjs`, `handleServerRequest()`: future Codex app-server versions could rename input request methods. Generated Codex 0.145.0 bindings confirm both current methods, and tests pin them.
3. `src/project-launcher.mjs`, platform guard: Windows Codex terminals receive no native centering or sound from this feature. Current acceptance and live execution target macOS Terminal.app.

### Top Improvements

1. After active tasks finish and CC Relay restarts, validate one real Claude question and one real Codex question, including an initially minimized window.
2. Add a Windows implementation only after it can revalidate the exact cmd process and native window before movement.
3. Re-run the generated protocol binding check after Codex CLI upgrades that alter server request names or payloads.

### Recommendation

**Ship with Mitigations**

Restart CC Relay only after its current running tasks finish, then use the next genuine provider question as the live Terminal.app smoke. Keep diagnostics visible for the first run.

---

### Confirmed Issues

None remain. The review initially found that Claude awaited the native action, which could pause transcript monitoring on a slow AppleScript. The implementation now schedules attention without awaiting it, and the regression test uses a never-resolving attention promise while the Claude turn still resumes and completes.

### Suspected Issues & Edge Cases

- A full-screen Terminal window may reject scripted bounds. The sound occurs before the final movement commands, the error is diagnostic, and the provider task continues.
- An off-screen window with no display overlap falls back to the primary visible display.
- A window larger than its display preserves size and is mathematically centered, which can leave edges outside the visible frame. CC Relay intentionally does not resize a user's terminal.
- Two rapid input requests serialize with native launch and close actions. This can delay the second alert but prevents window-layout races.

### Regression Risks

- Before: Claude emitted only Task Activity input state. After: it also starts a best-effort native action. Provider timing and persisted task state are unchanged.
- Before: Codex silently sent its fallback response. After: it emits an in-process event first. The exact JSON replies remain unchanged and are asserted.
- Before: `listDisplays()` had no subprocess timeout. After: display discovery is bounded at ten seconds, so a blocked native query now fails loudly instead of hanging a launch indefinitely.

### Performance Risks

Each attention request is O(1) at the CC Relay layer. Native runtime resolution scans the bounded local socket and Terminal inventories once. Input questions are rare, and no work is added to normal transcript polling or HTTP requests.

The native action shares `ProjectLauncher.launchQueue`, so it cannot race launch and close placement. A slow native call can delay another native launch or close by its bounded duration, but it cannot delay the active Claude watcher.

### Test Gaps

- No live audible and visual smoke was run because the current backend had two running tasks.
- No Windows native test exists because Windows centering is not implemented.
- Unit coverage is otherwise adequate: **Yes**, because both normal and refusal paths, provider triggers, async independence, protocol replies, display selection, and source wiring are asserted.

### Positive Improvements

- A question now becomes difficult to miss even when terminals launched behind other windows.
- Runtime identity is re-proven instead of trusting `front window` or an old TTY.
- The same native behavior serves Claude and Codex without duplicating window logic.
- Diagnostics make external Terminal failures observable without converting them into task failures.

See [[terminal-input-attention]], [[claude-terminal-input]], and [[terminal-close-review]].

#relay #review #terminal #attention #claude #codex
