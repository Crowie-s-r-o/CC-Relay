---
name: Execute Plan Council Ship Review
description: Adversarial ship review for the persisted three-stage planning pipeline.
type: review
---

# Execute Plan Council Ship Review

### Executive Summary

**Ticket confidence: High for deterministic behavior, amber for live new-backend validation**

The implementation now matches the requested primitive contract exactly: Claude authors from the original brief, Codex reviews the original brief plus Claude's draft, and Claude revises from the original brief plus draft plus review. Each successful stage is persisted before the next begins. The only Markdown deliverable is the final `plan.md`, and a completed plan can create a linked Execute task on any selected same-workspace Codex or Claude Relay.

The investigation reproduced the machine's provider failure at the time of the report. `claude auth status --json` reported `loggedIn: false`, and a real non-interactive Plan command exited with `Failed to authenticate: OAuth session expired and could not be refreshed`. The old runner discarded that JSON, reported only exit code 1, and the queue retried indefinitely. Claude was authenticated again before this review finished, and the running backend now reports it ready. The corrected runner preserves the provider message, never automatically retries a Plan council, and resumes explicitly from saved checkpoints.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | Unit traces prove all three prompt handoffs, original brief propagation, attachment propagation, final-only output, stage resume, empty-output rejection, liveness, timeout, and exact task-scoped cancellation. |
| Regression risk | Amber | The full 258-test suite passes. The running backend cannot be restarted while this task owns it, so the new HTTP routes have not been exercised against the live desktop process. Capability gating keeps the new renderer safe against that older process. |
| Gap risk | Amber | Claude authentication is healthy again, but the running Relay process predates the new resume, artifact, and execution routes and has active tasks. Restarting it for a successful new-backend smoke test would interrupt user work. |
| Code quality | Green | Prompt construction, state-machine execution, artifact storage, plan-to-execution validation, queue policy, HTTP routing, and renderer actions have separate responsibilities. |
| Unit tests | Green | 258 tests pass. The new tests cover stage handoffs, reviewer and revision resume, timeout, provider error extraction, queue retry policy, one canonical artifact, and executor validation. Adequate UNIT tests: Yes. |
| Performance and scalability | Green | Council work is sequential by design. Checkpoint writes are small atomic local writes, heartbeat cost is constant, and failed stages no longer create unbounded provider traffic. |

### Functional Execution Trace

1. Submission stores the original brief, selected Codex reviewer, provider settings, and references in the ordinary task record.
2. `PlanCouncilRunner` loads compatible `plan.json` state or creates version 2 state, then persists it atomically.
3. Claude receives the author prompt and references. A non-empty response is stored as `draft` before Codex starts.
4. Codex receives the original brief, references, and saved draft in read-only mode. A non-empty response is stored as `review` before revision starts.
5. Claude receives the original brief, references, draft, and review. Its non-empty response is stored as `finalPlan`.
6. Completion atomically writes state and canonical `plan.md`, then removes a stale `result.md` if present.
7. Failure records the exact stage and error. The queue does not schedule an automatic retry.
8. Manual resume validates Claude authentication and a connected same-workspace Codex reviewer, preserves `plan.json`, and skips every stage with a saved output.
9. **Execute on Relay** validates a completed source, selected provider, live session, workspace, model, effort, and attachments, then creates a linked direct Execute task containing the original request and final plan.

### Top 3 Risks

1. A successful live pass still requires a normal Relay restart after its active tasks finish. The current process serves the old runner and cannot hot-load backend routes.
2. The HTTP execute and resume routes are covered through their pure validators, source contracts, queue tests, and syntax checks rather than a live server integration fixture with connected fake providers.
3. A one-hour stage limit is intentionally generous. It prevents infinite hangs, but a genuinely wedged provider can still occupy its exclusive council lane until that bound or explicit cancellation.

### Top Improvements

1. After a normal Relay restart, run one small live council and execute its result on a second Relay as a release smoke test.
2. Add an injectable HTTP server fixture with fake Codex and Claude registries so route-level resume, artifact download, and execute calls can run in CI.
3. Consider a user-configurable stage cancellation control in Task Activity if one-hour provider turns become common. Do not reintroduce automatic retries.

