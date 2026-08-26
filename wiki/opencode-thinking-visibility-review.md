---
name: OpenCode Thinking Visibility Review
description: Adversarial ship review of native OpenCode reasoning capture, Task Activity filtering, and honest token telemetry.
type: review
tags:
  - relay
  - opencode
  - reasoning
  - task-activity
  - review
---

# OpenCode Thinking Visibility Review

## Executive Summary

**Ticket confidence: High**

The verified OpenCode 1.18.23 session stored a non-empty `reasoning` part but reported zero numeric
reasoning tokens. The original Relay launch also omitted `--thinking`, which OpenCode defaults to
false in non-interactive mode, and `OpenCodeRunner` ignored reasoning records. The repaired path adds
the native flag, normalizes each returned reasoning part into Relay's existing reasoning item,
deduplicates stream and export copies, and retains provider-reported token usage without estimation.

The installed CLI passed a clean isolated smoke through the patched runner: response `OK`, one native
reasoning record, exit code zero, reported reasoning tokens zero, and successful test-session cleanup.
The full repository suite passed 1,729 tests.

## Change Mapping

| File | Responsibility and changed behavior | Downstream checks |
| --- | --- | --- |
| `src/opencode-runner.mjs` | Adds `--thinking`, emits provider-scoped reasoning items, extracts export reasoning, and deduplicates by native part ID. | Queue event persistence, artifacts, retry isolation, Task Activity grouping. |
| `public/app.js` | Caps only the rendered reasoning preview at 50,000 characters while preserving the stored text and Copy log. | Selected-task refresh performance, escaping, filtered copy. |
| `test/opencode-runner.test.mjs` | Covers launch arguments, native reasoning, duplicate suppression, export recovery, and attempt isolation. | OpenCode runner contract. |
| `test/event-stream.test.mjs` | Proves OpenCode reasoning is toggleable system telemetry, not an AI response. | Counts, filters, Highlights, response history. |
| `test/thinking-visibility.test.mjs` | Protects the preview bound and lossless Copy log path. | Renderer safety contract. |
| `FEATURES.md`, `wiki/` | Documents the CLI default, visible behavior, numeric mismatch, and operator contract. | Product and engineering memory. |

Blast radius is limited to direct OpenCode Execute runs and the provider-neutral reasoning preview.
There is no database migration, API shape change, authentication change, feature flag, cache change,
or new configuration value.

## Functional Execution Trace

1. A direct OpenCode task reaches `OpenCodeRunner.run()` through the existing disposable provider
   allocation.
2. `openCodeRunArguments()` launches `opencode run --format json --thinking --auto` in the exact task
   repository and retains the saved `--session` behavior for retries.
3. OpenCode emits only completed reasoning parts, gated by its native `part.time.end`. Relay converts
   each non-empty part to `item/completed` with `provider: opencode` and `type: reasoning`.
4. Queue persistence records the provider-scoped item without treating it as a response message.
5. Event grouping folds repeated native IDs into one signal. The Thinking switch includes or removes
   that signal from All and Copy log, while Highlights and AI-message counts stay unchanged.
6. If normal completion already requires bounded session export reconciliation, export reasoning
   parts take the same path. An identical stream and export record is dropped by native part ID and
   text.
7. Numeric usage continues through `step_finish`. A provider-reported zero remains zero even when
   reasoning text exists.

