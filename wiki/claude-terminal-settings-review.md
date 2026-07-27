---
name: Claude Terminal Settings and Submission Review
description: Adversarial review of deterministic model and effort application plus visible terminal submission.
type: review
---

# Claude Terminal Settings and Submission Review

### Executive Summary

**Ticket confidence: High**

The original terminal path did not apply a queued task's model or effort. It reported `session default` and used whatever settings were already active in Claude. Task 266 also ran through a Relay server started before the guarded submit fix was written, which is why its event log had neither the new submit-recovery progress event nor the new failure text.

The corrected path treats model and effort as Claude process launch settings. Before each configured terminal turn, `ClaudeTerminalExecutor` re-reads the session, proves the live pid still maps to the owned window and tty, stops that exact pid, and restores the same conversation UUID in the same tab with the pinned Claude binary plus `--model` and `--effort`. It waits for a different pid to register as the same idle interactive session in the same workspace, re-verifies the terminal again, records the transcript offset, then injects the prompt. The existing no-start watcher still sends at most one guarded separate Return.

Three production turns passed against the real `relay-83` terminal on July 25, 2026:

1. A fresh `hi` turn changed the live process from Claude 2.1.218 using Fable and xhigh to Claude 2.1.220 with `--session-id <same UUID> --model opus --effort max`, submitted, returned a visible response, and completed in 11.5 seconds.
2. A second turn restored the existing transcript with `--resume <same UUID> --model opus --effort max`, submitted, and returned exactly `OK`.
3. A 281-line resumed paste submitted and returned exactly `OK`.

The live process stayed on Terminal window `53148` and `/dev/ttys015` while its pid changed as expected. The post-run `ps` command line proved the active launch flags. No headless Claude process was used.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `ClaudeTerminalExecutor.runTurn` applies settings before offset capture and injection. `relaunchForTask` verifies the old pid, resumes the same UUID, requires the same interactive session and workspace, waits for idle, and re-resolves the same window and tty. Three real Terminal.app turns completed. |
| Regression risk (UI / backend / contracts) | Green | The queue and HTTP contracts are unchanged. Existing headless, non-macOS, unowned-terminal, Plan council, and Turbo paths keep their prior execution. `claude/started` now reports the settings actually launched for terminal mode. |
| Gap risk (edge cases, error handling, completeness) | Amber | Claude and Terminal.app remain external processes. An unsent manual draft is discarded when Relay restarts Claude to guarantee task settings. A launch Apple Event can time out after delivery, so that ambiguity deliberately fails non-retryably. |
| Code quality (maintainability as safety) | Green | Command construction is pure and shell-quoted. Process termination, liveness, relaunch, time, and Apple Events are dependency-injected. Pre-launch, post-launch, and pre-injection identity checks are separated and fail closed. |
| Unit tests | Green | Focused coverage includes fresh and resumed command building, selected settings, cancellation during restart, process-exit timeout, ambiguous launch failure, exact terminal ownership refresh, guarded Return behavior, and default runner binary wiring. The full repository suite passes. |
| Performance & scalability (if applicable) | Amber | A configured visible turn adds one Claude restart and bounded polling. Work is constant per turn and isolated by session, but startup adds several seconds compared with typing into an already configured process. |

### Top 3 Risks

1. `src/claude-terminal-executor.mjs`, `relaunchForTask`: Claude CLI startup behavior can change. The guard requires a new pid, the same UUID, interactive source, workspace, window, and tty before any prompt is typed. Re-run the real smoke test after Claude CLI upgrades.
2. `src/claude-terminal-executor.mjs`, settings restart: an unsent user draft in the Claude composer is lost when the verified Claude process stops. This prevents Relay from merging a queued task with unknown draft text, but the UI cannot inspect or preserve that draft.
3. `src/project-launcher.mjs`, `refreshTerminalRuntimeIdentity`: native ownership must follow the new Claude pid without accepting a moved terminal. The method updates only when the window and tty are unchanged, and tests prove a different window or tty is rejected.

### Top Improvements

1. Add a packaged macOS smoke check for one fresh and one resumed visible Claude turn after each supported Claude CLI upgrade.
2. Surface a short composer note that a configured Claude task restarts the selected session and clears any unsent terminal draft.
3. If Claude later exposes a supported local session-settings API, replace the process restart while preserving the same identity and no-double-execution rules.

### Recommendation

**Ship with Mitigations**

Ship the implementation. Restart Relay after the currently active task finishes so the backend loads the new executor. Preserve the live smoke check and the full automated suite as release gates.

### Confirmed Issues

- `src/claude-terminal-executor.mjs` previously emitted `model: 'session default'` and `effort: 'session default'` and never applied the task selections.
- Task 266 ran on server pid `33680`, started July 24 at 15:15, while the guarded submit executor file was written later. Its stored error used the old text and its raw events contained no separate-submit progress event.
- The selected terminal had `hi` in the composer but no turn transcript. The current code cleared that stale draft through the verified process restart and completed a fresh visible `hi` turn.

### Suspected Issues & Edge Cases

- Immediate reuse of the exact old pid could make the new-process check time out. This is safe because Relay types nothing, but it would require a manual retry.
- A future registered-but-idle Claude modal could absorb the launch or prompt. Bounded readiness and no-start guards fail without automatic retyping.
- User interaction in the short interval between verified process exit and shell relaunch could interfere with the tab. The same-window requirement and short settle interval reduce the window, but Terminal.app offers no atomic stop-and-relaunch operation.

### Regression Risks

- Before: terminal tasks silently inherited the live session model and effort. After: configured terminal tasks restart the same session with the task selections.
- Before: a manual draft could merge with Relay's paste. After: the settings restart clears the draft before Relay types.
- Before and after: every ambiguity after prompt injection is non-retryable, preventing queue auto-retry from executing the same turn twice.
- Before and after: Windows, Linux, unowned macOS terminals, oversized prompts, and NUL-bearing prompts use the headless path.

### Performance Risks

The new work is O(1) per visible terminal turn: one SIGTERM, one shell launch Apple Event, bounded session discovery, and two terminal identity resolutions. Different UUIDs remain concurrent. The practical cost is Claude startup latency, observed at roughly a few seconds in the live checks.

### Test Gaps

**Are there adequate UNIT tests? Yes.** The tests cover the normal configured turn, fresh and resumed command shapes, cancellation restoration, process refusal to exit, ambiguous Apple Event failure, pid ownership refresh, terminal movement rejection, prompt injection, guarded submission, transcript completion, and default binary wiring.

The remaining non-unit gap is unavoidable external behavior across future Terminal.app and Claude Code versions. The real three-turn check closes that gap for Claude Code 2.1.220 on the current macOS host.

### Positive Improvements

- Task model and effort are now real execution settings rather than decorative task metadata.
- The exact Claude binary selected at Relay startup is reused for the visible session restart.
- The same conversation UUID, workspace, Terminal window, and tty are preserved.
- Runtime terminal ownership follows the intentional pid change without accepting a moved session.
- Prompt injection occurs only after the relaunched session is idle and verified.
- Submission remains one-shot, observable, and protected against automatic duplicate execution.

See [[claude-terminal-visibility]], [[claude-terminal-submit-review]], [[diagnostics]], and [[hot]].

#claude #terminal #review #diagnosis