### Recommendation

**Ship with mitigations.** The implementation and deterministic coverage are strong. Claude authentication is healthy again. Before calling the new workflow live-verified, restart Relay after active work finishes and complete the smoke test above.

### Confirmed Issues

- Fixed: failed Plan councils entered an unlimited five-second automatic retry loop.
- Fixed: retry recreated the council and paid for completed author work again.
- Fixed: nonzero Claude JSON errors were discarded behind a generic exit-code message.
- Fixed: the runner emitted no heartbeat and had no safety timeout.
- Fixed: completed output mixed draft, review, and final material instead of exposing one canonical execution-ready Markdown file.
- Fixed: completed plans had no API or UI path to execute on a chosen Relay.
- Fixed during review: timeout and cancellation could call the Codex runner without the exact Plan task ID, risking cancellation of unrelated work.
- Fixed during review: new static UI could call unsafe resume or artifact routes on an older backend. Separate capability gates now fail closed.
- Fixed during review: retry route mutation and attachment copying needed stricter status, workspace, and path checks.

### Suspected Issues & Edge Cases

- Provider output can be syntactically valid Markdown but still be a poor plan. The independent review reduces this product risk but cannot eliminate it mechanically.
- Disk exhaustion during an atomic rename will fail the task loudly. The prior completed checkpoint remains intact when the rename itself fails.
- Repeated execution of the same completed plan is allowed intentionally. Each run is a distinct linked Execute task.

### Regression Risks

- Plan council failures now require an explicit resume, which changes former queue behavior but prevents invisible spend and preserves user control.
- Completed Plan tasks no longer receive `result.md`. Consumers must use the task database result or canonical `plan.md`.
- Execution is restricted to the source workspace. A Relay in another project is intentionally not an eligible target.

### Performance Risks

- None material. The new heartbeat is one event every 30 seconds, and atomic state files are small.
- The major performance correction is removal of unbounded repeated provider launches.

### Test Gaps

- The OAuth failure was reproduced directly and authentication was later restored, but no successful pass used the new runner because the live Relay backend is still the older process and has active tasks.
- No in-app browser or Electron CDP runtime was available, so rendered interaction was checked through source contracts and deterministic tests, not a live click-through.
- There is no real-provider failure injection at each network boundary in CI.

### Positive Improvements

- Provider work is durable at stage boundaries.
- Errors name the real remediation instead of an exit code.
- The plan is portable as one readable Markdown artifact and remains traceable to its source task.
- Execution is an explicit user choice and inherits the selected Relay's settings.
- Existing version 1 completed plans self-heal to the canonical artifact format when opened.

See [[plan-council]], [[diagnostics]], [[task-history]], and [[interface-layout]].

#relay #plan-council #review #ship

## Execution Visibility Follow-up Review

### Executive Summary

**Ticket confidence: High for code and artifact behavior, amber for live restarted-backend interaction**

The execution capability existed in source but was too implicit, and the live Relay process still lacked `planArtifacts` and `planExecution`. The completed-plan UI now makes both deliverables explicit in one place. It always shows the local `plan.md` path, explains the restart boundary on an old backend, lists every opened same-workspace Codex and Claude Relay, and names the chosen provider and Relay on the execution button.

Task 194 was also a real legacy artifact counterexample: its old `plan.md` combined draft, review, and final text and had a duplicate `result.md`. Running it through the production `ArtifactStore.writePlan()` path preserved draft and review in `plan.json`, rewrote `plan.md` to equal only `finalPlan`, removed `result.md`, and confirmed `.gitignore` excludes `.data/`.

### Quality Panel (RAG)