Null, empty, or malformed reasoning text emits no item. An out-of-order completed record still renders
correctly because the item is terminal on arrival. Retry export selection accepts only observed
message IDs or assistant messages created after the current attempt start. Cancellation and process
failure retain their existing child-process cleanup and error path.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | Installed CLI help and source confirm the non-interactive default; the isolated patched-runner smoke emitted one reasoning item and a correct response. |
| Regression risk (UI / backend / contracts) | Green | Existing provider-neutral reasoning shape is reused; OpenCode reasoning remains outside response counts and running previews. |
| Gap risk (edge cases, error handling, completeness) | Amber | An OpenCode release older than the verified 1.18.23 could reject `--thinking`; Relay does not currently advertise a minimum OpenCode version. |
| Code quality (maintainability as safety) | Green | Capture and fallback share one `emitReasoning` path with explicit duplicate suppression. |
| Unit tests | Green | Native stream, duplicate, export, isolation, UI-category, filter, and preview-bound contracts are covered; 1,729 tests pass. Adequate UNIT tests: Yes. |
| Performance & scalability | Green | Runner work is O(parts) per attempt, stream lines remain capped at 4 MB, exports at 8 MB, and each rendered reasoning preview is capped at 50,000 characters. |

## Top 3 Risks

1. Older OpenCode versions may not accept `--thinking` in `openCodeRunArguments()`. The verified
   1.18.23 binary accepts it, and an unsupported option fails loudly before provider work, but runtime
   detection has no minimum-version gate.
2. Provider reasoning can contain much more text than a Codex summary. `reasoningPreview()` bounds
   repeated DOM construction while `eventCopyText()` keeps the lossless channel.
3. Providers can expose reasoning text while reporting zero reasoning tokens. Any attempt to infer a
   count would create false telemetry, so `normalizeTokenUsage()` remains authoritative.

## Top Improvements

1. Add an explicit supported OpenCode version or capability probe if older CLI compatibility becomes
   a product requirement.
2. Add a packaged desktop smoke for one OpenCode reasoning run after future OpenCode CLI upgrades.
3. Consider a dedicated disclosure for reasoning previews only if operators need on-screen access to
   more than 50,000 characters without using Copy log.

## Recommendation

**Ship.** The remaining version-compatibility risk is low for the verified runtime and fails loudly.

## Confirmed Issues

- `openCodeRunArguments()` omitted `--thinking`, so OpenCode suppressed reasoning records in the
  non-interactive JSON stream.
- `OpenCodeRunner.consumeRecord()` had no reasoning branch even if a record arrived.
- An unbounded provider reasoning preview could make repeated Task Activity refreshes unnecessarily
  expensive. The 50,000-character render cap fixes this without data loss.

## Suspected Issues & Edge Cases

- OpenCode versions predating the native flag may reject the new argument. No such version was
  available locally for a compatibility test.
- A malformed provider record without a native part ID can create a fallback ID. OpenCode's supported
  schema supplies stable part IDs, so duplicate protection is strongest on valid records.

## Regression Risks

- Before: OpenCode runs completed but silently discarded reasoning visibility. After: reasoning text
  is persisted locally and visible by default, so task databases can grow by the bounded provider
  payload size.
- Before: OpenCode response history contained only `opencode/message`. After: that remains true;
  reasoning is deliberately system telemetry and does not change references, search responses, or AI
  message counts.
- Before: the Thinking switch covered Codex summaries only. After: the same control covers both
  providers without a new renderer preference.

## Performance Risks

`reasoningTextByPart` and export extraction are O(P) in reasoning parts and hold at most the bounded
current-run text until the child settles. Renderer work is capped at 50,000 characters per reasoning
entry per refresh. No new polling, process, network request, or database query was added.

## Test Gaps

- No older OpenCode binary was available to test unknown-option behavior.
- The live smoke used the installed configured model in an isolated temporary directory, not a
  packaged desktop build containing the patch. A rebuilt or updated desktop is still required for the
  operator-facing smoke.

## Positive Improvements

- The user-visible reasoning path now matches the native session evidence.
- Numeric token telemetry remains honest instead of being estimated from reasoning text.
- Duplicate stream and export records cannot create duplicate Task Activity rows.
- Escaping, filtering, copy semantics, response counts, retry isolation, and payload bounds reuse
  established Relay contracts.

See [[opencode-provider-and-token-throughput]], [[opencode-token-throughput-review]],
[[interface-layout]], and [[hot]].

#relay #opencode #reasoning #task-activity #review