| Area | Rating | Evidence |
|------|--------|----------|
| Functional correctness | Green | `renderPlanPreview()` always exposes the artifact row after final output. `eligiblePlanExecutionThreads()` accepts only Codex or Claude sessions in the exact task workspace. `executeReviewedPlan()` submits the explicit selector target, and the server repeats provider, connection, workspace, status, model, effort, and attachment validation. |
| Regression risk (UI / backend / contracts) | Amber | The full 258-test suite passes and the current server hot-serves the new markup and module. The server process is older and has an active task, so its backend cannot be restarted for the final live click without interrupting user work. |
| Gap risk (edge cases, error handling, completeness) | Green | No opened Relay, old backend capability, disconnected selection, Claude sign-out, duplicate clicks, cross-workspace selection, missing attachments, and stale provider sessions all fail visibly or are rejected server-side. |
| Code quality (maintainability as safety) | Green | The execution UI reuses existing thread discovery, provider labels, per-thread execution settings, capability flags, and the one server route. It does not introduce another execution path. |
| Unit tests | Green | 258 tests pass. Source-contract tests cover visible artifact, ignored data directory, explicit selector, both providers, same-workspace filtering, capability fallback, route call, and source-task linkage. Backend unit tests cover prompt content and validation. Adequate UNIT tests: Yes. |
| Performance and scalability | Green | Each refresh filters and renders the small connected-session list, O(t) for `t` opened Relays. No new polling, storage scan, or provider request was added. |

### Top 3 Risks

1. The new backend routes are not active until the current Relay process restarts. Static UI correctly explains this, but the execute click cannot succeed before restart.
2. Renderer interaction could not be exercised through Electron CDP or the in-app browser because neither runtime was available. Deterministic source contracts and served-asset inspection cover structure, not pointer interaction.
3. An unusually long Claude session title can lengthen button text. CSS now constrains it with ellipsis, while the adjacent select retains the full native option text.

### Top Improvements

1. Restart Relay after active work finishes, select task 194, choose one Codex and one Claude session in turn, and execute a harmless reviewed-plan fixture as the final smoke test.
2. Add an injectable server and DOM fixture so capability fallback, selector changes, and the real POST response can run together in CI.
3. Consider a small copy-path action only if users need filesystem navigation beyond the existing visible path and open link.

### Recommendation

**Ship with mitigations.** The artifact and selection behavior are deterministic and fully tested at their current seams. One normal restart and live click-through remain before calling the new backend interaction visually verified.

### Confirmed Issues

- Fixed: the canonical artifact row was hidden entirely when static UI ran against an older backend.
- Fixed: plan execution depended on the global Relay selection and was easy to miss in the generic task action row.
- Fixed: task 194 retained a combined council transcript in `plan.md` and a duplicate `result.md`.
- Confirmed: `.data/` is Git-ignored, and task 194's canonical plan produces no Git status entry.

### Suspected Issues & Edge Cases

- A session may disconnect between selector refresh and click. The server reads the exact provider registry again and returns an actionable error without queueing work.
- Multiple completed plans may remember different Relay selections in memory. This is intentional and resets with the renderer process.
- A new Relay can appear during polling. The selector refreshes from current thread discovery and preserves an existing valid choice.

### Regression Risks

- The execution action moved from the generic task-header buttons into the final-plan panel. This improves discoverability but changes muscle memory for anyone who used the unreleased earlier implementation.
- The artifact path is visible on an old backend even though its link is disabled. This is intentional because the file exists locally and the missing capability affects only HTTP access.
- The selector chooses the first eligible Relay when no current or remembered Relay remains. The button names that fallback before any request is sent.

### Performance Risks

None material. Rendering is O(t), where `t` is the number of connected Relays, and runs only during existing detail or thread refreshes.

### Test Gaps

- No live Electron or browser automation runtime was available.
- The running backend lacks the new capability flags and cannot be restarted while task 196 is active.
- Route-level integration still relies on pure validator tests plus server source contracts rather than a fake connected provider registry.

### Positive Improvements

- The final plan, its disk location, Git behavior, eligible executors, and next action are now colocated.
- Compatibility behavior is visible rather than silently hiding unavailable controls.
- The selected execution provider is explicit before queueing, while server validation remains authoritative.

See [[plan-council]], [[interface-layout]], [[task-history]], and [[diagnostics]].

#relay #plan-council #execution #review
